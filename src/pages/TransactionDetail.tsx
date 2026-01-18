import { ArrowLeft, Edit, Trash2, Image as ImageIcon, Package, RefreshCw } from 'lucide-react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import ImageGallery from '@/components/ui/ImageGallery'
import { TransactionImagePreview } from '@/components/ui/ImagePreview'
import { useParams } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import ContextLink from '@/components/ContextLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { Transaction, Project, Item, TransactionItemFormData, BudgetCategory, ItemDisposition, ItemImage, TransactionImage } from '@/types'
import { transactionService, projectService, unifiedItemsService } from '@/services/inventoryService'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import { offlineStore } from '@/services/offlineStore'
import { offlineTransactionService } from '@/services/offlineTransactionService'
import { useOfflineMediaTracker } from '@/hooks/useOfflineMediaTracker'
import { formatDate, formatCurrency } from '@/utils/dateUtils'
import { useToast } from '@/components/ui/ToastContext'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import TransactionItemForm from '@/components/TransactionItemForm'
import TransactionItemsList from '@/components/TransactionItemsList'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { useNetworkState } from '@/hooks/useNetworkState'
import { hydrateOptimisticItem, hydrateTransactionCache, loadTransactionItemsWithReconcile } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import TransactionAudit from '@/components/ui/TransactionAudit'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { projectTransactionEdit, projectTransactions } from '@/utils/routes'
import { splitItemsByMovement, type DisplayTransactionItem } from '@/utils/transactionMovement'
import { ConflictResolutionView } from '@/components/ConflictResolutionView'


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

const buildDisplayItems = (items: Item[], movedOutItemIds: Set<string>): DisplayTransactionItem[] => {
  return items.map(item => ({
    id: item.itemId,
    description: item.description || '',
    purchasePrice: item.purchasePrice?.toString() || '',
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
  const transactionRef = useRef<Transaction | null>(null)
  const derivedRealtimeProjectId = projectId || transaction?.projectId || null
  const { refreshCollections: refreshRealtimeCollections, items: realtimeProjectItems } = useProjectRealtime(derivedRealtimeProjectId)
  const refreshRealtimeAfterWrite = useCallback(
    (includeProject = false) => {
      if (!derivedRealtimeProjectId) return Promise.resolve()
      return refreshRealtimeCollections(includeProject ? { includeProject: true } : undefined).catch(err => {
        console.debug('TransactionDetail: realtime refresh failed', err)
      })
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
  const [receiptUploadsInFlight, setReceiptUploadsInFlight] = useState(0)
  const [otherUploadsInFlight, setOtherUploadsInFlight] = useState(0)
  const isUploadingReceiptImages = receiptUploadsInFlight > 0
  const isUploadingOtherImages = otherUploadsInFlight > 0
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())
  const [itemRecords, setItemRecords] = useState<Item[]>([])

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
  const [isAddingItem, setIsAddingItem] = useState(false)
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
  const refreshTransactionItems = useCallback(async () => {
    if (!currentAccountId || !transactionId) return

    const activeTransaction = transactionRef.current
    const actualProjectId = projectId || activeTransaction?.projectId
    if (!actualProjectId || !activeTransaction) return

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
        if (itemIdsFromTransaction.length > 0 && actualProjectId) {
          const itemsPromises = itemIdsFromTransaction.map((itemId: string) => unifiedItemsService.getItemById(currentAccountId, itemId))
          const items = await Promise.all(itemsPromises)
          let validItems = items.filter(item => item !== null) as Item[]
          console.log('TransactionDetail - fetched items (from transaction.itemIds):', validItems.length)

          try {
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
              console.log('TransactionDetail - added moved items:', validMovedItems.length)
            }

            setLoadedItems(validItems, new Set<string>(movedOutItemIds))
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
    if (!resolvedProjectId) return

    const unsubscribe = transactionService.subscribeToTransaction(
      currentAccountId,
      resolvedProjectId,
      transactionId,
      updatedTransaction => {
        setTransaction(updatedTransaction)
      }
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
    if (!resolvedProjectId) return

    const unsubscribe = unifiedItemsService.subscribeToProjectItems(
      currentAccountId,
      resolvedProjectId,
      () => {
        refreshTransactionItems()
      }
    )

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



  const handleDelete = async () => {
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

    if (window.confirm('Are you sure you want to delete this transaction? This action cannot be undone.')) {
      try {
        await transactionService.deleteTransaction(currentAccountId, projectId, transactionId)
        await refreshRealtimeAfterWrite(true)
        navigate(projectId ? projectTransactions(projectId) : '/projects')
      } catch (error) {
        console.error('Error deleting transaction:', error)
        showError('Failed to delete transaction. Please try again.')
      }
    }
  }

  const handleImageClick = (index: number) => {
    setGalleryInitialIndex(index)
    setShowGallery(true)
  }

  const handleGalleryClose = () => {
    setShowGallery(false)
  }

  const handleReceiptsUpload = async (files: File[]) => {
    if (!projectId || !transactionId || !project || files.length === 0 || !currentAccountId) return

    setReceiptUploadsInFlight(count => count + 1)

    try {
      const newReceiptImages: TransactionImage[] = []
      const projectName = project.name

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
    if (!projectId || !transactionId || !project || files.length === 0 || !currentAccountId) return

    setOtherUploadsInFlight(count => count + 1)

    try {
      const newOtherImages: TransactionImage[] = []
      const projectName = project.name

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
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

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
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

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
    if (!projectId || !transactionId || !transaction) {
      throw new Error('Transaction context is missing for item creation')
    }
    const { disposition, ...rest } = item
    return {
      ...rest,
      projectId,
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

  const handleCreateItem = async (item: TransactionItemFormData) => {
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

    try {
      const itemData = buildCreateItemPayload(item)

      const createResult = await unifiedItemsService.createItem(currentAccountId, itemData)
      const itemId = createResult.itemId

      // Hydrate optimistic item into React Query cache immediately
      await hydrateOptimisticItem(currentAccountId, itemId, itemData)

      await uploadItemImages(itemId, item)

      await refreshTransactionItems()
      await refreshRealtimeAfterWrite()
      setIsAddingItem(false)
      
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
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

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

  const handleCancelAddItem = () => {
    setIsAddingItem(false)
    setImageFilesMap(new Map())
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
            <ContextLink
              to={buildContextUrl(editTransactionUrl)}
              className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              title="Edit Transaction"
            >
              <Edit className="h-4 w-4" />
            </ContextLink>
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
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            {getCanonicalTransactionTitle(transaction)} - {formatCurrency(transaction.amount)}
          </h1>
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
              <dd className="mt-1 text-sm text-gray-900">{formatCurrency(transaction.amount)}</dd>
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

            {transaction.receiptEmailed && (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  Receipt Emailed
                </dt>
                <dd className="mt-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Yes
                  </span>
                </dd>
              </div>
            )}

            {transaction.notes && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Notes</dt>
                <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{transaction.notes}</dd>
              </div>
            )}
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
        <div className="px-6 py-6 border-t border-gray-200" id="transaction-items-container">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Package className="h-5 w-5 mr-2" />
              Transaction Items
            </h3>
          </div>

          {isLoadingItems ? (
            <div className="flex justify-center items-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              <span className="ml-2 text-sm text-gray-600">Loading items...</span>
            </div>
          ) : items.length > 0 ? (
            <div className="space-y-6">
              {/* Current items in this transaction */}
              {itemsInTransaction.length > 0 && (
                <div>
                  <TransactionItemsList
                    items={itemsInTransaction}
                    onItemsChange={() => {}}
                    onAddItem={handleCreateItem}
                    onUpdateItem={handleUpdateItem}
                    onDuplicateItem={handleDuplicateTransactionItem}
                    projectId={projectId}
                    projectName={project?.name}
                    onImageFilesChange={handleImageFilesChange}
                    onDeleteItems={handleDeletePersistedItems}
                    containerId="transaction-items-container"
                  />
                </div>
              )}

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
                      showSelectionControls={false}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : !isAddingItem ? (
            <div className="text-center py-8">
              <Package className="mx-auto h-8 w-8 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No items added</h3>
              <button
                onClick={() => setIsAddingItem(true)}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mt-3"
                title="Add new item"
              >
                <Package className="h-3 w-3 mr-1" />
                Add Item
              </button>
            </div>
          ) : (
            <TransactionItemForm
              onSave={handleCreateItem}
              onCancel={handleCancelAddItem}
              projectId={projectId}
              projectName={project ? project.name : ''}
              onImageFilesChange={handleImageFilesChange}
            />
          )}
          {/* Sentinel element to detect when container is scrolled past */}
          <div id="transaction-items-sentinel" className="h-1" />
        </div>

        {/* Transaction Audit */}
        {transaction && (projectId || transaction.projectId) && getCanonicalTransactionTitle(transaction) !== COMPANY_INVENTORY_SALE && getCanonicalTransactionTitle(transaction) !== COMPANY_INVENTORY_PURCHASE && (
          <div className="px-6 py-6 border-t border-gray-200">
            <TransactionAudit
              transaction={transaction}
              projectId={projectId || transaction.projectId || ''}
              transactionItems={auditItems}
              onItemsUpdated={refreshTransactionItems}
            />
          </div>
        )}

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
        />
      )}
    </div>
  )
}
