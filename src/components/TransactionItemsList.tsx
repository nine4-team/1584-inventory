import { useEffect, useMemo, useState } from 'react'
import { Edit, X, Plus, ChevronDown, Receipt, Camera, Search, Filter, ArrowUpDown } from 'lucide-react'
import { TransactionItemFormData } from '@/types'
import TransactionItemForm from './TransactionItemForm'
import ItemDetail from '@/pages/ItemDetail'
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'
import { getTransactionFormGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from './ui/CollapsedDuplicateGroup'
import { normalizeDisposition, displayDispositionLabel, DISPOSITION_OPTIONS, dispositionsEqual } from '@/utils/dispositionUtils'
import { unifiedItemsService, integrationService } from '@/services/inventoryService'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { projectItemDetail } from '@/utils/routes'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import ContextLink from './ContextLink'
import type { ItemDisposition } from '@/types'
import ItemPreviewCard, { type ItemPreviewData } from './items/ItemPreviewCard'
import BulkItemControls from '@/components/ui/BulkItemControls'

interface TransactionItemsListProps {
  items: TransactionItemFormData[]
  onItemsChange: (items: TransactionItemFormData[]) => void
  onAddItem?: (item: TransactionItemFormData) => Promise<void> | void
  onUpdateItem?: (item: TransactionItemFormData) => Promise<void> | void
  projectId?: string
  projectName?: string
  onImageFilesChange?: (itemId: string, imageFiles: File[]) => void
  totalAmount?: string // Optional total amount to display instead of calculating from items
  showSelectionControls?: boolean // Whether to show select/merge buttons and checkboxes
  onDeleteItem?: (itemId: string, item: TransactionItemFormData) => Promise<boolean | void> | boolean | void
  enablePersistedItemFeatures?: boolean // Whether to enable bookmark/disposition features that require persisted items
  containerId?: string // ID of the container element to track for sticky behavior
}

export default function TransactionItemsList({
  items,
  onItemsChange,
  onAddItem,
  onUpdateItem,
  projectId,
  projectName,
  onImageFilesChange,
  totalAmount,
  showSelectionControls = true,
  onDeleteItem,
  enablePersistedItemFeatures = true,
  containerId
}: TransactionItemsListProps) {
  const [isAddingItem, setIsAddingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [viewingItemId, setViewingItemId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false)
  const [mergeMasterId, setMergeMasterId] = useState<string | null>(null)
  const [openDispositionMenu, setOpenDispositionMenu] = useState<string | null>(null)
  const [deletingItemIds, setDeletingItemIds] = useState<Set<string>>(new Set())
  const [bookmarkedItemIds, setBookmarkedItemIds] = useState<Set<string>>(new Set())
  const [transactionDisplayInfos, setTransactionDisplayInfos] = useState<Map<string, {title: string, amount: string} | null>>(new Map())
  const [transactionRoutes, setTransactionRoutes] = useState<Map<string, {path: string, projectId: string | null}>>(new Map())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'bookmarked'>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortMode, setSortMode] = useState<'alphabetical' | 'price'>('alphabetical')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [shouldStick, setShouldStick] = useState(true)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [bulkControlsWidth, setBulkControlsWidth] = useState<number | undefined>(undefined)
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  const { refreshCollections: refreshProjectCollections } = useProjectRealtime(projectId)

  // Initialize bookmarked items from database
  useEffect(() => {
    if (!enablePersistedItemFeatures) return

    const loadBookmarkStates = async () => {
      if (!currentAccountId) return

      const persistedItemIds = items
        .filter(item => item.id && !item.id.toString().startsWith('item-'))
        .map(item => item.id)

      if (persistedItemIds.length === 0) return

      try {
        const bookmarkStates = new Set<string>()
        // Fetch bookmark states for all persisted items
        const bookmarkPromises = persistedItemIds.map(async (itemId) => {
          try {
            const item = await unifiedItemsService.getItemById(currentAccountId, itemId)
            if (item?.bookmark) {
              return itemId
            }
            return null
          } catch (error) {
            console.error(`Failed to fetch bookmark state for item ${itemId}:`, error)
            return null
          }
        })

        const results = await Promise.all(bookmarkPromises)
        results.forEach(itemId => {
          if (itemId) bookmarkStates.add(itemId)
        })

        setBookmarkedItemIds(bookmarkStates)
      } catch (error) {
        console.error('Failed to load bookmark states:', error)
      }
    }

    void loadBookmarkStates()
  }, [items, currentAccountId, enablePersistedItemFeatures])

  useEffect(() => {
    setSelectedItemIds(prev => {
      const valid = new Set<string>()
      for (const item of items) {
        if (prev.has(item.id)) valid.add(item.id)
      }
      return valid.size === prev.size ? prev : valid
    })
  }, [items])

  // Track when transaction items container is scrolled past for sticky controls
  useEffect(() => {
    if (!containerId) {
      // If no containerId, default to sticky behavior
      setShouldStick(true)
      return
    }

    const checkScrollPosition = () => {
      const container = document.getElementById(containerId)
      const sentinel = document.getElementById('transaction-items-sentinel')
      
      if (!container || !sentinel) {
        // If elements don't exist, default to sticky
        setShouldStick(true)
        return
      }

      const containerRect = container.getBoundingClientRect()
      const sentinelRect = sentinel.getBoundingClientRect()
      
      // Unstick only when the entire container (including sentinel) is scrolled past
      // i.e., when the bottom of the sentinel is above the top of the viewport
      const isFullyScrolledPast = sentinelRect.bottom < 0
      setShouldStick(!isFullyScrolledPast)
    }

    // Check immediately
    checkScrollPosition()

    // Set up IntersectionObserver on the sentinel
    const sentinel = document.getElementById('transaction-items-sentinel')
    let observer: IntersectionObserver | null = null

    if (sentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          checkScrollPosition()
        },
        {
          root: null,
          rootMargin: '0px',
          threshold: 0
        }
      )
      observer.observe(sentinel)
    }

    // Also listen to scroll events for more responsive updates
    window.addEventListener('scroll', checkScrollPosition, { passive: true })
    window.addEventListener('resize', checkScrollPosition, { passive: true })

    return () => {
      if (observer) {
        observer.disconnect()
      }
      window.removeEventListener('scroll', checkScrollPosition)
      window.removeEventListener('resize', checkScrollPosition)
    }
  }, [containerId])

  useEffect(() => {
    if (typeof window === 'undefined' || !containerId) {
      setBulkControlsWidth(undefined)
      return
    }

    const updateWidth = () => {
      const container = document.getElementById(containerId)
      if (container) {
        setBulkControlsWidth(container.getBoundingClientRect().width)
      }
    }

    updateWidth()

    const containerElement = document.getElementById(containerId)
    if (containerElement && 'ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => updateWidth())
      resizeObserver.observe(containerElement)
      return () => {
        resizeObserver.disconnect()
      }
    }

    window.addEventListener('resize', updateWidth)
    return () => {
      window.removeEventListener('resize', updateWidth)
    }
  }, [containerId])

  useEffect(() => {
    if (selectedItemIds.size === 0 && bulkDeleteError) {
      setBulkDeleteError(null)
    }
  }, [selectedItemIds, bulkDeleteError])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
  }, [showFilterMenu, showSortMenu])

  // Fetch transaction display texts and links for all items
  useEffect(() => {
    const fetchTransactionData = async () => {
      if (!currentAccountId) return

      const newDisplayTexts = new Map<string, string | null>()
      const newLinks = new Map<string, string>()

      // Process items that have transactionIds
      const itemsWithTransactionIds = items.filter(item => item.transactionId)

      // Fetch display infos and routes in parallel
      const promises = itemsWithTransactionIds.map(async (item) => {
        const [displayInfo, route] = await Promise.all([
          getTransactionDisplayInfo(currentAccountId, item.transactionId, 20),
          getTransactionRoute(item.transactionId, currentAccountId, projectId)
        ])
        return { itemId: item.id, displayInfo, route }
      })

      const results = await Promise.all(promises)

      // Update the maps
      results.forEach(({ itemId, displayInfo, route }) => {
        newDisplayTexts.set(itemId, displayInfo)
        transactionRoutes.set(itemId, route)
      })

      // Set items without transactionIds to null/empty
      items.filter(item => !item.transactionId).forEach(item => {
        newDisplayTexts.set(item.id, null)
        transactionRoutes.set(item.id, { path: '', projectId: null })
      })

      setTransactionDisplayInfos(newDisplayTexts)
      setTransactionRoutes(transactionRoutes)
    }

    fetchTransactionData()
  }, [items, currentAccountId, projectId])

  const selectedItems = useMemo(
    () => items.filter(item => selectedItemIds.has(item.id)),
    [items, selectedItemIds]
  )

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = items

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(item => {
        return (
          item.description?.toLowerCase().includes(query) ||
          item.sku?.toLowerCase().includes(query) ||
          item.space?.toLowerCase().includes(query) ||
          item.notes?.toLowerCase().includes(query)
        )
      })
    }

    // Apply filter based on filterMode
    if (filterMode === 'bookmarked') {
      result = result.filter(item => bookmarkedItemIds.has(item.id))
    }

    // Apply sorting
    result = [...result].sort((a, b) => {
      if (sortMode === 'alphabetical') {
        const aDesc = a.description || ''
        const bDesc = b.description || ''
        return aDesc.localeCompare(bDesc)
      } else if (sortMode === 'price') {
        const aPrice = parseFloat(a.projectPrice || a.purchasePrice || '0') || 0
        const bPrice = parseFloat(b.projectPrice || b.purchasePrice || '0') || 0
        return bPrice - aPrice // Highest price first
      }
      return 0
    })

    return result
  }, [items, searchQuery, filterMode, sortMode, bookmarkedItemIds])

  // Group items by their grouping key for collapsed duplicate display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, TransactionItemFormData[]>()

    filteredItems.forEach(item => {
      const groupKey = getTransactionFormGroupKey(item)
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    })

    // Convert to array and sort groups by the first item's position in original list
    return Array.from(groups.entries())
      .map(([groupKey, items]) => ({ groupKey, items }))
      .sort((a, b) => {
        const aIndex = filteredItems.indexOf(a.items[0])
        const bIndex = filteredItems.indexOf(b.items[0])
        return aIndex - bIndex
      })
  }, [filteredItems])

  const handleSaveItem = async (item: TransactionItemFormData) => {
    const isEditing = !!editingItemId
    const shouldDelegate = isEditing ? !!onUpdateItem : !!onAddItem

    try {
      if (shouldDelegate) {
        if (isEditing) {
          await onUpdateItem?.(item)
        } else {
          await onAddItem?.(item)
        }

        if (item.imageFiles && item.imageFiles.length > 0 && onImageFilesChange) {
          onImageFilesChange(item.id, item.imageFiles)
        }

        // Notify parent so it can refresh/persist as needed
        if (isEditing) {
          onItemsChange(items)
        } else {
          onItemsChange([...items, item])
        }

        setIsAddingItem(false)
        setEditingItemId(null)
        return
      }

      // Fallback: manage local state when no persistence callbacks are provided
      if (isEditing) {
        const updatedItems = items.map(existingItem =>
          existingItem.id === editingItemId ? item : existingItem
        )
        onItemsChange(updatedItems)
      } else {
        onItemsChange([...items, item])
      }

      if (item.imageFiles && item.imageFiles.length > 0 && onImageFilesChange) {
        onImageFilesChange(item.id, item.imageFiles)
      }

      setIsAddingItem(false)
      setEditingItemId(null)
    } catch (error) {
      console.error('TransactionItemsList: failed to save item', error)
    }
  }

  const handleCancelItem = () => {
    setIsAddingItem(false)
    setEditingItemId(null)
  }

  const handleEditItem = (itemId: string) => {
    setEditingItemId(itemId)
    setIsAddingItem(false)
  }

  const handleDeleteItem = async (itemId: string) => {
    const itemToDelete = items.find(item => item.id === itemId)
    if (!itemToDelete) return

    let shouldRemove = true

    if (onDeleteItem) {
      setDeletingItemIds(prev => {
        const next = new Set(prev)
        next.add(itemId)
        return next
      })

      try {
        const result = await onDeleteItem(itemId, itemToDelete)
        if (result === false) {
          shouldRemove = false
        }
      } catch (error) {
        console.error('TransactionItemsList: failed to delete item via callback', error)
        shouldRemove = false
      } finally {
        setDeletingItemIds(prev => {
          const next = new Set(prev)
          next.delete(itemId)
          return next
        })
      }
    }

    if (!shouldRemove) return

    const updatedItems = items.filter(item => item.id !== itemId)
    onItemsChange(updatedItems)
    setSelectedItemIds(prev => {
      if (!prev.has(itemId)) return prev
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const handleDuplicateItem = (itemId: string) => {
    const itemToDuplicate = items.find(item => item.id === itemId)
    if (!itemToDuplicate) return

    // Create a duplicate with a new ID
    const duplicatedItem: TransactionItemFormData = {
      ...itemToDuplicate,
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      // Clear any transaction-specific fields that shouldn't be duplicated
      transactionId: itemToDuplicate.transactionId, // Keep the same transaction ID
    }

    // Find the index of the original item and insert the duplicate right after it
    const originalIndex = items.findIndex(item => item.id === itemId)
    const newItems = [...items]
    newItems.splice(originalIndex + 1, 0, duplicatedItem)
    onItemsChange(newItems)
    if (projectId) {
      refreshProjectCollections().catch(err =>
        console.debug('TransactionItemsList: failed to refresh after duplicate', err)
      )
    }
  }

  const handleBookmarkItem = async (itemId: string) => {
    if (!enablePersistedItemFeatures) {
      return
    }

    if (!currentAccountId) {
      console.error('Cannot bookmark item: no account ID')
      return
    }

    const isPersisted = itemId && !itemId.toString().startsWith('item-')
    if (!isPersisted) {
      // For draft/temporary items, just update local state (but don't persist)
      setBookmarkedItemIds(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) {
          next.delete(itemId)
        } else {
          next.add(itemId)
        }
        return next
      })
      return
    }

    // Get current bookmark state
    const currentBookmarkState = bookmarkedItemIds.has(itemId)
    const newBookmarkState = !currentBookmarkState

    // Optimistically update UI
    setBookmarkedItemIds(prev => {
      const next = new Set(prev)
      if (newBookmarkState) {
        next.add(itemId)
      } else {
        next.delete(itemId)
      }
      return next
    })

    try {
      // Persist to database
      await unifiedItemsService.updateItem(currentAccountId, itemId, { bookmark: newBookmarkState })
    } catch (error) {
      console.error('Failed to update bookmark:', error)
      // Revert optimistic update on error
      setBookmarkedItemIds(prev => {
        const next = new Set(prev)
        if (currentBookmarkState) {
          next.add(itemId)
        } else {
          next.delete(itemId)
        }
        return next
      })
    }
  }

  const getItemToEdit = () => {
    if (!editingItemId) return null
    return items.find(item => item.id === editingItemId) || null
  }

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount)
    return isNaN(num) ? '$0.00' : `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const hasNonEmptyMoneyString = (value: string | undefined) => {
    if (value === undefined) return false
    if (typeof value !== 'string') return false
    if (!value.trim()) return false
    const n = Number.parseFloat(value)
    return Number.isFinite(n)
  }

  const getDispositionBadgeClasses = (disposition?: string | null) => {
    const baseClasses = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors hover:opacity-80'
    const d = normalizeDisposition(disposition)

    switch (d) {
      case 'to purchase':
        return `${baseClasses} bg-amber-100 text-amber-800`
      case 'purchased':
        return `${baseClasses} bg-green-100 text-green-800`
      case 'to return':
        return `${baseClasses} bg-red-100 text-red-700`
      case 'returned':
        return `${baseClasses} bg-red-800 text-red-100`
      case 'inventory':
        return `${baseClasses} bg-primary-100 text-primary-600`
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`
    }
  }

  const toggleDispositionMenu = (itemId: string) => {
    setOpenDispositionMenu(openDispositionMenu === itemId ? null : itemId)
  }

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    if (!enablePersistedItemFeatures) {
      return
    }

    if (!currentAccountId) return

    try {
      const item = items.find(item => item.id === itemId)
      if (!item) {
        console.error('Item not found for disposition update:', itemId)
        return
      }

      const isPersisted = !itemId.toString().startsWith('item-')

      if (!isPersisted) {
        // Update the local state (draft items only exist locally)
        const updatedItems = items.map(item =>
          item.id === itemId ? { ...item, disposition: newDisposition } : item
        )
        onItemsChange(updatedItems)
        setOpenDispositionMenu(null)
        return
      }

      const originalDisposition = item.disposition

      await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: newDisposition })

      // If disposition is set to 'inventory', trigger deallocation process
      if (newDisposition === 'inventory') {
        try {
          await integrationService.handleItemDeallocation(
            currentAccountId,
            itemId,
            projectId || '',
            newDisposition
          )
        } catch (deallocationError) {
          console.error('Failed to handle deallocation:', deallocationError)
          // Revert the disposition change if deallocation fails
          await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: originalDisposition as ItemDisposition })
          throw deallocationError
        }
      }

      // Update the local state (for both persisted and draft items)
      const updatedItems = items.map(item =>
        item.id === itemId ? { ...item, disposition: newDisposition } : item
      )
      onItemsChange(updatedItems)

      setOpenDispositionMenu(null)
    } catch (error) {
      console.error('Failed to update disposition:', error)
    }
  }

  const toggleItemSelection = (itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedItemIds(new Set())
      return
    }
    setSelectedItemIds(new Set(filteredItems.map(item => item.id)))
  }

  const getGroupSelectionState = (groupItems: TransactionItemFormData[]) => {
    const selectedInGroup = groupItems.filter(item => selectedItemIds.has(item.id)).length
    if (selectedInGroup === 0) return 'unchecked' as const
    if (selectedInGroup === groupItems.length) return 'checked' as const
    return 'indeterminate' as const
  }

  const handleSelectGroup = (groupItems: TransactionItemFormData[], checked: boolean) => {
    const newSelected = new Set(selectedItemIds)
    groupItems.forEach(item => {
      if (checked) {
        newSelected.add(item.id)
      } else {
        newSelected.delete(item.id)
      }
    })
    setSelectedItemIds(newSelected)
  }

  const renderTransactionItem = (item: TransactionItemFormData, groupIndex: number, groupSize?: number, itemIndexInGroup?: number) => {
    // Convert TransactionItemFormData to ItemPreviewData
    const previewData: ItemPreviewData = {
      id: item.id,
      description: item.description,
      sku: item.sku,
      purchasePrice: item.purchasePrice,
      projectPrice: item.projectPrice,
      marketValue: item.marketValue,
      disposition: item.disposition,
      images: item.images,
      transactionId: item.transactionId,
      space: item.space,
      notes: item.notes,
      bookmark: bookmarkedItemIds.has(item.id)
    }

    // Determine if item is persisted (has a real UUID, not a temp ID starting with 'item-')
    const isPersisted = item.id && !item.id.toString().startsWith('item-')
    const enablePersistedControls = enablePersistedItemFeatures && !!isPersisted

    return (
      <ItemPreviewCard
        key={item.id}
        item={previewData}
        isSelected={selectedItemIds.has(item.id)}
        onSelect={toggleItemSelection}
        showCheckbox={showSelectionControls}
        onBookmark={enablePersistedControls ? handleBookmarkItem : undefined}
        onDuplicate={handleDuplicateItem}
        onEdit={(href) => handleEditItem(item.id)}
        onClick={isPersisted ? () => setViewingItemId(item.id) : undefined}
        onDispositionUpdate={enablePersistedControls ? updateDisposition : undefined}
        uploadingImages={new Set()}
        openDispositionMenu={openDispositionMenu}
        setOpenDispositionMenu={setOpenDispositionMenu}
        deletingItemIds={deletingItemIds}
        context="transaction"
        projectId={projectId}
        duplicateCount={groupSize}
        duplicateIndex={itemIndexInGroup}
        itemNumber={groupIndex + 1}
      />
    )
  }

  const closeMergeDialog = () => {
    setIsMergeDialogOpen(false)
    setMergeMasterId(null)
  }

  const openMergeDialog = () => {
    const defaults = selectedItems
    if (defaults.length < 2) return
    setMergeMasterId(defaults[0]?.id ?? null)
    setIsMergeDialogOpen(true)
  }

  const parseMoney = (value?: string): number => {
    if (!value || !value.trim()) return 0
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const formatMoney = (value: number): string => {
    const normalized = normalizeMoneyToTwoDecimalString(value.toFixed(2))
    return normalized ?? value.toFixed(2)
  }

  const aggregateMoneyField = (
    field: keyof Pick<
      TransactionItemFormData,
      'purchasePrice' | 'projectPrice' | 'price' | 'taxAmountPurchasePrice' | 'taxAmountProjectPrice'
    >,
    master: TransactionItemFormData,
    absorbed: TransactionItemFormData[]
  ): string | undefined => {
    const values = [master[field], ...absorbed.map(item => item[field])]
    const hasValue = values.some(val => hasNonEmptyMoneyString(val))
    if (!hasValue) return master[field]
    const total = values.reduce((sum, val) => sum + parseMoney(val), 0)
    return formatMoney(total)
  }

  const buildMergedNotes = (master: TransactionItemFormData, absorbed: TransactionItemFormData[]): string | undefined => {
    if (absorbed.length === 0) return master.notes
    const masterNotes = master.notes?.trim() ?? ''
    const absorbedLines = absorbed.map(item => {
      const description = item.description?.trim() || 'Unnamed item'
      const sku = item.sku?.trim() ? ` (SKU ${item.sku.trim()})` : ''
      return `- ${description}${sku}`
    })
    const mergedSection = ['Merged items:', ...absorbedLines].join('\n')
    if (!masterNotes) return mergedSection
    return `${masterNotes}\n\n${mergedSection}`
  }

  const handleConfirmMerge = () => {
    if (!mergeMasterId) return
    const masterItem = items.find(item => item.id === mergeMasterId)
    if (!masterItem) return
    const absorbedItems = selectedItems.filter(item => item.id !== mergeMasterId)
    if (absorbedItems.length === 0) {
      closeMergeDialog()
      return
    }

    const updatedMaster: TransactionItemFormData = {
      ...masterItem,
      purchasePrice: aggregateMoneyField('purchasePrice', masterItem, absorbedItems),
      price: aggregateMoneyField('price', masterItem, absorbedItems) ?? aggregateMoneyField('purchasePrice', masterItem, absorbedItems),
      projectPrice: aggregateMoneyField('projectPrice', masterItem, absorbedItems),
      taxAmountPurchasePrice: aggregateMoneyField('taxAmountPurchasePrice', masterItem, absorbedItems),
      taxAmountProjectPrice: aggregateMoneyField('taxAmountProjectPrice', masterItem, absorbedItems),
      notes: buildMergedNotes(masterItem, absorbedItems)
    }

    const updatedItems = items
      .filter(item => !selectedItemIds.has(item.id) || item.id === mergeMasterId)
      .map(item => (item.id === mergeMasterId ? updatedMaster : item))

    onItemsChange(updatedItems)
    if (projectId) {
      refreshProjectCollections().catch(err =>
        console.debug('TransactionItemsList: failed to refresh after merge', err)
      )
    }
    setSelectedItemIds(new Set([mergeMasterId]))
    closeMergeDialog()
  }

  const handleBulkDeleteSelected = async () => {
    if (selectedItemIds.size === 0) {
      return
    }

    const itemsToDelete = items.filter(item => item.id && selectedItemIds.has(item.id))
    if (itemsToDelete.length === 0) {
      return
    }

    setBulkDeleteError(null)
    const successfullyDeleted = new Set<string>()
    const failedDeletes: string[] = []

    for (const item of itemsToDelete) {
      const itemId = item.id
      if (!itemId) {
        continue
      }

      let shouldRemove = true
      if (onDeleteItem) {
        try {
          const result = await onDeleteItem(itemId, item)
          if (result === false) {
            shouldRemove = false
          }
        } catch (error) {
          console.error('TransactionItemsList: failed to delete item via bulk action', error)
          shouldRemove = false
        }
      }

      if (shouldRemove) {
        successfullyDeleted.add(itemId)
      } else {
        failedDeletes.push(itemId)
      }
    }

    if (successfullyDeleted.size > 0) {
      const remainingItems = items.filter(item => !successfullyDeleted.has(item.id))
      onItemsChange(remainingItems)
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        successfullyDeleted.forEach(id => next.delete(id))
        return next
      })
    }

    if (failedDeletes.length > 0) {
      setBulkDeleteError(`Failed to delete ${failedDeletes.length} item${failedDeletes.length > 1 ? 's' : ''}. Please try again.`)
    } else {
      setBulkDeleteError(null)
    }
  }

  if (isAddingItem || editingItemId) {
    const itemToEdit = getItemToEdit()
    return (
      <TransactionItemForm
        item={itemToEdit || undefined}
        onSave={handleSaveItem}
        onCancel={handleCancelItem}
        isEditing={!!itemToEdit}
        projectId={projectId}
        projectName={projectName}
        onImageFilesChange={onImageFilesChange}
      />
    )
  }

  if (viewingItemId) {
    return (
      <ItemDetail
        itemId={viewingItemId}
        projectId={projectId}
        onClose={() => setViewingItemId(null)}
      />
    )
  }

  return (
    <div className="relative space-y-4">
      {items.length > 0 && showSelectionControls && (
        <div className={`z-10 bg-white border-b border-gray-200 py-3 mb-4 ${shouldStick ? 'sticky top-0' : ''}`}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Select All Checkbox */}
            <label className="flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                onChange={(e) => toggleSelectAll()}
                checked={selectedItemIds.size === filteredItems.length && filteredItems.length > 0}
              />
              <span className="ml-2 text-sm font-medium text-gray-700">Select all</span>
            </label>

            {/* Add Button */}
            <button
              type="button"
              onClick={() => setIsAddingItem(true)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-transparent text-sm font-medium text-white bg-primary-600 hover:bg-primary-900 flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              Create Item
            </button>

            {/* Sort Button */}
            <div className="relative flex-shrink-0">
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
                <div className="sort-menu absolute top-full right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10">
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
                        setSortMode('price')
                        setShowSortMenu(false)
                      }}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        sortMode === 'price' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      Price
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Filter Button */}
            <div className="relative flex-shrink-0">
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
                <div className="filter-menu absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
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
                  </div>
                </div>
              )}
            </div>

            {/* Search Bar - wraps onto its own line on mobile */}
            <div className="relative flex-1 min-w-[200px] w-full sm:w-auto">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          {bulkDeleteError && (
            <p className="mt-2 text-sm text-red-600">{bulkDeleteError}</p>
          )}
        </div>
      )}

      {showSelectionControls && items.length === 0 && (
        <div className="relative border-2 border-dashed rounded-lg p-6 sm:p-8 text-center bg-white border-gray-300 hover:border-gray-400 transition-colors">
          <div className="flex flex-col items-center space-y-3">
            <div className="p-3 rounded-full bg-gray-100">
              <Receipt className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">No items added yet</p>
              <p className="mt-1 text-xs text-gray-500">
                Create line items to mirror your receipts and attach photos to each purchase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddingItem(true)}
              className="inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Plus className="h-4 w-4 mr-2 text-gray-500" />
              Add Item
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {groupedItems.map(({ groupKey, items: groupItems }, groupIndex) => {
          // Single item - render directly
          if (groupItems.length === 1) {
            const item = groupItems[0]
            return renderTransactionItem(item, groupIndex)
          }

          // Multiple items - render as collapsed group
          const firstItem = groupItems[0]
          const groupSelectionState = getGroupSelectionState(groupItems)

          // Calculate group totals for prices and taxes
          const totalProjectPrice = groupItems.reduce((sum, item) => sum + (parseFloat(item.projectPrice || item.purchasePrice || '0') || 0), 0)
          const totalTaxPurchase = groupItems.reduce((sum, item) => sum + (parseFloat(item.taxAmountPurchasePrice || '0') || 0), 0)
          const totalTaxProject = groupItems.reduce((sum, item) => sum + (parseFloat(item.taxAmountProjectPrice || '0') || 0), 0)

          const hasAnyTaxPurchase = groupItems.some(item => hasNonEmptyMoneyString(item.taxAmountPurchasePrice))
          const hasAnyTaxProject = groupItems.some(item => hasNonEmptyMoneyString(item.taxAmountProjectPrice))

          // Get transaction display info for first item if it has a transactionId
          const firstItemTransactionInfo = firstItem.transactionId ? transactionDisplayInfos.get(firstItem.id) : null
          const firstItemTransactionRoute = firstItem.transactionId ? transactionRoutes.get(firstItem.id) : null

          return (
            <CollapsedDuplicateGroup
              key={groupKey}
              groupId={groupKey}
              count={groupItems.length}
              selectionState={showSelectionControls ? groupSelectionState : undefined}
              onToggleSelection={showSelectionControls ? (checked) => handleSelectGroup(groupItems, checked) : undefined}
              topRowContent={
                <span className="text-sm text-gray-500">
                  {formatCurrency(totalProjectPrice.toString())}
                  {totalProjectPrice !== parseFloat(firstItem.projectPrice || firstItem.purchasePrice || '0') && (
                    <span className="text-xs text-gray-400">
                      {' ('}{formatCurrency((totalProjectPrice / groupItems.length).toString())}{' each)'}
                    </span>
                  )}
                </span>
              }
              summary={
                <div className="flex gap-4">
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
                    <h4 className="text-sm font-medium text-gray-900 mb-1">
                      {firstItem.description || 'No description'}
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                      {/* SKU display (no transaction link in transaction context) */}
                      {firstItem.sku && (
                        <div>
                          <span className="font-medium">SKU: {firstItem.sku}</span>
                        </div>
                      )}
                      {firstItem.marketValue && (
                        <div>
                          <span className="font-medium">Market Value:</span> ${firstItem.marketValue}
                        </div>
                      )}
                    </div>

                    {firstItem.notes && (
                      <div className="mt-2 text-sm text-gray-600">
                        <span className="font-medium">Notes:</span> {firstItem.notes}
                      </div>
                    )}
                  </div>
                </div>
              }
            >
              {groupItems.map((item, itemIndexInGroup) => {
                return renderTransactionItem(item, groupIndex, groupItems.length, itemIndexInGroup + 1)
              })}
            </CollapsedDuplicateGroup>
          )
        })}

        {items.length > 0 && (
          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Total Items: {filteredItems.length}{filteredItems.length !== items.length ? ` of ${items.length}` : ''}
            </div>
            <div className="text-lg font-semibold text-gray-900">
              Calculated Subtotal: {formatCurrency(
                totalAmount || filteredItems.reduce((sum, item) => sum + (parseFloat(item.projectPrice || item.purchasePrice || '0') || 0), 0).toString()
              )}
            </div>
          </div>
        )}
      </div>
      {showSelectionControls && (
        <BulkItemControls
          selectedItemIds={selectedItemIds}
          projectId={projectId}
          onDelete={handleBulkDeleteSelected}
          onClearSelection={() => setSelectedItemIds(new Set())}
          itemListContainerWidth={bulkControlsWidth}
          enableAssignToTransaction={false}
          enableLocation={false}
          enableDisposition={false}
          enableSku={false}
          deleteButtonLabel="Delete selected items"
          placement="container"
        />
      )}
    </div>
  )
}
