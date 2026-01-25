import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FileUp, Save, Shield, Trash2 } from 'lucide-react'
import ContextBackLink from '@/components/ContextBackLink'
import TransactionItemsList from '@/components/TransactionItemsList'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useToast } from '@/components/ui/ToastContext'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useAccount } from '@/contexts/AccountContext'
import { extractPdfText } from '@/utils/pdfTextExtraction'
import { parseWayfairInvoiceText, WayfairInvoiceLineItem, WayfairInvoiceParseResult } from '@/utils/wayfairInvoiceParser'
import { normalizeMoneyToTwoDecimalString, parseMoneyToNumber } from '@/utils/money'
import { projectService, transactionService, unifiedItemsService } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import CategorySelect from '@/components/CategorySelect'
import { extractPdfEmbeddedImages, type PdfEmbeddedImagePlacement } from '@/utils/pdfEmbeddedImageExtraction'
import { COMPANY_NAME } from '@/constants/company'
import type { ItemImage, TransactionItemFormData } from '@/types'
import { projectTransactionDetail, projectTransactions } from '@/utils/routes'
import { navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'
import { loadTransactionItemsWithReconcile } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'

function getTodayIsoDate(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function formatCurrencyFromString(amount: string): string {
  const n = Number.parseFloat(amount)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function sumLineTotals(lineItems: WayfairInvoiceLineItem[]): string {
  const sum = lineItems.reduce((acc, li) => acc + (parseMoneyToNumber(li.total) || 0), 0)
  return sum.toFixed(2)
}

const WAYFAIR_ASSET_UPLOAD_CONCURRENCY = 4
const DEFAULT_RAW_TEXT_LINE_LIMIT = 400
const RAW_TEXT_PREVIEW_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '200', value: 200 },
  { label: '400', value: 400 },
  { label: '800', value: 800 },
  { label: '1600', value: 1600 },
  { label: 'All', value: 0 },
]
const PARSE_REPORT_FIRST_LINE_LIMIT = 600

type WayfairAssetItemPayload = {
  description: string
  files: File[]
}

type WayfairAssetFinalizePayload = {
  accountId: string
  projectId: string
  transactionId: string
  projectName: string
  items: WayfairAssetItemPayload[]
  receiptFile: File | null
  totalUploads: number
}

function createConcurrencyLimiter(maxConcurrent: number) {
  if (maxConcurrent < 1) {
    throw new Error('Concurrency limiter requires at least one slot.')
  }

  let activeCount = 0
  const queue: Array<() => void> = []

  const next = () => {
    activeCount = Math.max(0, activeCount - 1)
    const task = queue.shift()
    if (task) {
      task()
    }
  }

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const runTask = () => {
        activeCount++
        task()
          .then(resolve)
          .catch(reject)
          .finally(next)
      }

      if (activeCount < maxConcurrent) {
        runTask()
      } else {
        queue.push(runTask)
      }
    })
  }
}

type WayfairItemDraft = {
  qty: number
  sourceIndex: number
  template: Omit<TransactionItemFormData, 'id'>
}

type WayfairThumbnailDebugInfo = {
  extractedCount: number
  headerDropCount: number
  extraDropCount: number
  finalMatchCount: number
  placements: Array<{
    pageNumber: number
    bbox: PdfEmbeddedImagePlacement['bbox']
    pageHeight: number
    width: number
    height: number
    score: number
  }>
}

function buildWayfairItemDrafts(lineItemsWithIndex: Array<{ li: WayfairInvoiceLineItem; sourceIndex: number }>): WayfairItemDraft[] {
  const drafts: WayfairItemDraft[] = []

  for (const { li, sourceIndex } of lineItemsWithIndex) {
    const qty = Math.max(1, Math.floor(li.qty || 1))
    const totalNum = parseMoneyToNumber(li.total)
    const unitPriceNum = li.unitPrice ? parseMoneyToNumber(li.unitPrice) : undefined
    const shippingNum = li.shipping ? (parseMoneyToNumber(li.shipping) || 0) : 0
    const adjustmentNum = li.adjustment ? (parseMoneyToNumber(li.adjustment) || 0) : 0
    const taxNum = li.tax ? (parseMoneyToNumber(li.tax) || 0) : 0

    const perUnitFromTotal = totalNum !== undefined ? totalNum / qty : undefined
    const shippingPerUnit = shippingNum / qty
    const adjustmentPerUnit = adjustmentNum / qty
    const taxPerUnit = taxNum / qty
    const perUnitPurchasePrice = unitPriceNum !== undefined
      ? (unitPriceNum - adjustmentPerUnit + shippingPerUnit)
      : (perUnitFromTotal ?? totalNum ?? 0)

    const perUnitPurchaseMoney = normalizeMoneyToTwoDecimalString(String(perUnitPurchasePrice)) || '0.00'
    const perUnitTaxMoney = normalizeMoneyToTwoDecimalString(String(taxPerUnit)) || undefined

    const baseNotesParts: string[] = []
    if (li.shippedOn) baseNotesParts.push(`Wayfair shipped on ${li.shippedOn}`)
    if (li.section === 'to_be_shipped') baseNotesParts.push('Wayfair: items to be shipped')
    const attributeNoteParts: string[] = []
    if (li.attributeLines && li.attributeLines.length > 0) {
      attributeNoteParts.push(...li.attributeLines)
    } else {
      if (li.attributes?.color) attributeNoteParts.push(`Color: ${li.attributes.color}`)
      if (li.attributes?.size) attributeNoteParts.push(`Size: ${li.attributes.size}`)
    }
    for (const p of Array.from(new Set(attributeNoteParts.map(x => x.trim()).filter(Boolean)))) {
      baseNotesParts.push(p)
    }
    const baseNotes = baseNotesParts.length > 0 ? baseNotesParts.join(' • ') : 'Wayfair import'

    drafts.push({
      qty,
      sourceIndex,
      template: {
        description: li.description,
        sku: li.sku,
        purchasePrice: perUnitPurchaseMoney,
        price: perUnitPurchaseMoney,
        taxAmountPurchasePrice: perUnitTaxMoney,
        notes: baseNotes,
      },
    })
  }

  return drafts
}

function expandWayfairItemDrafts(drafts: WayfairItemDraft[]): {
  items: TransactionItemFormData[]
  imageFilesMap: Map<string, File[]>
} {
  const items: TransactionItemFormData[] = []
  const imageFilesMap = new Map<string, File[]>()

  for (const draft of drafts) {
    const qty = Math.max(1, Math.floor(draft.qty || 1))

    // Compute uiGroupKey for grouping identical items (same as getTransactionFormGroupKey logic)
    let uiGroupKey: string | undefined
    const normalizedSku = (draft.template.sku || '').trim().toLowerCase()

    if (normalizedSku) {
      // Only group items with non-empty SKU
      const normalizedPrice = (draft.template.purchasePrice || draft.template.price || '').trim().toLowerCase().replace(/[^0-9.-]/g, '')
      uiGroupKey = [normalizedSku, normalizedPrice].join('|')
    } else {
      // Items with null/empty SKU get unique keys (no grouping)
      uiGroupKey = `unique-${Math.random()}`
    }

    for (let i = 0; i < qty; i++) {
      const id = crypto.randomUUID()
      const templateImages = draft.template.images ? draft.template.images.map(img => ({ ...img })) : undefined
      const templateImageFiles = draft.template.imageFiles ? [...draft.template.imageFiles] : undefined
      const description = draft.template.description || ''

      items.push({
        id,
        ...draft.template,
        description,
        images: templateImages,
        imageFiles: templateImageFiles,
        uiGroupKey,
      })

      if (templateImageFiles?.length) {
        imageFilesMap.set(id, templateImageFiles)
      }
    }
  }

  return { items, imageFilesMap }
}

function scoreEmbeddedImagePlacement(placement: PdfEmbeddedImagePlacement): number {
  const width = Math.abs(placement.bbox.xMax - placement.bbox.xMin)
  const height = Math.abs(placement.bbox.yMax - placement.bbox.yMin)
  const area = width * height
  const aspectRatio = height > 0 ? width / height : 0

  let score = 0

  if (area >= 4000) score += 2
  if (area >= 9000) score += 1
  if (width >= 40 && height >= 40) score += 1
  if (placement.bbox.xMin <= 240) score += 1

  if (aspectRatio >= 0.7 && aspectRatio <= 1.5) {
    score += 2
  } else if (aspectRatio >= 2.2 || aspectRatio <= 0.5) {
    score -= 3
  }

  if (placement.pageNumber === 1 && placement.bbox.yMax >= 650) score -= 4
  if (height < 35 || width < 35) score -= 2

  return score
}

function filterPageAnchoredDecorativeImages(
  placements: PdfEmbeddedImagePlacement[]
): { filteredPlacements: PdfEmbeddedImagePlacement[]; droppedCount: number } {
  if (placements.length === 0) {
    return { filteredPlacements: placements, droppedCount: 0 }
  }

  const filteredPlacements = placements.filter(placement => {
    if (placement.pageNumber !== 1) return true
    const pageHeight = placement.pageHeight || 792
    const width = Math.abs(placement.bbox.xMax - placement.bbox.xMin)
    const height = Math.abs(placement.bbox.yMax - placement.bbox.yMin)
    const aspectRatio = height > 0 ? width / height : 0
    const nearTopHeaderBand = placement.bbox.yMin >= pageHeight - 180
    const touchesTopMargin = placement.bbox.yMax >= pageHeight - 30
    const extremelyWide = width >= 140 || aspectRatio >= 2.2
    const veryShort = height <= 70

    if ((nearTopHeaderBand || touchesTopMargin) && (extremelyWide || veryShort)) {
      return false
    }
    return true
  })

  return {
    filteredPlacements,
    droppedCount: placements.length - filteredPlacements.length,
  }
}

function normalizeEmbeddedImagesForLineItems(
  embeddedImages: PdfEmbeddedImagePlacement[],
  lineItemCount: number
): { normalizedImages: PdfEmbeddedImagePlacement[]; droppedCount: number } {
  if (embeddedImages.length <= lineItemCount) {
    return { normalizedImages: embeddedImages, droppedCount: 0 }
  }

  const extras = embeddedImages.length - lineItemCount
  const scored = embeddedImages.map((placement, idx) => ({
    placement,
    idx,
    score: scoreEmbeddedImagePlacement(placement),
  }))

  scored.sort((a, b) => {
    if (a.score === b.score) return a.idx - b.idx
    return a.score - b.score
  })

  const indicesToDrop = new Set(scored.slice(0, extras).map(entry => entry.idx))
  const normalizedImages = embeddedImages.filter((_, idx) => !indicesToDrop.has(idx))

  return {
    normalizedImages,
    droppedCount: indicesToDrop.size,
  }
}

function applyThumbnailsToDrafts(
  drafts: WayfairItemDraft[],
  embeddedImages: PdfEmbeddedImagePlacement[],
  sourceLineItems: WayfairInvoiceLineItem[]
): { drafts: WayfairItemDraft[]; warning: string | null; debug: WayfairThumbnailDebugInfo } {
  const warningParts: string[] = []
  const { filteredPlacements, droppedCount: headerDrops } = filterPageAnchoredDecorativeImages(embeddedImages)
  const { normalizedImages, droppedCount } = normalizeEmbeddedImagesForLineItems(filteredPlacements, sourceLineItems.length)
  const thumbnailFiles = normalizedImages.map(p => p.file)

  if (thumbnailFiles.length === 0) {
    warningParts.push('No embedded item thumbnails detected in the PDF.')
  } else if (thumbnailFiles.length !== sourceLineItems.length) {
    warningParts.push(`Detected ${thumbnailFiles.length} embedded thumbnail(s) but parsed ${sourceLineItems.length} line item(s). Matching will be partial; please review.`)
  }

  const totalDropped = headerDrops + droppedCount
  if (totalDropped > 0) {
    warningParts.push(`Ignored ${totalDropped} decorative image${totalDropped === 1 ? '' : 's'} that did not match any line items.`)
  }

  const placementsWithScore = normalizedImages.map(placement => {
    const width = Math.abs(placement.bbox.xMax - placement.bbox.xMin)
    const height = Math.abs(placement.bbox.yMax - placement.bbox.yMin)
    return {
      pageNumber: placement.pageNumber,
      bbox: placement.bbox,
      pageHeight: placement.pageHeight,
      width,
      height,
      score: scoreEmbeddedImagePlacement(placement),
    }
  })

  const updatedDrafts = drafts.map(draft => {
    const matchedThumb = thumbnailFiles[draft.sourceIndex]
    if (!matchedThumb) return draft

    const previewImage = createPreviewItemImageFromFile(matchedThumb, true)
    return {
      ...draft,
      template: {
        ...draft.template,
        images: [previewImage],
        imageFiles: [matchedThumb],
      },
    }
  })

  return {
    drafts: updatedDrafts,
    warning: warningParts.length > 0 ? warningParts.join(' ') : null,
    debug: {
      extractedCount: embeddedImages.length,
      headerDropCount: headerDrops,
      extraDropCount: droppedCount,
      finalMatchCount: thumbnailFiles.length,
      placements: placementsWithScore,
    },
  }
}

function createPreviewItemImageFromFile(file: File, isPrimary: boolean): ItemImage {
  const url = URL.createObjectURL(file)
  return {
    url,
    alt: file.name,
    isPrimary,
    uploadedAt: new Date(),
    fileName: file.name,
    size: file.size,
    mimeType: file.type || 'image/png',
  }
}

export default function ImportWayfairInvoice() {
  const { id, projectId: routeProjectId } = useParams<{ id?: string; projectId?: string }>()
  const resolvedProjectId = routeProjectId || id
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isOwner } = useAuth()
  const { currentAccountId } = useAccount()
  const { getBackDestination } = useNavigationContext()
  const { showError, showInfo, showSuccess, showWarning } = useToast()
  const activeParseRunRef = useRef(0)
  const invoiceFileInputRef = useRef<HTMLInputElement | null>(null)
  const fallbackPath = useMemo(
    () => (resolvedProjectId ? projectTransactions(resolvedProjectId) : '/projects'),
    [resolvedProjectId]
  )

  if (!currentAccountId && !isOwner()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <Shield className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You don&apos;t have permission to import transactions. Please contact an administrator if you need access.
          </p>
          <ContextBackLink
            fallback={getBackDestination(fallbackPath)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Back to Project
          </ContextBackLink>
        </div>
      </div>
    )
  }

  const [projectName, setProjectName] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseResult, setParseResult] = useState<WayfairInvoiceParseResult | null>(null)
  const [transactionDate, setTransactionDate] = useState(getTodayIsoDate())
  const [paymentMethod, setPaymentMethod] = useState<string>('Client Card')
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [taxRatePreset, setTaxRatePreset] = useState<string | undefined>(undefined)
  const [subtotal, setSubtotal] = useState<string>('')
  const [items, setItems] = useState<TransactionItemFormData[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isExtractingThumbnails, setIsExtractingThumbnails] = useState(false)
  const [embeddedImagePlacements, setEmbeddedImagePlacements] = useState<PdfEmbeddedImagePlacement[]>([])
  const [thumbnailWarning, setThumbnailWarning] = useState<string | null>(null)
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())
  const [thumbnailDebugInfo, setThumbnailDebugInfo] = useState<WayfairThumbnailDebugInfo | null>(null)
  const [extractedPdfText, setExtractedPdfText] = useState<string | null>(null)
  const [extractedPdfPages, setExtractedPdfPages] = useState<string[] | null>(null)
  const [rawTextLineLimit, setRawTextLineLimit] = useState<number>(DEFAULT_RAW_TEXT_LINE_LIMIT)

  const debugStats = useMemo(() => {
    if (!parseResult) return null
    const skuCount = parseResult.lineItems.filter(li => Boolean(li.sku && li.sku.trim())).length
    const attrCount = parseResult.lineItems.filter(li => Boolean(li.attributeLines && li.attributeLines.length > 0)).length
    return {
      skuCount,
      missingSkuCount: parseResult.lineItems.length - skuCount,
      attrCount,
      missingAttrCount: parseResult.lineItems.length - attrCount,
    }
  }, [parseResult])

  useEffect(() => {
    const loadProject = async () => {
      if (!resolvedProjectId || !currentAccountId) return
      try {
        const project = await projectService.getProject(currentAccountId, resolvedProjectId)
        if (project?.name) setProjectName(project.name)
      } catch (e) {
        console.error('Failed to load project:', e)
      }
    }
    loadProject()
  }, [resolvedProjectId, currentAccountId])



  const includedLineItems = useMemo(() => {
    if (!parseResult) return []
    return parseResult.lineItems
  }, [parseResult])

  const parseStats = useMemo(() => {
    if (!parseResult) return null
    const shipped = parseResult.lineItems.filter(li => li.section === 'shipped').length
    const toBeShipped = parseResult.lineItems.filter(li => li.section === 'to_be_shipped').length
    const unknown = parseResult.lineItems.filter(li => li.section === 'unknown').length
    return { shipped, toBeShipped, unknown, total: parseResult.lineItems.length }
  }, [parseResult])

  const normalizedRawTextLines = useMemo(() => {
    if (!extractedPdfText) return []
    return extractedPdfText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
  }, [extractedPdfText])

  const rawTextPreviewLines = useMemo(() => {
    if (rawTextLineLimit <= 0) return normalizedRawTextLines
    return normalizedRawTextLines.slice(0, rawTextLineLimit)
  }, [normalizedRawTextLines, rawTextLineLimit])

  const formattedRawTextPreview = useMemo(() => {
    if (rawTextPreviewLines.length === 0) return ''
    return rawTextPreviewLines
      .map((line, idx) => `${String(idx + 1).padStart(3, '0')}: ${line}`)
      .join('\n')
  }, [rawTextPreviewLines])

  const parseReportPreviewCount = useMemo(() => {
    if (normalizedRawTextLines.length === 0) return PARSE_REPORT_FIRST_LINE_LIMIT
    return Math.min(PARSE_REPORT_FIRST_LINE_LIMIT, normalizedRawTextLines.length)
  }, [normalizedRawTextLines])

  const handleReset = () => {
    activeParseRunRef.current += 1
    setSelectedFile(null)
    if (invoiceFileInputRef.current) {
      invoiceFileInputRef.current.value = ''
    }
    setParseResult(null)
    setExtractedPdfText(null)
    setExtractedPdfPages(null)
    setTransactionDate(getTodayIsoDate())
    setPaymentMethod('Client Card')
    setAmount('')
    setNotes('')
    setTaxRatePreset(undefined)
    setSubtotal('')
    setItems([])
    setIsParsing(false)
    setIsExtractingThumbnails(false)
    setEmbeddedImagePlacements([])
    setThumbnailWarning(null)
    setImageFilesMap(new Map())
    setThumbnailDebugInfo(null)
    setGeneralError(null)
    setRawTextLineLimit(DEFAULT_RAW_TEXT_LINE_LIMIT)
  }

  const applyParsedInvoiceToDraft = (
    result: WayfairInvoiceParseResult,
    thumbnailsOverride?: PdfEmbeddedImagePlacement[]
  ) => {
    const today = getTodayIsoDate()
    setTransactionDate(result.orderDate || today)

    const lineItemsWithIndex = result.lineItems.map((li, idx) => ({ li, sourceIndex: idx }))

    const lineItemsForAmount = lineItemsWithIndex.map(x => x.li)
    const computedSum = sumLineTotals(lineItemsForAmount)
    const defaultAmount = result.orderTotal || computedSum
    setAmount(defaultAmount)

    const hasSubtotal = Boolean(result.calculatedSubtotal && result.orderTotal)
    if (hasSubtotal && result.calculatedSubtotal) {
      setTaxRatePreset('Other')
      setSubtotal(result.calculatedSubtotal)
    } else {
      setTaxRatePreset(undefined)
      setSubtotal('')
    }

    const notesParts: string[] = []
    notesParts.push('Wayfair import')
    if (result.invoiceNumber) notesParts.push(`Invoice # ${result.invoiceNumber}`)
    if (result.orderDate) notesParts.push(`Order date: ${result.orderDate}`)
    setNotes(notesParts.join(' • '))

    let drafts = buildWayfairItemDrafts(lineItemsWithIndex)
    let warning: string | null = null
    const thumbnailsToUse = thumbnailsOverride ?? embeddedImagePlacements

    if (thumbnailsToUse.length > 0) {
      const applied = applyThumbnailsToDrafts(drafts, thumbnailsToUse, result.lineItems)
      drafts = applied.drafts
      warning = applied.warning
      setThumbnailDebugInfo(applied.debug)
    } else if (thumbnailsOverride) {
      warning = 'No embedded item thumbnails detected in this PDF.'
      setThumbnailDebugInfo({
        extractedCount: thumbnailsOverride.length,
        headerDropCount: 0,
        extraDropCount: 0,
        finalMatchCount: 0,
        placements: [],
      })
    } else {
      setThumbnailDebugInfo(null)
    }

    const expanded = expandWayfairItemDrafts(drafts)
    setItems(expanded.items)
    setImageFilesMap(expanded.imageFilesMap)
    if (thumbnailsToUse.length > 0 || thumbnailsOverride !== undefined) {
      setThumbnailWarning(warning)
    }
  }

  const parsePdf = async (file: File) => {
    if (!file) return
    const parseRunId = activeParseRunRef.current + 1
    activeParseRunRef.current = parseRunId
    const isLatestRun = () => activeParseRunRef.current === parseRunId

    setGeneralError(null)
    setThumbnailWarning(null)
    setIsParsing(true)

    const parseStartedAt = performance.now()
    try {
      const [{ fullText, pages }, embeddedImages] = await Promise.all([
        extractPdfText(file),
        (async () => {
          if (isLatestRun()) {
            setIsExtractingThumbnails(true)
          }
          try {
            try {
              return await extractPdfEmbeddedImages(file, {
                // tuned for Wayfair invoice thumbnails (small, left side)
                pdfBoxSizeFilter: { min: 15, max: 180 },
                xMinMax: 220,
              })
            } catch (e) {
              console.warn('Thumbnail extraction failed; continuing without thumbnails.', e)
              if (isLatestRun()) {
                setThumbnailWarning('Thumbnail extraction failed for this PDF. Continuing without thumbnails.')
              }
              return [] as PdfEmbeddedImagePlacement[]
            }
          } finally {
            if (isLatestRun()) {
              setIsExtractingThumbnails(false)
            }
          }
        })(),
      ])

      if (!isLatestRun()) return

      setExtractedPdfText(fullText)
      setExtractedPdfPages(pages)

      const result = parseWayfairInvoiceText(fullText)
      setParseResult(result)
      setEmbeddedImagePlacements(embeddedImages)
      applyParsedInvoiceToDraft(result, embeddedImages)

      if (result.warnings.length > 0) {
        showWarning(`Parsed with ${result.warnings.length} warning(s). Review before creating.`)
      } else {
        showSuccess('Parsed successfully. Review and create when ready.')
      }
    } catch (err) {
      if (!isLatestRun()) return
      console.error('Failed to parse PDF:', err)
      setParseResult(null)
      setItems([])
      setExtractedPdfText(null)
      setExtractedPdfPages(null)
      setGeneralError(err instanceof Error ? err.message : 'Failed to parse PDF. Please try again.')
      showError('Failed to parse PDF.')
    } finally {
      if (isLatestRun()) {
        setIsParsing(false)
        const parseDurationMs = Math.round(performance.now() - parseStartedAt)
        console.log(`[Wayfair importer] PDF parse flow finished in ${parseDurationMs}ms.`)
      }
    }
  }

  const buildParseReport = (): Record<string, unknown> | null => {
    if (!parseResult) return null
    const rawText = extractedPdfText || ''
    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    return {
      generatedAt: new Date().toISOString(),
      file: selectedFile ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type } : null,
      extraction: {
        pageCount: extractedPdfPages?.length ?? null,
        charCount: rawText.length,
        nonEmptyLineCount: rawLines.length,
        firstLines: rawLines.slice(0, PARSE_REPORT_FIRST_LINE_LIMIT),
      },
      images: {
        embeddedPlacementsCount: embeddedImagePlacements.length,
        thumbnailDebug: thumbnailDebugInfo,
      },
      parse: parseResult,
      debug: debugStats,
    }
  }

  const copyParseReportToClipboard = async () => {
    const report = buildParseReport()
    if (!report) return
    const text = JSON.stringify(report, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      showSuccess('Parse report copied to clipboard.')
    } catch (e) {
      console.warn('Failed to copy parse report:', e)
      showError('Failed to copy parse report. Your browser may block clipboard access.')
    }
  }

  const downloadParseReportJson = () => {
    const report = buildParseReport()
    if (!report) return
    const text = JSON.stringify(report, null, 2)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = selectedFile?.name?.replace(/\.pdf$/i, '') || 'wayfair-invoice'
    a.href = url
    a.download = `${base}-parse-report.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const finalizeWayfairImportAssets = useCallback(async (payload: WayfairAssetFinalizePayload) => {
    const {
      accountId,
      projectId: workerProjectId,
      transactionId,
      projectName: workerProjectName,
      items: itemsForUpload,
      receiptFile,
      totalUploads,
    } = payload

    if (!accountId || !workerProjectId) return
    if (itemsForUpload.length === 0 && !receiptFile) return

    const jobStartedAt = performance.now()
    const assetLabel = totalUploads === 1 ? 'asset' : 'assets'
    console.log(`[Wayfair importer] Queued ${totalUploads} ${assetLabel} for background upload on transaction ${transactionId}.`)
    showInfo(`Uploading ${totalUploads} ${assetLabel} in the background. We'll notify you when done.`)

    try {
      const queryClient = getGlobalQueryClient()
      const createdItems = queryClient
        ? await loadTransactionItemsWithReconcile(queryClient, accountId, transactionId, { projectId: workerProjectId })
        : await unifiedItemsService.getItemsForTransaction(accountId, workerProjectId, transactionId)
      const itemsByDescription = new Map<string, string[]>()
      for (const created of createdItems) {
        const key = (created.description || '').trim().toLowerCase()
        if (!itemsByDescription.has(key)) {
          itemsByDescription.set(key, [])
        }
        itemsByDescription.get(key)!.push(created.itemId)
      }

      const limit = createConcurrencyLimiter(WAYFAIR_ASSET_UPLOAD_CONCURRENCY)
      const uploadCache = new Map<string, Promise<{ url: string; fileName: string; size: number; mimeType: string }>>()

      const imageUploadPromises = itemsForUpload.map(item =>
        limit(async () => {
          const descriptionKey = (item.description || '').trim().toLowerCase()
          const bucket = itemsByDescription.get(descriptionKey)
          const targetItemId = bucket?.shift()
          if (!targetItemId) {
            throw new Error(`No created item found for description "${item.description}"`)
          }

          const uploadedImages: ItemImage[] = []

          for (let fileIndex = 0; fileIndex < item.files.length; fileIndex++) {
            const file = item.files[fileIndex]
            const cacheKey = `${file.name}_${file.size}_${file.type}`
            if (!uploadCache.has(cacheKey)) {
              uploadCache.set(cacheKey, ImageUploadService.uploadItemImage(file, workerProjectName || 'Project', targetItemId))
            }
            const uploadResult = await uploadCache.get(cacheKey)!
            uploadedImages.push({
              url: uploadResult.url,
              alt: file.name,
              isPrimary: fileIndex === 0,
              uploadedAt: new Date(),
              fileName: uploadResult.fileName,
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
            })
          }

          return {
            itemId: targetItemId,
            images: uploadedImages,
            description: item.description,
          }
        })
      )

      const settledImageUploads = await Promise.allSettled(imageUploadPromises)
      const successfulUpdates: Array<{ itemId: string; images: ItemImage[] }> = []
      const failedUploads: Array<{ description: string; reason: string }> = []

      settledImageUploads.forEach((result, index) => {
        const description = itemsForUpload[index]?.description ?? 'Unknown Wayfair item'
        if (result.status === 'fulfilled') {
          if (result.value.images.length > 0) {
            successfulUpdates.push({ itemId: result.value.itemId, images: result.value.images })
          }
        } else {
          const reason = result.reason instanceof Error ? result.reason.message : 'Unknown error'
          failedUploads.push({ description, reason })
        }
      })

      if (successfulUpdates.length > 0) {
        await unifiedItemsService.bulkUpdateItemImages(accountId, successfulUpdates)
      }

      let receiptError: Error | null = null
      if (receiptFile) {
        try {
          const receiptUpload = await limit(() =>
            ImageUploadService.uploadReceiptAttachment(receiptFile, workerProjectName || 'Project', transactionId)
          )
          const receiptAttachment = [{
            url: receiptUpload.url,
            fileName: receiptUpload.fileName,
            uploadedAt: new Date(),
            size: receiptUpload.size,
            mimeType: receiptUpload.mimeType
          }]
          await transactionService.updateTransaction(accountId, workerProjectId, transactionId, {
            receiptImages: receiptAttachment,
            transactionImages: receiptAttachment
          })
        } catch (err) {
          receiptError = err instanceof Error ? err : new Error('Receipt upload failed')
          console.warn('Wayfair import: receipt attachment upload failed (background):', err)
        }
      }

      const durationMs = Math.round(performance.now() - jobStartedAt)
      if (failedUploads.length === 0 && !receiptError) {
        showSuccess(`Wayfair uploads finished in ${durationMs}ms.`)
      } else {
        const issueCount = failedUploads.length + (receiptError ? 1 : 0)
        showWarning(`Wayfair uploads finished with ${issueCount} issue${issueCount === 1 ? '' : 's'}. Open the transaction to retry.`)
        if (failedUploads.length > 0) {
          console.warn('Wayfair import: failed thumbnail uploads:', failedUploads)
        }
      }

      console.log(`[Wayfair importer] Asset worker completed in ${durationMs}ms (success:${successfulUpdates.length}, failed:${failedUploads.length + (receiptError ? 1 : 0)}).`)
    } catch (err) {
      const durationMs = Math.round(performance.now() - jobStartedAt)
      console.error('Wayfair import: asset worker failed unexpectedly:', err)
      console.log(`[Wayfair importer] Asset worker aborted after ${durationMs}ms due to error.`)
      showError('Wayfair assets failed to upload. Please retry from the transaction detail page.')
    }
  }, [showError, showInfo, showSuccess, showWarning])

  const validateBeforeCreate = (): string | null => {
    if (!resolvedProjectId) return 'Missing project ID.'
    if (!currentAccountId) return 'No account found.'
    if (!user?.id) return 'You must be signed in to create a transaction.'
    if (!parseResult) return 'No parsed invoice data. Upload and parse a PDF first.'
    if (!amount.trim() || !Number.isFinite(Number.parseFloat(amount)) || Number.parseFloat(amount) <= 0) return 'Amount must be a positive number.'

    if (taxRatePreset === 'Other') {
      const subtotalNum = Number.parseFloat(subtotal)
      const amountNum = Number.parseFloat(amount)
      if (!Number.isFinite(subtotalNum) || subtotalNum <= 0) return 'Subtotal must be provided and greater than 0 when Tax Rate Preset is Other.'
      if (!Number.isFinite(amountNum) || amountNum < subtotalNum) return 'Subtotal cannot exceed the total amount.'
    }

    for (const item of items) {
      if (!item.description?.trim()) return 'Each item must have a description.'
      const priceNum = item.purchasePrice ? Number.parseFloat(item.purchasePrice) : NaN
      if (!Number.isFinite(priceNum) || priceNum < 0) return 'Each item must have a valid purchase price (>= 0).'
    }

    return null
  }

  const handleCreate = async () => {
    const validationError = validateBeforeCreate()
    if (validationError) {
      setGeneralError(validationError)
      showError(validationError)
      return
    }
    if (!resolvedProjectId || !currentAccountId || !user?.id) return

    const assetItemsForUpload: WayfairAssetItemPayload[] = items
      .map(item => {
        const files = imageFilesMap.get(item.id) || item.imageFiles || []
        if (!files || files.length === 0) return null
        return {
          description: item.description,
          files: [...files],
        }
      })
      .filter((payload): payload is WayfairAssetItemPayload => Boolean(payload))

    const receiptFile = selectedFile
    const totalUploads = assetItemsForUpload.reduce((sum, payload) => sum + payload.files.length, 0) + (receiptFile ? 1 : 0)
    const hasBackgroundAssets = totalUploads > 0

    setGeneralError(null)
    setIsCreating(true)
    const createStartedAt = performance.now()
    try {
      const transactionData = {
        projectId: resolvedProjectId,
        projectName,
        transactionDate,
        source: 'Wayfair',
        transactionType: 'Purchase',
        paymentMethod,
        amount: normalizeMoneyToTwoDecimalString(amount) || amount,
        categoryId: categoryId || undefined,
        notes: notes || undefined,
        receiptEmailed: false,
        createdBy: user.id,
        status: 'completed' as const,
        triggerEvent: 'Manual' as const,
        taxRatePreset,
        subtotal: taxRatePreset === 'Other' ? (normalizeMoneyToTwoDecimalString(subtotal) || subtotal) : undefined,
      }

      const transactionId = await transactionService.createTransaction(
        currentAccountId,
        resolvedProjectId,
        transactionData as any,
        items
      )
      const creationDurationMs = Math.round(performance.now() - createStartedAt)
      console.log(`[Wayfair importer] Transaction ${transactionId} created in ${creationDurationMs}ms with ${items.length} item(s).`)

      if (hasBackgroundAssets && currentAccountId) {
        void finalizeWayfairImportAssets({
          accountId: currentAccountId,
          projectId: resolvedProjectId,
          transactionId,
          projectName: projectName || 'Project',
          items: assetItemsForUpload,
          receiptFile,
          totalUploads,
        })
      }

      showSuccess('Transaction created.')
      navigateToReturnToOrFallback(
        navigate,
        location,
        projectTransactionDetail(resolvedProjectId, transactionId)
      )
    } catch (err) {
      console.error('Failed to create transaction from Wayfair invoice:', err)
      const message = err instanceof Error ? err.message : 'Failed to create transaction. Please try again.'
      setGeneralError(message)
      showError(message)
    } finally {
      setIsCreating(false)
    }
  }

  const onFileSelected = (file: File | null) => {
    if (!file) return
    if (file.type !== 'application/pdf') {
      showError('Please select a PDF file.')
      return
    }
    setSelectedFile(file)
    setParseResult(null)
    setItems([])
    setEmbeddedImagePlacements([])
    setThumbnailWarning(null)
    setImageFilesMap(new Map())
    void parsePdf(file)
  }

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    setImageFilesMap(prev => {
      const next = new Map(prev)
      next.set(itemId, imageFiles)
      return next
    })
    setItems(prevItems => prevItems.map(it => (it.id === itemId ? { ...it, imageFiles } : it)))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <ContextBackLink
            fallback={getBackDestination(fallbackPath)}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </ContextBackLink>

          <button
            type="button"
            onClick={() => {
              handleReset()
              showInfo('Importer reset.')
            }}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            title="Reset importer"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Reset
          </button>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">Import Wayfair Invoice</h1>
            <p className="text-sm text-gray-600 mt-1">
              {projectName ? `Project: ${projectName}` : 'Project transaction import'}
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Upload */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Invoice PDF</label>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const file = e.dataTransfer.files?.[0] || null
                  onFileSelected(file)
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                      <FileUp className="h-5 w-5 text-primary-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {selectedFile ? selectedFile.name : 'Drag and drop a Wayfair invoice PDF here'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Or use the file picker. Parsing happens locally in your browser.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="application/pdf"
                      ref={invoiceFileInputRef}
                      onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-700"
                    />
                  </div>
                </div>

                {isParsing && (
                  <div className="mt-4">
                    <LoadingSpinner size="sm" />
                    <p className="mt-2 text-xs text-gray-500 text-center">Parsing PDF…</p>
                  </div>
                )}
                {!isParsing && isExtractingThumbnails && (
                  <div className="mt-4">
                    <LoadingSpinner size="sm" />
                    <p className="mt-2 text-xs text-gray-500 text-center">Extracting embedded item thumbnails…</p>
                  </div>
                )}
              </div>
            </div>

            {/* Parse Summary */}
            {parseResult && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Invoice</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseResult.invoiceNumber ? `#${parseResult.invoiceNumber}` : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Order total (parsed)</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseResult.orderTotal ? formatCurrencyFromString(parseResult.orderTotal) : 'Unknown'}
                    </p>
                    {parseResult.taxTotal && (
                      <p className="mt-1 text-xs text-gray-500">
                        Tax Total: {formatCurrencyFromString(parseResult.taxTotal)}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Detected line items</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseStats ? `${parseStats.total} (shipped ${parseStats.shipped}, to-be-shipped ${parseStats.toBeShipped})` : `${parseResult.lineItems.length}`}
                    </p>
                    {debugStats && (
                      <p className="mt-1 text-xs text-gray-500">
                        SKU: {debugStats.skuCount}/{parseResult.lineItems.length} • Attributes: {debugStats.attrCount}/{parseResult.lineItems.length}
                      </p>
                    )}
                  </div>
                </div>

                {parseResult.warnings.length > 0 && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-sm font-medium text-amber-800">Warnings</p>
                    <ul className="mt-2 text-sm text-amber-800 list-disc pl-5 space-y-1">
                      {parseResult.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {thumbnailWarning && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-sm font-medium text-amber-800">Thumbnail import</p>
                    <p className="mt-2 text-sm text-amber-800">{thumbnailWarning}</p>
                    {embeddedImagePlacements.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700">
                        Detected {embeddedImagePlacements.length} embedded image(s). Thumbnails are matched to items by row order; verify by editing an item if needed.
                      </p>
                    )}
                  </div>
                )}

                {/* Debug / Parse Report (visible, not console-dependent) */}
                <details className="mt-4 border border-gray-200 rounded-md bg-gray-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-900">
                    Parse report (debug)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyParseReportToClipboard()}
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Copy JSON
                      </button>
                      <button
                        type="button"
                        onClick={downloadParseReportJson}
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Download JSON
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-white border border-gray-200 rounded-md p-3">
                        <p className="text-xs text-gray-500">Parsed line items (compact)</p>
                        <div className="mt-2 max-h-64 overflow-auto">
                          <ul className="space-y-2 text-xs text-gray-800">
                            {parseResult.lineItems.slice(0, 50).map((li, idx) => (
                              <li key={idx} className="border-b border-gray-100 pb-2">
                                <div className="font-medium">{idx + 1}. {li.description}</div>
                                <div className="text-gray-600">
                                  SKU: {li.sku || '—'} • Qty: {li.qty} • Total: ${li.total}
                                </div>
                                {li.attributeLines && li.attributeLines.length > 0 && (
                                  <div className="text-gray-600">
                                    Attr: {li.attributeLines.join(' • ')}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                          {parseResult.lineItems.length > 50 && (
                            <p className="mt-2 text-xs text-gray-500">Showing first 50 of {parseResult.lineItems.length} items.</p>
                          )}
                        </div>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-md p-3">
                        <p className="text-xs text-gray-500">
                          {normalizedRawTextLines.length > 0
                            ? `Raw extracted text (${rawTextLineLimit <= 0
                                ? `showing all ${normalizedRawTextLines.length}`
                                : `showing first ${Math.min(rawTextLineLimit, normalizedRawTextLines.length)} of ${normalizedRawTextLines.length}`
                              } non-empty lines)`
                            : 'Raw extracted text (no lines extracted yet)'}
                        </p>
                        {normalizedRawTextLines.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                            <span>Line limit:</span>
                            {RAW_TEXT_PREVIEW_OPTIONS.map(option => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setRawTextLineLimit(option.value)}
                                className={`px-2 py-0.5 rounded border text-xs font-medium transition ${
                                  rawTextLineLimit === option.value
                                    ? 'bg-primary-50 border-primary-300 text-primary-800'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 max-h-64 overflow-auto">
                          <pre className="text-[11px] leading-4 whitespace-pre-wrap break-words text-gray-800">
                            {formattedRawTextPreview || 'No extracted text available.'}
                          </pre>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          If parsing fails, download the JSON report and send it—this now includes the first {parseReportPreviewCount} lines of extracted text plus the parsed output.
                        </p>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* Transaction fields */}
            {parseResult && (
              <div className="space-y-4">
                {generalError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <p className="text-sm font-medium text-red-800">Error</p>
                    <p className="mt-1 text-sm text-red-700">{generalError}</p>
                  </div>
                )}

                <div className={`grid grid-cols-1 ${taxRatePreset === 'Other' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {taxRatePreset === 'Other' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Calculated Subtotal</label>
                      <div className="mt-1 relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500 sm:text-sm">$</span>
                        </div>
                        <input
                          type="text"
                          value={subtotal}
                          onChange={(e) => setSubtotal(e.target.value)}
                          className="block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      {parseResult?.taxTotal && (
                        <p className="mt-1 text-xs text-gray-500">
                          Tax Total: {formatCurrencyFromString(parseResult.taxTotal)}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Amount</label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 sm:text-sm">$</span>
                      </div>
                      <input
                        type="text"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Sum of line items: {formatCurrencyFromString(sumLineTotals(includedLineItems))}
                    </p>
                  </div>

                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <CategorySelect
                      value={categoryId}
                      onChange={setCategoryId}
                      label="Budget Category"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                    <div className="mt-2 flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm text-gray-900">
                        <input
                          type="radio"
                          name="paymentMethod"
                          value="Client Card"
                          checked={paymentMethod === 'Client Card'}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                        />
                        Client Card
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-900">
                        <input
                          type="radio"
                          name="paymentMethod"
                          value={COMPANY_NAME}
                          checked={paymentMethod === COMPANY_NAME}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                        />
                        {COMPANY_NAME}
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <TransactionItemsList
                  items={items}
                  onItemsChange={(next) => setItems(next)}
                  projectId={resolvedProjectId || ''}
                  projectName={projectName}
                  onImageFilesChange={handleImageFilesChange}
                  totalAmount={amount}
                  enablePersistedItemFeatures={false}
                  enableDisposition={false}
                  enableSku={false}
                  enableLocation={false}
                />

                <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-6 -mb-6 px-6 py-4 mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isParsing || isCreating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isCreating ? 'Creating…' : 'Create Transaction'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


