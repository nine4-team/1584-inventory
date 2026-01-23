import { ArrowLeft, Save, X } from 'lucide-react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useNavigationStack } from '@/contexts/NavigationStackContext'
import { useState, useEffect, useRef, FormEvent, useMemo, useCallback } from 'react'
import { TransactionFormData, TransactionValidationErrors, TransactionImage, TransactionItemFormData, TaxPreset, Transaction } from '@/types'
import { COMPANY_NAME, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { transactionService, projectService, unifiedItemsService } from '@/services/inventoryService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import ImageUpload from '@/components/ui/ImageUpload'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { TransactionImagePreview } from '@/components/ui/ImagePreview'
import { useAuth } from '../contexts/AuthContext'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '../contexts/AccountContext'
import { useOfflineMediaTracker } from '@/hooks/useOfflineMediaTracker'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { UserRole } from '../types'
import { Shield } from 'lucide-react'
import { toDateOnlyString } from '@/utils/dateUtils'
import { getTaxPresets } from '@/services/taxPresetsService'
import { NO_TAX_PRESET_ID } from '@/constants/taxPresets'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import CategorySelect from '@/components/CategorySelect'
import TransactionItemsList from '@/components/TransactionItemsList'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { projectTransactionDetail, projectTransactions } from '@/utils/routes'
import { getReturnToFromLocation, navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'
import { hydrateTransactionCache, loadTransactionItemsWithReconcile } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'

export default function EditTransaction() {
  const { id, projectId: routeProjectId, transactionId } = useParams<{ id?: string; projectId?: string; transactionId: string }>()
  const projectId = routeProjectId || id
  const navigate = useNavigate()
  const hasSyncError = useSyncError()
  const navigationStack = useNavigationStack()
  const location = useLocation()
  const { hasRole } = useAuth()
  const { currentAccountId } = useAccount()
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  const { showOfflineSaved } = useOfflineFeedback()
  const receiptTracker = useOfflineMediaTracker()
  const otherImageTracker = useOfflineMediaTracker()

  const defaultBackPath = useMemo(() => {
    if (projectId && transactionId) {
      return projectTransactionDetail(projectId, transactionId)
    }
    if (projectId) {
      return projectTransactions(projectId)
    }
    return '/projects'
  }, [projectId, transactionId])

  const handleBackNavigation = useCallback(() => {
    const returnTo = getReturnToFromLocation(location)
    if (returnTo) {
      navigate(returnTo, { replace: true })
      return
    }
    const fallback = getBackDestination(defaultBackPath)
    const entry = navigationStack.pop(location.pathname + location.search)
    const target = entry?.path || fallback
    if (Number.isFinite(entry?.scrollY)) {
      navigate(target, { state: { restoreScrollY: entry?.scrollY } })
    } else {
      navigate(target)
    }
  }, [defaultBackPath, getBackDestination, location, navigationStack, navigate])

  // Check if user has permission to edit transactions (USER role or higher)
  if (!hasRole(UserRole.USER)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <Shield className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You don't have permission to edit transactions. Please contact an administrator if you need access.
          </p>
          <ContextLink
            to={projectId ? buildContextUrl(projectTransactions(projectId)) : '/projects'}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Back to Project
          </ContextLink>
        </div>
      </div>
    )
  }

  const [projectName, setProjectName] = useState<string>('')

  const [formData, setFormData] = useState<TransactionFormData>({
    transactionDate: '',
    source: '',
    transactionType: 'Purchase',
    paymentMethod: '',
    amount: '',
    categoryId: '',
    notes: '',
    status: 'completed',
    reimbursementType: '',
    triggerEvent: 'Manual',
    receiptImages: [],
    otherImages: [],
    receiptEmailed: false
  })

  // Tax form state
  const [taxRatePreset, setTaxRatePreset] = useState<string | undefined>(undefined)
  const [subtotal, setSubtotal] = useState<string>('')
  const [taxPresets, setTaxPresets] = useState<TaxPreset[]>([])
  const [selectedPresetRate, setSelectedPresetRate] = useState<number | undefined>(undefined)

  const [errors, setErrors] = useState<TransactionValidationErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploadingImages, setIsUploadingImages] = useState(false)
  const [existingOtherImages, setExistingOtherImages] = useState<TransactionImage[]>([])
  const [existingReceiptImages, setExistingReceiptImages] = useState<TransactionImage[]>([])

  // Transaction items state
  const [items, setItems] = useState<TransactionItemFormData[]>([])
  const initialItemsRef = useRef<TransactionItemFormData[] | null>(null)
  const lastLoggedTransactionIdRef = useRef<string | null>(null)
  const lastLoggedItemsRef = useRef<string | null>(null)

  // Custom source state
  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])
  const availableVendorsRef = useRef<string[]>([])

  // Load vendor defaults on mount
  useEffect(() => {
    const loadVendors = async () => {
      if (!currentAccountId) {
        setAvailableVendors([])
        availableVendorsRef.current = []
        return
      }
      try {
        const vendors = await getAvailableVendors(currentAccountId)
        setAvailableVendors(vendors)
        availableVendorsRef.current = vendors
      } catch (error) {
        console.error('Error loading vendor defaults:', error)
        // Fallback to empty array - will show only "Other" option
        setAvailableVendors([])
        availableVendorsRef.current = []
      }
    }
    loadVendors()
  }, [currentAccountId])

  // Load tax presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      if (!currentAccountId) return
      try {
        const presets = await getTaxPresets(currentAccountId)
        setTaxPresets(presets)
      } catch (error) {
        console.error('Error loading tax presets:', error)
      }
    }
    loadPresets()
  }, [currentAccountId])

  // Update selected preset rate when preset changes
  useEffect(() => {
    if (taxRatePreset && taxRatePreset !== 'Other' && taxRatePreset !== NO_TAX_PRESET_ID) {
      const preset = taxPresets.find(p => p.id === taxRatePreset)
      setSelectedPresetRate(preset?.rate)
    } else {
      setSelectedPresetRate(undefined)
    }
  }, [taxRatePreset, taxPresets])

  // Load transaction and project data
  useEffect(() => {
    // Guard against missing params before attempting to load anything
    if (!transactionId) {
      console.error('EditTransaction: transactionId is required in the route params.')
      setIsLoading(false)
      return
    }

    if (!projectId || projectId === 'undefined') {
      console.error('EditTransaction: projectId is required. Business inventory transactions should use EditBusinessInventoryTransaction.')
      setIsLoading(false)
      return
    }

    if (!currentAccountId) {
      // Still waiting on account context; keep spinner visible instead of logging false errors
      return
    }

    const loadTransaction = async () => {
      try {
        // First, try to hydrate from offlineStore to React Query cache
        // This ensures optimistic transactions created offline are available
        try {
          await hydrateTransactionCache(getGlobalQueryClient(), currentAccountId, transactionId)
        } catch (error) {
          console.warn('Failed to hydrate transaction cache (non-fatal):', error)
        }

        // Check React Query cache first (for optimistic transactions created offline)
        const queryClient = getGlobalQueryClient()
        const cachedTransaction = queryClient.getQueryData<Transaction>(['transaction', currentAccountId, transactionId])
        
        let transactionData: Transaction | null = cachedTransaction ?? null
        if (cachedTransaction && lastLoggedTransactionIdRef.current !== cachedTransaction.transactionId) {
          console.log('✅ Transaction found in React Query cache:', cachedTransaction.transactionId)
          lastLoggedTransactionIdRef.current = cachedTransaction.transactionId
        }

        // Always fetch the latest transaction so attachments stay in sync with Supabase
        const fetchedTransaction = await transactionService.getTransaction(currentAccountId, projectId, transactionId)
        if (fetchedTransaction) {
          transactionData = fetchedTransaction
        }

        const project = await projectService.getProject(currentAccountId, projectId)
        const transaction = transactionData

        if (project) {
          setProjectName(project.name)
        }
        if (transaction) {
          // Determine the source to display: if database saved 'Other' (legacy), use project name
          const legacyOther = transaction.source === 'Other' || transaction.source === ''
          const resolvedSource = legacyOther && project ? project.name : transaction.source
          const sourceIsCustom = Boolean(resolvedSource && !availableVendorsRef.current.includes(resolvedSource))
          // Use the transaction date directly for date input (convert Date object to YYYY-MM-DD string)
          setFormData({
            transactionDate: toDateOnlyString(transaction.transactionDate) || '',
            source: resolvedSource,
            transactionType: transaction.transactionType,
            paymentMethod: transaction.paymentMethod,
            amount: transaction.amount,
            categoryId: transaction.categoryId || '',
            notes: transaction.notes || '',
            status: transaction.status || 'completed',
            reimbursementType: transaction.reimbursementType || '',
            triggerEvent: transaction.triggerEvent || 'Manual',
            receiptImages: [],
            otherImages: [],
            receiptEmailed: transaction.receiptEmailed
          })

          setIsCustomSource(sourceIsCustom)

          // Populate tax fields if present
          if (transaction.taxRatePreset) {
            setTaxRatePreset(transaction.taxRatePreset)
          } else if (transaction.taxRatePct === 0) {
            setTaxRatePreset(NO_TAX_PRESET_ID)
          }
          setSubtotal(transaction.subtotal || '')

          // If legacy 'Other' was stored, immediately correct database to the project name
          if (legacyOther && project && projectId && transactionId && currentAccountId) {
            try {
              await transactionService.updateTransaction(currentAccountId, projectId, transactionId, { source: project.name })
            } catch (e) {
              console.warn('Failed to auto-correct source to project name:', e)
            }
          }

          // Handle legacy and new image fields for loading transaction data
          // Note: Legacy transaction_images is loaded but not stored in local state, receipt_images is the current field

          const otherImages = transaction.otherImages || []
          setExistingOtherImages(Array.isArray(otherImages) ? otherImages : [])

          const receiptImages = transaction.receiptImages || []
          setExistingReceiptImages(Array.isArray(receiptImages) ? receiptImages : [])

          // Load transaction items
          try {
            const transactionItems = queryClient
              ? await loadTransactionItemsWithReconcile(queryClient, currentAccountId, transactionId, { projectId })
              : await unifiedItemsService.getItemsForTransaction(currentAccountId, projectId, transactionId)
            const shouldLogItems = lastLoggedItemsRef.current !== transactionId
            if (shouldLogItems) {
              console.log('Loaded transaction items:', transactionItems)
              const transactionItemIds = transactionItems.map(item => item.itemId)
              console.log('Transaction item IDs:', transactionItemIds)
            }
            const itemsWithDetails = await Promise.all(
              transactionItems.map(async (item) => {
                if (shouldLogItems) {
                  console.log(`Loaded item ${item.itemId}:`, {
                    id: item.itemId,
                    description: item?.description || '',
                    hasValidFormat: item.itemId.startsWith('I-') && item.itemId.length > 10
                  })
                }

                return {
                  id: item.itemId,
                  description: item?.description || '',
                  purchasePrice: item?.purchasePrice?.toString() || '',
                  projectPrice: item?.projectPrice?.toString() || '',
                  sku: item?.sku || '',
                  marketValue: item?.marketValue?.toString() || '',
                  notes: item?.notes || '',
                  imageFiles: [],
                  images: item?.images || []
                }
              })
            )
            if (shouldLogItems) {
              console.log('Loaded transaction items:', transactionItems.map(item => ({
                id: item.itemId,
                description: item.description,
                isTempId: item.itemId.startsWith('temp-')
              })))
              lastLoggedItemsRef.current = transactionId
            }
            setItems(itemsWithDetails)
            // Capture initial snapshot of loaded items to detect later edits.
            try {
              initialItemsRef.current = itemsWithDetails.map(i => ({
                id: i.id,
                description: i.description,
                purchasePrice: i.purchasePrice,
                projectPrice: i.projectPrice,
                sku: i.sku,
                marketValue: i.marketValue,
                notes: i.notes
              } as TransactionItemFormData))
            } catch (e) {
              // Non-fatal
              initialItemsRef.current = null
            }
          } catch (itemError) {
            console.error('Error loading transaction items:', itemError)
          }
        }
      } catch (error) {
        console.error('Error loading transaction:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadTransaction()
  }, [projectId, transactionId, currentAccountId])

  // Validation function
  const validateForm = (): boolean => {
    const newErrors: TransactionValidationErrors = {}

    // Source is still required to maintain data quality
    if (!formData.source.trim()) {
      newErrors.source = 'Source is required'
    }

    // TransactionType is optional
    // PaymentMethod is optional

    if (!formData.categoryId?.trim()) {
      newErrors.categoryId = 'Budget category is required'
    }

    if (!formData.amount.trim()) {
      newErrors.amount = 'Amount is required'
    } else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
      newErrors.amount = 'Amount must be a positive number'
    }

    // TransactionDate is optional

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validateForm() || !projectId || !transactionId || !currentAccountId) return

    setIsSubmitting(true)
    const willUploadImages = Boolean((formData.receiptImages?.length || 0) > 0 || (formData.otherImages?.length || 0) > 0)
    if (willUploadImages) {
      setIsUploadingImages(true)
    }
    let _needsReviewBatchStarted = false
    try {
      if (currentAccountId && transactionId) {
        try {
          transactionService.beginNeedsReviewBatch(currentAccountId, transactionId)
          _needsReviewBatchStarted = true
        } catch (e) {
          console.warn('Failed to begin needs review batch:', e)
        }
      }
      // First, handle item updates and creations
      if (items.length > 0) {
        // Debug: Log all items to understand the issue
        console.log('All items before processing:', items.map(item => ({
          id: item.id,
          description: item.description,
          price: item.purchasePrice,
          sku: item.sku,
          isTempId: item.id.startsWith('temp-'),
          idFormat: item.id.startsWith('I-') ? 'database' : item.id.startsWith('temp-') ? 'temp' : 'unknown'
        })))
        // Separate existing items from new items using robust classification
        // Existing items have real database IDs (format: "I-" prefix followed by timestamp and random string)
        // New items have temporary IDs (format: "temp-" prefix followed by timestamp and random string)
        const existingItems: TransactionItemFormData[] = []
        const newItems: TransactionItemFormData[] = []

        items.forEach(item => {
          // Robust classification logic
          if (item.id.startsWith('temp-')) {
            // Definitely a temp item
            newItems.push(item)
          } else if (item.id.startsWith('I-') && item.id.length > 10) {
            // Likely a real database item (format: I-timestamp-randomstring)
            existingItems.push(item)
          } else if (item.id.length > 5 && !item.id.includes('_')) {
            // Could be a real database item with different format, treat as existing for safety
            console.warn(`Item with ambiguous ID treated as existing: ${item.id} - ${item.description}`)
            existingItems.push(item)
          } else {
            // Default to treating as new item if ID format is unclear
            console.warn(`Item with unclear ID format treated as new: ${item.id} - ${item.description}`)
            newItems.push(item)
          }
        })

        console.log(`Separated ${existingItems.length} existing items and ${newItems.length} new items`)

        // Update existing items only if fields actually changed compared to the initial load.
        const initialItemsMap = new Map<string, TransactionItemFormData>()
        if (initialItemsRef.current) {
          for (const it of initialItemsRef.current) initialItemsMap.set(it.id, it)
        }

        const itemsToUpdate: Array<{ id: string; updates: Partial<TransactionItemFormData> }> = []
        for (const item of existingItems) {
          const orig = initialItemsMap.get(item.id)
          const updates: Partial<TransactionItemFormData> = {}
          if (!orig || orig.description !== item.description) updates.description = item.description
          // Normalize undefined/empty string comparisons for numeric fields stored as strings
          if (!orig || String(orig.purchasePrice || '') !== String(item.purchasePrice || '')) updates.purchasePrice = item.purchasePrice
          if (!orig || String(orig.projectPrice || '') !== String(item.projectPrice || '')) updates.projectPrice = item.projectPrice
          if (!orig || String(orig.marketValue || '') !== String(item.marketValue || '')) updates.marketValue = item.marketValue
          if (!orig || (orig.sku || '') !== (item.sku || '')) updates.sku = item.sku
          if (!orig || (orig.notes || '') !== (item.notes || '')) updates.notes = item.notes
          // Ensure transaction linkage is present
          updates.transactionId = transactionId

          // If there are any meaningful updates (besides transactionId), add to update list
          const meaningfulKeys = Object.keys(updates).filter(k => k !== 'transactionId')
          if (meaningfulKeys.length > 0) {
            itemsToUpdate.push({ id: item.id, updates })
          }
        }

        console.log(`Preparing to update ${itemsToUpdate.length} of ${existingItems.length} existing items`)
        for (const u of itemsToUpdate) {
          await unifiedItemsService.updateItem(currentAccountId, u.id, u.updates)
        }

        // Create new items using the same batch infrastructure as new transactions
        let createdItemIds: string[] = []
        if (newItems.length > 0) {
          const creationResults = await Promise.all(
            newItems.map(async (item) => {
              const itemData = {
                ...item,
                projectId: projectId,
                transactionId: transactionId,
                dateCreated: formData.transactionDate,
                source: formData.source,
                inventoryStatus: 'available' as const,
                paymentMethod: 'Unknown',
                qrKey: `QR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                bookmark: false,
                sku: item.sku || '',
                purchasePrice: item.purchasePrice || '',
                projectPrice: item.projectPrice || '',
                marketValue: item.marketValue || '',
                notes: item.notes || '',
                space: item.space || '',
                disposition: 'purchased'
              }
              const result = await unifiedItemsService.createItem(currentAccountId, itemData)
              return result.itemId
            })
          )
          createdItemIds = creationResults
          console.log('Created new items:', createdItemIds)

          // Update the item IDs in our local state (map temp IDs to real IDs)
          setItems(prevItems => prevItems.map(prevItem => {
            // Only update items that were in our newItems array (have temp IDs)
            const newItemIndex = newItems.findIndex(item => item.id === prevItem.id)
            if (newItemIndex >= 0 && newItemIndex < createdItemIds.length) {
              return { ...prevItem, id: createdItemIds[newItemIndex] }
            }
            return prevItem
          }))
        }

        // Note: Item image upload functionality removed for now - focusing on transaction images
      }

      const otherOfflineMediaIds: string[] = []
      const receiptOfflineMediaIds: string[] = []

      // Upload other images with offline support
      let otherImages: TransactionImage[] = [...existingOtherImages]
      if (formData.otherImages && formData.otherImages.length > 0) {
        try {
          const newOtherImages: TransactionImage[] = []
          for (const file of formData.otherImages) {
            const uploadResult = await OfflineAwareImageService.uploadOtherAttachment(
              file,
              projectName || 'Unnamed Project',
              transactionId,
              currentAccountId
            )

            const metadata = uploadResult.url.startsWith('offline://')
              ? {
                  offlineMediaId: uploadResult.url.replace('offline://', ''),
                  isOfflinePlaceholder: true
                }
              : undefined

            if (metadata?.offlineMediaId) {
              otherImageTracker.trackMediaId(metadata.offlineMediaId)
              otherOfflineMediaIds.push(metadata.offlineMediaId)
            }

            newOtherImages.push({
              url: uploadResult.url,
              fileName: uploadResult.fileName,
              uploadedAt: new Date(),
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
              ...(metadata && { metadata })
            })
          }

          if (newOtherImages.length > 0) {
            otherImages = [...existingOtherImages, ...newOtherImages]
          }
        } catch (error) {
          console.error('Error uploading other images:', error)
          setErrors({ otherImages: 'Failed to upload other images. Please try again.' })
          return
        }
      }

      // Upload receipt images with offline support
      let receiptImages: TransactionImage[] = [...existingReceiptImages]
      if (formData.receiptImages && formData.receiptImages.length > 0) {
        try {
          const newReceiptImages: TransactionImage[] = []
          for (const file of formData.receiptImages) {
            const uploadResult = await OfflineAwareImageService.uploadReceiptAttachment(
              file,
              projectName || 'Unnamed Project',
              transactionId,
              currentAccountId
            )

            const metadata = uploadResult.url.startsWith('offline://')
              ? {
                  offlineMediaId: uploadResult.url.replace('offline://', ''),
                  isOfflinePlaceholder: true
                }
              : undefined

            if (metadata?.offlineMediaId) {
              receiptTracker.trackMediaId(metadata.offlineMediaId)
              receiptOfflineMediaIds.push(metadata.offlineMediaId)
            }

            newReceiptImages.push({
              url: uploadResult.url,
              fileName: uploadResult.fileName,
              uploadedAt: new Date(),
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
              ...(metadata && { metadata })
            })
          }

          if (newReceiptImages.length > 0) {
            receiptImages = [...existingReceiptImages, ...newReceiptImages]
          }
        } catch (error) {
          console.error('Error uploading receipt images:', error)
          setErrors({ receiptImages: 'Failed to upload receipt images. Please try again.' })
          return
        }
      }

      const hadOfflineUploads = receiptOfflineMediaIds.length > 0 || otherOfflineMediaIds.length > 0

      // Update transaction with new data and images
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { transactionImages: _transactionImages, otherImages: _formOtherImages, receiptImages: _formReceiptImages, ...formDataWithoutImages } = formData
      const isNoTaxSelection = taxRatePreset === NO_TAX_PRESET_ID
      const updateData = {
        ...formDataWithoutImages,
        otherImages: otherImages,
        receiptImages: receiptImages,
        ...(taxRatePreset === undefined
          ? { taxRatePreset: null, taxRatePct: null, subtotal: null }
          : isNoTaxSelection
            ? { taxRatePreset: null, taxRatePct: 0, subtotal: null }
            : { taxRatePreset: taxRatePreset, subtotal: taxRatePreset === 'Other' ? subtotal : null })
      }

      await transactionService.updateTransaction(currentAccountId, projectId, transactionId, updateData)

      // Prevent offline placeholders from being cleaned up before sync completes
      receiptOfflineMediaIds.forEach(mediaId => receiptTracker.removeMediaId(mediaId))
      otherOfflineMediaIds.forEach(mediaId => otherImageTracker.removeMediaId(mediaId))

      if (hadOfflineUploads) {
        showOfflineSaved()
      }

      navigateToReturnToOrFallback(navigate, location, defaultBackPath)
    } catch (error) {
      console.error('Error updating transaction:', error)
      // Set a general error message instead of targeting specific fields
      setErrors({ general: error instanceof Error ? error.message : 'Failed to update transaction. Please try again.' })
    } finally {
      if (_needsReviewBatchStarted && currentAccountId && transactionId) {
        try {
          await transactionService.flushNeedsReviewBatch(currentAccountId, transactionId, { flushImmediately: true })
        } catch (e) {
          console.warn('Failed to flush needs review batch:', e)
        }
      }
      setIsSubmitting(false)
      setIsUploadingImages(false)
    }
  }

  const handleInputChange = (field: Exclude<keyof TransactionFormData, 'taxRatePreset' | 'subtotal'> | 'categoryId', value: string | boolean | File[]) => {
    // Handle categoryId separately since it's not in the original TransactionFormData type exclusion
    if (field === 'categoryId') {
      setFormData(prev => ({ ...prev, categoryId: value as string }))
      if (errors.categoryId) {
        setErrors(prev => ({ ...prev, categoryId: undefined }))
      }
      return
    }
    setFormData(prev => {
      const newData = { ...prev, [field]: value }

      // Apply business rules for status and reimbursement type
      if (field === 'status' && value === 'completed' && prev.reimbursementType) {
        // If setting status to completed, clear reimbursement type by setting to empty string
        // The service layer will convert this to deleteField()
        newData.reimbursementType = ''
      } else if (field === 'reimbursementType' && value && prev.status === 'completed') {
        // If setting reimbursement type while status is completed, change status to pending
        newData.status = 'pending'
      }

      return newData
    })

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }


  const handleRemoveExistingReceiptImage = useCallback(
    (imageUrl: string) => {
      if (isSubmitting || isUploadingImages) return
      setExistingReceiptImages(prev => prev.filter(image => image.url !== imageUrl))
    },
    [isSubmitting, isUploadingImages]
  )

  const handleRemoveExistingOtherImage = useCallback(
    (imageUrl: string) => {
      if (isSubmitting || isUploadingImages) return
      setExistingOtherImages(prev => prev.filter(image => image.url !== imageUrl))
    },
    [isSubmitting, isUploadingImages]
  )

  const handleReceiptImagesChange = (files: File[]) => {
    setFormData(prev => ({ ...prev, receiptImages: files }))
    // Clear any existing image errors
    if (errors.receiptImages) {
      setErrors(prev => ({ ...prev, receiptImages: undefined }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading transaction...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        {/* Back button row */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              handleBackNavigation()
            }}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </button>
          {hasSyncError && <RetrySyncButton size="sm" variant="secondary" />}
        </div>

      </div>

      {/* Form */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Edit Transaction</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {/* General Error Display */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{errors.general}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Source/Vendor *
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              {availableVendors.map((source) => (
                <div key={source} className="flex items-center">
                  <input
                    type="radio"
                    id={`source_${source.toLowerCase().replace(/\s+/g, '_')}`}
                    name="source"
                    value={source}
                    checked={formData.source === source}
                    onChange={(e) => {
                      handleInputChange('source', e.target.value)
                      setIsCustomSource(false)
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <label htmlFor={`source_${source.toLowerCase().replace(/\s+/g, '_')}`} className="ml-2 block text-sm text-gray-900">
                    {source}
                  </label>
                </div>
              ))}
            </div>
            <div className="flex items-center">
              <input
                type="radio"
                id="source_custom"
                name="source"
                value="custom"
                checked={isCustomSource}
                onChange={() => {
                  setIsCustomSource(true)
                  handleInputChange('source', '')
                }}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
              />
              <label htmlFor="source_custom" className="ml-2 block text-sm text-gray-900">
                Other
              </label>
            </div>
            {isCustomSource && (
              <input
                type="text"
                id="source_custom_input"
                value={formData.source}
                onChange={(e) => handleInputChange('source', e.target.value)}
                placeholder="Enter custom source..."
                className={`mt-3 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.source ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            )}
            {errors.source && (
              <p className="mt-1 text-sm text-red-600">{errors.source}</p>
            )}
          </div>

          {/* Budget Category */}
          <div>
            <CategorySelect
              value={formData.categoryId}
              onChange={(categoryId) => {
                handleInputChange('categoryId', categoryId)
              }}
              label="Budget Category"
              error={errors.categoryId}
              required
            />
          </div>

          {/* Transaction Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Transaction Type
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="type_purchase"
                  name="transactionType"
                  value="Purchase"
                  checked={formData.transactionType === 'Purchase'}
                  onChange={(e) => handleInputChange('transactionType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="type_purchase" className="ml-2 block text-sm text-gray-900">
                  Purchase
                </label>
              </div>
              {/* 'To Inventory' option removed */}
              <div className="flex items-center">
                <input
                  type="radio"
                  id="type_return"
                  name="transactionType"
                  value="Return"
                  checked={formData.transactionType === 'Return'}
                  onChange={(e) => handleInputChange('transactionType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="type_return" className="ml-2 block text-sm text-gray-900">
                  Return
                </label>
              </div>
            </div>
            {errors.transactionType && (
              <p className="mt-1 text-sm text-red-600">{errors.transactionType}</p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Status
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="status_pending"
                  name="status"
                  value="pending"
                  checked={formData.status === 'pending'}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="status_pending" className="ml-2 block text-sm text-gray-900">
                  Pending
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="status_completed"
                  name="status"
                  value="completed"
                  checked={formData.status === 'completed'}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="status_completed" className="ml-2 block text-sm text-gray-900">
                  Completed
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="status_cancelled"
                  name="status"
                  value="canceled"
                  checked={formData.status === 'canceled'}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="status_cancelled" className="ml-2 block text-sm text-gray-900">
                  Canceled
                </label>
              </div>
            </div>
            {errors.status && (
              <p className="mt-1 text-sm text-red-600">{errors.status}</p>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Transaction Method
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="method_client_card"
                  name="paymentMethod"
                  value="Client Card"
                  checked={formData.paymentMethod === 'Client Card'}
                  onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="method_client_card" className="ml-2 block text-sm text-gray-900">
                  Client Card
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="method_1584_card"
                  name="paymentMethod"
                  value={COMPANY_NAME}
                  checked={formData.paymentMethod === COMPANY_NAME}
                  onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="method_1584_card" className="ml-2 block text-sm text-gray-900">
                  {COMPANY_NAME}
                </label>
              </div>
            </div>
            {errors.paymentMethod && (
              <p className="mt-1 text-sm text-red-600">{errors.paymentMethod}</p>
            )}
          </div>

          {/* Reimbursement Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Reimbursement Type
            </label>
            <p className="mb-3 text-xs text-gray-500">Flags transactions that require reimbursement</p>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="reimbursement_none"
                  name="reimbursementType"
                  value=""
                  checked={!formData.reimbursementType}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_none" className="ml-2 block text-sm text-gray-900">
                  None
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="reimbursement_client_owes"
                  name="reimbursementType"
                  value={CLIENT_OWES_COMPANY}
                  checked={formData.reimbursementType === CLIENT_OWES_COMPANY}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_client_owes" className="ml-2 block text-sm text-gray-900">
                  {CLIENT_OWES_COMPANY}
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="reimbursement_we_owe"
                  name="reimbursementType"
                  value={COMPANY_OWES_CLIENT}
                  checked={formData.reimbursementType === COMPANY_OWES_CLIENT}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_we_owe" className="ml-2 block text-sm text-gray-900">
                  {COMPANY_OWES_CLIENT}
                </label>
              </div>
            </div>
            {errors.reimbursementType && (
              <p className="mt-1 text-sm text-red-600">{errors.reimbursementType}</p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
              Amount *
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="text"
                id="amount"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.amount ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.amount && (
              <p className="mt-1 text-sm text-red-600">{errors.amount}</p>
            )}
          </div>

          {/* Tax Rate Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Tax Rate Preset</label>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="tax_preset_none"
                  name="tax_rate_preset"
                  value={NO_TAX_PRESET_ID}
                  checked={taxRatePreset === NO_TAX_PRESET_ID}
                  onChange={() => {
                    setTaxRatePreset(NO_TAX_PRESET_ID)
                    setSubtotal('')
                  }}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="tax_preset_none" className="ml-2 block text-sm text-gray-900">
                  No Tax (0%)
                </label>
              </div>
              {taxPresets.map((preset) => (
                <div key={preset.id} className="flex items-center">
                  <input
                    type="radio"
                    id={`tax_preset_${preset.id}`}
                    name="tax_rate_preset"
                    value={preset.id}
                    checked={taxRatePreset === preset.id}
                    onChange={(e) => setTaxRatePreset(e.target.value)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <label htmlFor={`tax_preset_${preset.id}`} className="ml-2 block text-sm text-gray-900">
                    {preset.name} ({preset.rate}%)
                  </label>
                </div>
              ))}
              <div className="flex items-center">
                <input
                  type="radio"
                  id="tax_preset_other"
                  name="tax_rate_preset"
                  value="Other"
                  checked={taxRatePreset === 'Other'}
                  onChange={(e) => setTaxRatePreset(e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="tax_preset_other" className="ml-2 block text-sm text-gray-900">
                  Other
                </label>
              </div>
            </div>
            {/* Show selected tax rate for presets */}
            {taxRatePreset &&
              taxRatePreset !== 'Other' &&
              taxRatePreset !== NO_TAX_PRESET_ID &&
              selectedPresetRate !== undefined && (
              <div className="mt-3 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Tax Rate:</span> {selectedPresetRate}%
                </p>
              </div>
            )}
          </div>

          {/* Subtotal (shown only for Other) */}
          {taxRatePreset === 'Other' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Subtotal</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  type="text"
                  id="subtotal"
                  value={subtotal}
                  onChange={(e) => setSubtotal(e.target.value)}
                  placeholder="0.00"
                  className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 border-gray-300`}
                />
              </div>
              <p className="mt-1 text-sm text-gray-500">This will be used to calculate the tax rate.</p>
            </div>
          )}

          {/* Transaction Date */}
          <div>
            <label htmlFor="transactionDate" className="block text-sm font-medium text-gray-700">
              Transaction Date
            </label>
            <input
              type="date"
              id="transactionDate"
              value={formData.transactionDate}
              onChange={(e) => {
                // Use the date value directly (YYYY-MM-DD format)
                handleInputChange('transactionDate', e.target.value)
              }}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                errors.transactionDate ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.transactionDate && (
              <p className="mt-1 text-sm text-red-600">{errors.transactionDate}</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            <textarea
              id="notes"
              rows={3}
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              placeholder="Additional notes about this transaction..."
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                errors.notes ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.notes && (
              <p className="mt-1 text-sm text-red-600">{errors.notes}</p>
            )}
          </div>

          {/* Transaction Items */}
          <div>
            <TransactionItemsList
              items={items}
              onItemsChange={(newItems) => {
                setItems(newItems)
                // Clear items error if items are added
                if (errors.items && newItems.length > 0) {
                  setErrors(prev => ({ ...prev, items: undefined }))
                }
              }}
              projectId={projectId}
              projectName={projectName}
              onRemoveFromTransaction={async (itemId, item) => {
                const isDraft = itemId.toString().startsWith('item-')
                if (isDraft) {
                  setItems(prev => prev.filter(i => i.id !== itemId))
                  return
                }
                if (!currentAccountId) return
                await unifiedItemsService.unlinkItemFromTransaction(currentAccountId, transactionId, itemId, {
                  itemCurrentTransactionId: transactionId
                })
                setItems(prev => prev.filter(i => i.id !== itemId))
              }}
            />
            {errors.items && (
              <p className="mt-1 text-sm text-red-600">{errors.items}</p>
            )}
          </div>

          {/* Receipts */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Receipts
            </h3>
            {existingReceiptImages.length > 0 && (
              <TransactionImagePreview
                images={existingReceiptImages}
                onRemoveImage={handleRemoveExistingReceiptImage}
                showControls={!isSubmitting}
                maxImages={5}
                className="mb-4"
              />
            )}
            <ImageUpload
              onImagesChange={handleReceiptImagesChange}
              maxImages={5}
              maxFileSize={10}
              acceptedTypes={['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf']}
              disabled={isSubmitting}
              className="mb-2"
            />
            {errors.receiptImages && (
              <p className="mt-1 text-sm text-red-600">{errors.receiptImages}</p>
            )}
          </div>

          {/* Receipt Email Copy */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Receipt Email Copy
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="receipt_yes"
                  name="receiptEmailed"
                  checked={formData.receiptEmailed === true}
                  onChange={() => handleInputChange('receiptEmailed', true)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="receipt_yes" className="ml-2 block text-sm text-gray-900">
                  Yes
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="receipt_no"
                  name="receiptEmailed"
                  checked={formData.receiptEmailed === false}
                  onChange={() => handleInputChange('receiptEmailed', false)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="receipt_no" className="ml-2 block text-sm text-gray-900">
                  No
                </label>
              </div>
            </div>
          </div>

          {/* Other Images */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Other Images
            </h3>
            {existingOtherImages.length > 0 && (
              <TransactionImagePreview
                images={existingOtherImages}
                onRemoveImage={handleRemoveExistingOtherImage}
                showControls={!isSubmitting}
                maxImages={5}
                className="mb-4"
              />
            )}
            <ImageUpload
              onImagesChange={(files) => handleInputChange('otherImages', files)}
              maxImages={5}
              maxFileSize={10}
              disabled={isSubmitting}
              className="mb-2"
            />
            {errors.otherImages && (
              <p className="mt-1 text-sm text-red-600">{errors.otherImages}</p>
            )}
          </div>


          {/* Form Actions - Sticky positioned at bottom of form */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-6 -mb-6 px-6 py-4 mt-6">
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  handleBackNavigation()
                }}
                className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </button>
              <div className="flex flex-col items-end gap-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSubmitting ? 'Updating...' : 'Update'}
                </button>
                <UploadActivityIndicator isUploading={isUploadingImages} label="Uploading images" />
              </div>
            </div>
          </div>
        </form>
      </div>


    </div>
  )
}
