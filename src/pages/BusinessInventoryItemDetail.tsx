import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import ContextLink from '@/components/ContextLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { ArrowLeft, Package, ImagePlus, FileText, RefreshCw, Bookmark, ChevronLeft, ChevronRight } from 'lucide-react'
import { Item, Project, ItemDisposition, Transaction } from '@/types'
import { unifiedItemsService, projectService, transactionService } from '@/services/inventoryService'
import { formatDate } from '@/utils/dateUtils'
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'
import ImagePreview from '@/components/ui/ImagePreview'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { ImageUploadService } from '@/services/imageService'
import { useDuplication } from '@/hooks/useDuplication'
import { useAccount } from '@/contexts/AccountContext'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'
import ItemLineageBreadcrumb from '@/components/ui/ItemLineageBreadcrumb'
import { lineageService } from '@/services/lineageService'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useNetworkState } from '@/hooks/useNetworkState'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { projectItemDetail, projectItems, projectTransactionDetail } from '@/utils/routes'
import ItemActionsMenu from '@/components/items/ItemActionsMenu'
import BlockingConfirmDialog from '@/components/ui/BlockingConfirmDialog'
import { Combobox } from '@/components/ui/Combobox'
import { displayDispositionLabel } from '@/utils/dispositionUtils'
import { supabase } from '@/services/supabase'

export default function BusinessInventoryItemDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useStackedNavigate()
  const rawNavigate = useNavigate()
  const { currentAccountId } = useAccount()
  const { items: snapshotItems, isLoading: realtimeLoading, refreshCollections } = useBusinessInventoryRealtime()
  const { buildContextUrl } = useNavigationContext()
  const { isOnline } = useNetworkState()
  const { showOfflineSaved } = useOfflineFeedback()
  const snapshotItem = useMemo(() => {
    if (!id) return null
    return snapshotItems.find(item => item.itemId === id) ?? null
  }, [id, snapshotItems])

  // Parse filter and sort from URL params (matching BusinessInventory.tsx logic)
  const filterMode = useMemo(() => {
    const param = searchParams.get('bizItemFilter')
    const validModes = ['all', 'bookmarked', 'no-sku', 'no-description', 'no-project-price', 'no-image', 'no-transaction']
    return validModes.includes(param || '') ? param as typeof validModes[number] : 'all'
  }, [searchParams])
  
  const sortMode = useMemo(() => {
    const param = searchParams.get('bizItemSort')
    return param === 'alphabetical' ? 'alphabetical' : 'creationDate'
  }, [searchParams])
  
  const inventorySearchQuery = useMemo(() => {
    return searchParams.get('bizItemSearch') || ''
  }, [searchParams])

  // Helper function to check if a money string is non-empty
  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    return value.trim().length > 0 && Number.isFinite(Number.parseFloat(value))
  }

  // Apply same filtering and sorting as BusinessInventory.tsx
  const filteredAndSortedItems = useMemo(() => {
    return snapshotItems.filter(item => {
      // Apply search filter
      const rawQuery = (inventorySearchQuery || '').trim()
      const query = rawQuery.toLowerCase()
      const hasDigit = /\d/.test(rawQuery)
      const allowedOnly = /^[0-9\s,().$-]+$/.test(rawQuery)
      const isAmountQuery = hasDigit && allowedOnly
      const normalizedQuery = isAmountQuery ? normalizeMoneyToTwoDecimalString(rawQuery) : undefined
      const normalizedQueryNumeric = normalizedQuery?.replace(/[^0-9-]/g, '') ?? ''
      const matchesText = !query ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.sku || '').toLowerCase().includes(query) ||
        (item.source || '').toLowerCase().includes(query) ||
        (item.paymentMethod || '').toLowerCase().includes(query) ||
        (item.businessInventoryLocation || '').toLowerCase().includes(query)
      let matchesAmount = false
      if (isAmountQuery && normalizedQuery) {
        const amountValues = [item.price, item.purchasePrice, item.projectPrice, item.marketValue]
        matchesAmount = amountValues.some(value => {
          const normalizedAmount = normalizeMoneyToTwoDecimalString((value ?? '').toString())
          if (!normalizedAmount) return false
          if (normalizedAmount === normalizedQuery) return true
          if (!normalizedQueryNumeric || normalizedQueryNumeric === '-') return false
          const normalizedAmountNumeric = normalizedAmount.replace(/[^0-9-]/g, '')
          return normalizedAmountNumeric.includes(normalizedQueryNumeric)
        })
      }
      const matchesSearch = matchesText || matchesAmount

      // Apply filter based on filterMode
      let matchesFilter = false
      switch (filterMode) {
        case 'all':
          matchesFilter = true
          break
        case 'bookmarked':
          matchesFilter = !!item.bookmark
          break
        case 'no-sku':
          matchesFilter = !item.sku?.trim()
          break
        case 'no-description':
          matchesFilter = !item.description?.trim()
          break
        case 'no-project-price':
          matchesFilter = !hasNonEmptyMoneyString(item.projectPrice)
          break
        case 'no-image':
          matchesFilter = !item.images || item.images.length === 0
          break
        case 'no-transaction':
          matchesFilter = !item.transactionId
          break
        default:
          matchesFilter = true
      }

      return matchesSearch && matchesFilter
    }).sort((a, b) => {
      if (sortMode === 'alphabetical') {
        const aDesc = a.description || ''
        const bDesc = b.description || ''
        return aDesc.localeCompare(bDesc)
      } else if (sortMode === 'creationDate') {
        const aDate = new Date(a.dateCreated || 0).getTime()
        const bDate = new Date(b.dateCreated || 0).getTime()
        return bDate - aDate // Most recent first
      }
      return 0
    })
  }, [snapshotItems, filterMode, sortMode, inventorySearchQuery])

  // Navigation state for next/previous items
  const [currentIndex, setCurrentIndex] = useState<number>(-1)

  // Update current index when filtered/sorted items or id changes
  useEffect(() => {
    if (filteredAndSortedItems.length > 0 && id) {
      const index = filteredAndSortedItems.findIndex(i => i.itemId === id)
      setCurrentIndex(index)
    }
  }, [filteredAndSortedItems, id])

  const nextItem = currentIndex >= 0 && currentIndex < filteredAndSortedItems.length - 1 ? filteredAndSortedItems[currentIndex + 1] : null
  const previousItem = currentIndex > 0 ? filteredAndSortedItems[currentIndex - 1] : null

  const handleNavigateToItem = (targetItem: Item) => {
    if (!targetItem) return
    // Preserve filter/sort/search params when navigating between items
    const preservedParams: Record<string, string> = {}
    const returnTo = searchParams.get('returnTo')
    const bizItemFilter = searchParams.get('bizItemFilter')
    const bizItemSort = searchParams.get('bizItemSort')
    const bizItemSearch = searchParams.get('bizItemSearch')
    if (returnTo) preservedParams.returnTo = returnTo
    if (bizItemFilter) preservedParams.bizItemFilter = bizItemFilter
    if (bizItemSort) preservedParams.bizItemSort = bizItemSort
    if (bizItemSearch) preservedParams.bizItemSearch = bizItemSearch
    
    // Use replace: true so next/previous navigation doesn't add to history stack
    // This way the back button goes back to the business inventory list, not through all items
    rawNavigate(buildContextUrl(`/business-inventory/${targetItem.itemId}`, preservedParams), { replace: true })
  }
  const [item, setItem] = useState<Item | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [showAllocationModal, setShowAllocationModal] = useState(false)
  const [allocationForm, setAllocationForm] = useState({
    projectId: '',
    space: ''
  })
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [isUpdatingTransaction, setIsUpdatingTransaction] = useState(false)
  const [showRemoveFromTransactionConfirm, setShowRemoveFromTransactionConfirm] = useState(false)
  const [isRemovingFromTransaction, setIsRemovingFromTransaction] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeletingItem, setIsDeletingItem] = useState(false)

  // Image upload state
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)

  // Navigation context logic for basic back navigation
  const backDestination = '/business-inventory' // Always go back to main inventory list

  const refreshRealtimeAfterWrite = useCallback(async () => {
    try {
      await refreshCollections()
    } catch (error) {
      console.debug('BusinessInventoryItemDetail: realtime refresh failed', error)
    }
  }, [refreshCollections])

  // Use duplication hook for business inventory items
  const { duplicateItem } = useDuplication({
    items: item ? [item] : [],
    setItems: (items) => {
      if (typeof items === 'function') {
        setItem(prev => items([prev!])[0] || prev)
      } else if (items.length > 0) {
        setItem(items[0])
      }
    },
    duplicationService: async (itemId: string) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      // Since we're using the unified service, we need to create a duplicate item
      const originalItem = await unifiedItemsService.getItemById(currentAccountId, itemId)
      if (!originalItem) throw new Error('Item not found')

      // Create a new item with similar data but new ID
      const { itemId: originalItemId, dateCreated, lastUpdated, ...itemData } = originalItem
      const result = await unifiedItemsService.createItem(currentAccountId, {
        ...itemData,
        inventoryStatus: 'available',
        projectId: null,
        disposition: 'inventory' // Business inventory duplicates should always stay inventory
      })
      return result.itemId
    }
  })

  // Helper functions
  const formatLinkedProjectText = (projectId: string): string => {
    const project = projects.find(p => p.id === projectId)
    return project ? `${project.name} - ${project.clientName}` : projectId
  }

  useEffect(() => {
    if (id && currentAccountId) {
      loadProjects()
    }
  }, [id, currentAccountId, refreshCollections])

  const loadProjects = async () => {
    if (!currentAccountId) return
    try {
      const projectsData = await projectService.getProjects(currentAccountId)
      setProjects(projectsData)
    } catch (error) {
      console.error('Error loading projects:', error)
    }
  }

  const loadTransactions = async () => {
    if (!currentAccountId) return
    setLoadingTransactions(true)
    try {
      const txs = await transactionService.getBusinessInventoryTransactions(currentAccountId)
      setTransactions(txs)
    } catch (error) {
      console.error('Failed to load transactions:', error)
      alert('Failed to load transactions. Please try again.')
    } finally {
      setLoadingTransactions(false)
    }
  }

  useEffect(() => {
    if (!showTransactionDialog || !currentAccountId) return
    loadTransactions()
  }, [showTransactionDialog, currentAccountId])

  const getCanonicalTransactionTitle = (transaction: Transaction): string => {
    if (transaction.transactionId?.startsWith('INV_SALE_')) {
      return 'Design Business Inventory Sale'
    }
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      return 'Design Business Inventory Purchase'
    }
    return transaction.source
  }

  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: `${project.name} - ${project.clientName}`,
      disabled: project.id === item?.projectId
    })),
    [projects, item?.projectId]
  )

  useEffect(() => {
    if (!id) return
    if (realtimeLoading) return
    setItem(snapshotItem)
  }, [id, realtimeLoading, snapshotItem])

  // Subscribe to lineage edges for this specific business-inventory item and refetch on new edges
  useEffect(() => {
    if (!id || !currentAccountId) return

    const unsubscribe = lineageService.subscribeToItemLineageForItem(currentAccountId, id, async () => {
      try {
        const updated = await unifiedItemsService.getItemById(currentAccountId, id)
        if (updated) {
          setItem(updated)
        }
        await refreshCollections({ force: true })
      } catch (err) {
        console.debug('BusinessInventoryItemDetail - failed to refetch item on lineage event', err)
      }
    })

    return () => {
      try { unsubscribe() } catch (e) { /* noop */ }
    }
  }, [id, currentAccountId])

  const handleRefreshItem = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await refreshCollections({ force: true })
    } catch (error) {
      console.error('Error refreshing item:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const toggleBookmark = async () => {
    if (!item || !currentAccountId) return
    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        bookmark: !item.bookmark
      })
      setItem({ ...item, bookmark: !item.bookmark })
    } catch (error) {
      console.error('Failed to update bookmark:', error)
    }
  }

  const updateDisposition = async (newDisposition: ItemDisposition) => {
    if (!item || !currentAccountId) return
    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        disposition: newDisposition
      })
      setItem({ ...item, disposition: newDisposition })
    } catch (error) {
      console.error('Failed to update disposition:', error)
      alert('Failed to update status. Please try again.')
    }
  }

  const openTransactionDialog = () => {
    setSelectedTransactionId(item?.transactionId ?? '')
    setShowTransactionDialog(true)
  }

  const handleChangeTransaction = async () => {
    if (!item || !currentAccountId || !selectedTransactionId) return

    setIsUpdatingTransaction(true)
    const previousTransactionId = item.transactionId
    let didUpdateItem = false

    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        transactionId: selectedTransactionId
      })
      didUpdateItem = true

      try {
        await lineageService.updateItemLineagePointers(currentAccountId, item.itemId, selectedTransactionId)
      } catch (lineageError) {
        console.warn('Failed to update lineage pointers for item:', item.itemId, lineageError)
      }

      if (previousTransactionId) {
        const { data: oldTxData, error: fetchOldError } = await supabase
          .from('transactions')
          .select('item_ids')
          .eq('account_id', currentAccountId)
          .eq('transaction_id', previousTransactionId)
          .single()

        if (fetchOldError) {
          throw fetchOldError
        }

        if (oldTxData) {
          const currentItemIds: string[] = Array.isArray(oldTxData.item_ids) ? oldTxData.item_ids : []
          const updatedItemIds = currentItemIds.filter(id => id !== item.itemId)

          const { error: updateOldError } = await supabase
            .from('transactions')
            .update({
              item_ids: updatedItemIds,
              updated_at: new Date().toISOString()
            })
            .eq('account_id', currentAccountId)
            .eq('transaction_id', previousTransactionId)

          if (updateOldError) {
            throw updateOldError
          }
        }
      }

      const { data: newTxData, error: fetchNewError } = await supabase
        .from('transactions')
        .select('item_ids')
        .eq('account_id', currentAccountId)
        .eq('transaction_id', selectedTransactionId)
        .single()

      if (fetchNewError) {
        throw fetchNewError
      }

      if (newTxData) {
        const currentItemIds: string[] = Array.isArray(newTxData.item_ids) ? newTxData.item_ids : []
        if (!currentItemIds.includes(item.itemId)) {
          const updatedItemIds = [...currentItemIds, item.itemId]

          const { error: updateNewError } = await supabase
            .from('transactions')
            .update({
              item_ids: updatedItemIds,
              updated_at: new Date().toISOString()
            })
            .eq('account_id', currentAccountId)
            .eq('transaction_id', selectedTransactionId)

          if (updateNewError) {
            throw updateNewError
          }
        }
      }

      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      setShowTransactionDialog(false)
      setSelectedTransactionId('')
    } catch (error) {
      console.error('Failed to update transaction:', error)
      const message = didUpdateItem
        ? 'Item updated, but transaction links could not be updated. Refresh and verify the transaction.'
        : 'Failed to update transaction. Please try again.'
      alert(message)
    } finally {
      setIsUpdatingTransaction(false)
    }
  }

  const handleRemoveFromTransaction = async () => {
    if (!item || !currentAccountId) return
    if (!item.transactionId) return

    setIsRemovingFromTransaction(true)
    try {
      await unifiedItemsService.unlinkItemFromTransaction(currentAccountId, item.transactionId, item.itemId, {
        itemCurrentTransactionId: item.transactionId
      })
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      setShowRemoveFromTransactionConfirm(false)
    } catch (error) {
      console.error('Failed to remove item from transaction:', error)
      alert('Failed to remove item from transaction. Please try again.')
    } finally {
      setIsRemovingFromTransaction(false)
      setShowRemoveFromTransactionConfirm(false)
    }
  }


  const handleDeleteItem = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDeleteItem = async () => {
    if (!id || !item || !currentAccountId) return
    setIsDeletingItem(true)
    try {
      await unifiedItemsService.deleteItem(currentAccountId, id)
      await refreshRealtimeAfterWrite()
      navigate('/business-inventory')
    } catch (error) {
      console.error('Error deleting item:', error)
      alert('Error deleting item. Please try again.')
    } finally {
      setIsDeletingItem(false)
      setShowDeleteConfirm(false)
    }
  }



  const openAllocationModal = () => {
    setShowAllocationModal(true)
  }

  const closeAllocationModal = () => {
    setShowAllocationModal(false)
    setAllocationForm({
      projectId: '',
      space: ''
    })
  }

  const handleAllocationSubmit = async () => {
    if (!id || !allocationForm.projectId || !currentAccountId) return

    setIsUpdating(true)
    try {
      const wasOffline = !isOnline
      await unifiedItemsService.allocateItemToProject(
        currentAccountId,
        id!,
        allocationForm.projectId,
        undefined,
        undefined,
        allocationForm.space
      )
      if (wasOffline) {
        showOfflineSaved(null)
        closeAllocationModal()
        return
      }
      await refreshRealtimeAfterWrite()
      closeAllocationModal()

      // Navigate to the item detail in the project after successful allocation
      if (allocationForm.projectId) {
        navigate(projectItemDetail(allocationForm.projectId, id!))
      }

      // Item will be updated via real-time subscription
    } catch (error) {
      console.error('Error allocating item:', error)
      alert('Error allocating item. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  // Image handling functions
  const handleSelectFromGallery = async () => {
    if (!item || !item.itemId) return

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })

      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        console.log('Selected', files.length, 'files from gallery')

        // Process all selected files sequentially
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          await processImageUpload(file, files)
        }
      } else {
        console.log('No files selected from gallery')
      }
    } catch (error: any) {
      console.error('Error selecting from gallery:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      alert('Failed to add images. Please try again.')
    } finally {
      setUploadsInFlight(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) {
          setUploadProgress(0)
        }
        return next
      })
    }
  }

  const processImageUpload = async (file: File, allFiles?: File[]) => {
    if (!item?.itemId) return

    const uploadResult = await ImageUploadService.uploadItemImage(
      file,
      'Business Inventory',
      item.itemId
    )

    const newImage = {
      url: uploadResult.url,
      alt: file.name,
      isPrimary: item.images?.length === 0, // First image is always primary when added from detail view
      uploadedAt: new Date(),
      fileName: file.name,
      size: file.size,
      mimeType: file.type
    }

    // Update the item with the new image
    if (!currentAccountId) return
    const currentImages = item.images || []
    const updatedImages = [...currentImages, newImage]

    await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
    await refreshRealtimeAfterWrite()

  }

  const handleRemoveImage = async (imageUrl: string) => {
    if (!item?.itemId || !currentAccountId) return

    try {
      // Update in database
      const updatedImages = item.images?.filter(img => img.url !== imageUrl) || []
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
      await refreshRealtimeAfterWrite()

      // Update local state
      setItem({ ...item, images: updatedImages })
    } catch (error) {
      console.error('Error removing image:', error)
      alert('Error removing image. Please try again.')
    }
  }

  const handleSetPrimaryImage = async (imageUrl: string) => {
    if (!item?.itemId || !currentAccountId) return

    try {
      // Update in database
      const updatedImages = item.images?.map(img => ({
        ...img,
        isPrimary: img.url === imageUrl
      })) || []
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
      await refreshRealtimeAfterWrite()

      // Update local state
      setItem({ ...item, images: updatedImages })
    } catch (error) {
      console.error('Error setting primary image:', error)
      alert('Error setting primary image. Please try again.')
    }
  }

  if (realtimeLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="text-center py-12 px-4">
        <Package className="mx-auto h-16 w-16 text-gray-400 -mb-1" />
        <h3 className="text-lg font-medium text-gray-900 mb-1">
          Item not found
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          The item you're looking for doesn't exist or has been deleted.
        </p>
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Inventory
            </ContextBackLink>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Sticky Header Controls */}
      <div className="sticky top-0 bg-gray-50 z-10 px-4 py-2 border-b border-gray-200">
        {/* Back button and controls row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
            <button
              onClick={handleRefreshItem}
              className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Refresh item"
              title="Refresh"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {item.disposition ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                {displayDispositionLabel(item.disposition)}
              </span>
            ) : null}
            <button
              onClick={toggleBookmark}
              className={`inline-flex items-center justify-center p-2 text-sm font-medium transition-colors ${
                item.bookmark
                  ? 'text-red-700 bg-transparent'
                  : 'text-primary-600 bg-transparent'
              } focus:outline-none`}
              title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
            >
              <Bookmark className="h-5 w-5" fill={item.bookmark ? 'currentColor' : 'none'} />
            </button>
            <ItemActionsMenu
              itemId={item.itemId}
              itemProjectId={item.projectId ?? null}
              itemTransactionId={item.transactionId ?? null}
              disposition={item.disposition}
              isPersisted={true}
              currentProjectId={item.projectId ?? null}
              triggerSize="md"
              onEdit={() => {
                navigate(buildContextUrl(`/business-inventory/${id}/edit`))
              }}
              onDuplicate={(quantity) => duplicateItem(item.itemId, quantity)}
              onAddToTransaction={openTransactionDialog}
              onMoveToProject={openAllocationModal}
              onChangeStatus={updateDisposition}
              onDelete={handleDeleteItem}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4">

        {/* Item information */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4">
            <h1 className="text-xl font-semibold text-gray-900">{item.description}</h1>
          </div>

          {/* Item Images */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <ImagePlus className="h-5 w-5 mr-2" />
                Item Images
              </h3>
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={handleSelectFromGallery}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  title="Add images from gallery or camera"
                >
                  <ImagePlus className="h-3 w-3 mr-1" />
                  Add Images
                </button>
                <UploadActivityIndicator isUploading={isUploadingImage} progress={uploadProgress} className="mt-1" />
              </div>
            </div>

            {item.images && item.images.length > 0 ? (
              <ImagePreview
                images={item.images}
                onRemoveImage={handleRemoveImage}
                onSetPrimary={handleSetPrimaryImage}
                maxImages={5}
                size="md"
                showControls={true}
              />
            ) : (
              <div className="text-center py-8">
                <ImagePlus className="mx-auto h-8 w-8 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No images uploaded</h3>
              </div>
            )}
          </div>

          {/* Item Details */}
          <div className="px-6 py-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Item Details
            </h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-3">
              {item.source && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Source</dt>
                  <dd className="mt-1 text-sm text-gray-900 capitalize">{item.source}</dd>
                </div>
              )}

              {item.sku && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">SKU</dt>
                  <dd className="mt-1 text-sm text-gray-900">{item.sku}</dd>
                </div>
              )}

              {item.purchasePrice && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Purchase Price</dt>
                  <p className="text-xs text-gray-500 mt-1">What the item was purchased for</p>
                  <dd className="mt-1 text-sm text-gray-900 font-medium">${item.purchasePrice}</dd>
                </div>
              )}

              {item.projectPrice && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Project Price</dt>
                  <p className="text-xs text-gray-500 mt-1">What the client is charged</p>
                  <dd className="mt-1 text-sm text-gray-900 font-medium">${item.projectPrice}</dd>
                </div>
              )}

              {item.marketValue && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Market Value</dt>
                  <p className="text-xs text-gray-500 mt-1">The fair market value of the item</p>
                  <dd className="mt-1 text-sm text-gray-900 font-medium">${item.marketValue}</dd>
                </div>
              )}

              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    item.inventoryStatus === 'available'
                      ? 'bg-green-100 text-green-800'
                      : item.inventoryStatus === 'allocated'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {item.inventoryStatus === 'available' ? 'Available' :
                     item.inventoryStatus === 'allocated' ? 'Allocated' : 'Sold'}
                  </span>
                </dd>
              </div>

              {item.businessInventoryLocation && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Location</dt>
                  <dd className="mt-1 text-sm text-gray-900">{item.businessInventoryLocation}</dd>
                </div>
              )}

              {item.notes && item.notes !== 'No notes' && (
                <div className="sm:col-span-3">
                  <dt className="text-sm font-medium text-gray-500">Notes</dt>
                  <dd className="mt-1 text-sm text-gray-900 bg-gray-50 p-3 rounded-md">{item.notes}</dd>
                </div>
              )}
            </dl>
          </div>


          {/* Metadata */}
          <div className="px-6 py-4 bg-gray-50">
            <div className="relative">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date Added</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(item.dateCreated)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Last Updated</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(item.lastUpdated)}</dd>
                </div>

                {item.projectId && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Project</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <ContextLink
                        to={buildContextUrl(projectItems(item.projectId), { from: 'business-inventory-item' })}
                        className="text-primary-600 hover:text-primary-800 font-medium"
                      >
                        {formatLinkedProjectText(item.projectId)}
                      </ContextLink>
                    </dd>
                  </div>
                )}

                {item.transactionId && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">TRANSACTION</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <ContextLink
                        to={buildContextUrl(projectTransactionDetail(item.projectId, item.transactionId), { from: 'business-inventory-item' })}
                        className="text-primary-600 hover:text-primary-800 font-medium"
                      >
                        {item.transactionId}
                      </ContextLink>
                    </dd>
                  </div>
                )}

                {/* Lineage breadcrumb (compact) */}
                {item.itemId && (
                  <div className="sm:col-span-3 mt-2">
                    <ItemLineageBreadcrumb itemId={item.itemId} />
                  </div>
                )}

                {item.previousProjectTransactionId && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Original Transaction</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {item.previousProjectId ? (
                        <ContextLink
                          to={buildContextUrl(projectTransactionDetail(item.previousProjectId, item.previousProjectTransactionId), { from: 'business-inventory-item' })}
                          className="text-primary-600 hover:text-primary-800 font-medium"
                        >
                          {item.previousProjectTransactionId}
                        </ContextLink>
                      ) : (
                        <span>{item.previousProjectTransactionId}</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

            </div>
          </div>
        </div>
      </div>


      {/* Transaction Change Dialog */}
      {showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {item?.transactionId ? 'Change Transaction' : 'Assign to Transaction'}
              </h3>
            </div>
            <div className="px-6 py-4">
              <Combobox
                label="Select Transaction"
                value={selectedTransactionId}
                onChange={setSelectedTransactionId}
                disabled={loadingTransactions || isUpdatingTransaction}
                loading={loadingTransactions}
                placeholder={loadingTransactions ? "Loading transactions..." : "Select a transaction"}
                options={
                  loadingTransactions ? [] : [
                    { id: '', label: 'Select a transaction' },
                    ...transactions.map((transaction) => ({
                      id: transaction.transactionId,
                      label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${getCanonicalTransactionTitle(transaction)} - $${transaction.amount}`
                    }))
                  ]
                }
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap justify-between gap-3">
              {item?.transactionId ? (
                <button
                  onClick={() => {
                    setShowTransactionDialog(false)
                    setShowRemoveFromTransactionConfirm(true)
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
                  disabled={isUpdatingTransaction}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowTransactionDialog(false)
                    setSelectedTransactionId('')
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={isUpdatingTransaction}
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangeTransaction}
                  disabled={!selectedTransactionId || isUpdatingTransaction}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpdatingTransaction ? 'Updating...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BlockingConfirmDialog
        open={showRemoveFromTransactionConfirm}
        title="Remove item from transaction?"
        description={
          <div className="text-sm text-gray-700 space-y-2">
            <p>This will remove the item from this transaction.</p>
            <p className="text-gray-600">The item will not be deleted.</p>
          </div>
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirming={isRemovingFromTransaction}
        onCancel={() => {
          if (isRemovingFromTransaction) return
          setShowRemoveFromTransactionConfirm(false)
        }}
        onConfirm={handleRemoveFromTransaction}
      />

      <BlockingConfirmDialog
        open={showDeleteConfirm}
        title="Delete item?"
        description={
          <div className="text-sm text-gray-700 space-y-2">
            <p>This will permanently delete the item.</p>
            <p className="text-gray-600">This action cannot be undone.</p>
          </div>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirming={isDeletingItem}
        onCancel={() => {
          if (isDeletingItem) return
          setShowDeleteConfirm(false)
        }}
        onConfirm={confirmDeleteItem}
      />

      {/* Allocation Modal */}
      {showAllocationModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Allocate Item to Project</h3>

              <div className="space-y-4">
                <Combobox
                  label="Select Project"
                  value={allocationForm.projectId}
                  onChange={(nextProjectId) => {
                    setAllocationForm(prev => ({ ...prev, projectId: nextProjectId }))
                  }}
                  options={projectOptions}
                  placeholder={projectOptions.length > 0 ? 'Select a project' : 'No projects available'}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700">Space (optional)</label>
                  <input
                    type="text"
                    value={allocationForm.space}
                    onChange={(e) => setAllocationForm(prev => ({ ...prev, space: e.target.value }))}
                    placeholder="e.g. Living Room, Bedroom"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  />
                </div>

              </div>

                <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeAllocationModal}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                    onClick={handleAllocationSubmit}
                    disabled={!allocationForm.projectId || isUpdating}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                >
                  {isUpdating ? 'Allocating...' : 'Allocate Item'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky bottom navigation bar */}
      {item && (nextItem || previousItem) && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 z-10 px-4 py-1.5 shadow-md">
          <div className="max-w-7xl mx-auto">
            {(filterMode !== 'all' || sortMode !== 'creationDate' || inventorySearchQuery.trim()) && (
              <div className="text-[10px] text-gray-500 mb-1 text-center">
                {[
                  inventorySearchQuery.trim() ? `Search: "${inventorySearchQuery.trim()}"` : null,
                  filterMode !== 'all' ? `Filter: ${filterMode}` : null,
                  sortMode !== 'creationDate' ? `Sort: ${sortMode}` : null
                ].filter(Boolean).join(' / ')}
              </div>
            )}
            <div className="flex items-center justify-between">
            <button
              onClick={() => previousItem && handleNavigateToItem(previousItem)}
              disabled={!previousItem}
              className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded transition-colors ${
                previousItem
                  ? 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                  : 'text-gray-400 bg-gray-50 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
              Previous
            </button>
            
            <span className="text-xs text-gray-500">
              {currentIndex >= 0 && filteredAndSortedItems.length > 0
                ? `${currentIndex + 1} of ${filteredAndSortedItems.length}`
                : ''}
            </span>
            
            <button
              onClick={() => nextItem && handleNavigateToItem(nextItem)}
              disabled={!nextItem}
              className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded transition-colors ${
                nextItem
                  ? 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                  : 'text-gray-400 bg-gray-50 cursor-not-allowed'
              }`}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
