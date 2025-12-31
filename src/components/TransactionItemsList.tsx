import { useEffect, useMemo, useState } from 'react'
import { Edit, X, Plus, GitMerge, ChevronDown, Receipt, Camera } from 'lucide-react'
import { TransactionItemFormData } from '@/types'
import TransactionItemForm from './TransactionItemForm'
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'
import { getTransactionFormGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from './ui/CollapsedDuplicateGroup'
import { normalizeDisposition, displayDispositionLabel, DISPOSITION_OPTIONS, dispositionsEqual } from '@/utils/dispositionUtils'
import { unifiedItemsService, integrationService } from '@/services/inventoryService'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useToast } from '@/components/ui/ToastContext'
import ContextLink from './ContextLink'
import type { ItemDisposition } from '@/types'
import ItemPreviewCard, { type ItemPreviewData } from './items/ItemPreviewCard'

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
  getItemLink?: (item: TransactionItemFormData) => string | null
}

export default function TransactionItemsList({ items, onItemsChange, onAddItem, onUpdateItem, projectId, projectName, onImageFilesChange, totalAmount, showSelectionControls = true, onDeleteItem, getItemLink }: TransactionItemsListProps) {
  const [isAddingItem, setIsAddingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false)
  const [mergeMasterId, setMergeMasterId] = useState<string | null>(null)
  const [openDispositionMenu, setOpenDispositionMenu] = useState<string | null>(null)
  const [deletingItemIds, setDeletingItemIds] = useState<Set<string>>(new Set())
  const [bookmarkedItemIds, setBookmarkedItemIds] = useState<Set<string>>(new Set())
  const [duplicatingItemIds, setDuplicatingItemIds] = useState<Set<string>>(new Set())
  const [transactionDisplayInfos, setTransactionDisplayInfos] = useState<Map<string, {title: string, amount: string} | null>>(new Map())
  const [transactionRoutes, setTransactionRoutes] = useState<Map<string, {path: string, projectId: string | null}>>(new Map())
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  const { showError, showSuccess } = useToast()

  useEffect(() => {
    setSelectedItemIds(prev => {
      const valid = new Set<string>()
      for (const item of items) {
        if (prev.has(item.id)) valid.add(item.id)
      }
      return valid.size === prev.size ? prev : valid
    })
  }, [items])

  // Close disposition menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.disposition-menu') && !target.closest('.disposition-badge')) {
        setOpenDispositionMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

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

  // Group items by their grouping key for collapsed duplicate display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, TransactionItemFormData[]>()

    items.forEach(item => {
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
        const aIndex = items.indexOf(a.items[0])
        const bIndex = items.indexOf(b.items[0])
        return aIndex - bIndex
      })
  }, [items])

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

  const handleDuplicateItem = async (itemId: string) => {
    const itemToDuplicate = items.find(item => item.id === itemId)
    if (!itemToDuplicate) return

    const isPersistedItem = Boolean(itemToDuplicate.transactionId)

    if (isPersistedItem) {
      if (!currentAccountId || !projectId) {
        console.error('TransactionItemsList: missing account or project context for duplication', { currentAccountId, projectId })
        showError('Cannot duplicate item: missing project context.')
        return
      }

      if (duplicatingItemIds.has(itemId)) {
        return
      }

      setDuplicatingItemIds(prev => {
        const next = new Set(prev)
        next.add(itemId)
        return next
      })

      try {
        await unifiedItemsService.duplicateItem(currentAccountId, projectId, itemId)
        showSuccess('Item duplicated.')
        onItemsChange([...items])
      } catch (error) {
        console.error('TransactionItemsList: failed to duplicate persisted item', error)
        showError('Failed to duplicate item. Please try again.')
      } finally {
        setDuplicatingItemIds(prev => {
          const next = new Set(prev)
          next.delete(itemId)
          return next
        })
      }
      return
    }

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
  }

  const handleBookmarkItem = (itemId: string) => {
    setBookmarkedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
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
    if (!currentAccountId) return

    try {
      const item = items.find(item => item.id === itemId)
      if (!item) {
        console.error('Item not found for disposition update:', itemId)
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

      // Update the local state
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
    if (selectedItemIds.size === items.length) {
      setSelectedItemIds(new Set())
      return
    }
    setSelectedItemIds(new Set(items.map(item => item.id)))
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

    const resolvedItemLink = getItemLink?.(item) ?? undefined

    return (
      <ItemPreviewCard
        key={item.id}
        item={previewData}
        isSelected={selectedItemIds.has(item.id)}
        onSelect={toggleItemSelection}
        showCheckbox={showSelectionControls}
        onBookmark={handleBookmarkItem}
        onDuplicate={handleDuplicateItem}
        onEdit={(href) => handleEditItem(item.id)}
        onDispositionUpdate={updateDisposition}
        uploadingImages={new Set()}
        openDispositionMenu={openDispositionMenu}
        setOpenDispositionMenu={setOpenDispositionMenu}
        deletingItemIds={deletingItemIds}
        context="transaction"
        projectId={projectId}
        itemLink={resolvedItemLink}
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
    setSelectedItemIds(new Set([mergeMasterId]))
    closeMergeDialog()
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

  return (
    <div className="space-y-4">
      {items.length > 0 && showSelectionControls && (
        <div className="sticky top-0 z-10 bg-white py-3 border-b border-gray-200 mb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {selectedItemIds.size > 0 && (
              <span className="text-gray-600">{selectedItemIds.size} selected</span>
            )}
            <button
              type="button"
              onClick={toggleSelectAll}
              className="px-3 py-1 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
            >
              {selectedItemIds.size === items.length ? 'Clear selection' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={openMergeDialog}
              disabled={selectedItemIds.size < 2}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-transparent text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <GitMerge className="h-4 w-4" />
              Merge Selected
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

        {/* Add Item Button */}
        <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
          <button
            onClick={() => setIsAddingItem(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            title="Add new item"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </button>
        </div>

        {items.length > 0 && (
          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Total Items: {items.length}
            </div>
            <div className="text-lg font-semibold text-gray-900">
              Subtotal: {formatCurrency(
                totalAmount || items.reduce((sum, item) => sum + (parseFloat(item.projectPrice || item.purchasePrice || '0') || 0), 0).toString()
              )}
            </div>
          </div>
        )}
      </div>

      {isMergeDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Merge Items</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Select which item should remain. The others will be absorbed into it. Purchase price and tax amounts will be summed and the absorbed item names/SKUs will be appended to the notes.
                </p>
              </div>
              <button
                type="button"
                onClick={closeMergeDialog}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-72 overflow-auto pr-1">
              {selectedItems.map(item => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="merge-master"
                    checked={mergeMasterId === item.id}
                    onChange={() => setMergeMasterId(item.id)}
                    className="mt-1 h-4 w-4 text-primary-600 border-gray-300"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.description || 'Untitled item'}</p>
                    <p className="text-xs text-gray-600">
                      SKU: {item.sku?.trim() || '—'} • Purchase price: {formatCurrency(item.purchasePrice || item.projectPrice || '0')}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeMergeDialog}
                className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!mergeMasterId}
                onClick={handleConfirmMerge}
                className="px-4 py-2 rounded-md border border-transparent bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Merge Items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
