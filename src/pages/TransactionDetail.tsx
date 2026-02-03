import { ArrowLeft, Trash2, Image as ImageIcon, Package, RefreshCw, X, AlertCircle } from 'lucide-react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import ImageGallery from '@/components/ui/ImageGallery'
import { TransactionImagePreview } from '@/components/ui/ImagePreview'
import { useParams } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import ContextLink from '@/components/ContextLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { Transaction, Project, Item, TransactionItemFormData, BudgetCategory, ItemDisposition, ItemImage, TransactionImage } from '@/types'
import {
  transactionService,
  projectService,
  unifiedItemsService,
  integrationService,
  isCanonicalTransactionId,
  isCanonicalSaleOrPurchaseTransactionId,
  computeCanonicalTransactionTotal,
  SellItemToProjectError
} from '@/services/inventoryService'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { lineageService } from '@/services/lineageService'
import { getItemizationEnabled } from '@/utils/categoryItemization'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import { offlineStore } from '@/services/offlineStore'
import { offlineTransactionService } from '@/services/offlineTransactionService'
import { useOfflineMediaTracker } from '@/hooks/useOfflineMediaTracker'
import { formatDate, formatCurrency } from '@/utils/dateUtils'
import { useToast } from '@/components/ui/ToastContext'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import TransactionItemsList from '@/components/TransactionItemsList'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { useNetworkState } from '@/hooks/useNetworkState'
import { hydrateOptimisticItem, hydrateTransactionCache, loadTransactionItemsWithReconcile } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { COMPANY_INVENTORY, COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import TransactionAudit from '@/components/ui/TransactionAudit'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { projectTransactionDetail, projectTransactionEdit, projectTransactions } from '@/utils/routes'
import { splitItemsByMovement, type DisplayTransactionItem } from '@/utils/transactionMovement'
import { ConflictResolutionView } from '@/components/ConflictResolutionView'
import TransactionActionsMenu from '@/components/transactions/TransactionActionsMenu'
import { Combobox } from '@/components/ui/Combobox'
import TransactionItemPicker from '@/components/transactions/TransactionItemPicker'


// Get canonical transaction title for display
const getCanonicalTransactionTitle = (transaction: Transaction): string => {
  // Check if this is a canonical inventory transaction
  if (transaction.transactionId?.startsWith('INV_SALE_')) {
    return COMPANY_INVENTORY_SALE
  }
  if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
    return COMPANY_INVENTORY_PURCHASE
  }
  // Return the original source for non-canonical transactions
  return transaction.source
}

  // Get budget category display name from transaction (handles both legacy and new fields)
const getBudgetCategoryDisplayName = (transaction: Transaction, categories: BudgetCategory[]): string | undefined => {
  // First try the new categoryId field
  if (transaction.categoryId) {
    const category = categories.find(c => c.id === transaction.categoryId)
    return category?.name
  }
  // Fall back to legacy budgetCategory field
  return transaction.budgetCategory
}

// Get category for transaction
const getTransactionCategory = (transaction: Transaction, categories: BudgetCategory[]): BudgetCategory | undefined => {
  if (transaction.categoryId) {
    return categories.find(c => c.id === transaction.categoryId)
  }
  return undefined
}

const buildDisplayItems = (items: Item[], movedOutItemIds: Set<string>): DisplayTransactionItem[] => {
  return items.map(item => ({
    id: item.itemId,
    transactionId: item.transactionId ?? item.latestTransactionId ?? undefined,
    description: item.description || '',
    purchasePrice: item.purchasePrice?.toString() || '',
    projectPrice: item.projectPrice?.toString() || '',
    sku: item.sku || '',
    marketValue: item.marketValue?.toString() || '',
    notes: item.notes || '',
    disposition: item.disposition,
    imageFiles: [],
    images: item.images || [],
    taxAmountPurchasePrice: item.taxAmountPurchasePrice,
    taxAmountProjectPrice: item.taxAmountProjectPrice,
    _latestTransactionId: item.latestTransactionId,
    _transactionId: item.transactionId || undefined,
    _projectId: item.projectId ?? null,
    _previousProjectTransactionId: item.previousProjectTransactionId,
    _hasMovedOut: movedOutItemIds.has(item.itemId)
  }))
}

const ITEM_DISPOSITION_VALUES: ItemDisposition[] = [
  'to purchase',
  'purchased',
  'to return',
  'returned',
  'inventory'
]

const normalizeDisposition = (value: string | null | undefined): ItemDisposition => {
  if (value && ITEM_DISPOSITION_VALUES.includes(value as ItemDisposition)) {
    return value as ItemDisposition
  }
  return 'purchased'
}


export default function TransactionDetail() {
  const { id, projectId: routeProjectId, transactionId } = useParams<{ id?: string; projectId?: string; transactionId: string }>()
  const projectId = routeProjectId || id
  const navigate = useStackedNavigate()
  const hasSyncError = useSyncError()
  const { currentAccountId } = useAccount()
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isUpdatingProject, setIsUpdatingProject] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [showItemProjectDialog, setShowItemProjectDialog] = useState(false)
  const [itemProjectDialogMode, setItemProjectDialogMode] = useState<'move' | 'sell'>('move')
  const [itemProjectTargetId, setItemProjectTargetId] = useState<string | null>(null)
  const [itemProjectSelectedId, setItemProjectSelectedId] = useState('')
  const [isUpdatingItemProject, setIsUpdatingItemProject] = useState(false)
  const transactionRef = useRef<Transaction | null>(null)
  const derivedRealtimeProjectId = projectId || transaction?.projectId || null
  const { refreshCollections: refreshRealtimeCollections, items: realtimeProjectItems } = useProjectRealtime(derivedRealtimeProjectId)
  let refreshTransactionItems: (() => Promise<void>) | null = null
  const refreshRealtimeAfterWrite = useCallback(
    async (includeProject = false) => {
      if (derivedRealtimeProjectId) {
        return refreshRealtimeCollections(includeProject ? { includeProject: true } : undefined).catch(err => {
          console.debug('TransactionDetail: realtime refresh failed', err)
        })
      }

      // Business inventory fallback: refresh the transaction items directly.
      return refreshTransactionItems?.()
    },
    [derivedRealtimeProjectId, refreshRealtimeCollections]
  )

  useEffect(() => {
    const loadBudgetCategories = async () => {
      if (!currentAccountId) return
      try {
        const categories = await budgetCategoriesService.getCategories(currentAccountId, true)
        setBudgetCategories(categories)
      } catch (error) {
        console.error('Error loading budget categories:', error)
      }
    }
    loadBudgetCategories()
  }, [currentAccountId])

  // Transaction items state - using TransactionItemFormData like the edit screen
  const [items, setItems] = useState<TransactionItemFormData[]>([])
  const initialItemsRef = useRef<TransactionItemFormData[] | null>(null)
  const realtimeTransactionItemIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    transactionRef.current = transaction
  }, [transaction])

  const snapshotInitialItems = (displayItems: TransactionItemFormData[]) => {
    try {
      initialItemsRef.current = displayItems.map(i => ({
        id: i.id,
        description: i.description,
        purchasePrice: i.purchasePrice,
        projectPrice: i.projectPrice,
        sku: i.sku,
        marketValue: i.marketValue,
        notes: i.notes
      }) as TransactionItemFormData)
    } catch (e) {
      console.debug('TransactionDetail - failed to snapshot initial items', e)
      initialItemsRef.current = null
    }
  }

  // Cache resolved project IDs for transactions referenced by items when item.projectId is missing
  const [resolvedProjectByTx, setResolvedProjectByTx] = useState<Record<string, string>>({})
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingItems, setIsLoadingItems] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0)
  const [showExistingItemsModal, setShowExistingItemsModal] = useState(false)
  const [modalPosition, setModalPosition] = useState<{ top: number; left: number; width: number; containerLeft: number } | null>(null)
  const transactionItemsContainerRef = useRef<HTMLDivElement>(null)
  const [isImagePinned, setIsImagePinned] = useState(false)
  const [pinnedImage, setPinnedImage] = useState<ItemImage | null>(null)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)
  const isSavingNotesRef = useRef(false)
  useEffect(() => {
    isSavingNotesRef.current = isSavingNotes
  }, [isSavingNotes])
  useEffect(() => {
    if (!isEditingNotes) {
      setNotesDraft(transaction?.notes ?? '')
    }
  }, [transaction?.notes, isEditingNotes])
  // Pin panel gesture state
  const [pinZoom, setPinZoom] = useState(1)
  const [pinPanX, setPinPanX] = useState(0)
  const [pinPanY, setPinPanY] = useState(0)
  const pinImageContainerRef = useRef<HTMLDivElement>(null)
  const pinImageRef = useRef<HTMLImageElement>(null)
  const pinZoomRef = useRef(1)
  const pinPanXRef = useRef(0)
  const pinPanYRef = useRef(0)
  const pinSuppressClickRef = useRef(false)
  const pinPointerStartRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinLastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const pinPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  
  type PinGestureState =
    | {
        kind: 'pan'
        pointerId: number
        startClientX: number
        startClientY: number
        startPanX: number
        startPanY: number
      }
    | {
        kind: 'pinch'
        pointerIdA: number
        pointerIdB: number
        startDistance: number
        startZoom: number
        startPanX: number
        startPanY: number
        containerCenterX: number
        containerCenterY: number
        startPinchCenterX: number
        startPinchCenterY: number
      }
  
  const pinGestureRef = useRef<PinGestureState | null>(null)
  const [receiptUploadsInFlight, setReceiptUploadsInFlight] = useState(0)
  const [otherUploadsInFlight, setOtherUploadsInFlight] = useState(0)
  const isUploadingReceiptImages = receiptUploadsInFlight > 0
  const isUploadingOtherImages = otherUploadsInFlight > 0
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())
  const [itemRecords, setItemRecords] = useState<Item[]>([])
  const [computedTotal, setComputedTotal] = useState<string | null>(null)
  const [isHealingAmount, setIsHealingAmount] = useState(false)

  useEffect(() => {
    if (!transaction) return
    setSelectedProjectId(transaction.projectId || '')
  }, [transaction])

  useEffect(() => {
    if (!currentAccountId) return
    let isMounted = true

    const fetchProjects = async () => {
      setLoadingProjects(true)
      try {
        const fetchedProjects = await projectService.getProjects(currentAccountId)
        if (isMounted) {
          setProjects(fetchedProjects)
        }
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        if (isMounted) {
          setLoadingProjects(false)
        }
      }
    }

    fetchProjects()

    return () => {
      isMounted = false
    }
  }, [currentAccountId])

  async function resolveMissingProjectIds(items: Item[]) {
    if (!currentAccountId) return

    const txIdsToResolve = Array.from(new Set(
      items
        .map(i => i.latestTransactionId ?? i.transactionId)
        .filter(Boolean) as string[]
    )).filter(txId => !resolvedProjectByTx[txId])

    if (txIdsToResolve.length === 0) return

    try {
      const results = await Promise.all(
        txIdsToResolve.map(async (txId) => {
          try {
            const res = await transactionService.getTransactionById(currentAccountId, txId)
            return { txId, projectId: res.projectId || null }
          } catch (err) {
            console.debug('TransactionDetail - failed to fetch transaction for project resolution', { txId, err })
            return { txId, projectId: null }
          }
        })
      )

      const newMap = { ...resolvedProjectByTx }
      results.forEach(r => {
        if (r.projectId) {
          newMap[r.txId] = r.projectId
        }
      })

      if (Object.keys(newMap).length > Object.keys(resolvedProjectByTx).length) {
        setResolvedProjectByTx(newMap)
      }
    } catch (err) {
      console.debug('TransactionDetail - resolveMissingProjectIds unexpected error', err)
    }
  }

  const setLoadedItems = (validItems: Item[], movedOutItemIds: Set<string>) => {
    setItemRecords(validItems)
    const displayItems = buildDisplayItems(validItems, movedOutItemIds)
    setItems(displayItems)
    snapshotInitialItems(displayItems)
    resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
  }

  // Compute canonical transaction total and self-heal if needed
  useEffect(() => {
    const computeAndHealTotal = async () => {
      if (!transaction || !currentAccountId || !transactionId) return
      if (!isCanonicalSaleOrPurchaseTransactionId(transactionId)) return

      try {
        // Get item IDs from transaction and lineage edges
        const itemIds = Array.isArray(transaction.itemIds) ? transaction.itemIds : []
        let edges: Array<{ itemId: string }> = []
        let movedOutItemIds: string[] = []
        try {
          const fetchedEdges = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
          edges = fetchedEdges.map(edge => ({ itemId: edge.itemId }))
          movedOutItemIds = Array.from(new Set(fetchedEdges.map(edge => edge.itemId)))
        } catch (edgeError) {
          console.warn('⚠️ Failed to fetch lineage edges (non-fatal):', edgeError)
          edges = []
          movedOutItemIds = []
        }

        // Compute total
        const computed = await computeCanonicalTransactionTotal(
          currentAccountId,
          transactionId,
          itemIds,
          edges
        )
        
        // Only proceed if compute succeeded (non-null)
        if (computed === null) {
          console.log('⏭️ Skipped healing (compute failed) for canonical transaction:', transactionId)
          // Don't set computedTotal - fall back to stored amount
          setComputedTotal(null)
          return
        }
        
        setComputedTotal(computed)

        // Compare with stored amount and self-heal if different
        const storedAmount = parseFloat(transaction.amount || '0').toFixed(2)
        if (computed !== storedAmount) {
          console.log('🔧 Canonical transaction total mismatch detected:', {
            transactionId,
            stored: storedAmount,
            computed,
            itemIds: itemIds.length,
            movedOutItemIds: movedOutItemIds.length
          })

          // Only heal if projectId is available
          const resolvedProjectId = projectId || transaction.projectId
          if (!resolvedProjectId) {
            console.log('⏭️ Skipped healing (missing projectId) for canonical transaction:', transactionId)
            return
          }

          // Self-heal: update stored amount in background (non-blocking)
          setIsHealingAmount(true)
          try {
            await transactionService.updateTransaction(
              currentAccountId,
              resolvedProjectId,
              transactionId,
              { amount: computed }
            )
            console.log('✅ Self-healed canonical transaction amount:', transactionId, computed)
            // Update local transaction state
            setTransaction(prev => prev ? { ...prev, amount: computed } : prev)
          } catch (healError) {
            console.warn('⚠️ Failed to self-heal canonical transaction amount:', healError)
          } finally {
            setIsHealingAmount(false)
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to compute canonical transaction total:', error)
        // Don't set computedTotal on error - fall back to stored amount
        setComputedTotal(null)
      }
    }

    computeAndHealTotal()
  }, [transaction, currentAccountId, transactionId, projectId])

  const { inTransaction: itemsInTransaction, movedOut: itemsMovedOut } = useMemo(() => {
    return splitItemsByMovement(items as DisplayTransactionItem[], transactionId)
  }, [items, transactionId])
  const auditItems = useMemo(() => {
    if (!itemsInTransaction.length) {
      return []
    }

    const inTransactionItemIds = new Set(itemsInTransaction.map(item => item.id))
    return itemRecords.filter(item => inTransactionItemIds.has(item.itemId))
  }, [itemRecords, itemsInTransaction])
  const { showError, showSuccess } = useToast()
  const { showOfflineSaved } = useOfflineFeedback()
  const { isOnline } = useNetworkState()
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  
  // Track offline media IDs for cleanup
  const itemImageTracker = useOfflineMediaTracker()
  const receiptTracker = useOfflineMediaTracker()
  const otherImageTracker = useOfflineMediaTracker()

  // Navigation context logic

  const backDestination = useMemo(() => {
    const fallbackPath = projectId ? projectTransactions(projectId) : '/projects'
    return getBackDestination(fallbackPath)
  }, [getBackDestination, projectId])

  const editTransactionUrl = useMemo(() => {
    if (!transactionId) {
      return '/projects'
    }

    const normalizedTransactionProjectId =
      transaction?.projectId && transaction.projectId !== 'null' ? transaction.projectId : undefined
    const resolvedProjectId = projectId ?? normalizedTransactionProjectId

    if (resolvedProjectId) {
      return projectTransactionEdit(resolvedProjectId, transactionId)
    }

    return `/business-inventory/transaction/null/${transactionId}/edit`
  }, [projectId, transaction?.projectId, transactionId])

  const fetchItemsViaReconcile = useCallback(
    async (projectScope?: string | null) => {
      if (!currentAccountId || !transactionId) return []
      const queryClient = getGlobalQueryClient()
      if (queryClient) {
        return await loadTransactionItemsWithReconcile(queryClient, currentAccountId, transactionId, {
          projectId: projectScope ?? undefined,
        })
      }
      return await unifiedItemsService.getItemsForTransaction(
        currentAccountId,
        projectScope ?? '',
        transactionId
      )
    },
    [currentAccountId, transactionId]
  )

  // Refresh transaction items
  const refreshTransactionItemsCallback = useCallback(async () => {
    if (!currentAccountId || !transactionId) return

    const activeTransaction = transactionRef.current
    const actualProjectId = projectId ?? activeTransaction?.projectId ?? null
    if (!activeTransaction) return

    try {
      const transactionItems = await fetchItemsViaReconcile(actualProjectId)
      let validItems = transactionItems.filter(item => item !== null) as Item[]

      // Include items that were moved out of this transaction by consulting lineage edges.
      // The UI displays both "in transaction" and "moved out" items; we need to load moved items too.
      const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
      const movedOutItemIds = Array.from(new Set(edgesFromTransaction.map(edge => edge.itemId)))

      // Fetch any moved item records that aren't already in the items list
      const missingMovedItemIds = movedOutItemIds.filter(id => !validItems.some(it => it.itemId === id))
      if (missingMovedItemIds.length > 0) {
        const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
        const movedItems = await Promise.all(movedItemsPromises)
        const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
        validItems = validItems.concat(validMovedItems)
        console.log('TransactionDetail - refresh added moved items:', validMovedItems.length)
      }

      setLoadedItems(validItems, new Set<string>(movedOutItemIds))
    } catch (error) {
      console.error('Error refreshing transaction items:', error)
    }
  }, [currentAccountId, projectId, transactionId, fetchItemsViaReconcile])
  refreshTransactionItems = refreshTransactionItemsCallback

  useEffect(() => {
    if (!transactionId || !realtimeProjectItems || realtimeProjectItems.length === 0) {
      realtimeTransactionItemIdsRef.current = new Set()
      return
    }

    const relevantItemIds = new Set(
      realtimeProjectItems
        .filter(item => item?.transactionId === transactionId || item?.latestTransactionId === transactionId)
        .map(item => item.itemId)
        .filter((id): id is string => Boolean(id))
    )

    const prevIds = realtimeTransactionItemIdsRef.current
    let hasChange = relevantItemIds.size !== prevIds.size

    if (!hasChange) {
      for (const id of relevantItemIds) {
        if (!prevIds.has(id)) {
          hasChange = true
          break
        }
      }
    }

    if (hasChange) {
      realtimeTransactionItemIdsRef.current = relevantItemIds
      refreshTransactionItems().catch(err => console.debug('TransactionDetail: realtime refresh failed', err))
    }
  }, [realtimeProjectItems, transactionId, refreshTransactionItems])

  const handleDeletePersistedItems = useCallback(
    async (itemIds: string[]) => {
      if (!currentAccountId) {
        showError('You must belong to an account to delete items.')
        return false
      }

      if (itemIds.length === 0) {
        return true
      }

      const deletionResults = await Promise.allSettled(
        itemIds.map(itemId => unifiedItemsService.deleteItem(currentAccountId, itemId))
      )

      let successCount = 0
      let errorCount = 0

      deletionResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++
          return
        }

        errorCount++
        console.error(`Error deleting item ${itemIds[index]}:`, result.reason)
      })

      if (successCount > 0) {
        await refreshTransactionItems()
        await refreshRealtimeAfterWrite()
        const message =
          successCount === 1
            ? 'Item deleted successfully'
            : `${successCount} items deleted successfully`
        showSuccess(message)
      }

      if (errorCount > 0) {
        showError('Failed to delete some items. Please try again.')
      }

      return errorCount === 0
    },
    [currentAccountId, refreshRealtimeAfterWrite, refreshTransactionItems, showError, showSuccess]
  )

  const handleRemoveItemFromThisTransaction = useCallback(
    async (itemId: string, item: TransactionItemFormData) => {
      if (!currentAccountId) {
        showError('You must belong to an account to update items.')
        return
      }

      if (!transactionId) {
        showError('Missing transaction ID.')
        return
      }

      try {
        const displayItem = item as any
        const itemCurrentTransactionId: string | null | undefined =
          (displayItem?._latestTransactionId ?? displayItem?._transactionId ?? null) as string | null

        await unifiedItemsService.unlinkItemFromTransaction(currentAccountId, transactionId, itemId, {
          itemCurrentTransactionId
        })
        await refreshTransactionItems()
        await refreshRealtimeAfterWrite()
        showSuccess('Removed from transaction')
      } catch (error) {
        console.error('Failed to remove item from transaction:', error)
        showError('Failed to remove item from transaction. Please try again.')
      }
    },
    [currentAccountId, refreshRealtimeAfterWrite, refreshTransactionItems, showError, showSuccess, transactionId]
  )

  const loadTransaction = useCallback(async () => {
    if (!transactionId || !currentAccountId) return

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

      let actualProjectId: string | null | undefined = projectId ?? null
      let transactionData: Transaction | null = null
      let projectData: Project | null = null

      if (cachedTransaction) {
        console.log('✅ Transaction found in React Query cache:', cachedTransaction.transactionId)
        transactionData = cachedTransaction
        actualProjectId = cachedTransaction.projectId ?? projectId ?? null

        // Still need to load project if projectId exists
        if (actualProjectId) {
          try {
            projectData = await projectService.getProject(currentAccountId, actualProjectId)
            if (projectData) {
              setProject(projectData)
            }
          } catch (error) {
            console.warn('Failed to fetch project name:', error)
          }
        }

        setTransaction(transactionData)
        setIsLoading(false)
        // Continue to load items below - use cached transaction data
      } else {
        // Transaction not in cache, proceed with normal loading
        let fetchedTransactionData: any
        let fetchedProjectData: Project | null = null

        if (!actualProjectId) {
        // For business inventory transactions, we need to find the transaction across all projects
        console.log('TransactionDetail - No projectId provided, searching across all projects for business inventory transaction')
        const result = await transactionService.getTransactionById(currentAccountId, transactionId)

        if (!result.transaction) {
          console.error('TransactionDetail - Transaction not found in any project')
          setIsLoading(false)
          setIsLoadingItems(false)
          return
        }

          fetchedTransactionData = result.transaction
          actualProjectId = result.projectId

          // Get project data only if projectId exists (business inventory transactions have null projectId)
          if (actualProjectId) {
            fetchedProjectData = await projectService.getProject(currentAccountId, actualProjectId)
          }
        } else {
          // Fetch transaction and project data for regular project transactions.
          // We intentionally do NOT rely on `getItemsForTransaction` here because moved/deallocated
          // items may have been cleared from the `transaction_id` column. Instead, read
          // `itemIds` from the transaction row and load each item by `item_id` so moved items
          // are still discoverable and can be shown in the "Moved out" section.
          const [fetchedTxData, fetchedProjData] = await Promise.all([
            transactionService.getTransaction(currentAccountId, actualProjectId, transactionId),
            projectService.getProject(currentAccountId, actualProjectId)
          ])

          fetchedTransactionData = fetchedTxData
          fetchedProjectData = fetchedProjData
        }

        transactionData = fetchedTransactionData
        projectData = fetchedProjectData

        setTransaction(transactionData)
        if (projectData) {
          setProject(projectData)
        }
        setIsLoading(false)
      }

      // Load items for both cached and fetched transactions
      if (transactionData) {

        // Prefer item IDs stored on the transaction record
        const itemIdsFromTransaction = Array.isArray(transactionData?.itemIds) ? transactionData.itemIds : []
        if (itemIdsFromTransaction.length > 0) {
          const itemsPromises = itemIdsFromTransaction.map((itemId: string) => unifiedItemsService.getItemById(currentAccountId, itemId))
          const items = await Promise.all(itemsPromises)
          let validItems = items.filter(item => item !== null) as Item[]
          console.log('TransactionDetail - fetched items (from transaction.itemIds):', validItems.length)

          try {
            // Include items that were moved out of this transaction by consulting lineage edges.
            // The UI displays both "in transaction" and "moved out" items; we need to load moved items too.
            const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
            const movedOutItemIds = Array.from(new Set(edgesFromTransaction.map(edge => edge.itemId)))

            // Detect "ghost references": items fetched via transaction.itemIds that are neither
            // currently attached to this transaction nor present in lineage. Without this,
            // users can see an empty items list even though audit/completeness thinks the
            // transaction has items.
            const ghostReferencedItemIds = validItems
              .filter(it => (it as any).transactionId !== transactionId && !movedOutItemIds.includes(it.itemId))
              .map(it => it.itemId)

            if (ghostReferencedItemIds.length > 0) {
              console.warn('TransactionDetail - found ghost-referenced items (treating as moved out for display):', {
                transactionId,
                count: ghostReferencedItemIds.length,
                itemIds: ghostReferencedItemIds.slice(0, 10)
              })
            }

            // Fetch any moved item records that aren't already in the items list
            const missingMovedItemIds = movedOutItemIds.filter(id => !validItems.some(it => it.itemId === id))
            if (missingMovedItemIds.length > 0) {
              const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
              const movedItems = await Promise.all(movedItemsPromises)
              const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
              validItems = validItems.concat(validMovedItems)
              console.log('TransactionDetail - added moved items:', validMovedItems.length)
            }

            const movedOutPlusGhost = new Set<string>([...movedOutItemIds, ...ghostReferencedItemIds])
            setLoadedItems(validItems, movedOutPlusGhost)
          } catch (edgeErr) {
            console.error('TransactionDetail - failed to fetch lineage edges:', edgeErr)
            setLoadedItems(validItems, new Set<string>())
          }
        } else {
          // Fallback: query items by transaction_id when itemIds is empty or missing
          console.log('TransactionDetail - itemIds empty, falling back to getItemsForTransaction')
          try {
            const transactionItems = await fetchItemsViaReconcile(actualProjectId)
            const itemIds = transactionItems.map(item => item.itemId)
            const itemsPromises = itemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
            const items = await Promise.all(itemsPromises)
            let validItems = items.filter(item => item !== null) as Item[]

            let movedOutItemIds = new Set<string>()
            try {
              // Include items that were moved out of this transaction by consulting lineage edges.
              // The UI displays both "in transaction" and "moved out" items; we need to load moved items too.
              const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
              const allMovedOutItemIds = Array.from(new Set<string>(edgesFromTransaction.map(edge => edge.itemId)))

              // Fetch any moved item records that aren't already in the items list
              const missingMovedItemIds = allMovedOutItemIds.filter(id => !validItems.some(it => it.itemId === id))
              if (missingMovedItemIds.length > 0) {
                const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
                const movedItems = await Promise.all(movedItemsPromises)
                const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
                validItems = validItems.concat(validMovedItems)
                console.log('TransactionDetail - added moved items (fallback):', validMovedItems.length)
              }

              movedOutItemIds = new Set<string>(allMovedOutItemIds)
            } catch (edgeErr) {
              console.error('TransactionDetail - failed to fetch lineage edges via fallback:', edgeErr)
            }

            setLoadedItems(validItems, movedOutItemIds)
          } catch (itemError) {
            console.error('TransactionDetail - failed to fetch items by transaction_id:', itemError)
            setItems([])
          }
        }
      }

    } catch (error) {
      console.error('Error loading transaction:', error)
      setItems([])
    } finally {
      setIsLoading(false)
      setIsLoadingItems(false)
    }
  }, [projectId, transactionId, currentAccountId, fetchItemsViaReconcile])

  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: project.name,
      disabled: project.id === transaction?.projectId
    })),
    [projects, transaction?.projectId]
  )
  const itemTargetRecord = useMemo(
    () => itemRecords.find(item => item.itemId === itemProjectTargetId) ?? null,
    [itemProjectTargetId, itemRecords]
  )
  const itemProjectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: project.name,
      disabled: project.id === itemTargetRecord?.projectId
    })),
    [projects, itemTargetRecord?.projectId]
  )
  const itemAssociateDisabledReason = itemTargetRecord?.transactionId
    ? (isCanonicalTransactionId(itemTargetRecord.transactionId)
      ? 'This item is tied to a Design Business Inventory transaction. You can’t change its project directly.'
      : 'This item is tied to a transaction. Move the transaction to another project instead.')
    : null
  const itemAssociateDisabled = Boolean(itemAssociateDisabledReason) || loadingProjects || isUpdatingItemProject

  const canMoveToBusinessInventory = Boolean(transaction?.projectId)
  const canMoveToProject = projectOptions.length > 0

  const openProjectDialog = useCallback(() => {
    if (!transaction) return
    setSelectedProjectId(transaction.projectId || '')
    setShowProjectDialog(true)
  }, [transaction])

  const openItemProjectDialog = useCallback((itemId: string, mode: 'move' | 'sell') => {
    const item = itemRecords.find(record => record.itemId === itemId)
    if (!item) {
      showError('Item not found. Refresh and try again.')
      return
    }
    setItemProjectTargetId(itemId)
    setItemProjectDialogMode(mode)
    setItemProjectSelectedId(item.projectId ?? '')
    setShowItemProjectDialog(true)
  }, [itemRecords, showError])

  const handleMoveItemToBusinessInventory = useCallback(async (itemId: string) => {
    if (!currentAccountId) return
    const item = itemRecords.find(record => record.itemId === itemId)
    if (!item || !item.projectId) return
    if (item.transactionId) {
      showError('This item is tied to a transaction. Move the transaction instead.')
      return
    }
    try {
      await integrationService.moveItemToBusinessInventory(currentAccountId, item.itemId, item.projectId)
      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      showSuccess('Moved to business inventory.')
    } catch (error) {
      console.error('Failed to move item to business inventory:', error)
      showError('Failed to move item to business inventory. Please try again.')
    }
  }, [currentAccountId, itemRecords, refreshRealtimeAfterWrite, refreshTransactionItems, showError, showSuccess])

  const handleSellItemToBusinessInventory = useCallback(async (itemId: string) => {
    if (!currentAccountId) return
    const item = itemRecords.find(record => record.itemId === itemId)
    if (!item || !item.projectId) return
    try {
      const wasOffline = !isOnline
      await integrationService.handleItemDeallocation(currentAccountId, item.itemId, item.projectId, 'inventory')
      if (wasOffline) {
        showOfflineSaved()
        return
      }
      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      showSuccess('Moved to business inventory.')
    } catch (error) {
      console.error('Failed to sell item to business inventory:', error)
      showError('Failed to sell item to business inventory. Please try again.')
    }
  }, [currentAccountId, itemRecords, isOnline, refreshRealtimeAfterWrite, refreshTransactionItems, showError, showOfflineSaved, showSuccess])

  const handleMoveItemToProject = useCallback(async () => {
    if (!currentAccountId || !itemTargetRecord) return
    if (!itemProjectSelectedId || itemProjectSelectedId === itemTargetRecord.projectId) {
      setShowItemProjectDialog(false)
      return
    }
    if (itemTargetRecord.transactionId) {
      showError('This item is tied to a transaction. Move the transaction to another project instead.')
      setShowItemProjectDialog(false)
      return
    }
    setIsUpdatingItemProject(true)
    try {
      await unifiedItemsService.updateItem(currentAccountId, itemTargetRecord.itemId, {
        projectId: itemProjectSelectedId,
        disposition: 'purchased'
      })
      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      showSuccess('Project association updated.')
    } catch (error) {
      console.error('Failed to move item to project:', error)
      showError('Failed to move item to project. Please try again.')
    } finally {
      setIsUpdatingItemProject(false)
      setShowItemProjectDialog(false)
    }
  }, [
    currentAccountId,
    itemProjectSelectedId,
    itemTargetRecord,
    refreshRealtimeAfterWrite,
    refreshTransactionItems,
    showError,
    showSuccess
  ])

  const handleSellItemToProject = useCallback(async () => {
    if (!currentAccountId || !itemTargetRecord || !itemTargetRecord.projectId) return
    if (!itemProjectSelectedId || itemProjectSelectedId === itemTargetRecord.projectId) {
      setShowItemProjectDialog(false)
      return
    }
    setIsUpdatingItemProject(true)
    try {
      const wasOffline = !isOnline
      await integrationService.sellItemToProject(
        currentAccountId,
        itemTargetRecord.itemId,
        itemTargetRecord.projectId,
        itemProjectSelectedId
      )
      if (wasOffline) {
        showOfflineSaved()
        return
      }
      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      showSuccess('Sold to project.')
    } catch (error) {
      if (error instanceof SellItemToProjectError) {
        switch (error.code) {
          case 'ITEM_NOT_FOUND':
            showError('Item not found. Refresh and try again.')
            break
          case 'SOURCE_PROJECT_MISMATCH':
          case 'CONFLICT':
            showError('This item changed since you opened it. Refresh and try again.')
            break
          case 'NON_CANONICAL_TRANSACTION':
            showError('This item is tied to a transaction. Move the transaction instead.')
            break
          case 'TARGET_SAME_AS_SOURCE':
            showError('Select a different project to sell to.')
            break
          case 'PARTIAL_COMPLETION':
            showError('Item was moved to business inventory. Allocate it to the target project from there.')
            await refreshTransactionItems()
            await refreshRealtimeAfterWrite()
            break
          default:
            showError('Failed to sell item to project. Please try again.')
        }
      } else {
        console.error('Failed to sell item to project:', error)
        showError('Failed to sell item to project. Please try again.')
      }
    } finally {
      setIsUpdatingItemProject(false)
      setShowItemProjectDialog(false)
    }
  }, [
    currentAccountId,
    itemProjectSelectedId,
    itemTargetRecord,
    isOnline,
    refreshRealtimeAfterWrite,
    refreshTransactionItems,
    showError,
    showOfflineSaved,
    showSuccess
  ])

  const handleMoveProject = useCallback(async () => {
    if (!transaction || !currentAccountId) return
    if (!selectedProjectId || selectedProjectId === transaction.projectId) {
      setShowProjectDialog(false)
      return
    }
    if (isCanonicalSaleOrPurchaseTransactionId(transaction.transactionId)) {
      showError('This is a Design Business Inventory purchase/sale transaction. Move is not available.')
      setSelectedProjectId(transaction.projectId || '')
      setShowProjectDialog(false)
      return
    }

    setIsUpdatingProject(true)
    try {
      await transactionService.moveTransactionToProject(currentAccountId, transaction.transactionId, selectedProjectId)
      const nextProject = projects.find(project => project.id === selectedProjectId)
      if (nextProject) {
        setProject(nextProject)
      }
      setTransaction(prev => prev ? { ...prev, projectId: selectedProjectId } : prev)
      showSuccess('Transaction moved to project.')
      setShowProjectDialog(false)
      navigate(buildContextUrl(projectTransactionDetail(selectedProjectId, transaction.transactionId)))
    } catch (error) {
      console.error('Failed to move transaction:', error)
      setSelectedProjectId(transaction.projectId || '')
      showError('Failed to move transaction. Please try again.')
    } finally {
      setIsUpdatingProject(false)
    }
  }, [transaction, currentAccountId, selectedProjectId, showError, showSuccess, navigate, buildContextUrl, projects])

  const handleMoveToBusinessInventory = useCallback(async () => {
    if (!transaction || !currentAccountId) return
    if (!transaction.projectId) return
    if (isCanonicalSaleOrPurchaseTransactionId(transaction.transactionId)) {
      showError('This is a Design Business Inventory purchase/sale transaction. Move is not available.')
      return
    }

    setIsUpdatingProject(true)
    try {
      await transactionService.moveTransactionToProject(currentAccountId, transaction.transactionId, null)
      setProject(null)
      setTransaction(prev => prev ? { ...prev, projectId: null } : prev)
      setSelectedProjectId('')
      showSuccess('Transaction moved to business inventory.')
      navigate(buildContextUrl(`/business-inventory/transaction/${transaction.transactionId}`))
    } catch (error) {
      console.error('Failed to move transaction to business inventory:', error)
      showError('Failed to move transaction. Please try again.')
    } finally {
      setIsUpdatingProject(false)
    }
  }, [transaction, currentAccountId, showError, showSuccess, navigate, buildContextUrl])

  useEffect(() => {
    loadTransaction()
  }, [loadTransaction])

  const handleRefreshTransaction = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await loadTransaction()
      await refreshRealtimeAfterWrite(true)
    } catch (error) {
      console.error('Error refreshing transaction:', error)
      showError('Failed to refresh transaction. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, loadTransaction, refreshRealtimeAfterWrite, showError])

  useEffect(() => {
    if (!currentAccountId || !transactionId) return
    const resolvedProjectId = projectId || transaction?.projectId
    const unsubscribe = resolvedProjectId
      ? transactionService.subscribeToTransaction(
          currentAccountId,
          resolvedProjectId,
          transactionId,
          updatedTransaction => {
            setTransaction(prev => {
              if (isSavingNotesRef.current && prev && updatedTransaction) {
                // If we are saving notes, ignore incoming notes updates to avoid flashing old content
                return { ...updatedTransaction, notes: prev.notes }
              }
              return updatedTransaction
            })
          }
        )
      : transactionService.subscribeToBusinessInventoryTransactions(
          currentAccountId,
          transactionsSnapshot => {
            const updatedTransaction =
              transactionsSnapshot.find(tx => tx.transactionId === transactionId) ?? null
            setTransaction(prev => {
              if (isSavingNotesRef.current && prev && updatedTransaction) {
                // If we are saving notes, ignore incoming notes updates to avoid flashing old content
                return { ...updatedTransaction, notes: prev.notes }
              }
              return updatedTransaction
            })
          },
          transaction ? [transaction] : undefined
        )

    return () => {
      try {
        unsubscribe()
      } catch (err) {
        console.debug('TransactionDetail - failed to unsubscribe transaction realtime', err)
      }
    }
  }, [currentAccountId, projectId, transaction?.projectId, transactionId])

  useEffect(() => {
    if (!currentAccountId || !transactionId) return
    const resolvedProjectId = projectId || transaction?.projectId
    const unsubscribe = resolvedProjectId
      ? unifiedItemsService.subscribeToProjectItems(currentAccountId, resolvedProjectId, () => {
          refreshTransactionItems()
        })
      : unifiedItemsService.subscribeToBusinessInventoryItems(currentAccountId, () => {
          refreshTransactionItems()
        })

    return () => {
      try {
        unsubscribe()
      } catch (err) {
        console.debug('TransactionDetail - failed to unsubscribe items realtime', err)
      }
    }
  }, [currentAccountId, projectId, transaction?.projectId, transactionId, refreshTransactionItems])

  // Set up real-time subscription for transaction updates
  useEffect(() => {
    if (!transactionId || !transaction) return
    // Use the actual project ID (whether from URL params or discovered from transaction lookup)
    const actualProjectId = projectId || transaction.projectId

    if (!actualProjectId) return

    // Temporarily disable real-time subscription to debug
    // const unsubscribe = transactionService.subscribeToTransaction(
    //   currentAccountId,
    //   actualProjectId,
    //   transactionId,
    //   (updatedTransaction) => {
    //     if (updatedTransaction) {
    //       console.log('TransactionDetail - real-time updatedTransaction:', updatedTransaction)
    //       console.log('TransactionDetail - real-time updatedTransaction.transaction_images:', updatedTransaction.transaction_images)
    //       console.log('TransactionDetail - real-time updatedTransaction.transaction_images length:', updatedTransaction.transaction_images?.length)

    //       const convertedTransaction: Transaction = {
    //         ...updatedTransaction,
    //         transaction_images: Array.isArray(updatedTransaction.transaction_images) ? updatedTransaction.transaction_images : []
    //       } as Transaction

    //       console.log('TransactionDetail - real-time convertedTransaction:', convertedTransaction)
    //       setTransaction(convertedTransaction)
    //     } else {
    //       setTransaction(null)
    //     }
    //   }
    // )

    // return () => {
    //   unsubscribe()
    // }
  }, [projectId, transactionId, transaction])

  // Subscribe to new lineage edges that moved items FROM this transaction and refresh items (strict realtime)
  useEffect(() => {
    if (!currentAccountId || !transactionId) return
    const unsubscribe = lineageService.subscribeToEdgesFromTransaction(currentAccountId, transactionId, () => {
      try {
        // If an edge's from_transaction_id matches this transaction, it indicates the item moved out
        refreshTransactionItems()
      } catch (err) {
        console.debug('TransactionDetail - failed to refresh on lineage event', err)
      }
    })

    return () => {
      try { unsubscribe() } catch (err) { /* noop */ }
    }
  }, [currentAccountId, transactionId])



  const handleEdit = useCallback(() => {
    if (!editTransactionUrl) return
    navigate(buildContextUrl(editTransactionUrl))
  }, [editTransactionUrl, navigate, buildContextUrl])

  const handleNotesEditStart = useCallback(() => {
    setNotesDraft(transaction?.notes ?? '')
    setIsEditingNotes(true)
  }, [transaction?.notes])

  const handleNotesCancel = useCallback(() => {
    setNotesDraft(transaction?.notes ?? '')
    setIsEditingNotes(false)
  }, [transaction?.notes])

  const handleNotesSave = useCallback(async () => {
    if (!transactionId || !transaction || !currentAccountId || isSavingNotes) return

    const normalizedNotes = notesDraft.trim()
    const nextNotes = normalizedNotes.length > 0 ? notesDraft : null
    const previousNotes = transaction.notes ?? ''
    const nextNotesForCompare = nextNotes ?? ''
    if (previousNotes === nextNotesForCompare) {
      setIsEditingNotes(false)
      return
    }

    setIsSavingNotes(true)
    setTransaction(prev => prev ? { ...prev, notes: nextNotes ?? undefined } : prev)
    setIsEditingNotes(false)
    try {
      const offlineTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
      if (offlineTransaction) {
        await offlineStore.saveTransactions([{
          ...offlineTransaction,
          notes: nextNotes ?? undefined
        }])
      }

      const updateProjectId = transaction.projectId || projectId
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        notes: nextNotes
      })

      if (!isOnline) {
        showOfflineSaved()
      } else {
        showSuccess('Notes updated.')
      }
    } catch (error) {
      console.error('Failed to update notes:', error)
      setTransaction(prev => prev ? { ...prev, notes: previousNotes || undefined } : prev)
      setNotesDraft(previousNotes)
      showError('Failed to update notes. Please try again.')
    } finally {
      setIsSavingNotes(false)
    }
  }, [
    transactionId,
    transaction,
    currentAccountId,
    isSavingNotes,
    notesDraft,
    projectId,
    isOnline,
    showOfflineSaved,
    showSuccess,
    showError
  ])

  const handleDelete = useCallback(async () => {
    if (!transactionId || !transaction || !currentAccountId) {
      console.warn('Cannot delete transaction: missing context', {
        transactionId,
        hasTransaction: !!transaction,
        hasAccountId: !!currentAccountId
      })
      if (!currentAccountId) {
        showError('Unable to delete: Account context is missing. Please refresh the page.')
      } else if (!transaction) {
        showError('Unable to delete: Transaction data not loaded.')
      }
      return
    }

    const resolvedProjectId = projectId || transaction.projectId

    if (window.confirm('Are you sure you want to delete this transaction? This action cannot be undone.')) {
      try {
        await transactionService.deleteTransaction(currentAccountId, resolvedProjectId ?? '', transactionId)
        await refreshRealtimeAfterWrite(true)
        navigate(resolvedProjectId ? projectTransactions(resolvedProjectId) : '/business-inventory')
      } catch (error) {
        console.error('Error deleting transaction:', error)
        showError('Failed to delete transaction. Please try again.')
      }
    }
  }, [projectId, transactionId, transaction, currentAccountId, showError, navigate, refreshRealtimeAfterWrite])

  const handleImageClick = (index: number) => {
    setGalleryInitialIndex(index)
    setShowGallery(true)
  }

  const handlePinToggle = (image?: ItemImage) => {
    if (image) {
      setPinnedImage(image)
      setIsImagePinned(true)
      setShowGallery(false)
      // Reset zoom/pan when pinning a new image
      setPinZoom(1)
      setPinPanX(0)
      setPinPanY(0)
      return
    }
    setIsImagePinned(false)
    setPinnedImage(null)
    // Reset zoom/pan when unpinning
    setPinZoom(1)
    setPinPanX(0)
    setPinPanY(0)
  }

  const handlePinTransactionImage = (transactionImage: TransactionImage) => {
    // Convert TransactionImage to ItemImage format
    const itemImage: ItemImage = {
      url: transactionImage.url,
      alt: transactionImage.fileName || '',
      fileName: transactionImage.fileName || '',
      uploadedAt: transactionImage.uploadedAt || new Date(),
      size: transactionImage.size || 0,
      mimeType: transactionImage.mimeType || 'image/jpeg',
      isPrimary: false
    }
    handlePinToggle(itemImage)
  }

  // Pin panel gesture helpers
  const pinClamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const pinGetContainerRect = (): DOMRect | null => pinImageContainerRef.current?.getBoundingClientRect() ?? null

  const pinGetBaseImageSize = (): { width: number; height: number } | null => {
    const rect = pinImageRef.current?.getBoundingClientRect()
    if (!rect) return null
    const baseWidth = rect.width / Math.max(pinZoomRef.current, 0.0001)
    const baseHeight = rect.height / Math.max(pinZoomRef.current, 0.0001)
    if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) return null
    return { width: baseWidth, height: baseHeight }
  }

  const pinClampPanToBounds = (nextPanX: number, nextPanY: number, nextZoom: number): { x: number; y: number } => {
    const container = pinGetContainerRect()
    const base = pinGetBaseImageSize()
    if (!container || !base) return { x: nextPanX, y: nextPanY }

    const scaledW = base.width * nextZoom
    const scaledH = base.height * nextZoom

    const maxX = Math.max(0, (scaledW - container.width) / 2)
    const maxY = Math.max(0, (scaledH - container.height) / 2)

    return {
      x: pinClamp(nextPanX, -maxX, maxX),
      y: pinClamp(nextPanY, -maxY, maxY)
    }
  }

  const pinResetView = () => {
    setPinZoom(1)
    setPinPanX(0)
    setPinPanY(0)
  }

  const pinSetZoomAroundPoint = (nextZoom: number, clientX: number, clientY: number) => {
    const container = pinGetContainerRect()
    if (!container) {
      setPinZoom(nextZoom)
      if (nextZoom === 1) {
        setPinPanX(0)
        setPinPanY(0)
      }
      return
    }

    const containerCenterX = container.left + container.width / 2
    const containerCenterY = container.top + container.height / 2

    const dx = (clientX - containerCenterX - pinPanXRef.current) / Math.max(pinZoomRef.current, 0.0001)
    const dy = (clientY - containerCenterY - pinPanYRef.current) / Math.max(pinZoomRef.current, 0.0001)

    const unclampedPanX = clientX - containerCenterX - dx * nextZoom
    const unclampedPanY = clientY - containerCenterY - dy * nextZoom
    const clamped = pinClampPanToBounds(unclampedPanX, unclampedPanY, nextZoom)

    setPinZoom(nextZoom)
    setPinPanX(clamped.x)
    setPinPanY(clamped.y)
  }

  // Update refs when state changes
  useEffect(() => {
    pinZoomRef.current = pinZoom
  }, [pinZoom])

  useEffect(() => {
    pinPanXRef.current = pinPanX
    pinPanYRef.current = pinPanY
  }, [pinPanX, pinPanY])

  // Reset zoom/pan when pinned image changes
  useEffect(() => {
    if (pinnedImage) {
      pinResetView()
    }
  }, [pinnedImage])

  // Calculate modal position relative to transaction items container
  useEffect(() => {
    if (!showExistingItemsModal) {
      setModalPosition(null)
      return
    }

    const calculatePosition = () => {
      const container = transactionItemsContainerRef.current
      if (!container) {
        // Fallback to full screen if container not found
        setModalPosition(null)
        return
      }

      const isDesktop = window.innerWidth >= 1024 // lg breakpoint
      
      // On mobile, use full screen overlay
      if (!isDesktop) {
        setModalPosition(null)
        return
      }

      const rect = container.getBoundingClientRect()

      // Get container width and align horizontally with it
      const width = rect.width
      const left = rect.left
      const containerLeft = rect.left

      const top = 16

      setModalPosition({ top, left, width, containerLeft })
    }

    // Calculate immediately
    calculatePosition()

    // Recalculate on resize
    window.addEventListener('resize', calculatePosition)

    return () => {
      window.removeEventListener('resize', calculatePosition)
    }
  }, [showExistingItemsModal, isImagePinned])

  const pinZoomStep = 0.5
  const pinMinZoom = 1
  const pinMaxZoom = 5

  const pinBeginPanGesture = (pointerId: number, clientX: number, clientY: number) => {
    pinGestureRef.current = {
      kind: 'pan',
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      startPanX: pinPanXRef.current,
      startPanY: pinPanYRef.current
    }
  }

  const pinTryBeginPinchGesture = () => {
    const entries = Array.from(pinPointersRef.current.entries())
    if (entries.length < 2) return
    const [a, b] = entries.slice(0, 2)
    const pointerIdA = a[0]
    const pointerIdB = b[0]
    const ax = a[1].x
    const ay = a[1].y
    const bx = b[1].x
    const by = b[1].y

    const container = pinGetContainerRect()
    if (!container) return

    const startDistance = Math.hypot(bx - ax, by - ay)
    const startPinchCenterX = (ax + bx) / 2
    const startPinchCenterY = (ay + by) / 2

    pinGestureRef.current = {
      kind: 'pinch',
      pointerIdA,
      pointerIdB,
      startDistance: Math.max(startDistance, 0.0001),
      startZoom: pinZoom,
      startPanX: pinPanX,
      startPanY: pinPanY,
      containerCenterX: container.left + container.width / 2,
      containerCenterY: container.top + container.height / 2,
      startPinchCenterX,
      startPinchCenterY
    }
  }

  const pinHandlePointerDown = (e: React.PointerEvent) => {
    pinPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinPointerStartRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    if (pinPointersRef.current.size === 1 && pinZoom > 1.01) {
      pinBeginPanGesture(e.pointerId, e.clientX, e.clientY)
    }

    if (pinPointersRef.current.size >= 2) {
      pinTryBeginPinchGesture()
    }
  }

  const pinHandlePointerMove = (e: React.PointerEvent) => {
    if (!pinPointersRef.current.has(e.pointerId)) return
    pinPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const start = pinPointerStartRef.current.get(e.pointerId)
    if (start) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > 6) pinSuppressClickRef.current = true
    }

    const g = pinGestureRef.current
    if (!g) return

    if (g.kind === 'pan') {
      if (e.pointerId !== g.pointerId) return
      if (pinZoom <= 1.01) return
      e.preventDefault()

      const dx = e.clientX - g.startClientX
      const dy = e.clientY - g.startClientY
      const unclampedX = g.startPanX + dx
      const unclampedY = g.startPanY + dy
      const clamped = pinClampPanToBounds(unclampedX, unclampedY, pinZoom)
      setPinPanX(clamped.x)
      setPinPanY(clamped.y)
      return
    }

    // Pinch
    const a = pinPointersRef.current.get(g.pointerIdA)
    const b = pinPointersRef.current.get(g.pointerIdB)
    if (!a || !b) return

    e.preventDefault()

    const currentDistance = Math.hypot(b.x - a.x, b.y - a.y)
    const pinchScale = currentDistance / Math.max(g.startDistance, 0.0001)
    const nextZoom = pinClamp(g.startZoom * pinchScale, pinMinZoom, pinMaxZoom)

    const currentCenterX = (a.x + b.x) / 2
    const currentCenterY = (a.y + b.y) / 2

    const startDx = (g.startPinchCenterX - g.containerCenterX - g.startPanX) / Math.max(g.startZoom, 0.0001)
    const startDy = (g.startPinchCenterY - g.containerCenterY - g.startPanY) / Math.max(g.startZoom, 0.0001)

    const unclampedPanX = currentCenterX - g.containerCenterX - startDx * nextZoom
    const unclampedPanY = currentCenterY - g.containerCenterY - startDy * nextZoom
    const clamped = pinClampPanToBounds(unclampedPanX, unclampedPanY, nextZoom)

    setPinZoom(nextZoom)
    setPinPanX(clamped.x)
    setPinPanY(clamped.y)
  }

  const pinHandlePointerUpOrCancel = (e: React.PointerEvent) => {
    const pointerStart = pinPointerStartRef.current.get(e.pointerId)
    pinPointersRef.current.delete(e.pointerId)
    pinPointerStartRef.current.delete(e.pointerId)
    if (pinPointersRef.current.size < 2 && pinGestureRef.current?.kind === 'pinch') {
      pinGestureRef.current = null
    }
    if (pinPointersRef.current.size === 0 && pinGestureRef.current?.kind === 'pan') {
      pinGestureRef.current = null
    }

    if (pinPointersRef.current.size === 1 && pinZoom > 1.01) {
      const [only] = Array.from(pinPointersRef.current.entries())
      pinBeginPanGesture(only[0], only[1].x, only[1].y)
    }

    // Double-tap (touch) toggles zoom at tap point
    if (e.pointerType === 'touch' && pinPointersRef.current.size === 0) {
      const now = Date.now()
      const prev = pinLastTapRef.current
      const start = { x: e.clientX, y: e.clientY }

      if (prev && now - prev.t < 320 && Math.hypot(start.x - prev.x, start.y - prev.y) < 26) {
        pinSuppressClickRef.current = true
        pinLastTapRef.current = null
        if (pinZoomRef.current > 1.01) {
          pinResetView()
        } else {
          pinSetZoomAroundPoint(2, e.clientX, e.clientY)
        }
        return
      }

      if (!pointerStart || Math.hypot(start.x - pointerStart.x, start.y - pointerStart.y) < 10) {
        pinLastTapRef.current = { t: now, x: start.x, y: start.y }
      }
    }
  }

  const pinHandleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (pinZoom > 1.01) {
      pinResetView()
      return
    }
    pinSetZoomAroundPoint(2, e.clientX, e.clientY)
  }

  // Wheel zoom handler for pinned panel
  useEffect(() => {
    const el = pinImageContainerRef.current
    if (!el || !isImagePinned) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY > 0 ? -0.2 : 0.2
      const nextZoom = pinClamp(pinZoomRef.current + delta, pinMinZoom, pinMaxZoom)
      if (Math.abs(nextZoom - pinZoomRef.current) < 0.0001) return
      pinSetZoomAroundPoint(nextZoom, event.clientX, event.clientY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as EventListener)
  }, [isImagePinned])

  const handleGalleryClose = () => {
    setShowGallery(false)
  }

  const handleReceiptsUpload = async (files: File[]) => {
    // Allow upload if we have transactionId and accountId, even if project/projectId are missing (Business Inventory)
    if (!transactionId || files.length === 0 || !currentAccountId) return

    setReceiptUploadsInFlight(count => count + 1)

    try {
      const newReceiptImages: TransactionImage[] = []
      // Use project name if available, otherwise fallback to Business Inventory
      const projectName = project?.name || COMPANY_INVENTORY

      // Upload sequentially to track offline media IDs properly
      for (const file of files) {
        try {
          const uploadResult = await OfflineAwareImageService.uploadReceiptAttachment(
            file,
            projectName,
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
          }

          newReceiptImages.push({
            url: uploadResult.url,
            fileName: uploadResult.fileName,
            uploadedAt: new Date(),
            size: uploadResult.size,
            mimeType: uploadResult.mimeType,
            ...(metadata && { metadata })
          } as TransactionImage & { metadata?: { offlineMediaId: string; isOfflinePlaceholder: boolean } })
        } catch (uploadError) {
          console.error(`Failed to upload receipt ${file.name}:`, uploadError)
          // Continue with other files
        }
      }

      if (newReceiptImages.length > 0) {
        // Update transaction with new receipts
        const currentReceiptImages = transaction?.receiptImages || []
        const updatedReceiptImages = [...currentReceiptImages, ...newReceiptImages]

        // Check if we're online to determine whether to queue the update or apply it immediately
        const hasOfflinePlaceholders = newReceiptImages.some(img => (img as any).metadata?.isOfflinePlaceholder)

        // Always update local transaction record for immediate UI feedback
        const offlineTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
        if (offlineTransaction) {
          const updatedOfflineTransaction = {
            ...offlineTransaction,
            receiptImages: updatedReceiptImages,
            transactionImages: updatedReceiptImages // Also update legacy field for compatibility
          }
          await offlineStore.saveTransactions([updatedOfflineTransaction])

          // Update UI state immediately
          setTransaction({
            ...transaction,
            receiptImages: updatedReceiptImages,
            transactionImages: updatedReceiptImages
          } as Transaction)
        }

        const shouldQueueUpdate = hasOfflinePlaceholders || !isOnline

        if (!shouldQueueUpdate) {
          // Online with no placeholders - use normal transaction service
          const updateProjectId = transaction?.projectId || projectId
          await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
            receiptImages: updatedReceiptImages,
            transactionImages: updatedReceiptImages // Also update legacy field for compatibility
          })

          // Remove tracked IDs after successful save
          newReceiptImages.forEach(img => {
            if ((img as any).metadata?.offlineMediaId) {
              receiptTracker.removeMediaId((img as any).metadata.offlineMediaId)
            }
          })

          // Refresh transaction data (use actual project_id from transaction)
          const refreshProjectId = transaction?.projectId || projectId
          const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
          setTransaction(updatedTransaction)
          await refreshRealtimeAfterWrite()
        } else {
          // Offline or has placeholders - queue the update operation for sync
          await offlineTransactionService.updateTransaction(currentAccountId, transactionId, {
            receiptImages: updatedReceiptImages,
            transactionImages: updatedReceiptImages // Also update legacy field for compatibility
          })

          // Keep tracked IDs for cleanup after sync
          // They'll be removed when the queued operation completes successfully
        }

        // Show offline feedback if any receipts were queued
        if (hasOfflinePlaceholders) {
          showOfflineSaved()
        } else {
          showSuccess('Receipts uploaded successfully')
        }
      }
    } catch (error) {
      console.error('Error uploading receipts:', error)
      showError('Failed to upload receipts. Please try again.')
    } finally {
      setReceiptUploadsInFlight(count => Math.max(0, count - 1))
    }
  }

  const handleOtherImagesUpload = async (files: File[]) => {
    // Allow upload if we have transactionId and accountId, even if project/projectId are missing (Business Inventory)
    if (!transactionId || files.length === 0 || !currentAccountId) return

    setOtherUploadsInFlight(count => count + 1)

    try {
      const newOtherImages: TransactionImage[] = []
      // Use project name if available, otherwise fallback to Business Inventory
      const projectName = project?.name || COMPANY_INVENTORY

      // Upload sequentially to track offline media IDs properly
      for (const file of files) {
        try {
          const uploadResult = await OfflineAwareImageService.uploadOtherAttachment(
            file,
            projectName,
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
          }

          newOtherImages.push({
            url: uploadResult.url,
            fileName: uploadResult.fileName,
            uploadedAt: new Date(),
            size: uploadResult.size,
            mimeType: uploadResult.mimeType,
            ...(metadata && { metadata })
          } as TransactionImage & { metadata?: { offlineMediaId: string; isOfflinePlaceholder: boolean } })
        } catch (uploadError) {
          console.error(`Failed to upload other image ${file.name}:`, uploadError)
          // Continue with other files
        }
      }

      if (newOtherImages.length > 0) {
        // Update transaction with new other images
        const currentOtherImages = transaction?.otherImages || []
        const updatedOtherImages = [...currentOtherImages, ...newOtherImages]

        // Check if we're online to determine whether to queue the update or apply it immediately
        const hasOfflinePlaceholders = newOtherImages.some(img => (img as any).metadata?.isOfflinePlaceholder)

        // Always update local transaction record for immediate UI feedback
        const offlineTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
        if (offlineTransaction) {
          const updatedOfflineTransaction = {
            ...offlineTransaction,
            otherImages: updatedOtherImages
          }
          await offlineStore.saveTransactions([updatedOfflineTransaction])

          // Update UI state immediately
          setTransaction({
            ...transaction,
            otherImages: updatedOtherImages
          } as Transaction)
        }

        const shouldQueueUpdate = hasOfflinePlaceholders || !isOnline

        if (!shouldQueueUpdate) {
          // Online with no placeholders - use normal transaction service
          const updateProjectId = transaction?.projectId || projectId
          await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
            otherImages: updatedOtherImages
          })

          // Remove tracked IDs after successful save
          newOtherImages.forEach(img => {
            if ((img as any).metadata?.offlineMediaId) {
              otherImageTracker.removeMediaId((img as any).metadata.offlineMediaId)
            }
          })

          // Refresh transaction data (use actual project_id from transaction)
          const refreshProjectId = transaction?.projectId || projectId
          const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
          setTransaction(updatedTransaction)
          await refreshRealtimeAfterWrite()
        } else {
          // Offline or has placeholders - queue the update operation for sync
          await offlineTransactionService.updateTransaction(currentAccountId, transactionId, {
            otherImages: updatedOtherImages
          })

          // Keep tracked IDs for cleanup after sync
          // They'll be removed when the queued operation completes successfully
        }

        // Show offline feedback if any images were queued
        if (hasOfflinePlaceholders) {
          showOfflineSaved()
        } else {
          showSuccess('Other images uploaded successfully')
        }
      }
    } catch (error) {
      console.error('Error uploading other images:', error)
      showError('Failed to upload other images. Please try again.')
    } finally {
      setOtherUploadsInFlight(count => Math.max(0, count - 1))
    }
  }

  const handleDeleteReceiptImage = async (imageUrl: string) => {
    // Allow delete if we have transactionId and accountId, even if project/projectId are missing (Business Inventory)
    if (!transactionId || !transaction || !currentAccountId) return

    try {
      // Handle offline media deletion if this is an offline placeholder
      if (imageUrl.startsWith('offline://')) {
        const mediaId = imageUrl.replace('offline://', '')
        receiptTracker.removeMediaId(mediaId)
        try {
          await offlineMediaService.deleteMediaFile(mediaId)
        } catch (error) {
          console.warn('Failed to delete offline media file:', error)
        }
      }

      // Filter out the image to be deleted
      const currentReceiptImages = transaction.receiptImages || []
      const updatedReceiptImages = currentReceiptImages.filter(img => img.url !== imageUrl)

      const updateProjectId = transaction?.projectId || projectId
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        receiptImages: updatedReceiptImages,
        transactionImages: updatedReceiptImages // Also update legacy field for compatibility
      })

      // Refresh transaction data (use actual project_id from transaction)
      const refreshProjectId = transaction?.projectId || projectId
      const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
      setTransaction(updatedTransaction)
      await refreshRealtimeAfterWrite()

      showSuccess('Receipt deleted successfully')
    } catch (error) {
      console.error('Error deleting receipt:', error)
      showError('Failed to delete receipt. Please try again.')
    }
  }

  const handleDeleteOtherImage = async (imageUrl: string) => {
    // Allow delete if we have transactionId and accountId, even if project/projectId are missing (Business Inventory)
    if (!transactionId || !transaction || !currentAccountId) return

    try {
      // Handle offline media deletion if this is an offline placeholder
      if (imageUrl.startsWith('offline://')) {
        const mediaId = imageUrl.replace('offline://', '')
        otherImageTracker.removeMediaId(mediaId)
        try {
          await offlineMediaService.deleteMediaFile(mediaId)
        } catch (error) {
          console.warn('Failed to delete offline media file:', error)
        }
      }

      // Filter out the image to be deleted
      const currentOtherImages = transaction.otherImages || []
      const updatedOtherImages = currentOtherImages.filter(img => img.url !== imageUrl)

      const updateProjectId = transaction?.projectId || projectId
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        otherImages: updatedOtherImages
      })

      // Refresh transaction data (use actual project_id from transaction)
      const refreshProjectId = transaction?.projectId || projectId
      const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
      setTransaction(updatedTransaction)
      await refreshRealtimeAfterWrite()

      showSuccess('Other image deleted successfully')
    } catch (error) {
      console.error('Error deleting other image:', error)
      showError('Failed to delete other image. Please try again.')
    }
  }

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    setImageFilesMap(prev => {
      const newMap = new Map(prev)
      newMap.set(itemId, imageFiles)
      return newMap
    })
  }

  const uploadItemImages = async (targetItemId: string, sourceItem: TransactionItemFormData) => {
    if (!currentAccountId) return

    let imageFiles = imageFilesMap.get(sourceItem.id)
    if (!imageFiles && sourceItem.imageFiles) {
      imageFiles = sourceItem.imageFiles
    }

    if (!imageFiles || imageFiles.length === 0) {
      return
    }

    try {
      const uploadedImages: ItemImage[] = []
      const projectName = project ? project.name : 'Unknown Project'

      // Upload sequentially to track offline media IDs properly
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i]
        try {
          const uploadResult = await OfflineAwareImageService.uploadItemImage(
            file,
            projectName,
            targetItemId,
            currentAccountId
          )

          const metadata = uploadResult.url.startsWith('offline://')
            ? {
                offlineMediaId: uploadResult.url.replace('offline://', ''),
                isOfflinePlaceholder: true
              }
            : undefined

          if (metadata?.offlineMediaId) {
            itemImageTracker.trackMediaId(metadata.offlineMediaId)
          }

          uploadedImages.push({
            url: uploadResult.url,
            alt: file.name,
            isPrimary: i === 0,
            uploadedAt: new Date(),
            fileName: uploadResult.fileName,
            size: uploadResult.size,
            mimeType: uploadResult.mimeType,
            metadata
          })
        } catch (uploadError) {
          console.error(`Failed to upload ${file.name}:`, uploadError)
          // Don't add failed uploads
        }
      }

      if (uploadedImages.length > 0) {
        await unifiedItemsService.updateItem(currentAccountId, targetItemId, { images: uploadedImages })
        
        // Remove tracked IDs after successful save
        uploadedImages.forEach(img => {
          if (img.metadata?.offlineMediaId) {
            itemImageTracker.removeMediaId(img.metadata.offlineMediaId)
          }
        })
        
        await refreshRealtimeAfterWrite()
        
        // Show offline feedback if any images were queued
        if (uploadedImages.some(img => img.metadata?.isOfflinePlaceholder)) {
          showOfflineSaved()
        }
      }
    } catch (error) {
      console.error('Error in image upload process:', error)
    } finally {
      setImageFilesMap(prev => {
        if (!prev.has(sourceItem.id)) {
          return prev
        }
        const next = new Map(prev)
        next.delete(sourceItem.id)
        return next
      })
    }
  }

  const buildCreateItemPayload = (item: TransactionItemFormData) => {
    if (!transactionId || !transaction) {
      throw new Error('Transaction context is missing for item creation')
    }
    const { disposition, ...rest } = item
    const resolvedProjectId =
      transaction.projectId && transaction.projectId !== 'null'
        ? transaction.projectId
        : projectId ?? null
    return {
      ...rest,
      projectId: resolvedProjectId,
      transactionId,
      dateCreated: transaction.transactionDate || new Date().toISOString(),
      source: transaction.source,
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
      disposition: normalizeDisposition(disposition)
    }
  }

  const handleSetSpaceId = async (spaceId: string | null, selectedIds: string[], selectedItems: any[]) => {
    if (!currentAccountId) return

    try {
      const updatePromises = selectedIds.map(itemId =>
        unifiedItemsService.updateItem(currentAccountId, itemId, {
          spaceId: spaceId
        })
      )

      await Promise.all(updatePromises)
      await refreshRealtimeAfterWrite()
      showSuccess(`Updated space for ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to set space:', error)
      showError('Failed to set space. Please try again.')
    }
  }

  const handleCreateItem = async (item: TransactionItemFormData) => {
    if (!transactionId || !transaction || !currentAccountId) return

    try {
      const itemData = buildCreateItemPayload(item)

      const createResult = await unifiedItemsService.createItem(currentAccountId, itemData)
      const itemId = createResult.itemId

      // Hydrate optimistic item into React Query cache immediately
      await hydrateOptimisticItem(currentAccountId, itemId, itemData)

      await uploadItemImages(itemId, item)

      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      
      if (createResult.mode === 'offline') {
        showOfflineSaved(createResult.operationId)
      } else {
        showSuccess('Item added successfully')
      }
    } catch (error) {
      console.error('Error adding item:', error)
      showError('Failed to add item. Please try again.')
    }
  }

  const handleDuplicateTransactionItem = async (item: TransactionItemFormData, quantity = 1) => {
    if (!transactionId || !transaction || !currentAccountId) return

    try {
      const duplicateCount = Math.max(0, Math.floor(quantity))
      let lastResult: { mode: string; operationId: string | null } | null = null

      if (duplicateCount === 0) {
        showError('Enter a quantity greater than 0.')
        return
      }

      for (let i = 0; i < duplicateCount; i += 1) {
        const duplicatePayload = buildCreateItemPayload(item)
        const createResult = await unifiedItemsService.createItem(currentAccountId, duplicatePayload)
        await hydrateOptimisticItem(currentAccountId, createResult.itemId, duplicatePayload)
        lastResult = { mode: createResult.mode, operationId: createResult.operationId ?? null }
      }

      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()

      if (lastResult?.mode === 'offline') {
        showOfflineSaved(lastResult.operationId)
      } else if (duplicateCount === 1) {
        showSuccess('Item duplicated successfully')
      } else {
        showSuccess(`Duplicated ${duplicateCount} items successfully`)
      }
    } catch (error) {
      console.error('Error duplicating item:', error)
      showError('Failed to duplicate item. Please try again.')
    }
  }

  const handleUpdateItem = async (item: TransactionItemFormData) => {
    if (!currentAccountId) return

    try {
      const updateData = {
        description: item.description,
        sku: item.sku || '',
        purchasePrice: item.purchasePrice || '',
        projectPrice: item.projectPrice || '',
        marketValue: item.marketValue || '',
        notes: item.notes || '',
        space: item.space || '',
        taxAmountPurchasePrice: item.taxAmountPurchasePrice,
        taxAmountProjectPrice: item.taxAmountProjectPrice
      }

      const wasOffline = !isOnline
      await unifiedItemsService.updateItem(currentAccountId, item.id, updateData)
      await uploadItemImages(item.id, item)

      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      
      if (wasOffline) {
        showOfflineSaved(null)
      } else {
        showSuccess('Item updated successfully')
      }
    } catch (error) {
      console.error('Error updating item:', error)
      showError('Failed to update item. Please try again.')
    }
  }

  // Convert transaction attachments to ItemImage format for the gallery (images only).
  // Receipt attachments may include PDFs; those should not be rendered in an <img> gallery.
  const allTransactionAttachments = [
    ...(transaction?.receiptImages || []),
    ...(transaction?.otherImages || [])
  ]

  const isRenderableImageAttachment = (img: { mimeType?: string; fileName?: string; url: string }) => {
    const mime = (img.mimeType || '').toLowerCase()
    if (mime.startsWith('image/')) return true
    const name = (img.fileName || img.url || '').toLowerCase()
    return /\.(png|jpe?g|gif|webp|heic|heif)$/.test(name)
  }

  const galleryTransactionImages = allTransactionAttachments.filter(isRenderableImageAttachment)

  const itemImages = galleryTransactionImages.map((img, index) => ({
    url: img.url,
    alt: img.fileName,
    fileName: img.fileName,
    uploadedAt: img.uploadedAt,
    size: img.size,
    mimeType: img.mimeType,
    isPrimary: index === 0 // First image is primary
  })) || []

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

  if (!transaction) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto h-12 w-12 text-gray-400">📄</div>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Transaction not found</h3>
        <p className="mt-1 text-sm text-gray-500">The transaction you're looking for doesn't exist.</p>
        <div className="mt-6">
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </ContextBackLink>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={isImagePinned ? 'lg:flex lg:gap-6' : ''}>
        {isImagePinned && pinnedImage && (
          <div className="fixed top-0 left-0 right-0 h-[33svh] bg-white border-b border-gray-200 z-40 lg:sticky lg:top-4 lg:h-screen lg:w-96 lg:rounded-lg lg:border lg:shadow-sm lg:flex-shrink-0">
            <div className="relative w-full h-full p-3">
              <button
                onClick={() => handlePinToggle()}
                className="absolute top-3 right-3 z-10 p-2 bg-white/90 border border-gray-200 rounded-full shadow hover:bg-white"
                aria-label="Unpin image"
                title="Unpin image"
              >
                <X className="h-4 w-4 text-gray-700" />
              </button>
              <div
                ref={pinImageContainerRef}
                className="w-full h-full flex items-center justify-center overflow-hidden"
                style={{ touchAction: 'none' }}
                onPointerDown={pinHandlePointerDown}
                onPointerMove={pinHandlePointerMove}
                onPointerUp={pinHandlePointerUpOrCancel}
                onPointerCancel={pinHandlePointerUpOrCancel}
                onDoubleClick={pinHandleDoubleClick}
              >
                <img
                  ref={pinImageRef}
                  src={pinnedImage.url}
                  alt={pinnedImage.alt || pinnedImage.fileName}
                  className="max-h-full max-w-full object-contain select-none"
                  style={{
                    transform: `translate3d(${pinPanX}px, ${pinPanY}px, 0) scale(${pinZoom})`,
                    transformOrigin: 'center center',
                    cursor: pinZoom > 1.01 ? 'grab' : 'default'
                  }}
                  draggable={false}
                />
              </div>
            </div>
          </div>
        )}
        <div className={isImagePinned ? 'pt-[33svh] lg:pt-0 lg:flex-1' : ''}>
      {/* Header */}
      <div className="space-y-4">
        {/* Back button row */}
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
            <button
              onClick={handleRefreshTransaction}
              className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Refresh transaction"
              title="Refresh"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex items-center space-x-3">
            {hasSyncError && <RetrySyncButton size="sm" variant="secondary" />}
          </div>
        </div>
      </div>

      {/* Conflict Resolution */}
      {currentAccountId && projectId && (
        <ConflictResolutionView
          accountId={currentAccountId}
          projectId={projectId}
          onConflictsResolved={() => {
            // Refresh transaction and items after conflicts are resolved
            refreshRealtimeAfterWrite()
            refreshTransactionItems()
          }}
        />
      )}

      {/* Transaction Details */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-6 border-b border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              {getCanonicalTransactionTitle(transaction)} - {formatCurrency(
                isCanonicalSaleOrPurchaseTransactionId(transactionId) && computedTotal !== null
                  ? computedTotal
                  : transaction.amount
              )}
              {isHealingAmount && (
                <span className="ml-2 text-sm text-gray-500 font-normal">(updating...)</span>
              )}
            </h1>
            {transaction && (
              <div className="shrink-0">
                <TransactionActionsMenu
                  transactionId={transaction.transactionId}
                  projectId={transaction.projectId}
                  onEdit={handleEdit}
                  onMoveToProject={openProjectDialog}
                  onMoveToBusinessInventory={handleMoveToBusinessInventory}
                  onDelete={handleDelete}
                  canMoveToBusinessInventory={canMoveToBusinessInventory}
                  canMoveToProject={canMoveToProject}
                  triggerSize="md"
                />
              </div>
            )}
          </div>
        </div>


        <div className="px-6 py-4 border-t border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Transaction Details
          </h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-500">Transaction Type</dt>
              <dd className="mt-1">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium no-icon ${
                  transaction.transactionType === 'Purchase'
                    ? 'bg-green-100 text-green-800'
                    : transaction.transactionType === 'Sale'
                    ? 'bg-blue-100 text-blue-800'
                    : transaction.transactionType === 'Return'
                    ? 'bg-red-100 text-red-800'
                    : transaction.transactionType === 'To Inventory'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {transaction.transactionType}
                </span>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Budget Category</dt>
              <dd className="mt-1">
                {(() => {
                  const categoryName = getBudgetCategoryDisplayName(transaction, budgetCategories)
                  return (
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                      categoryName === 'Design Fee'
                        ? 'bg-amber-100 text-amber-800'
                        : categoryName === 'Furnishings'
                        ? 'bg-yellow-100 text-yellow-800'
                        : categoryName === 'Property Management'
                        ? 'bg-orange-100 text-orange-800'
                        : categoryName === 'Kitchen'
                        ? 'bg-amber-200 text-amber-900'
                        : categoryName === 'Install'
                        ? 'bg-yellow-200 text-yellow-900'
                        : categoryName === 'Storage & Receiving'
                        ? 'bg-orange-200 text-orange-900'
                        : categoryName === 'Fuel'
                        ? 'bg-amber-300 text-amber-900'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {categoryName || 'Not specified'}
                    </span>
                  )
                })()}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Source</dt>
              <dd className="mt-1 text-sm text-gray-900">{transaction.source}</dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Amount</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatCurrency(
                  isCanonicalSaleOrPurchaseTransactionId(transactionId) && computedTotal !== null
                    ? computedTotal
                    : transaction.amount
                )}
                {isCanonicalSaleOrPurchaseTransactionId(transactionId) && computedTotal !== null && computedTotal !== parseFloat(transaction.amount || '0').toFixed(2) && (
                  <span className="ml-2 text-xs text-gray-500">
                    (was {formatCurrency(transaction.amount)})
                  </span>
                )}
              </dd>
            </div>


            {transaction.subtotal && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Subtotal</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatCurrency(transaction.subtotal)}</dd>
              </div>
            )}

            {transaction.taxRatePct !== undefined && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Tax Rate</dt>
                <dd className="mt-1 text-sm text-gray-900">{transaction.taxRatePct}%</dd>
              </div>
            )}

            <div>
              <dt className="text-sm font-medium text-gray-500">Transaction Date</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {transaction.transactionDate ? formatDate(transaction.transactionDate) : 'No date'}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Payment Method</dt>
              <dd className="mt-1 text-sm text-gray-900">{transaction.paymentMethod}</dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Status</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {(transaction.status || 'pending').charAt(0).toUpperCase() + (transaction.status || 'pending').slice(1)}
              </dd>
            </div>

            {transaction.reimbursementType && (transaction.reimbursementType as string) !== '' && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Reimbursement Type</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {transaction.reimbursementType === CLIENT_OWES_COMPANY ? CLIENT_OWES_COMPANY : COMPANY_OWES_CLIENT}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-sm font-medium text-gray-500">
                Receipt Emailed
              </dt>
              <dd className="mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  transaction.receiptEmailed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {transaction.receiptEmailed ? 'Yes' : 'No'}
                </span>
              </dd>
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-500">Notes</dt>
                {!isEditingNotes ? (
                  <button
                    type="button"
                    onClick={handleNotesEditStart}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    {transaction.notes ? 'Edit' : 'Add'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleNotesCancel}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      disabled={isSavingNotes}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleNotesSave}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                      disabled={isSavingNotes}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              <dd className="mt-1">
                {isEditingNotes ? (
                  <textarea
                    rows={3}
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        handleNotesCancel()
                      }
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault()
                        handleNotesSave()
                      }
                    }}
                    placeholder="Add notes about this transaction..."
                    className="block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 border-gray-300 text-sm text-gray-900"
                  />
                ) : transaction.notes ? (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{transaction.notes}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No notes yet</p>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Receipts */}
        <div className="px-6 py-6 border-t border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <ImageIcon className="h-5 w-5 mr-2" />
              Receipts
            </h3>
                {transaction.receiptImages && transaction.receiptImages.length > 0 && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => {
                    // Trigger file input click programmatically
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*,application/pdf'
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files
                      if (files) {
                        handleReceiptsUpload(Array.from(files))
                      }
                    }
                    input.click()
                  }}
                  className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  <ImageIcon className="h-3 w-3 mr-1" />
                  Add Receipts
                </button>
                <UploadActivityIndicator isUploading={isUploadingReceiptImages} label="Uploading receipts" className="mt-1" />
              </div>
            )}
          </div>
          {transaction.receiptImages && transaction.receiptImages.length > 0 ? (
            <TransactionImagePreview
              images={transaction.receiptImages}
              onRemoveImage={handleDeleteReceiptImage}
              onPinImage={handlePinTransactionImage}
              onImageClick={(imageUrl) => {
                const idx = galleryTransactionImages.findIndex(img => img.url === imageUrl)
                if (idx >= 0) handleImageClick(idx)
              }}
              maxImages={5}
              showControls={true}
              size="md"
              className="mb-4"
            />
          ) : (
            <div className="text-center py-8">
              <ImageIcon className="mx-auto h-8 w-8 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No receipts uploaded</h3>
              <div className="mt-3 flex flex-col items-center gap-1">
                <button
                  onClick={() => {
                    // Trigger file input click programmatically
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*,application/pdf'
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files
                      if (files) {
                        handleReceiptsUpload(Array.from(files))
                      }
                    }
                    input.click()
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  <ImageIcon className="h-3 w-3 mr-1" />
                  Add Receipts
                </button>
                <UploadActivityIndicator isUploading={isUploadingReceiptImages} label="Uploading receipts" className="mt-1" />
              </div>
            </div>
          )}
        </div>

        {/* Other Images - Only show if there are other images */}
            {transaction.otherImages && transaction.otherImages.length > 0 && (
          <div className="px-6 py-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <ImageIcon className="h-5 w-5 mr-2" />
                Other Images
              </h3>
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => {
                    // Trigger file input click programmatically
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*'
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files
                      if (files) {
                        handleOtherImagesUpload(Array.from(files))
                      }
                    }
                    input.click()
                  }}
                  className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  <ImageIcon className="h-3 w-3 mr-1" />
                  Add Images
                </button>
                <UploadActivityIndicator isUploading={isUploadingOtherImages} label="Uploading images" className="mt-1" />
              </div>
            </div>
            <TransactionImagePreview
              images={transaction.otherImages}
              onRemoveImage={handleDeleteOtherImage}
              onPinImage={handlePinTransactionImage}
              onImageClick={(imageUrl) => {
                const idx = galleryTransactionImages.findIndex(img => img.url === imageUrl)
                if (idx >= 0) handleImageClick(idx)
              }}
              maxImages={5}
              showControls={true}
              size="md"
              className="mb-4"
            />

          </div>
        )}

        {/* Transaction Items */}
        {(() => {
          const transactionCategory = transaction ? getTransactionCategory(transaction, budgetCategories) : undefined
          const itemizationEnabled = getItemizationEnabled(transactionCategory)
          const hasExistingItems = items.length > 0

          // Show items if itemization is enabled OR if items already exist (with warning)
          if (!itemizationEnabled && !hasExistingItems) {
            return null
          }

          return (
            <div ref={transactionItemsContainerRef} className="px-6 py-6 border-t border-gray-200" id="transaction-items-container">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 flex items-center">
                  <Package className="h-5 w-5 mr-2" />
                  Transaction Items
                </h3>
              </div>

              {!itemizationEnabled && hasExistingItems && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      <strong>Itemization is disabled for this category.</strong> This transaction has existing items. You can view and manage them, but itemization is disabled for new transactions in this category.
                      <div className="mt-2">
                        <ContextLink
                          to="/settings"
                          className="inline-flex items-center text-sm font-medium text-yellow-800 underline hover:text-yellow-900"
                        >
                          Enable itemization in Settings
                        </ContextLink>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isLoadingItems ? (
                <div className="flex justify-center items-center h-16">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  <span className="ml-2 text-sm text-gray-600">Loading items...</span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Current items in this transaction */}
                  <div>
                    <TransactionItemsList
                      items={itemsInTransaction}
                      onItemsChange={() => {}}
                      onAddItem={handleCreateItem}
                      onAddExistingItems={() => setShowExistingItemsModal(true)}
                      onUpdateItem={handleUpdateItem}
                      onDuplicateItem={handleDuplicateTransactionItem}
                      projectId={projectId}
                      projectName={project?.name}
                      onImageFilesChange={handleImageFilesChange}
                      onDeleteItems={handleDeletePersistedItems}
                      onRemoveFromTransaction={handleRemoveItemFromThisTransaction}
                      onSellToBusiness={handleSellItemToBusinessInventory}
                      onSellToProject={(itemId) => openItemProjectDialog(itemId, 'sell')}
                      onMoveToBusiness={handleMoveItemToBusinessInventory}
                      onMoveToProject={(itemId) => openItemProjectDialog(itemId, 'move')}
                      containerId="transaction-items-container"
                      enableLocation={true}
                      onSetSpaceId={handleSetSpaceId}
                    />
                  </div>

                  {/* Moved items section */}
                  {itemsMovedOut.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Moved items</h3>
                      <div className="opacity-60">
                        <TransactionItemsList
                          items={itemsMovedOut}
                          onItemsChange={() => {}}
                          onAddItem={handleCreateItem}
                          onUpdateItem={handleUpdateItem}
                          onDuplicateItem={handleDuplicateTransactionItem}
                          projectId={projectId}
                          projectName={project?.name}
                          onImageFilesChange={handleImageFilesChange}
                          onDeleteItems={handleDeletePersistedItems}
                          onRemoveFromTransaction={handleRemoveItemFromThisTransaction}
                          onSellToBusiness={handleSellItemToBusinessInventory}
                          onSellToProject={(itemId) => openItemProjectDialog(itemId, 'sell')}
                          onMoveToBusiness={handleMoveItemToBusinessInventory}
                          onMoveToProject={(itemId) => openItemProjectDialog(itemId, 'move')}
                          showSelectionControls={false}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Sentinel element to detect when container is scrolled past */}
              <div id="transaction-items-sentinel" className="h-1" />
            </div>
          )
        })()}

        {/* Transaction Audit */}
        {(() => {
          if (!transaction) return null
          const resolvedProjectId = projectId || transaction.projectId
          if (!resolvedProjectId) return null
          if (getCanonicalTransactionTitle(transaction) === COMPANY_INVENTORY_SALE || getCanonicalTransactionTitle(transaction) === COMPANY_INVENTORY_PURCHASE) return null

          const transactionCategory = getTransactionCategory(transaction, budgetCategories)
          const itemizationEnabled = getItemizationEnabled(transactionCategory)

          // Hide audit section when itemization is disabled
          if (!itemizationEnabled) {
            return null
          }

          return (
            <div className="px-6 py-6 border-t border-gray-200">
              <TransactionAudit
                transaction={transaction}
                projectId={resolvedProjectId}
                transactionItems={auditItems}
              />
            </div>
          )
        })()}

        {/* Metadata */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="relative">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Project</dt>
                <dd className="mt-1 text-sm text-gray-900">{project?.name || transaction.projectName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {formatDate(transaction.createdAt)}
                </dd>
              </div>
            </dl>

            {/* Delete button in lower right corner */}
            <div className="absolute bottom-0 right-0">
              <button
                onClick={handleDelete}
                className="inline-flex items-center justify-center p-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                title="Delete Transaction"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Image gallery modal */}
      {showGallery && (
        <ImageGallery
          images={itemImages}
          initialIndex={galleryInitialIndex}
          onClose={handleGalleryClose}
          onPinToggle={handlePinToggle}
        />
      )}

      {/* Move to Project Dialog */}
      {showProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Move to Project
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <Combobox
                label="Select Project"
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                disabled={loadingProjects || isUpdatingProject}
                loading={loadingProjects}
                placeholder={loadingProjects ? "Loading projects..." : "Select a project"}
                options={projectOptions}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (isUpdatingProject) return
                  setShowProjectDialog(false)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isUpdatingProject}
              >
                Cancel
              </button>
              <button
                onClick={handleMoveProject}
                disabled={!selectedProjectId || isUpdatingProject}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingProject ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item Move/Sell to Project Dialog */}
      {showItemProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {itemProjectDialogMode === 'sell' ? 'Sell to Project' : 'Move to Project'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <Combobox
                label="Select Project"
                value={itemProjectSelectedId}
                onChange={setItemProjectSelectedId}
                disabled={loadingProjects || isUpdatingItemProject}
                loading={loadingProjects}
                placeholder={loadingProjects ? 'Loading projects...' : 'Select a project'}
                options={itemProjectOptions}
              />
              {itemProjectDialogMode === 'move' && itemAssociateDisabledReason && (
                <p className="text-xs text-gray-500">{itemAssociateDisabledReason}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (isUpdatingItemProject) return
                  setShowItemProjectDialog(false)
                  setItemProjectTargetId(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isUpdatingItemProject}
              >
                Cancel
              </button>
              <button
                onClick={itemProjectDialogMode === 'sell' ? handleSellItemToProject : handleMoveItemToProject}
                disabled={!itemProjectSelectedId || isUpdatingItemProject || (itemAssociateDisabled && itemProjectDialogMode === 'move')}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingItemProject
                  ? itemProjectDialogMode === 'sell'
                    ? 'Selling...'
                    : 'Moving...'
                  : itemProjectDialogMode === 'sell'
                    ? 'Sell'
                    : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Existing Items Modal */}
      {showExistingItemsModal && transaction && (
        <>
          <div className="fixed inset-0 z-30 bg-black bg-opacity-50 pointer-events-none" />
          {/* Modal positioned relative to transaction items container on desktop, centered on mobile */}
          <div
            className={`fixed z-50 ${
              modalPosition
                ? ''
                : isImagePinned
                  ? 'inset-x-0 bottom-0 h-[62vh] flex items-end justify-center'
                  : 'inset-0 flex items-end justify-center'
            }`}
            style={modalPosition ? {
              top: `${modalPosition.top}px`,
              left: `${modalPosition.left}px`,
              width: `${modalPosition.width}px`,
              maxWidth: 'calc(100% - 32px)', // 16px margin on each side
              height: 'calc(100vh - 16px)'
            } : undefined}
            role="dialog"
            aria-modal="true"
          >
              <div className={`bg-white rounded-lg shadow-xl overflow-hidden ${
              modalPosition
                ? 'w-full h-[calc(100vh-16px)] max-h-none flex flex-col'
                : 'w-full max-w-5xl mx-4 h-[66vh] max-h-[66vh] flex flex-col'
            }`}>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Add Existing Items</h3>
                <button
                  type="button"
                  onClick={() => setShowExistingItemsModal(false)}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900"
                >
                  Close
                </button>
              </div>
              <div id="transaction-items-picker-modal" className={`px-6 py-4 overflow-y-auto ${modalPosition ? 'flex-1' : 'max-h-[70vh]'}`}>
                <TransactionItemPicker
                  transaction={transaction}
                  projectId={projectId}
                  transactionItemIds={itemsInTransaction.map(item => item.id)}
                  containerId="transaction-items-picker-modal"
                  onItemsAdded={async () => {
                    await refreshTransactionItems()
                    await refreshRealtimeAfterWrite()
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
        </div>
      </div>
    </div>
  )
}
