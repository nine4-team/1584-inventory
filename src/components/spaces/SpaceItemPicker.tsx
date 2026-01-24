import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Item } from '@/types'
import { unifiedItemsService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import ItemPreviewCard, { type ItemPreviewData } from '@/components/items/ItemPreviewCard'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import { useToast } from '@/components/ui/ToastContext'

type SpaceItemPickerProps = {
  projectId: string
  spaceId: string
  excludedItemIds?: Set<string>
  onItemsAdded?: () => void | Promise<void>
}

const toPreviewData = (item: Item): ItemPreviewData => ({
  itemId: item.itemId,
  description: item.description || '',
  sku: item.sku || '',
  purchasePrice: item.purchasePrice,
  projectPrice: item.projectPrice,
  marketValue: item.marketValue,
  disposition: item.disposition,
  images: item.images,
  projectId: item.projectId ?? null,
  transactionId: item.transactionId ?? null,
  source: item.source,
  space: item.space,
  businessInventoryLocation: item.businessInventoryLocation,
  bookmark: item.bookmark,
  notes: item.notes
})

export default function SpaceItemPicker({
  projectId,
  spaceId,
  excludedItemIds,
  onItemsAdded
}: SpaceItemPickerProps) {
  const { currentAccountId } = useAccount()
  const { showError, showSuccess } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const normalizedQuery = searchQuery.trim()

  useEffect(() => {
    if (!currentAccountId || !projectId) return
    let cancelled = false
    const loadItems = async () => {
      setIsLoading(true)
      try {
        const result = await unifiedItemsService.getItemsByProject(currentAccountId, projectId, {
          searchQuery: normalizedQuery || undefined
        })
        if (!cancelled) {
          const excluded = excludedItemIds ?? new Set<string>()
          setItems((result || []).filter(item => !excluded.has(item.itemId)))
        }
      } catch (error) {
        if (!cancelled) {
          console.error('SpaceItemPicker: failed to load project items', error)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void loadItems()
    return () => {
      cancelled = true
    }
  }, [currentAccountId, excludedItemIds, normalizedQuery, projectId])

  useEffect(() => {
    const visibleIds = new Set(items.map(i => i.itemId))
    setSelectedItemIds(prev => {
      const next = new Set<string>()
      prev.forEach(id => {
        if (visibleIds.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const toggleItemSelection = useCallback((itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }, [])

  const selectedItems = useMemo(() => {
    const selected = new Set(selectedItemIds)
    return items.filter(item => selected.has(item.itemId))
  }, [items, selectedItemIds])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>()
    items.forEach(item => {
      const key = getInventoryListGroupKey(item, 'project')
      const existing = groups.get(key) ?? []
      existing.push(item)
      groups.set(key, existing)
    })
    return Array.from(groups.entries()).map(([groupKey, groupItems]) => ({ groupKey, items: groupItems }))
  }, [items])

  const getGroupSelectionState = useCallback((groupItems: Item[]) => {
    const selectedCount = groupItems.filter(item => selectedItemIds.has(item.itemId)).length
    if (selectedCount === 0) return 'unchecked' as const
    if (selectedCount === groupItems.length) return 'checked' as const
    return 'indeterminate' as const
  }, [selectedItemIds])

  const handleSelectGroup = useCallback((groupItems: Item[], checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      groupItems.forEach(item => {
        if (checked) next.add(item.itemId)
        else next.delete(item.itemId)
      })
      return next
    })
  }, [])

  const isAllSelected = useMemo(() => {
    if (items.length === 0) return false
    return items.every(item => selectedItemIds.has(item.itemId))
  }, [items, selectedItemIds])

  const toggleSelectAll = useCallback(() => {
    if (items.length === 0) return
    setSelectedItemIds(prev => {
      if (isAllSelected) return new Set()
      return new Set(items.map(i => i.itemId))
    })
  }, [isAllSelected, items])

  const handleAddSelected = useCallback(async () => {
    if (!currentAccountId) return
    if (selectedItems.length === 0) return

    setIsAdding(true)
    try {
      await Promise.all(
        selectedItems.map(item =>
          unifiedItemsService.updateItem(currentAccountId, item.itemId, { spaceId })
        )
      )
      showSuccess(selectedItems.length === 1 ? 'Item added to space' : `Added ${selectedItems.length} items to space`)
      setSelectedItemIds(new Set())
      if (onItemsAdded) {
        await onItemsAdded()
      }
    } catch (error) {
      console.error('SpaceItemPicker: failed to add selected items', error)
      showError('Failed to add selected items')
    } finally {
      setIsAdding(false)
    }
  }, [currentAccountId, onItemsAdded, selectedItems, showError, showSuccess, spaceId])

  const lastItemId = items[items.length - 1]?.itemId
  const selectedCount = selectedItemIds.size

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="relative w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search project items"
            className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-base sm:text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
              checked={isAllSelected}
              onChange={toggleSelectAll}
              disabled={items.length === 0}
            />
            Select all
          </label>
          <span className="text-xs text-gray-400">{items.length} available</span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading project items...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gray-500">No items available to add.</div>
        ) : (
          groupedItems.map(({ groupKey, items: groupItems }) => {
            if (groupItems.length === 1) {
              const item = groupItems[0]
              return (
                <ItemPreviewCard
                  key={item.itemId}
                  item={toPreviewData(item)}
                  isSelected={selectedItemIds.has(item.itemId)}
                  onSelect={toggleItemSelection}
                  showCheckbox
                  context="project"
                  projectId={projectId}
                  menuDirection={item.itemId === lastItemId ? 'top' : 'bottom'}
                />
              )
            }

            const groupSelectionState = getGroupSelectionState(groupItems)
            const summaryItem = groupItems[0]
            const hasDuplicates = groupItems.length > 1

            return (
              <CollapsedDuplicateGroup
                key={groupKey}
                groupId={groupKey}
                count={groupItems.length}
                selectionState={groupSelectionState}
                onToggleSelection={(checked) => handleSelectGroup(groupItems, checked)}
                summary={(
                  <div className="w-full">
                    <ItemPreviewCard
                      item={toPreviewData(summaryItem)}
                      showCheckbox={false}
                      context="project"
                      projectId={projectId}
                    />
                  </div>
                )}
              >
                <div className="space-y-3">
                  {groupItems.map((item, index) => (
                    <ItemPreviewCard
                      key={item.itemId}
                      item={toPreviewData(item)}
                      isSelected={selectedItemIds.has(item.itemId)}
                      onSelect={toggleItemSelection}
                      showCheckbox
                      context="project"
                      projectId={projectId}
                      duplicateCount={hasDuplicates ? groupItems.length : undefined}
                      duplicateIndex={hasDuplicates ? index + 1 : undefined}
                      menuDirection={item.itemId === lastItemId ? 'top' : 'bottom'}
                    />
                  ))}
                </div>
              </CollapsedDuplicateGroup>
            )
          })
        )}
      </div>

      {selectedCount > 0 && (
        <div className="fixed bottom-0 z-40 bg-white border-t border-gray-200 shadow-lg w-full left-0">
          <div className="px-4 py-3 flex items-center justify-between gap-3 max-w-5xl mx-auto">
            <span className="text-sm font-medium text-gray-700">
              {selectedCount} Selected
            </span>
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={isAdding}
              className={`inline-flex items-center px-3 py-2 border text-xs font-medium rounded ${
                isAdding
                  ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                  : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

