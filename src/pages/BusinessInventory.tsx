import { Plus, Search, Package, Receipt, Filter, QrCode, Trash2, Camera, DollarSign, ArrowUpDown, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { Item, Transaction, ItemImage, Project, ItemDisposition } from '@/types'
import type { Transaction as TransactionType } from '@/types'
import { unifiedItemsService, projectService, integrationService } from '@/services/inventoryService'
import { useToast } from '@/components/ui/ToastContext'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { useNetworkState } from '@/hooks/useNetworkState'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'
import { formatCurrency, formatDate } from '@/utils/dateUtils'
import { COMPANY_INVENTORY, COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE } from '@/constants/company'
import { useBookmark } from '@/hooks/useBookmark'
import { useDuplication } from '@/hooks/useDuplication'
import { useAccount } from '@/contexts/AccountContext'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import InventoryItemRow from '@/components/items/InventoryItemRow'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'

interface FilterOptions {
  status?: string
  searchQuery?: string
}

export default function BusinessInventory() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const { items: snapshotItems, transactions: snapshotTransactions, isLoading: realtimeLoading, refreshCollections } =
    useBusinessInventoryRealtime()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const { buildContextUrl } = useNavigationContext()
  const stackedNavigate = useStackedNavigate()
  const [activeTab, setActiveTab] = useState<'inventory' | 'transactions'>('inventory')
  const [items, setItems] = useState<Item[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filters] = useState<FilterOptions>({
    status: '',
    searchQuery: ''
  })
  const handleNavigateToEdit = useCallback(
    (href: string) => {
      if (!href || href === '#') return
      stackedNavigate(buildContextUrl(href))
    },
    [buildContextUrl, stackedNavigate]
  )

  const [inventorySearchQuery, setInventorySearchQuery] = useState<string>('')
  const [transactionSearchQuery, setTransactionSearchQuery] = useState<string>('')

  // Filter state for transactions tab
  const [showTransactionFilterMenu, setShowTransactionFilterMenu] = useState(false)
  const [transactionFilterMode, setTransactionFilterMode] = useState<'all' | 'pending' | 'completed' | 'canceled' | 'inventory-only'>('all')

  // Image upload state
  const [uploadingImages, setUploadingImages] = useState<Set<string>>(new Set())

  // Filter and selection state for inventory items (matching InventoryList.tsx)
  const [filterMode, setFilterMode] = useState<
    'all'
    | 'bookmarked'
    | 'no-sku'
    | 'no-description'
    | 'no-project-price'
    | 'no-image'
    | 'no-transaction'
  >('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortMode, setSortMode] = useState<'alphabetical' | 'creationDate'>('creationDate')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [openDispositionMenu, setOpenDispositionMenu] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()
  const { showOfflineSaved } = useOfflineFeedback()
  const { isOnline } = useNetworkState()

  // Batch allocation state
  const [projects, setProjects] = useState<Project[]>([])
  const [showBatchAllocationModal, setShowBatchAllocationModal] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [batchAllocationForm, setBatchAllocationForm] = useState({
    projectId: '',
    space: ''
  })
  const [isAllocating, setIsAllocating] = useState(false)

  // Close filter menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if ((showFilterMenu || showTransactionFilterMenu || showSortMenu) && !event.target) return

      const target = event.target as Element
      if (!target.closest('.filter-menu') && !target.closest('.filter-button') && !target.closest('.transaction-filter-menu') && !target.closest('.transaction-filter-button') && !target.closest('.sort-menu') && !target.closest('.sort-button')) {
        setShowFilterMenu(false)
        setShowTransactionFilterMenu(false)
        setShowSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterMenu, showTransactionFilterMenu, showSortMenu])

  // Close disposition menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDispositionMenu && !event.target) return

      const target = event.target as Element
      if (!target.closest('.disposition-menu') && !target.closest('.disposition-badge')) {
        setOpenDispositionMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDispositionMenu])


  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    try {
      const item = items.find((it: Item) => it.itemId === itemId)
      if (!item) {
        console.error('Item not found for disposition update:', itemId)
        return
      }

      if (!currentAccountId) throw new Error('Account ID is required')
      const wasOffline = !isOnline
      await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: newDisposition })

      if (newDisposition === 'inventory') {
        try {
          await integrationService.handleItemDeallocation(currentAccountId, itemId, item.projectId || '', newDisposition)
          setOpenDispositionMenu(null)
          if (wasOffline) {
            showOfflineSaved(null)
          } else {
            showSuccess && showSuccess('Item moved to inventory')
          }
          await refreshRealtimeAfterWrite()
        } catch (deallocationError) {
          console.error('Failed to handle deallocation:', deallocationError)
          await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: item.disposition })
          showError && showError('Failed to move item to inventory. Please try again.')
          return
        }
      } else {
        setItems(prev => prev.map(i => i.itemId === itemId ? { ...i, disposition: newDisposition } : i))
        setOpenDispositionMenu(null)
        if (wasOffline) {
          showOfflineSaved(null)
        }
        await refreshRealtimeAfterWrite()
      }
    } catch (error) {
      console.error('Failed to update disposition:', error)
      showError && showError('Failed to update disposition. Please try again.')
    }
  }

  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    return value.trim().length > 0 && Number.isFinite(Number.parseFloat(value))
  }

  // Compute filtered items (matching InventoryList.tsx)
  const filteredItems = useMemo(() => {
    let filtered = items.filter(item => {
      // Apply search filter
      const matchesSearch = !inventorySearchQuery ||
        item.description?.toLowerCase().includes(inventorySearchQuery.toLowerCase()) ||
        item.sku?.toLowerCase().includes(inventorySearchQuery.toLowerCase()) ||
        item.businessInventoryLocation?.toLowerCase().includes(inventorySearchQuery.toLowerCase())

      // Apply status filter
      const matchesStatus = !filters.status || item.inventoryStatus === filters.status

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

      return matchesSearch && matchesStatus && matchesFilter
    })

    // Apply sorting
    filtered.sort((a, b) => {
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

    return filtered
  }, [items, inventorySearchQuery, filters.status, filterMode, sortMode])

  // Group filtered items by their grouping key
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>()

    filteredItems.forEach(item => {
      const groupKey = getInventoryListGroupKey(item, 'businessInventory')
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    })

    // Convert to array - items are already sorted in filteredItems
    return Array.from(groups.entries())
      .map(([groupKey, items]) => ({ groupKey, items }))
  }, [filteredItems])

  // Compute filtered transactions
  const filteredTransactions = useMemo(() => {
    let filtered = transactions

    // Apply status filter based on filter mode
    if (transactionFilterMode !== 'all') {
      if (transactionFilterMode === 'inventory-only') {
        // Show only business inventory transactions (projectId == null)
        filtered = filtered.filter(t => t.projectId === null)
      } else {
        // Apply status filter for other modes
        filtered = filtered.filter(t => t.status === transactionFilterMode)
      }
    }

    // Apply search filter
    if (transactionSearchQuery) {
      const query = transactionSearchQuery.toLowerCase()
      filtered = filtered.filter(t =>
        t.source?.toLowerCase().includes(query) ||
        t.transactionType?.toLowerCase().includes(query) ||
        t.projectName?.toLowerCase().includes(query) ||
        t.notes?.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [transactions, transactionFilterMode, transactionSearchQuery])

  const inventoryValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const rawValue = item.projectPrice ?? item.purchasePrice ?? 0
      const parsed = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue)
      return sum + (Number.isFinite(parsed) ? parsed : 0)
    }, 0)
  }, [items])

  // Canonical transaction title for display only
  const getCanonicalTransactionTitle = (transaction: TransactionType): string => {
    if (transaction.transactionId?.startsWith('INV_SALE_')) return COMPANY_INVENTORY_SALE
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) return COMPANY_INVENTORY_PURCHASE
    return transaction.source
  }

  const tabs = [
    { id: 'inventory' as const, name: 'Items', icon: Package },
    { id: 'transactions' as const, name: 'Transactions', icon: Receipt }
  ]

  const refreshRealtimeAfterWrite = useCallback(async () => {
    try {
      await refreshCollections()
    } catch (error) {
      console.debug('BusinessInventory: realtime refresh failed', error)
    }
  }, [refreshCollections])

  useEffect(() => {
    setItems(snapshotItems)
  }, [snapshotItems])

  useEffect(() => {
    setTransactions(snapshotTransactions)
  }, [snapshotTransactions])

  useEffect(() => {
    const loadProjects = async () => {
      if (!currentAccountId) {
        setProjects([])
        return
      }
      try {
        const projectsData = await projectService.getProjects(currentAccountId)
        setProjects(projectsData)
      } catch (error) {
        console.error('Error loading projects:', error)
        setProjects([])
      }
    }

    loadProjects()
  }, [currentAccountId])

  // Per-visible-item lineage subscriptions: refetch single item on new edges to keep list in sync
  useEffect(() => {
    if (!currentAccountId || items.length === 0) return

    const unsubMap = new Map<string, () => void>()
    try {
      items.forEach(item => {
        if (!item?.itemId) return
        const unsub = lineageService.subscribeToItemLineageForItem(currentAccountId, item.itemId, async () => {
          try {
            const updatedItem = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
            if (updatedItem) {
              // If it is still a business inventory item, update it; otherwise remove it from the list
              if (!updatedItem.projectId) {
                setItems(prev => prev.map(i => i.itemId === updatedItem.itemId ? updatedItem : i))
              } else {
                setItems(prev => prev.filter(i => i.itemId !== updatedItem.itemId))
              }
              // Also refresh transactions to ensure deletions/creations are reflected
              try {
                await refreshCollections({ force: true })
              } catch (tErr) {
                console.debug('BusinessInventory - failed to reload transactions after lineage event', tErr)
              }
            }
          } catch (err) {
            console.debug('BusinessInventory - failed to refetch item on lineage event', err)
          }
        })
        unsubMap.set(item.itemId, unsub)
      })
    } catch (err) {
      console.debug('BusinessInventory - failed to setup per-item lineage subscriptions', err)
    }

    return () => {
      unsubMap.forEach(u => {
        try { u() } catch (e) { /* noop */ }
      })
    }
  }, [items.map(i => i.itemId).join(','), currentAccountId, refreshCollections])

  // Reset uploading state on unmount to prevent hanging state
  useEffect(() => {
    return () => {
      setUploadingImages(new Set())
    }
  }, [])

  const handleRefreshInventory = useCallback(async () => {
    if (!currentAccountId || isRefreshing) return
    setIsRefreshing(true)
    try {
      const [projectsData] = await Promise.all([
        projectService.getProjects(currentAccountId),
        refreshCollections({ force: true })
      ])
      setProjects(projectsData)
    } catch (error) {
      console.error('Error refreshing business inventory data:', error)
      showError && showError('Failed to refresh business inventory. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }, [currentAccountId, isRefreshing, refreshCollections, showError])


  const handleInventorySearchChange = (searchQuery: string) => {
    setInventorySearchQuery(searchQuery)
  }

  // Use centralized bookmark hook
  const { toggleBookmark } = useBookmark<Item>({
    items,
    setItems,
    updateItemService: (itemId: string, updates: Partial<Item>) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      return unifiedItemsService.updateItem(currentAccountId, itemId, updates)
    }
  })

  // Use duplication hook for business inventory items
  const { duplicateItem } = useDuplication({
    items,
    setItems,
    duplicationService: async (itemId: string) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      // Since we're using the unified service, we need to create a duplicate item
      const originalItem = await unifiedItemsService.getItemById(currentAccountId, itemId)
      if (!originalItem) throw new Error('Item not found')

      // Create a new item with similar data but new ID
      // Rename destructured `itemId` to `originalItemId` to avoid redeclaring the `itemId` parameter
      const { itemId: originalItemId, dateCreated, lastUpdated, ...itemData } = originalItem
      const result = await unifiedItemsService.createItem(currentAccountId, {
        ...itemData,
        inventoryStatus: 'available',
        projectId: null,
        disposition: 'inventory' // Business inventory duplicates should always be marked inventory
      })
      return result.itemId
    },
    onDuplicateComplete: async (newItemIds: string[]) => {
      if (!currentAccountId || newItemIds.length === 0) return

      try {
        const fetchedItems = await Promise.all(
          newItemIds.map(async (newItemId) => {
            try {
              return await unifiedItemsService.getItemById(currentAccountId, newItemId)
            } catch (error) {
              console.debug('BusinessInventory - failed to fetch duplicated item', error)
              return null
            }
          })
        )

        const newItems = fetchedItems.filter((item): item is Item => item !== null && !item.projectId)
        if (newItems.length > 0) {
          setItems(prev => {
            const existingIds = new Set(prev.map(item => item.itemId))
            const uniqueNewItems = newItems.filter(item => !existingIds.has(item.itemId))
            if (uniqueNewItems.length === 0) return prev
            return [...uniqueNewItems, ...prev]
          })
          return
        }
      } catch (error) {
        console.debug('BusinessInventory - failed to insert duplicated items', error)
      }

      try {
        const refreshedItems = await unifiedItemsService.getBusinessInventoryItems(currentAccountId, filters)
        setItems(refreshedItems)
      } catch (error) {
        console.debug('BusinessInventory - failed to refresh after duplication', error)
      }
    }
  })

  // Batch allocation functions
  const openBatchAllocationModal = () => {
    setShowBatchAllocationModal(true)
  }

  const closeBatchAllocationModal = () => {
    setShowBatchAllocationModal(false)
    setShowProjectDropdown(false)
    setBatchAllocationForm({
      projectId: '',
      space: ''
    })
  }

  const getSelectedProjectName = () => {
    const selectedProject = projects.find(p => p.id === batchAllocationForm.projectId)
    return selectedProject ? `${selectedProject.name} - ${selectedProject.clientName}` : 'Select a project...'
  }

  const handleBatchAllocationSubmit = async () => {
    if (!batchAllocationForm.projectId || selectedItems.size === 0 || !currentAccountId) return

    setIsAllocating(true)
    try {
      const itemIds = Array.from(selectedItems)
      await unifiedItemsService.batchAllocateItemsToProject(
        currentAccountId,
        itemIds,
        batchAllocationForm.projectId,
        {
          space: batchAllocationForm.space
        }
      )

      // Clear selections and close modal
      setSelectedItems(new Set())
      closeBatchAllocationModal()

      // Show success message
      alert(`Successfully allocated ${itemIds.length} items to project!`)
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Error batch allocating items:', error)
      alert('Error allocating items. Please try again.')
    } finally {
      setIsAllocating(false)
    }
  }

  const handleDeleteSelectedItems = async () => {
    if (selectedItems.size === 0 || !currentAccountId) return

    const itemCount = selectedItems.size
    const confirmMessage = itemCount === 1
      ? 'Are you sure you want to delete this item? This action cannot be undone.'
      : `Are you sure you want to delete ${itemCount} items? This action cannot be undone.`

    if (!window.confirm(confirmMessage)) {
      return
    }

    const itemIds = Array.from(selectedItems)

    try {
      let successCount = 0
      let errorCount = 0
      const successfullyDeletedIds: string[] = []

      // Delete items one by one
      for (const itemId of itemIds) {
        try {
          await unifiedItemsService.deleteItem(currentAccountId, itemId)
          successCount++
          successfullyDeletedIds.push(itemId)
        } catch (error) {
          console.error(`Error deleting item ${itemId}:`, error)
          errorCount++
        }
      }

      if (successfullyDeletedIds.length > 0) {
        setItems(prevItems => prevItems.filter(item => !successfullyDeletedIds.includes(item.itemId)))
        setSelectedItems(prevSelected => {
          const updatedSelection = new Set(prevSelected)
          successfullyDeletedIds.forEach(id => updatedSelection.delete(id))
          return updatedSelection
        })
      }

      if (errorCount > 0) {
        // If there were errors, reload the items to make sure state reflects the server
        await refreshCollections({ force: true })
      }
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Error deleting items:', error)
      // Reload items on error to restore state
      await refreshCollections({ force: true })
      alert('Error deleting items. Please try again.')
    }
  }

  // Image handling functions
  const handleAddImage = async (itemId: string) => {
    try {
      setUploadingImages(prev => new Set(prev).add(itemId))

      const files = await ImageUploadService.selectFromGallery()

      if (files.length > 0) {
        // Process all selected files sequentially
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          await processImageUpload(itemId, file, files)
        }
        await refreshRealtimeAfterWrite()
      }
    } catch (error: any) {
      console.error('Error adding image:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      alert('Failed to add image. Please try again.')
    } finally {
      setUploadingImages(prev => {
        const newSet = new Set(prev)
        newSet.delete(itemId)
        return newSet
      })
    }
  }

  const processImageUpload = async (itemId: string, file: File, allFiles?: File[]) => {
    const uploadResult = await ImageUploadService.uploadItemImage(
      file,
      'Business Inventory',
      itemId
    )

    const newImage: ItemImage = {
      url: uploadResult.url,
      alt: file.name,
      isPrimary: true, // First image is always primary when added from list
      uploadedAt: new Date(),
      fileName: file.name,
      size: file.size,
      mimeType: file.type
    }

    // Update the item with the new image
    if (!currentAccountId) throw new Error('Account ID is required')
    await unifiedItemsService.updateItem(currentAccountId, itemId, { images: [newImage] })

    // Show success notification on the last file
    if (allFiles && allFiles.indexOf(file) === allFiles.length - 1) {
      const message = allFiles.length > 1 ? `${allFiles.length} images uploaded successfully!` : 'Image uploaded successfully!'
      alert(message)
    }
  }


  // Filter handlers (matching InventoryList.tsx)
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(filteredItems.map(item => item.itemId)))
    } else {
      setSelectedItems(new Set())
    }
  }

  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(itemId)
    } else {
      newSelected.delete(itemId)
    }
    setSelectedItems(newSelected)
  }

  const handleSelectGroup = (groupItems: Item[], checked: boolean) => {
    const newSelected = new Set(selectedItems)
    groupItems.forEach(item => {
      if (checked) {
        newSelected.add(item.itemId)
      } else {
        newSelected.delete(item.itemId)
      }
    })
    setSelectedItems(newSelected)
  }

  const getGroupSelectionState = (groupItems: Item[]) => {
    const selectedInGroup = groupItems.filter(item => selectedItems.has(item.itemId)).length
    if (selectedInGroup === 0) return 'unchecked'
    if (selectedInGroup === groupItems.length) return 'checked'
    return 'indeterminate'
  }

  const isLoading = accountLoading || realtimeLoading

  // Guard against no account when not loading
  if (!isLoading && !accountLoading && !currentAccountId) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Business Inventory</h1>
        </div>
        <div className="bg-white shadow rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="px-4 py-5 sm:p-6">
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-yellow-600" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No Account Selected
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Please select or create an account to manage inventory.
              </p>
              <div className="mt-6">
                <Link
                  to="/settings"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{COMPANY_INVENTORY}</h1>
            <button
              onClick={handleRefreshInventory}
              className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Refresh business inventory"
              title="Refresh"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-sm text-gray-500">Track items held by the business outside active projects.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div>
              <div className="text-sm text-gray-500">Items</div>
              <div className="text-2xl font-semibold text-gray-900">{items.length}</div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div>
              <div className="text-sm text-gray-500">Inventory Value</div>
              <div className="text-2xl font-semibold text-gray-900">{formatCurrency(inventoryValue)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white shadow rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-base flex items-center ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {tab.name}
                </button>
              )
            })}
          </nav>
        </div>


        {/* Tab Content */}
        <div className="px-6 py-6">
          {activeTab === 'inventory' && (
            <>
              {/* Header - Just Add Item button */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-2">
                <ContextLink
                  to={buildContextUrl('/business-inventory/add')}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-200 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </ContextLink>
              </div>

              {/* Search and Controls - Sticky Container */}
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 pb-0 mb-2">
                <div className="space-y-0">
                  {/* Search Bar */}
                  <div className="relative pt-2">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base"
                      placeholder="Search items by description, SKU, or location..."
                      value={inventorySearchQuery || ''}
                      onChange={(e) => handleInventorySearchChange(e.target.value)}
                    />
                  </div>

          {/* Select All and Bulk Actions */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg">
            {/* Select All */}
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                onChange={(e) => handleSelectAll(e.target.checked)}
                checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
              />
              <span className="ml-3 text-sm font-medium text-gray-700">Select all</span>
            </label>

            {/* Right section - counter and buttons */}
            <div className="flex items-center gap-3">

              {/* Bulk action buttons */}
              <div className="flex items-center space-x-2">
                {/* Sort Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className={`sort-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                      sortMode === 'alphabetical'
                        ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                        : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
                    }`}
                    title="Sort items"
                  >
                    <ArrowUpDown className="h-4 w-4 mr-2" />
                    Sort
                  </button>

                  {/* Sort Dropdown Menu */}
                  {showSortMenu && (
                    <div className="sort-menu absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            setSortMode('alphabetical')
                            setShowSortMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            sortMode === 'alphabetical' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          Alphabetical
                        </button>
                        <button
                          onClick={() => {
                            setSortMode('creationDate')
                            setShowSortMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            sortMode === 'creationDate' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          Creation Date
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Filter Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    className={`filter-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                      filterMode === 'all'
                        ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                        : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
                    }`}
                    title="Filter items"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Filter
                  </button>

                  {/* Filter Dropdown Menu */}
                  {showFilterMenu && (
                    <div className="filter-menu absolute top-full right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            setFilterMode('all')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          All Items
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('bookmarked')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'bookmarked' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          Bookmarked Only
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-sku')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-sku' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No SKU
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-description')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-description' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Description
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-project-price')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-project-price' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Project Price
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-image')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-image' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Image
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-transaction')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-transaction' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Transaction
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Allocate to Project Button */}
                <button
                  onClick={openBatchAllocationModal}
                  className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
                  disabled={selectedItems.size === 0}
                  title="Allocate selected items to project"
                >
                  <DollarSign className="h-4 w-4" />
                </button>

                {ENABLE_QR && (
                  <button
                    className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors duration-200"
                    disabled={selectedItems.size === 0}
                    title="Generate QR Codes"
                  >
                    <QrCode className="h-4 w-4" />
                  </button>
                )}

                <button
                  onClick={handleDeleteSelectedItems}
                  className="inline-flex items-center justify-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200"
                  disabled={selectedItems.size === 0}
                  title="Delete Selected Items"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

              {/* Items List */}
              {filteredItems.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">📦</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">
                    No items found
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {inventorySearchQuery || filters.status || filterMode === 'bookmarked'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'No items found.'
                    }
                  </p>
                </div>
              ) : (
                <div className="bg-white shadow overflow-hidden sm:rounded-md">
                  <ul className="divide-y divide-gray-200">
                    {groupedItems.map(({ groupKey, items: groupItems }, groupIndex) => {
                      // Single item - render directly
                      if (groupItems.length === 1) {
                        const item = groupItems[0]
                        return (
                          <InventoryItemRow
                            key={item.itemId}
                            item={item}
                            isSelected={selectedItems.has(item.itemId)}
                            onSelect={handleSelectItem}
                            onBookmark={toggleBookmark}
                            onDuplicate={duplicateItem}
                            onEdit={handleNavigateToEdit}
                            onDispositionUpdate={updateDisposition}
                            onAddImage={handleAddImage}
                            uploadingImages={uploadingImages}
                            openDispositionMenu={openDispositionMenu}
                            setOpenDispositionMenu={setOpenDispositionMenu}
                            context="businessInventory"
                            itemNumber={groupIndex + 1}
                          />
                        )
                      }

                      // Multiple items - render as collapsed group
                      const firstItem = groupItems[0]
                      const groupSelectionState = getGroupSelectionState(groupItems)
                      const hasAnyPrice = firstItem.projectPrice || firstItem.purchasePrice
                      const totalPrice = groupItems.reduce((sum, item) => {
                        const price = parseFloat(item.projectPrice || item.purchasePrice || '0') || 0
                        return sum + price
                      }, 0)
                      const firstItemPrice = parseFloat(firstItem.projectPrice || firstItem.purchasePrice || '0') || 0

                      // Component to handle transaction display info for grouped items
                      const GroupedItemSummary = () => {
                        const { buildContextUrl } = useNavigationContext()
                        const [transactionDisplayInfo, setTransactionDisplayInfo] = useState<{title: string, amount: string} | null>(null)
                        const [transactionRoute, setTransactionRoute] = useState<{path: string, projectId: string | null} | null>(null)

                        useEffect(() => {
                          const fetchTransactionData = async () => {
                            if (firstItem.transactionId && currentAccountId) {
                              const [displayInfo, route] = await Promise.all([
                                getTransactionDisplayInfo(currentAccountId, firstItem.transactionId, 20),
                                getTransactionRoute(firstItem.transactionId, currentAccountId, null)
                              ])
                              setTransactionDisplayInfo(displayInfo)
                              setTransactionRoute(route)
                            } else {
                              setTransactionDisplayInfo(null)
                              setTransactionRoute(null)
                            }
                          }

                          fetchTransactionData()
                        }, [firstItem.transactionId, currentAccountId])

                        return (
                          <>
                            {/* Left column: Image */}
                            <div className="flex-shrink-0">
                              {firstItem.images && firstItem.images.length > 0 ? (
                                <img
                                  src={firstItem.images.find(img => img.isPrimary)?.url || firstItem.images[0].url}
                                  alt={firstItem.images[0].alt || firstItem.images[0].fileName}
                                  className="h-12 w-12 rounded-md object-cover border border-gray-200"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                                  <Camera className="h-5 w-5" />
                                </div>
                              )}
                            </div>

                            {/* Right column: Text content */}
                            <div className="flex-1 min-w-0">
                              <div>
                                {firstItem.description && (
                                  <h4 className="text-sm font-medium text-gray-900 mb-1">
                                    {firstItem.description}
                                  </h4>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                                  {/* SKU and conditional transaction/source display */}
                                  <div>
                                    {firstItem.sku && <span className="font-medium">SKU: {firstItem.sku}</span>}
                                    {(firstItem.sku || transactionDisplayInfo || firstItem.source) && <span className="mx-2 text-gray-400">•</span>}
                                    {transactionDisplayInfo ? (
                                      <span
                                        className="inline-flex items-center text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer hover:underline"
                                        title={`View transaction: ${transactionDisplayInfo.title}`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          if (transactionRoute) {
                                            window.location.href = buildContextUrl(
                                              transactionRoute.path,
                                              transactionRoute.projectId ? { project: transactionRoute.projectId } : undefined
                                            )
                                          }
                                        }}
                                      >
                                        <Receipt className="h-3 w-3 mr-1" />
                                        {transactionDisplayInfo.title} {transactionDisplayInfo.amount}
                                      </span>
                                    ) : (
                                      firstItem.source && <span className="text-xs font-medium text-gray-600">{firstItem.source}</span>
                                    )}
                                  </div>
                                  {firstItem.marketValue && (
                                    <div>
                                      <span className="font-medium">Market Value:</span> {formatCurrency(parseFloat(firstItem.marketValue.toString()))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </>
                        )
                      }

                      return (
                        <li key={groupKey} className="relative">
                          <CollapsedDuplicateGroup
                            groupId={groupKey}
                            count={groupItems.length}
                            selectionState={groupSelectionState}
                            onToggleSelection={(checked) => handleSelectGroup(groupItems, checked)}
                            topRowContent={
                              hasAnyPrice && (
                                <span className="text-sm text-gray-500">
                                  {formatCurrency(totalPrice)}
                                  {groupItems.length > 1 && totalPrice !== firstItemPrice && (
                                    <span className="text-xs text-gray-400">
                                      {' ('}{formatCurrency(totalPrice / groupItems.length)} each)
                                    </span>
                                  )}
                                </span>
                              )
                            }
                            summary={<GroupedItemSummary />}
                          >
                            {/* Render individual items in the expanded group */}
                            <ul className="divide-y divide-gray-200 rounded-lg overflow-visible list-none p-0 m-0">
                              {groupItems.map((item, itemIndex) => (
                                <InventoryItemRow
                                  key={item.itemId}
                                  item={item}
                                  isSelected={selectedItems.has(item.itemId)}
                                  onSelect={handleSelectItem}
                                  onBookmark={toggleBookmark}
                                  onDuplicate={duplicateItem}
                                  onEdit={handleNavigateToEdit}
                                  onDispositionUpdate={updateDisposition}
                                  onAddImage={handleAddImage}
                                  uploadingImages={uploadingImages}
                                  openDispositionMenu={openDispositionMenu}
                                  setOpenDispositionMenu={setOpenDispositionMenu}
                                  context="businessInventory"
                                  itemNumber={groupIndex + 1}
                                  duplicateCount={groupItems.length}
                                  duplicateIndex={itemIndex + 1}
                                />
                              ))}
                            </ul>
                          </CollapsedDuplicateGroup>

                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </>
          )}

          {activeTab === 'transactions' && (
            <>
              {/* Header - Add Transaction button */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                <ContextLink
                  to={buildContextUrl('/business-inventory/transaction/add')}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-200 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Transaction
                </ContextLink>
              </div>

              {/* Search and Controls - Sticky Container */}
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 pb-0 mb-2">
                <div className="space-y-0">
                  {/* Search Bar */}
                  <div className="relative pt-2">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base"
                      placeholder="Search transactions by source, type, project, or notes..."
                      value={transactionSearchQuery || ''}
                      onChange={(e) => setTransactionSearchQuery(e.target.value)}
                    />
                  </div>

                  {/* Filter Controls */}
                  <div className="flex items-center justify-end gap-4 p-3 rounded-lg">
                    {/* Filter Button */}
                    <div className="relative">
                      <button
                        onClick={() => setShowTransactionFilterMenu(!showTransactionFilterMenu)}
                        className={`transaction-filter-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                          transactionFilterMode === 'all'
                            ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                            : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
                        }`}
                        title="Filter transactions"
                      >
                        <Filter className="h-4 w-4 mr-2" />
                        Filter
                      </button>

                      {/* Transaction Filter Dropdown Menu */}
                      {showTransactionFilterMenu && (
                        <div className="transaction-filter-menu absolute top-full right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                          <div className="py-1">
                            <button
                              onClick={() => {
                                setTransactionFilterMode('all')
                                setShowTransactionFilterMenu(false)
                              }}
                              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionFilterMode === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              All Status
                            </button>
                            <button
                              onClick={() => {
                                setTransactionFilterMode('pending')
                                setShowTransactionFilterMenu(false)
                              }}
                              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionFilterMode === 'pending' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              Pending
                            </button>
                            <button
                              onClick={() => {
                                setTransactionFilterMode('completed')
                                setShowTransactionFilterMenu(false)
                              }}
                              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionFilterMode === 'completed' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              Completed
                            </button>
                            <button
                              onClick={() => {
                                setTransactionFilterMode('canceled')
                                setShowTransactionFilterMenu(false)
                              }}
                              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionFilterMode === 'canceled' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              Canceled
                            </button>
                            <button
                              onClick={() => {
                                setTransactionFilterMode('inventory-only')
                                setShowTransactionFilterMenu(false)
                              }}
                              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionFilterMode === 'inventory-only' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              Inventory Only
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Transactions List */}
              {filteredTransactions.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">🧾</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">
                    No transactions found
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {transactionSearchQuery || transactionFilterMode !== 'all'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'No inventory-related transactions found.'
                    }
                  </p>
                </div>
              ) : (
                <div className="bg-white shadow overflow-hidden sm:rounded-md">
                  <ul className="divide-y divide-gray-200">
                    {filteredTransactions.map((transaction) => (
                      <li key={transaction.transactionId} className="relative">
                        <ContextLink to={buildContextUrl(`/business-inventory/transaction/${transaction.transactionId}`)}>
                          <div className="block bg-gray-50 transition-colors duration-200 hover:bg-gray-100">
                            <div className="px-4 py-4 sm:px-6">
                            {/* Top row: Header with source and status */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center">
                                <h3 className="text-base font-medium text-gray-900">
                                  {getCanonicalTransactionTitle(transaction)}
                                </h3>
                              </div>
                              <div className="flex items-center flex-wrap gap-2">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium no-icon ${
                                  transaction.status === 'completed'
                                    ? 'bg-green-100 text-green-800'
                                    : transaction.status === 'pending'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {transaction.status === 'completed' ? 'Completed' :
                                   transaction.status === 'pending' ? 'Pending' :
                                   transaction.status === 'canceled' ? 'Canceled' :
                                   transaction.status}
                                </span>
                              </div>
                            </div>

                            {/* Bottom row: Details */}
                            <div className="space-y-2">
                              {/* Details row - Price, project, date */}
                              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                <span className="font-medium text-gray-700">{formatCurrency(transaction.amount)}</span>
                                {transaction.projectName && (
                                  <>
                                    <span className="hidden sm:inline">•</span>
                                    <span className="font-medium text-gray-700">
                                      {transaction.projectName}
                                    </span>
                                  </>
                                )}
                                <span className="hidden sm:inline">•</span>
                                <span className="font-medium text-gray-700">
                                  {formatDate(transaction.transactionDate)}
                                </span>
                              </div>

                              {/* Notes */}
                              {transaction.notes && (
                                <p className="text-sm text-gray-600 line-clamp-2">
                                  {transaction.notes}
                                </p>
                              )}

                            </div>

                            </div>
                          </div>
                        </ContextLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Batch Allocation Modal */}
      {showBatchAllocationModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Allocate {selectedItems.size} Items to Project
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Select Project
                  </label>
                  <div className="relative mt-1">
                    <button
                      type="button"
                      onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                      className="project-dropdown-button relative w-full bg-white border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      <span className={`block truncate ${!batchAllocationForm.projectId ? 'text-gray-500' : 'text-gray-900'}`}>
                        {getSelectedProjectName()}
                      </span>
                      <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </button>

                    {showProjectDropdown && (
                      <div className="project-dropdown absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base border border-gray-200 overflow-auto focus:outline-none sm:text-sm">
                        {projects.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => {
                              setBatchAllocationForm(prev => ({ ...prev, projectId: project.id }))
                              setShowProjectDropdown(false)
                            }}
                            className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${
                              batchAllocationForm.projectId === project.id ? 'bg-primary-50 text-primary-600' : 'text-gray-900'
                            }`}
                          >
                            <div className="font-medium">{project.name}</div>
                            <div className="text-sm text-gray-500">{project.clientName}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Space (Optional)
                  </label>
                  <input
                    type="text"
                    value={batchAllocationForm.space}
                    onChange={(e) => setBatchAllocationForm(prev => ({ ...prev, space: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder="e.g. Living Room, Bedroom, etc."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeBatchAllocationModal}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBatchAllocationSubmit}
                  disabled={!batchAllocationForm.projectId || isAllocating}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                >
                  {isAllocating ? 'Allocating...' : `Allocate ${selectedItems.size} Items`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
