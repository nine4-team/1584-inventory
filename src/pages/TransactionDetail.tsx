import { ArrowLeft, Edit, Trash2, Image as ImageIcon, Package } from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import ImageGallery from '@/components/ui/ImageGallery'
import { TransactionImagePreview } from '@/components/ui/ImagePreview'
import { useParams } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import ContextLink from '@/components/ContextLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { Transaction, Project, Item, TransactionItemFormData, BudgetCategory } from '@/types'
import { transactionService, projectService, unifiedItemsService } from '@/services/inventoryService'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { formatDate, formatCurrency } from '@/utils/dateUtils'
import { useToast } from '@/components/ui/ToastContext'
import TransactionItemForm from '@/components/TransactionItemForm'
import TransactionItemsList from '@/components/TransactionItemsList'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import type { ItemLineageEdge } from '@/types'
import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import TransactionAudit from '@/components/ui/TransactionAudit'
import { projectItemDetail, projectTransactionDetail, projectTransactionEdit, projectTransactions } from '@/utils/routes'
import { splitItemsByMovement, type DisplayTransactionItem } from '@/utils/transactionMovement'


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


export default function TransactionDetail() {
  const { id, projectId: routeProjectId, transactionId } = useParams<{ id?: string; projectId?: string; transactionId: string }>()
  const projectId = routeProjectId || id
  const navigate = useStackedNavigate()
  const { currentAccountId } = useAccount()
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [project, setProject] = useState<Project | null>(null)

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
  const [showGallery, setShowGallery] = useState(false)
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0)
  const [isUploadingReceiptImages, setIsUploadingReceiptImages] = useState(false)
  const [isUploadingOtherImages, setIsUploadingOtherImages] = useState(false)
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())

  const { inTransaction: itemsInTransaction, movedOut: itemsMovedOut } = useMemo(() => {
    return splitItemsByMovement(items as DisplayTransactionItem[], transactionId)
  }, [items, transactionId])
  const [isAddingItem, setIsAddingItem] = useState(false)
  const { showError, showSuccess } = useToast()
  const { buildContextUrl, getBackDestination } = useNavigationContext()

  // Navigation context logic

  const backDestination = useMemo(() => {
    const fallbackPath = projectId ? projectTransactions(projectId) : '/projects'
    return getBackDestination(fallbackPath)
  }, [getBackDestination, projectId])

  // Refresh transaction items
  const refreshTransactionItems = async () => {
    if (!currentAccountId || !transactionId || !transaction) return

    const actualProjectId = projectId || transaction?.projectId
    if (!actualProjectId) return

    try {
      // Use transaction.itemIds to include moved items (same logic as main useEffect)
      const itemIdsFromTransaction = Array.isArray(transaction?.itemIds) ? transaction.itemIds : []
      let itemIds: string[]

      if (itemIdsFromTransaction.length > 0) {
        itemIds = itemIdsFromTransaction
      } else {
        // Fallback: query items by transaction_id when itemIds is empty or missing
        const transactionItems = await unifiedItemsService.getItemsForTransaction(currentAccountId, actualProjectId, transactionId)
        itemIds = transactionItems.map(item => item.itemId)
      }
      const itemsPromises = itemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
      const items = await Promise.all(itemsPromises)
      let validItems = items.filter(item => item !== null) as Item[]

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

      const displayItems = buildDisplayItems(validItems, new Set(movedOutItemIds))

      setItems(displayItems)
      snapshotInitialItems(displayItems)

      // Resolve any missing project IDs (fire-and-forget)
      resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
    } catch (error) {
      console.error('Error refreshing transaction items:', error)
    }
  }

  const handleDeletePersistedItem = async (itemId: string) => {
    if (!currentAccountId) {
      showError('You must belong to an account to delete items.')
      return false
    }

    try {
      await unifiedItemsService.deleteItem(currentAccountId, itemId)
      await refreshTransactionItems()
      showSuccess('Item deleted successfully')
      return true
    } catch (error) {
      console.error('Error deleting item:', error)
      showError('Failed to delete item. Please try again.')
      return false
    }
  }

  useEffect(() => {
    const loadTransaction = async () => {
      if (!transactionId || !currentAccountId) return

      try {
        let actualProjectId = projectId
        let transactionData: any
        let projectData: Project | null = null

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

          transactionData = result.transaction
          actualProjectId = result.projectId

          // Get project data only if projectId exists (business inventory transactions have null projectId)
          if (actualProjectId) {
            projectData = await projectService.getProject(currentAccountId, actualProjectId)
          }
        } else {
          // Fetch transaction and project data for regular project transactions.
          // We intentionally do NOT rely on `getItemsForTransaction` here because moved/deallocated
          // items may have been cleared from the `transaction_id` column. Instead, read
          // `itemIds` from the transaction row and load each item by `item_id` so moved items
          // are still discoverable and can be shown in the "Moved out" section.
          const [fetchedTransactionData, fetchedProjectData] = await Promise.all([
            transactionService.getTransaction(currentAccountId, actualProjectId, transactionId),
            projectService.getProject(currentAccountId, actualProjectId)
          ])

          transactionData = fetchedTransactionData
          projectData = fetchedProjectData

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

              const displayItems = buildDisplayItems(validItems, new Set(movedOutItemIds))

              setItems(displayItems)
              snapshotInitialItems(displayItems)

              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            } catch (edgeErr) {
              console.error('TransactionDetail - failed to fetch lineage edges:', edgeErr)
              const displayItems = buildDisplayItems(validItems, new Set())
              setItems(displayItems)
              snapshotInitialItems(displayItems)
              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            }
          } else {
            // Fallback: query items by transaction_id when itemIds is empty or missing
            console.log('TransactionDetail - itemIds empty, falling back to getItemsForTransaction')
            try {
              const transactionItems = await unifiedItemsService.getItemsForTransaction(currentAccountId, actualProjectId, transactionId)
              const itemIds = transactionItems.map(item => item.itemId)
              const itemsPromises = itemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
              const items = await Promise.all(itemsPromises)
              let validItems = items.filter(item => item !== null) as Item[]

              let movedOutItemIds = new Set<string>()
              try {
                // Include items that were moved out of this transaction by consulting lineage edges.
                // The UI displays both "in transaction" and "moved out" items; we need to load moved items too.
                const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
                const allMovedOutItemIds = Array.from(new Set(edgesFromTransaction.map(edge => edge.itemId)))

                // Fetch any moved item records that aren't already in the items list
                const missingMovedItemIds = allMovedOutItemIds.filter(id => !validItems.some(it => it.itemId === id))
                if (missingMovedItemIds.length > 0) {
                  const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
                  const movedItems = await Promise.all(movedItemsPromises)
                  const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
                  validItems = validItems.concat(validMovedItems)
                  console.log('TransactionDetail - added moved items (fallback):', validMovedItems.length)
                }

                movedOutItemIds = new Set(allMovedOutItemIds)
              } catch (edgeErr) {
                console.error('TransactionDetail - failed to fetch lineage edges via fallback:', edgeErr)
              }

              const displayItems = buildDisplayItems(validItems, movedOutItemIds)

              setItems(displayItems)
              snapshotInitialItems(displayItems)
              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            } catch (itemError) {
              console.error('TransactionDetail - failed to fetch items by transaction_id:', itemError)
              setItems([])
            }
          }
        }

        const convertedTransaction: Transaction = {
          ...transactionData,
          transactionImages: Array.isArray(transactionData?.transactionImages) ? transactionData.transactionImages : []
        } as Transaction

        console.log('TransactionDetail - loaded transactionData:', transactionData)
        console.log('TransactionDetail - convertedTransaction:', convertedTransaction)
        console.log('TransactionDetail - actualProjectId:', actualProjectId)
        setTransaction(convertedTransaction)
        setProject(projectData)

        // Fetch transaction items for business inventory transactions (when no projectId in URL)
        if (!projectId) {
          // For business inventory transactions, prefer item IDs stored on the transaction record
          // so deallocated/moved items remain discoverable.
          const transactionItemIds = Array.isArray(transactionData?.itemIds) ? transactionData.itemIds : []
          if (transactionItemIds.length > 0) {
            const itemsPromises = transactionItemIds.map((itemId: string) => unifiedItemsService.getItemById(currentAccountId, itemId))
            const items = await Promise.all(itemsPromises)
            let validItems = items.filter(item => item !== null) as Item[]
            console.log('TransactionDetail - fetched items for business inventory transaction:', validItems.length)

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
                console.log('TransactionDetail - added moved items (business inventory):', validMovedItems.length)
              }

              const displayItems = buildDisplayItems(validItems, new Set(movedOutItemIds))

              setItems(displayItems)
              snapshotInitialItems(displayItems)

              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            } catch (edgeErr) {
              console.error('TransactionDetail - failed to fetch lineage edges (business inventory):', edgeErr)
              const displayItems = buildDisplayItems(validItems, new Set())
              setItems(displayItems)
              snapshotInitialItems(displayItems)
              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            }
          } else {
            // Fallback: query items by transaction_id when itemIds is empty or missing
            console.log('TransactionDetail - itemIds empty for business inventory, falling back to getItemsForTransaction')
            try {
              const actualProjectIdForQuery = actualProjectId || ''
              const transactionItems = await unifiedItemsService.getItemsForTransaction(currentAccountId, actualProjectIdForQuery, transactionId)
              const itemIds = transactionItems.map(item => item.itemId)
              const itemsPromises = itemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
              const items = await Promise.all(itemsPromises)
              let validItems = items.filter(item => item !== null) as Item[]

              let movedOutItemIds = new Set<string>()
              try {
                // Include items that were moved out of this transaction by consulting lineage edges.
                // The UI displays both "in transaction" and "moved out" items; we need to load moved items too.
                const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
                const allMovedOutItemIds = Array.from(new Set(edgesFromTransaction.map(edge => edge.itemId)))

                // Fetch any moved item records that aren't already in the items list
                const missingMovedItemIds = allMovedOutItemIds.filter(id => !validItems.some(it => it.itemId === id))
                if (missingMovedItemIds.length > 0) {
                  const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
                  const movedItems = await Promise.all(movedItemsPromises)
                  const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
                  validItems = validItems.concat(validMovedItems)
                  console.log('TransactionDetail - added moved items (business inventory fallback):', validMovedItems.length)
                }

                movedOutItemIds = new Set(allMovedOutItemIds)
              } catch (edgeErr) {
                console.error('TransactionDetail - failed to fetch lineage edges (business inventory fallback):', edgeErr)
              }

              const displayItems = buildDisplayItems(validItems, movedOutItemIds)

              setItems(displayItems)
              snapshotInitialItems(displayItems)
              resolveMissingProjectIds(validItems).catch(err => console.debug('resolveMissingProjectIds error:', err))
            } catch (itemError) {
              console.error('TransactionDetail - failed to fetch items by transaction_id (business inventory):', itemError)
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
    }

    loadTransaction()
  }, [projectId, transactionId, currentAccountId])

  // Set up real-time subscription for transaction updates
  useEffect(() => {
    if (!transactionId || !transaction) return
    // Use the actual project ID (whether from URL params or discovered from transaction lookup)
    const actualProjectId = projectId || transaction.projectId

    if (!actualProjectId) return

    // Temporarily disable real-time subscription to debug
    // const unsubscribe = transactionService.subscribeToTransaction(
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
    const unsubscribe = lineageService.subscribeToEdgesFromTransaction(currentAccountId, transactionId, (edge) => {
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
    if (!projectId || !transactionId || !project || files.length === 0) return

    setIsUploadingReceiptImages(true)

    try {
      // Upload receipts (images + PDFs)
      const uploadResults = await ImageUploadService.uploadMultipleReceiptAttachments(
        files,
        project.name,
        transactionId
      )

      // Convert to TransactionImage format
      const newReceiptImages = ImageUploadService.convertFilesToReceiptImages(uploadResults)

      // Update transaction with new receipts
      const currentReceiptImages = transaction?.receiptImages || []
      const updatedReceiptImages = [...currentReceiptImages, ...newReceiptImages]

      const updateProjectId = transaction?.projectId || projectId
      if (!currentAccountId) return
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        receiptImages: updatedReceiptImages,
        transactionImages: updatedReceiptImages // Also update legacy field for compatibility
      })

      // Refresh transaction data (use actual project_id from transaction)
      const refreshProjectId = transaction?.projectId || projectId
      const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
      setTransaction(updatedTransaction)

      showSuccess('Receipts uploaded successfully')
    } catch (error) {
      console.error('Error uploading receipts:', error)
      showError('Failed to upload receipts. Please try again.')
    } finally {
      setIsUploadingReceiptImages(false)
    }
  }

  const handleOtherImagesUpload = async (files: File[]) => {
    if (!projectId || !transactionId || !project || files.length === 0) return

    setIsUploadingOtherImages(true)

    try {
      // Upload other images
      const uploadResults = await ImageUploadService.uploadMultipleOtherImages(
        files,
        project.name,
        transactionId
      )

      // Convert to TransactionImage format
      const newOtherImages = ImageUploadService.convertFilesToOtherImages(uploadResults)

      // Update transaction with new other images
      const currentOtherImages = transaction?.otherImages || []
      const updatedOtherImages = [...currentOtherImages, ...newOtherImages]

      const updateProjectId = transaction?.projectId || projectId
      if (!currentAccountId) return
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        otherImages: updatedOtherImages
      })

      // Refresh transaction data (use actual project_id from transaction)
      const refreshProjectId = transaction?.projectId || projectId
      const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
      setTransaction(updatedTransaction)

      showSuccess('Other images uploaded successfully')
    } catch (error) {
      console.error('Error uploading other images:', error)
      showError('Failed to upload other images. Please try again.')
    } finally {
      setIsUploadingOtherImages(false)
    }
  }

  const handleDeleteReceiptImage = async (imageUrl: string) => {
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

    try {
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

      showSuccess('Receipt deleted successfully')
    } catch (error) {
      console.error('Error deleting receipt:', error)
      showError('Failed to delete receipt. Please try again.')
    }
  }

  const handleDeleteOtherImage = async (imageUrl: string) => {
    if (!projectId || !transactionId || !transaction) return

    try {
      // Filter out the image to be deleted
      const currentOtherImages = transaction.otherImages || []
      const updatedOtherImages = currentOtherImages.filter(img => img.url !== imageUrl)

      const updateProjectId = transaction?.projectId || projectId
      if (!currentAccountId) return
      await transactionService.updateTransaction(currentAccountId, updateProjectId || '', transactionId, {
        otherImages: updatedOtherImages
      })

      // Refresh transaction data (use actual project_id from transaction)
      const refreshProjectId = transaction?.projectId || projectId
      const updatedTransaction = await transactionService.getTransaction(currentAccountId, refreshProjectId || '', transactionId)
      setTransaction(updatedTransaction)

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
      const uploadedImages = await Promise.all(
        imageFiles.map(async (file, index) => {
          try {
            const uploadResult = await ImageUploadService.uploadItemImage(
              file,
              project ? project.name : 'Unknown Project',
              targetItemId
            )

            return {
              url: uploadResult.url,
              alt: file.name,
              isPrimary: index === 0,
              uploadedAt: new Date(),
              fileName: file.name,
              size: file.size,
              mimeType: file.type
            }
          } catch (uploadError) {
            console.error(`Failed to upload ${file.name}:`, uploadError)
            return {
              url: '',
              alt: file.name,
              isPrimary: false,
              uploadedAt: new Date(),
              fileName: file.name,
              size: file.size,
              mimeType: file.type
            }
          }
        })
      )

      const validImages = uploadedImages.filter(img => img.url && img.url.trim() !== '')

      if (validImages.length > 0) {
        await unifiedItemsService.updateItem(currentAccountId, targetItemId, { images: validImages })
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

  const handleCreateItem = async (item: TransactionItemFormData) => {
    if (!projectId || !transactionId || !transaction || !currentAccountId) return

    try {
      const itemData = {
        ...item,
        projectId: projectId,
        transactionId: transactionId,
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
        disposition: 'purchased'
      }

      const itemId = await unifiedItemsService.createItem(currentAccountId, itemData)
      await uploadItemImages(itemId, item)

      await refreshTransactionItems()
      setIsAddingItem(false)
      showSuccess('Item added successfully')
    } catch (error) {
      console.error('Error adding item:', error)
      showError('Failed to add item. Please try again.')
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

      await unifiedItemsService.updateItem(currentAccountId, item.id, updateData)
      await uploadItemImages(item.id, item)

      await refreshTransactionItems()
      showSuccess('Item updated successfully')
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

  // Resolve missing project IDs for transactions referenced by items.
  // This avoids interpolating `undefined` into project routes when an item
  // has had its `projectId` cleared but still references a `latestTransactionId`.
  async function resolveMissingProjectIds(items: Item[]) {
    if (!currentAccountId) return

    // Collect unique transaction IDs that need resolution and aren't already cached.
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

      // Only update state if we found any new mappings
      if (Object.keys(newMap).length > Object.keys(resolvedProjectByTx).length) {
        setResolvedProjectByTx(newMap)
      }
    } catch (err) {
      console.debug('TransactionDetail - resolveMissingProjectIds unexpected error', err)
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
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </ContextBackLink>
          <div className="flex space-x-3">
            <ContextLink
              to={buildContextUrl(
                // Use project route if projectId exists in URL and transaction has a projectId
                // Otherwise use business inventory route (projectId can be empty string for business inventory transactions)
                projectId && transaction?.projectId
                  ? projectTransactionEdit(projectId, transactionId)
                  : `/business-inventory/transaction/${transaction?.projectId || 'null'}/${transactionId}/edit`
              )}
              className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              title="Edit Transaction"
            >
              <Edit className="h-4 w-4" />
            </ContextLink>
          </div>
        </div>
      </div>

      {/* Transaction Details */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
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
                disabled={isUploadingReceiptImages}
                className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <ImageIcon className="h-3 w-3 mr-1" />
                {isUploadingReceiptImages ? 'Uploading...' : 'Add Receipts'}
              </button>
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
                disabled={isUploadingReceiptImages}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mt-3 disabled:opacity-50"
              >
                <ImageIcon className="h-3 w-3 mr-1" />
                {isUploadingReceiptImages ? 'Uploading...' : 'Add Receipts'}
              </button>
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
                disabled={isUploadingOtherImages}
                className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <ImageIcon className="h-3 w-3 mr-1" />
                {isUploadingOtherImages ? 'Uploading...' : 'Add Images'}
              </button>
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
        <div className="px-6 py-6 border-t border-gray-200">
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
                    onItemsChange={(updatedItems) => {
                      // Handle item updates, deletions, additions
                      console.log('Items changed:', updatedItems)
                      // For now, just refresh the transaction items
                      refreshTransactionItems()
                    }}
                    onAddItem={handleCreateItem}
                    onUpdateItem={handleUpdateItem}
                    projectId={projectId}
                    projectName={project?.name}
                    onImageFilesChange={handleImageFilesChange}
                    onDeleteItem={handleDeletePersistedItem}
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
                      onItemsChange={(updatedItems) => {
                        // Handle item updates, deletions, additions for moved items too
                        console.log('Moved items changed:', updatedItems)
                        // For now, just refresh the transaction items
                        refreshTransactionItems()
                      }}
                      onAddItem={handleCreateItem}
                      onUpdateItem={handleUpdateItem}
                      projectId={projectId}
                      projectName={project?.name}
                      onImageFilesChange={handleImageFilesChange}
                      onDeleteItem={handleDeletePersistedItem}
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
        </div>

        {/* Transaction Audit */}
        {transaction && (projectId || transaction.projectId) && getCanonicalTransactionTitle(transaction) !== COMPANY_INVENTORY_SALE && getCanonicalTransactionTitle(transaction) !== COMPANY_INVENTORY_PURCHASE && (
          <div className="px-6 py-6 border-t border-gray-200">
            <TransactionAudit
              transaction={transaction}
              projectId={projectId || transaction.projectId || ''}
              transactionItems={itemsInTransaction}
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
