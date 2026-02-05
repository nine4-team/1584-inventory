import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FileUp, Save, Shield, Trash2 } from 'lucide-react'
import ContextBackLink from '@/components/ContextBackLink'
import ItemEntryList from '@/components/ItemEntryList'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useToast } from '@/components/ui/ToastContext'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useAccount } from '@/contexts/AccountContext'
import { extractPdfText } from '@/utils/pdfTextExtraction'
import { parseAmazonInvoiceText, AmazonInvoiceLineItem, AmazonInvoiceParseResult } from '@/utils/amazonInvoiceParser'
import { normalizeMoneyToTwoDecimalString, parseMoneyToNumber } from '@/utils/money'
import { projectService, transactionService } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import CategorySelect from '@/components/CategorySelect'
import { COMPANY_NAME } from '@/constants/company'
import type { TransactionItemFormData } from '@/types'
import { projectTransactionDetail, projectTransactions } from '@/utils/routes'
import { navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'

function getTodayIsoDate(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function formatCurrencyFromString(amount: string): string {
  const n = Number.parseFloat(amount)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function sumLineTotals(lineItems: AmazonInvoiceLineItem[]): string {
  const sum = lineItems.reduce((acc, li) => acc + (parseMoneyToNumber(li.total) || 0), 0)
  return sum.toFixed(2)
}

const DEFAULT_RAW_TEXT_LINE_LIMIT = 400
const RAW_TEXT_PREVIEW_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '200', value: 200 },
  { label: '400', value: 400 },
  { label: '800', value: 800 },
  { label: '1600', value: 1600 },
  { label: 'All', value: 0 },
]
const PARSE_REPORT_FIRST_LINE_LIMIT = 600

type AmazonItemDraft = {
  qty: number
  sourceIndex: number
  template: Omit<TransactionItemFormData, 'id'>
}

function buildAmazonItemDrafts(lineItemsWithIndex: Array<{ li: AmazonInvoiceLineItem; sourceIndex: number }>): AmazonItemDraft[] {
  const drafts: AmazonItemDraft[] = []

  for (const { li, sourceIndex } of lineItemsWithIndex) {
    const qty = Math.max(1, Math.floor(li.qty || 1))
    const totalNum = parseMoneyToNumber(li.total)
    const unitPriceNum = li.unitPrice ? parseMoneyToNumber(li.unitPrice) : undefined

    const perUnitPurchasePrice = unitPriceNum !== undefined
      ? unitPriceNum
      : (totalNum !== undefined ? totalNum / qty : 0)

    const perUnitPurchaseMoney = normalizeMoneyToTwoDecimalString(String(perUnitPurchasePrice)) || '0.00'

    const baseNotesParts: string[] = []
    if (li.shippedOn) baseNotesParts.push(`Amazon shipped on ${li.shippedOn}`)
    baseNotesParts.push('Amazon import')
    const baseNotes = baseNotesParts.join(' • ')

    drafts.push({
      qty,
      sourceIndex,
      template: {
        description: li.description,
        purchasePrice: perUnitPurchaseMoney,
        price: perUnitPurchaseMoney,
        notes: baseNotes,
      },
    })
  }

  return drafts
}

function expandAmazonItemDrafts(drafts: AmazonItemDraft[]): TransactionItemFormData[] {
  const items: TransactionItemFormData[] = []

  for (const draft of drafts) {
    const qty = Math.max(1, Math.floor(draft.qty || 1))

    // Items get unique keys (no grouping for Amazon items)
    const uiGroupKey = `unique-${Math.random()}`

    for (let i = 0; i < qty; i++) {
      const id = crypto.randomUUID()
      const description = draft.template.description || ''

      items.push({
        id,
        ...draft.template,
        description,
        uiGroupKey,
      })
    }
  }

  return items
}

export default function ImportAmazonInvoice() {
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
  const [parseResult, setParseResult] = useState<AmazonInvoiceParseResult | null>(null)
  const [transactionDate, setTransactionDate] = useState(getTodayIsoDate())
  const [paymentMethod, setPaymentMethod] = useState<string>('Client Card')
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [items, setItems] = useState<TransactionItemFormData[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [extractedPdfText, setExtractedPdfText] = useState<string | null>(null)
  const [extractedPdfPages, setExtractedPdfPages] = useState<string[] | null>(null)
  const [rawTextLineLimit, setRawTextLineLimit] = useState<number>(DEFAULT_RAW_TEXT_LINE_LIMIT)

  const debugStats = useMemo(() => {
    if (!parseResult) return null
    return {
      totalItems: parseResult.lineItems.length,
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
    setItems([])
    setIsParsing(false)
    setGeneralError(null)
    setRawTextLineLimit(DEFAULT_RAW_TEXT_LINE_LIMIT)
  }

  const applyParsedInvoiceToDraft = (result: AmazonInvoiceParseResult) => {
    // Check for wrong vendor error
    if (result.warnings.some(w => w.includes('Not an Amazon invoice'))) {
      setGeneralError('This PDF does not look like an Amazon order details/invoice.')
      setParseResult(result)
      setItems([])
      return
    }

    const today = getTodayIsoDate()
    setTransactionDate(result.orderPlacedDate || today)

    const lineItemsWithIndex = result.lineItems.map((li, idx) => ({ li, sourceIndex: idx }))
    const lineItemsForAmount = lineItemsWithIndex.map(x => x.li)
    const computedSum = sumLineTotals(lineItemsForAmount)
    const defaultAmount = result.grandTotal || computedSum
    setAmount(defaultAmount)

    const notesParts: string[] = []
    notesParts.push('Amazon import')
    if (result.orderNumber) notesParts.push(`Order # ${result.orderNumber}`)
    if (result.orderPlacedDate) notesParts.push(`Order date: ${result.orderPlacedDate}`)
    setNotes(notesParts.join(' • '))

    // Set payment method if found
    if (result.paymentMethod) {
      if (result.paymentMethod.includes('Visa')) {
        setPaymentMethod('Client Card')
      }
    }

    const drafts = buildAmazonItemDrafts(lineItemsWithIndex)
    const expanded = expandAmazonItemDrafts(drafts)
    setItems(expanded)
  }

  const parsePdf = async (file: File) => {
    if (!file) return
    const parseRunId = activeParseRunRef.current + 1
    activeParseRunRef.current = parseRunId
    const isLatestRun = () => activeParseRunRef.current === parseRunId

    setGeneralError(null)
    setIsParsing(true)

    const parseStartedAt = performance.now()
    try {
      const { fullText, pages } = await extractPdfText(file)

      if (!isLatestRun()) return

      setExtractedPdfText(fullText)
      setExtractedPdfPages(pages)

      const result = parseAmazonInvoiceText(fullText)
      setParseResult(result)
      applyParsedInvoiceToDraft(result)

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
        console.log(`[Amazon importer] PDF parse flow finished in ${parseDurationMs}ms.`)
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
    const base = selectedFile?.name?.replace(/\.pdf$/i, '') || 'amazon-invoice'
    a.href = url
    a.download = `${base}-parse-report.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const finalizeAmazonImportReceipt = useCallback(async (
    accountId: string,
    projectId: string,
    transactionId: string,
    projectName: string,
    receiptFile: File | null
  ) => {
    if (!receiptFile) return

    try {
      const receiptUpload = await ImageUploadService.uploadReceiptAttachment(
        receiptFile,
        projectName || 'Project',
        transactionId
      )
      const receiptAttachment = [{
        url: receiptUpload.url,
        fileName: receiptUpload.fileName,
        uploadedAt: new Date(),
        size: receiptUpload.size,
        mimeType: receiptUpload.mimeType
      }]
      await transactionService.updateTransaction(accountId, projectId, transactionId, {
        receiptImages: receiptAttachment,
        transactionImages: receiptAttachment
      })
      console.log('[Amazon importer] Receipt uploaded successfully.')
    } catch (err) {
      console.warn('Amazon import: receipt attachment upload failed (background):', err)
    }
  }, [])

  const validateBeforeCreate = (): string | null => {
    if (!resolvedProjectId) return 'Missing project ID.'
    if (!currentAccountId) return 'No account found.'
    if (!user?.id) return 'You must be signed in to create a transaction.'
    if (!parseResult) return 'No parsed invoice data. Upload and parse a PDF first.'
    if (parseResult.warnings.some(w => w.includes('Not an Amazon invoice'))) {
      return 'This PDF does not look like an Amazon order details/invoice.'
    }
    if (!amount.trim() || !Number.isFinite(Number.parseFloat(amount)) || Number.parseFloat(amount) <= 0) {
      return 'Amount must be a positive number.'
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

    const receiptFile = selectedFile
    const hasBackgroundAssets = Boolean(receiptFile)

    setGeneralError(null)
    setIsCreating(true)
    const createStartedAt = performance.now()
    try {
      const transactionData = {
        projectId: resolvedProjectId,
        projectName,
        transactionDate,
        source: 'Amazon',
        transactionType: 'Purchase',
        paymentMethod,
        amount: normalizeMoneyToTwoDecimalString(amount) || amount,
        categoryId: categoryId || undefined,
        notes: notes || undefined,
        receiptEmailed: false,
        createdBy: user.id,
        status: 'completed' as const,
        triggerEvent: 'Manual' as const,
      }

      const transactionId = await transactionService.createTransaction(
        currentAccountId,
        resolvedProjectId,
        transactionData as any,
        items
      )
      const creationDurationMs = Math.round(performance.now() - createStartedAt)
      console.log(`[Amazon importer] Transaction ${transactionId} created in ${creationDurationMs}ms with ${items.length} item(s).`)

      if (hasBackgroundAssets && currentAccountId) {
        void finalizeAmazonImportReceipt(
          currentAccountId,
          resolvedProjectId,
          transactionId,
          projectName || 'Project',
          receiptFile
        )
      }

      showSuccess('Transaction created.')
      navigateToReturnToOrFallback(
        navigate,
        location,
        projectTransactionDetail(resolvedProjectId, transactionId)
      )
    } catch (err) {
      console.error('Failed to create transaction from Amazon invoice:', err)
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
    void parsePdf(file)
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
            <h1 className="text-2xl font-bold text-gray-900">Import Amazon Invoice</h1>
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
                        {selectedFile ? selectedFile.name : 'Drag and drop an Amazon invoice PDF here'}
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
              </div>
            </div>

            {/* Parse Summary */}
            {parseResult && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Order Number</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseResult.orderNumber ? `#${parseResult.orderNumber}` : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Order total (parsed)</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseResult.grandTotal ? formatCurrencyFromString(parseResult.grandTotal) : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Detected line items</p>
                    <p className="text-sm font-medium text-gray-900">
                      {parseResult.lineItems.length}
                    </p>
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

                {/* Debug / Parse Report */}
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
                                  Qty: {li.qty} • Unit: ${li.unitPrice || 'N/A'} • Total: ${li.total}
                                </div>
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
            {parseResult && !parseResult.warnings.some(w => w.includes('Not an Amazon invoice')) && (
              <div className="space-y-4">
                {generalError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <p className="text-sm font-medium text-red-800">Error</p>
                    <p className="mt-1 text-sm text-red-700">{generalError}</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

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

                <ItemEntryList
                  items={items}
                  onItemsChange={(next) => setItems(next)}
                  projectId={resolvedProjectId || ''}
                  projectName={projectName}
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
                    disabled={isParsing || isCreating || parseResult.warnings.some(w => w.includes('Not an Amazon invoice'))}
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
