import { useState, useEffect, useMemo } from 'react'
import { Plus, Search, RotateCcw, Camera, Trash2, QrCode, Filter, ArrowUpDown } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { unifiedItemsService, integrationService } from '@/services/inventoryService'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { Item, ItemImage } from '@/types'
import { normalizeDisposition } from '@/utils/dispositionUtils'
import type { ItemDisposition } from '@/types'
import { useToast } from '@/components/ui/ToastContext'
import { useBookmark } from '@/hooks/useBookmark'
import { useDuplication } from '@/hooks/useDuplication'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { projectItemNew } from '@/utils/routes'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import InventoryItemRow from '@/components/items/InventoryItemRow'

interface InventoryListProps {
  projectId: string
  projectName: string
  items: Item[]
}

export default function InventoryList({ projectId, projectName, items: propItems }: InventoryListProps) {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<Item[]>(propItems || [])
  const [error, setError] = useState<string | null>(null)
  
  // Show loading spinner only if account is loading - items come from props (parent handles that loading)
  const isLoading = accountLoading
  const [uploadingImages, setUploadingImages] = useState<Set<string>>(new Set())
  const [openDispositionMenu, setOpenDispositionMenu] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState<'all' | 'bookmarked' | 'to-inventory' | 'from-inventory'>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortMode, setSortMode] = useState<'alphabetical' | 'creationDate'>('alphabetical')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const { showSuccess, showError } = useToast()

  const parseMoney = (value?: string | number | null) => {
    if (value === undefined || value === null) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    return value.trim().length > 0 && Number.isFinite(Number.parseFloat(value))
  }

  const formatCurrency = (amount?: string | number | null) => {
    const numeric = parseMoney(amount)
    return numeric.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  const getPrimaryPrice = (item: Item) => {
    if (hasNonEmptyMoneyString(item.projectPrice)) return item.projectPrice
    if (hasNonEmptyMoneyString(item.purchasePrice)) return item.purchasePrice
    return undefined
  }

  // Debug logging
  useEffect(() => {
    console.log('🔍 InventoryList - accountLoading:', accountLoading, 'propItems length:', propItems?.length || 0, 'isLoading:', isLoading)
  }, [accountLoading, propItems, isLoading])

  useEffect(() => {
    console.log('🔍 InventoryList - propItems changed:', propItems?.length || 0)
    setItems(propItems || [])
  }, [propItems])

  // Per-visible-item lineage subscriptions: when an item has a lineage edge, refetch that item and update/remove as needed
  useEffect(() => {
    if (!currentAccountId || items.length === 0) return

    const unsubMap = new Map<string, () => void>()
    try {
      items.forEach(item => {
        if (!item?.itemId) return
        const unsub = lineageService.subscribeToItemLineageForItem(currentAccountId, item.itemId, async () => {
          try {
            const updated = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
            if (updated) {
              // If updated item still belongs to this project, update it; otherwise remove it from the list
              if (updated.projectId === projectId) {
                setItems(prev => prev.map(i => i.itemId === updated.itemId ? updated : i))
              } else {
                setItems(prev => prev.filter(i => i.itemId !== updated.itemId))
              }
            }
          } catch (err) {
            console.debug('InventoryList - failed to refetch item on lineage event', err)
          }
        })
        unsubMap.set(item.itemId, unsub)
      })
    } catch (err) {
      console.debug('InventoryList - failed to setup per-item lineage subscriptions', err)
    }

    return () => {
      unsubMap.forEach(u => {
        try { u() } catch (e) { /* noop */ }
      })
    }
  }, [items.map(i => i.itemId).join(','), currentAccountId, projectId])

 

  // Reset uploading state on unmount to prevent hanging state
  useEffect(() => {
    return () => {
      setUploadingImages(new Set())
    }
  }, [])

  // Close disposition menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDispositionMenu && !event.target) return

      const target = event.target as Element
      if (!target.closest('.disposition-menu') && !target.closest('.disposition-badge')) {
        setOpenDispositionMenu(null)
      }
      if ((showFilterMenu || showSortMenu) && !target.closest('.filter-menu') && !target.closest('.filter-button') && !target.closest('.sort-menu') && !target.closest('.sort-button')) {
        setShowFilterMenu(false)
        setShowSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDispositionMenu, showFilterMenu, showSortMenu])

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

  // Use centralized bookmark hook
  const { toggleBookmark } = useBookmark<Item>({
    items,
    setItems,
    updateItemService: (itemId, updates) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      return unifiedItemsService.updateItem(currentAccountId, itemId, updates)
    },
    projectId
  })

  // Use centralized duplication hook
  const { duplicateItem } = useDuplication({
    items,
    setItems,
    projectId,
    accountId: currentAccountId || undefined
  })

  // Use navigation context for proper back navigation
  const { buildContextUrl } = useNavigationContext()

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    console.log('🎯 InventoryList updateDisposition called:', itemId, newDisposition)

    try {
      const item = items.find((item: Item) => item.itemId === itemId)
      if (!item) {
        console.error('❌ Item not found for disposition update:', itemId)
        return
      }

      console.log('📝 Updating disposition from', item.disposition, 'to', newDisposition)

      // Update in Supabase
      if (!currentAccountId) throw new Error('Account ID is required')
      await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: newDisposition })
      console.log('💾 Database updated successfully')

      // If disposition is set to 'inventory', trigger deallocation process
      if (newDisposition === 'inventory') {
        console.log('🚀 Starting deallocation process for item:', itemId)
        try {
          await integrationService.handleItemDeallocation(
            currentAccountId,
            itemId,
            item.projectId || '',
            newDisposition
          )
          console.log('✅ Deallocation completed successfully')
          // Close the disposition menu - real-time subscription will handle state update
          setOpenDispositionMenu(null)
        } catch (deallocationError) {
          console.error('❌ Failed to handle deallocation:', deallocationError)
          // Revert the disposition change if deallocation fails
          await unifiedItemsService.updateItem(currentAccountId, itemId, {
            disposition: item.disposition // Revert to previous disposition
          })
          setError('Failed to move item to inventory. Please try again.')
          return
        }
      } else {
        // For non-inventory dispositions, update local state optimistically
        setItems(items.map(item =>
          item.itemId === itemId
            ? { ...item, disposition: newDisposition as ItemDisposition }
            : item
        ))

        // Close the disposition menu
        setOpenDispositionMenu(null)
      }
    } catch (error) {
      console.error('❌ Failed to update disposition:', error)
      setError('Failed to update item disposition. Please try again.')
    }
  }



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
      }
    } catch (error: any) {
      console.error('Error adding image:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      showError('Failed to add image. Please try again.')
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
      projectName,
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
    // The real-time listener will handle the UI update

    // Show success notification on the last file
    if (allFiles && allFiles.indexOf(file) === allFiles.length - 1) {
      const message = allFiles.length > 1 ? `${allFiles.length} images uploaded successfully!` : 'Image uploaded successfully!'
      showSuccess(message)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return

    const confirmMessage = `Are you sure you want to delete ${selectedItems.size} item(s)? This action cannot be undone.`

    if (!confirm(confirmMessage)) {
      return
    }

    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const idsToDelete = Array.from(selectedItems)

    // Optimistically remove items so the UI reflects the deletion immediately
    setItems(prev => prev.filter(item => !idsToDelete.includes(item.itemId)))
    setSelectedItems(new Set())

    try {
      const deletePromises = idsToDelete.map(itemId =>
        unifiedItemsService.deleteItem(currentAccountId, itemId)
      )

      await Promise.all(deletePromises)
      setError(null)
    } catch (error) {
      console.error('Failed to delete items:', error)
      setError('Failed to delete some items. Please try again.')
      // Reload items to ensure UI stays in sync if delete failed
      await handleRetry()
    }
  }

  const handleRetry = async () => {
    if (!currentAccountId) {
      setError('Account ID is required to reload inventory.')
      return
    }

    setError(null)

    try {
      const refreshedItems = await unifiedItemsService.getItemsByProject(currentAccountId, projectId)
      setItems(refreshedItems)
    } catch (retryError) {
      console.error('Failed to reload inventory:', retryError)
      setError('Failed to reload inventory. Please try again.')
    }
  }

  const filteredItems = items.filter(item => {
    // Apply search filter
    const matchesSearch = item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.paymentMethod?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.space && item.space.toLowerCase().includes(searchQuery.toLowerCase()))

    // Apply filter based on filterMode
    let matchesFilter = false
    switch (filterMode) {
      case 'all':
        matchesFilter = true
        break
      case 'bookmarked':
        matchesFilter = item.bookmark
        break
      case 'to-inventory':
        matchesFilter = item.disposition === 'inventory'
        break
      case 'from-inventory':
        matchesFilter = item.source === 'Inventory'
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

  // Group filtered items by their grouping key
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>()

    filteredItems.forEach(item => {
      const groupKey = getInventoryListGroupKey(item, 'project')
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    })

    // Convert to array - items are already sorted in filteredItems
    return Array.from(groups.entries())
      .map(([groupKey, items]) => ({ groupKey, items }))
  }, [filteredItems])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-2">
          <ContextLink
            to={buildContextUrl(projectItemNew(projectId), { project: projectId })}
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
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
            {/* Counter (when visible) */}
            {selectedItems.size > 0 && (
              <span className="text-sm text-gray-500">
                {selectedItems.size} of {filteredItems.length} selected
              </span>
            )}

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
                  <div className="filter-menu absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
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
                        Bookmarked
                      </button>
                      <button
                        onClick={() => {
                          setFilterMode('to-inventory')
                          setShowFilterMenu(false)
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                          filterMode === 'to-inventory' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                        }`}
                      >
                        To Inventory
                      </button>
                      <button
                        onClick={() => {
                          setFilterMode('from-inventory')
                          setShowFilterMenu(false)
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                          filterMode === 'from-inventory' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                        }`}
                      >
                        From Inventory
                      </button>
                    </div>
                  </div>
                )}
              </div>

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
                onClick={handleBulkDelete}
                className="inline-flex items-center justify-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200"
                disabled={selectedItems.size === 0}
                title="Delete All"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-gray-400 animate-spin mb-4">
            <svg fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Loading inventory...</h3>
          <p className="text-sm text-gray-500">Fetching your project items.</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-red-400 mb-4">⚠️</div>
          <h3 className="text-lg font-medium text-red-900 mb-2">Error loading inventory</h3>
          <p className="text-sm text-red-500 mb-6 max-w-sm mx-auto">{error}</p>
          <button
            onClick={handleRetry}
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors duration-200 w-full sm:w-auto max-w-xs"
          >
            <RotateCcw className="h-5 w-5 mr-2" />
            Retry
          </button>
        </div>
      )}

      {/* Items List */}
      {!isLoading && !error && filteredItems.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">📦</div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            No items yet
          </h3>
        </div>
      ) : (
        !isLoading && !error && (
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
                      onEdit={(href) => {
                        // Optional: Add analytics or logging here
                        console.log('Navigating to edit item:', href)
                      }}
                      onDispositionUpdate={updateDisposition}
                      onAddImage={handleAddImage}
                      uploadingImages={uploadingImages}
                      openDispositionMenu={openDispositionMenu}
                      setOpenDispositionMenu={setOpenDispositionMenu}
                      context="project"
                      projectId={projectId}
                      itemNumber={groupIndex + 1}
                    />
                  )
                }

                // Multiple items - render as collapsed group
                const firstItem = groupItems[0]
                const groupSelectionState = getGroupSelectionState(groupItems)
                const locationValue = firstItem.space || firstItem.businessInventoryLocation
                const hasAnyPrice = groupItems.some(item => getPrimaryPrice(item) !== undefined)
                const totalPrice = groupItems.reduce((sum, item) => sum + parseMoney(getPrimaryPrice(item)), 0)
                const firstItemPrice = parseMoney(getPrimaryPrice(firstItem))

                return (
                  <li key={groupKey} className="relative">
                    <CollapsedDuplicateGroup
                      groupId={groupKey}
                      count={groupItems.length}
                      selectionState={groupSelectionState}
                      onToggleSelection={(checked) => handleSelectGroup(groupItems, checked)}
                      summary={
                        <div className="flex items-start gap-4 py-3">
                          <div className="flex-shrink-0">
                            {firstItem.images && firstItem.images.length > 0 ? (
                              (() => {
                                const primaryImage = firstItem.images.find(img => img.isPrimary) || firstItem.images[0]
                                return (
                                  <div className="w-12 h-12 rounded-md overflow-hidden border border-gray-200">
                                    <img
                                      src={primaryImage.url}
                                      alt={primaryImage.alt || 'Item image'}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                )
                              })()
                            ) : (
                              <div className="w-12 h-12 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                                <Camera className="h-5 w-5" />
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0 space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                                Item {groupIndex + 1} ×{groupItems.length}
                              </span>
                              {hasAnyPrice && (
                                <span className="text-sm text-gray-500">
                                  {formatCurrency(totalPrice)}
                                  {groupItems.length > 1 && totalPrice !== firstItemPrice && (
                                    <span className="text-xs text-gray-400">
                                      {' ('}{formatCurrency(totalPrice / groupItems.length)} each)
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-medium text-gray-900">
                              {firstItem.description || 'No description'}
                            </h4>

                            {locationValue && (
                              <div className="text-sm text-gray-500">
                                <span className="font-medium">Location:</span> {locationValue}
                              </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                              {firstItem.sku && (
                                <div>
                                  <span className="font-medium">SKU:</span> {firstItem.sku}
                                </div>
                              )}
                              {firstItem.marketValue && (
                                <div>
                                  <span className="font-medium">Market Value:</span> {formatCurrency(firstItem.marketValue)}
                                </div>
                              )}
                            </div>

                            {firstItem.notes && (
                              <div className="text-sm text-gray-600 whitespace-pre-wrap">
                                <span className="font-medium">Notes:</span> {firstItem.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      }
                    >
                      {/* Render individual items in the expanded group */}
                      <ul className="divide-y divide-gray-200 rounded-lg overflow-hidden list-none p-0 m-0">
                        {groupItems.map((item, itemIndex) => (
                          <InventoryItemRow
                            key={item.itemId}
                            item={item}
                            isSelected={selectedItems.has(item.itemId)}
                            onSelect={handleSelectItem}
                            onBookmark={toggleBookmark}
                            onDuplicate={duplicateItem}
                            onEdit={(href) => {
                              // Optional: Add analytics or logging here
                              console.log('Navigating to edit item:', href)
                            }}
                            onDispositionUpdate={updateDisposition}
                            onAddImage={handleAddImage}
                            uploadingImages={uploadingImages}
                            openDispositionMenu={openDispositionMenu}
                            setOpenDispositionMenu={setOpenDispositionMenu}
                            context="project"
                            projectId={projectId}
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
        )
      )}
    </div>
  )
}

