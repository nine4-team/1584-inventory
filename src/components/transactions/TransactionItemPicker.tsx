import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Item, Transaction } from '@/types'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { useToast } from '@/components/ui/ToastContext'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import ItemPreviewCard, { type ItemPreviewData } from '@/components/items/ItemPreviewCard'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import BlockingConfirmDialog from '@/components/ui/BlockingConfirmDialog'
import { getTransactionDisplayInfo } from '@/utils/transactionDisplayUtils'

type TransactionItemPickerProps = {
  transaction: Transaction
  projectId?: string | null
  transactionItemIds: string[]
  onItemsAdded?: () => void | Promise<void>
  containerId?: string
}

type PickerTab = 'suggested' | 'project' | 'outside'

type ReassignmentConflict = {
  item: Item
  transactionInfo: { title: string; amount: string } | null
  transactionId: string
}

const SUGGESTED_LIMIT = 50
const CONFLICT_PREVIEW_LIMIT = 10

const normalizeProjectId = (value?: string | null) => {
  if (!value || value === 'null') return null
  return value
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

export default function TransactionItemPicker({
  transaction,
  projectId,
  transactionItemIds,
  onItemsAdded,
  containerId
}: TransactionItemPickerProps) {
  const { currentAccountId } = useAccount()
  const { showError, showSuccess } = useToast()
  const [activeTab, setActiveTab] = useState<PickerTab>('suggested')
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestedItems, setSuggestedItems] = useState<Item[]>([])
  const [projectItems, setProjectItems] = useState<Item[]>([])
  const [outsideItems, setOutsideItems] = useState<Item[]>([])
  const [isLoadingSuggested, setIsLoadingSuggested] = useState(false)
  const [isLoadingProject, setIsLoadingProject] = useState(false)
  const [isLoadingOutside, setIsLoadingOutside] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const [pendingAddItems, setPendingAddItems] = useState<Item[]>([])
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [conflictItems, setConflictItems] = useState<ReassignmentConflict[]>([])
  const [shouldStick, setShouldStick] = useState(true)
  const [controlBarWidth, setControlBarWidth] = useState<number | undefined>(undefined)

  const targetProjectId = normalizeProjectId(projectId ?? transaction.projectId)
  const transactionId = transaction.transactionId
  const normalizedQuery = searchQuery.trim().toLowerCase()

  const transactionItemIdSet = useMemo(() => new Set(transactionItemIds), [transactionItemIds])
  const includeBusinessInventory = useMemo(() => targetProjectId !== null, [targetProjectId])

  const isItemAlreadyAdded = useCallback((item: Item) => {
    const itemTx = item.transactionId ?? item.latestTransactionId
    if (itemTx && itemTx === transactionId) return true
    return transactionItemIdSet.has(item.itemId)
  }, [transactionId, transactionItemIdSet])

  const getItemActionLabel = useCallback((item: Item) => {
    if (isItemAlreadyAdded(item)) return 'Added'
    return 'Add'
  }, [isItemAlreadyAdded])

  const getSelectableItems = useCallback((items: Item[]) => {
    return items.filter(item => !isItemAlreadyAdded(item))
  }, [isItemAlreadyAdded])

  const handleSelectItem = useCallback((itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(itemId)
      } else {
        next.delete(itemId)
      }
      return next
    })
  }, [])

  const handleSelectGroup = useCallback((items: Item[], checked: boolean) => {
    const selectableItems = getSelectableItems(items)
    if (selectableItems.length === 0) return
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      selectableItems.forEach(item => {
        if (checked) {
          next.add(item.itemId)
        } else {
          next.delete(item.itemId)
        }
      })
      return next
    })
  }, [getSelectableItems])

  const getGroupSelectionState = useCallback((items: Item[]) => {
    const selectableItems = getSelectableItems(items)
    if (selectableItems.length === 0) return 'unchecked'
    const selectedCount = selectableItems.filter(item => selectedItemIds.has(item.itemId)).length
    if (selectedCount === 0) return 'unchecked'
    if (selectedCount === selectableItems.length) return 'checked'
    return 'indeterminate'
  }, [getSelectableItems, selectedItemIds])

  const groupItems = useCallback((
    items: Item[],
    resolveContext: (item: Item) => 'project' | 'businessInventory'
  ) => {
    const grouped = new Map<string, { context: 'project' | 'businessInventory'; items: Item[] }>()
    items.forEach(item => {
      const context = resolveContext(item)
      const key = `${context}::${getInventoryListGroupKey(item, context)}`
      const existing = grouped.get(key)
      if (existing) {
        existing.items.push(item)
      } else {
        grouped.set(key, { context, items: [item] })
      }
    })
    return Array.from(grouped.entries())
  }, [])

  const suggestedMatches = useMemo(() => {
    if (!normalizedQuery) return suggestedItems
    return suggestedItems.filter(item => {
      const description = item.description?.toLowerCase() ?? ''
      const sku = item.sku?.toLowerCase() ?? ''
      const source = item.source?.toLowerCase() ?? ''
      const purchasePrice = item.purchasePrice?.toLowerCase() ?? ''
      const projectPrice = item.projectPrice?.toLowerCase() ?? ''
      return (
        description.includes(normalizedQuery) ||
        sku.includes(normalizedQuery) ||
        source.includes(normalizedQuery) ||
        purchasePrice.includes(normalizedQuery) ||
        projectPrice.includes(normalizedQuery)
      )
    })
  }, [normalizedQuery, suggestedItems])

  const projectMatches = useMemo(() => projectItems, [projectItems])
  const outsideMatches = useMemo(() => outsideItems, [outsideItems])

  const allVisibleItems = useMemo(() => {
    const map = new Map<string, Item>()
    suggestedMatches.forEach(item => map.set(item.itemId, item))
    projectMatches.forEach(item => map.set(item.itemId, item))
    outsideMatches.forEach(item => map.set(item.itemId, item))
    return map
  }, [suggestedMatches, projectMatches, outsideMatches])

  useEffect(() => {
    setSelectedItemIds(prev => {
      const next = new Set<string>()
      prev.forEach(itemId => {
        if (allVisibleItems.has(itemId)) next.add(itemId)
      })
      return next.size === prev.size ? prev : next
    })
  }, [allVisibleItems])

  useEffect(() => {
    if (!currentAccountId || !transaction.source) return
    let cancelled = false
    const loadSuggested = async () => {
      setIsLoadingSuggested(true)
      try {
        const items = await transactionService.getSuggestedItemsForTransaction(
          currentAccountId,
          transaction.source,
          SUGGESTED_LIMIT
        )
        if (!cancelled) {
          setSuggestedItems(items || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('TransactionItemPicker: failed to load suggested items', error)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSuggested(false)
        }
      }
    }
    void loadSuggested()
    return () => {
      cancelled = true
    }
  }, [currentAccountId, transaction.source])

  useEffect(() => {
    if (!currentAccountId || !targetProjectId) {
      setProjectItems([])
      return
    }
    let cancelled = false
    const loadProjectItems = async () => {
      setIsLoadingProject(true)
      try {
        const items = await unifiedItemsService.getItemsByProject(currentAccountId, targetProjectId, {
          searchQuery: normalizedQuery || undefined
        })
        if (!cancelled) {
          setProjectItems(items || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('TransactionItemPicker: failed to load project items', error)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProject(false)
        }
      }
    }
    void loadProjectItems()
    return () => {
      cancelled = true
    }
  }, [currentAccountId, normalizedQuery, targetProjectId])

  useEffect(() => {
    if (!currentAccountId) {
      setOutsideItems([])
      return
    }
    let cancelled = false
    const loadOutsideItems = async () => {
      setIsLoadingOutside(true)
      try {
        const items = await unifiedItemsService.searchItemsOutsideProject(currentAccountId, {
          excludeProjectId: targetProjectId,
          includeBusinessInventory,
          searchQuery: normalizedQuery || undefined
        })
        if (!cancelled) {
          setOutsideItems(items || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('TransactionItemPicker: failed to load outside items', error)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingOutside(false)
        }
      }
    }
    void loadOutsideItems()
    return () => {
      cancelled = true
    }
  }, [currentAccountId, includeBusinessInventory, normalizedQuery, targetProjectId])

  useEffect(() => {
    if (!normalizedQuery) return
    const suggestedCount = suggestedMatches.length
    const projectCount = projectMatches.length
    const outsideCount = outsideMatches.length
    const availableTabs: PickerTab[] = ['suggested']
    if (targetProjectId) {
      availableTabs.push('project')
    }
    availableTabs.push('outside')
    const counts: Record<PickerTab, number> = {
      suggested: suggestedCount,
      project: projectCount,
      outside: outsideCount
    }
    const nextTab = availableTabs.find(tab => counts[tab] > 0)
    if (nextTab && counts[activeTab] === 0 && activeTab !== nextTab) {
      setActiveTab(nextTab)
    }
  }, [activeTab, outsideMatches.length, projectMatches.length, suggestedMatches.length, targetProjectId])

  const currentTabItems = useMemo(() => {
    if (activeTab === 'outside') return outsideMatches
    if (activeTab === 'project') return projectMatches
    return suggestedMatches
  }, [activeTab, outsideMatches, projectMatches, suggestedMatches])

  const selectableCurrentItems = useMemo(
    () => getSelectableItems(currentTabItems),
    [currentTabItems, getSelectableItems]
  )

  const isCurrentTabAllSelected = useMemo(() => {
    if (selectableCurrentItems.length === 0) return false
    return selectableCurrentItems.every(item => selectedItemIds.has(item.itemId))
  }, [selectableCurrentItems, selectedItemIds])

  const handleToggleSelectAllCurrent = useCallback(() => {
    if (selectableCurrentItems.length === 0) return
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (isCurrentTabAllSelected) {
        selectableCurrentItems.forEach(item => next.delete(item.itemId))
      } else {
        selectableCurrentItems.forEach(item => next.add(item.itemId))
      }
      return next
    })
  }, [isCurrentTabAllSelected, selectableCurrentItems])

  useEffect(() => {
    if (!containerId) {
      setShouldStick(true)
      return
    }

    const checkScrollPosition = () => {
      const container = document.getElementById(containerId)
      const sentinel = document.getElementById('transaction-items-sentinel')

      if (!container || !sentinel) {
        setShouldStick(true)
        return
      }

      const sentinelRect = sentinel.getBoundingClientRect()
      const isFullyScrolledPast = sentinelRect.bottom < 0
      setShouldStick(!isFullyScrolledPast)
    }

    checkScrollPosition()

    const sentinel = document.getElementById('transaction-items-sentinel')
    let observer: IntersectionObserver | null = null

    if (sentinel) {
      observer = new IntersectionObserver(
        () => {
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
      setControlBarWidth(undefined)
      return
    }

    const updateWidth = () => {
      const container = document.getElementById(containerId)
      if (container) {
        setControlBarWidth(container.getBoundingClientRect().width)
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

  const getConflictTransactionId = useCallback((item: Item) => {
    const linkedTransactionId = item.transactionId ?? item.latestTransactionId
    if (!linkedTransactionId || linkedTransactionId === transactionId) return null
    return linkedTransactionId
  }, [transactionId])

  const loadConflictDetails = useCallback(async (items: Item[]) => {
    if (!currentAccountId) return []
    const conflicts = items
      .map(item => ({ item, transactionId: getConflictTransactionId(item) }))
      .filter((entry): entry is { item: Item; transactionId: string } => Boolean(entry.transactionId))

    if (conflicts.length === 0) return []

    const uniqueTransactionIds = Array.from(new Set(conflicts.map(entry => entry.transactionId)))
    const infoEntries = await Promise.all(
      uniqueTransactionIds.map(id => getTransactionDisplayInfo(currentAccountId, id, 28))
    )
    const infoMap = new Map<string, { title: string; amount: string } | null>(
      uniqueTransactionIds.map((id, index) => [id, infoEntries[index] ?? null])
    )

    return conflicts.map(entry => ({
      item: entry.item,
      transactionId: entry.transactionId,
      transactionInfo: infoMap.get(entry.transactionId) ?? null
    }))
  }, [currentAccountId, getConflictTransactionId])

  const performAddItemsToTransaction = useCallback(async (items: Item[]) => {
    if (!currentAccountId || !transactionId) return
    const addableItems = items.filter(item => !isItemAlreadyAdded(item))
    if (addableItems.length === 0) return

    setIsAdding(true)
    const resolvedTargetProjectId = targetProjectId ?? null
    try {
      const itemsToRehome = addableItems.filter(item => (
        normalizeProjectId(item.projectId ?? null) !== resolvedTargetProjectId
      ))

      if (itemsToRehome.length > 0) {
        await Promise.all(itemsToRehome.map(item =>
          unifiedItemsService.updateItem(currentAccountId, item.itemId, {
            projectId: resolvedTargetProjectId
          })
        ))
      }

      const groupedByPreviousTransaction = new Map<string | null, Item[]>()
      addableItems.forEach(item => {
        const previousTransactionId = getConflictTransactionId(item)
        const key = previousTransactionId ?? null
        const group = groupedByPreviousTransaction.get(key) ?? []
        group.push(item)
        groupedByPreviousTransaction.set(key, group)
      })

      for (const [previousTransactionId, groupedItems] of groupedByPreviousTransaction.entries()) {
        const itemIds = groupedItems.map(item => item.itemId)
        if (itemIds.length === 1) {
          await unifiedItemsService.assignItemToTransaction(
            currentAccountId,
            transactionId,
            itemIds[0],
            { itemPreviousTransactionId: previousTransactionId ?? undefined }
          )
        } else {
          await unifiedItemsService.assignItemsToTransaction(
            currentAccountId,
            transactionId,
            itemIds,
            { itemPreviousTransactionId: previousTransactionId ?? undefined }
          )
        }
      }

      const addedItemIds = new Set(addableItems.map(item => item.itemId))
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        addableItems.forEach(item => next.delete(item.itemId))
        return next
      })
      const applyLocalUpdates = (prev: Item[]) => prev.map(item => (
        addedItemIds.has(item.itemId)
          ? {
              ...item,
              projectId: resolvedTargetProjectId,
              transactionId,
              latestTransactionId: transactionId
            }
          : item
      ))
      setSuggestedItems(applyLocalUpdates)
      setProjectItems(applyLocalUpdates)
      setOutsideItems(prev => prev.filter(item => !addedItemIds.has(item.itemId)))

      showSuccess(addableItems.length === 1 ? 'Item added' : `Added ${addableItems.length} items`)
      if (onItemsAdded) {
        await onItemsAdded()
      }
    } catch (error) {
      console.error('TransactionItemPicker: failed to add items', error)
      showError('Failed to add selected items')
    } finally {
      setIsAdding(false)
    }
  }, [currentAccountId, getConflictTransactionId, isItemAlreadyAdded, onItemsAdded, showError, showSuccess, targetProjectId, transactionId])

  const addItemsToTransaction = useCallback(async (items: Item[]) => {
    if (!currentAccountId || !transactionId) return
    const addableItems = items.filter(item => !isItemAlreadyAdded(item))
    if (addableItems.length === 0) return

    const conflicts = await loadConflictDetails(addableItems)
    if (conflicts.length > 0) {
      setPendingAddItems(addableItems)
      setConflictItems(conflicts)
      setIsConfirmOpen(true)
      return
    }

    await performAddItemsToTransaction(addableItems)
  }, [currentAccountId, isItemAlreadyAdded, loadConflictDetails, performAddItemsToTransaction, transactionId])

  const handleConfirmReassign = useCallback(async () => {
    if (pendingAddItems.length === 0) {
      setIsConfirmOpen(false)
      setConflictItems([])
      return
    }
    setIsConfirming(true)
    try {
      await performAddItemsToTransaction(pendingAddItems)
    } finally {
      setIsConfirming(false)
      setIsConfirmOpen(false)
      setPendingAddItems([])
      setConflictItems([])
    }
  }, [pendingAddItems, performAddItemsToTransaction])

  const handleCancelReassign = useCallback(() => {
    setIsConfirmOpen(false)
    setPendingAddItems([])
    setConflictItems([])
  }, [])

  const handleAddSelected = useCallback(async () => {
    const items = Array.from(selectedItemIds)
      .map(itemId => allVisibleItems.get(itemId))
      .filter((item): item is Item => Boolean(item))
    await addItemsToTransaction(items)
  }, [addItemsToTransaction, allVisibleItems, selectedItemIds])

  const renderItemRow = useCallback((
    item: Item,
    contextOverride?: 'project' | 'businessInventory',
    projectIdOverride?: string | null,
    duplicateCount?: number,
    duplicateIndex?: number
  ) => {
    const isAdded = isItemAlreadyAdded(item)
    const actionLabel = getItemActionLabel(item)
    const context = contextOverride ?? (normalizeProjectId(item.projectId ?? null) ? 'project' : 'businessInventory')
    const resolvedProjectId = projectIdOverride ?? item.projectId ?? null

    return (
      <ItemPreviewCard
        key={item.itemId}
        item={toPreviewData(item)}
        isSelected={selectedItemIds.has(item.itemId)}
        onSelect={isAdded ? undefined : handleSelectItem}
        showCheckbox={!isAdded}
        context={context}
        projectId={normalizeProjectId(resolvedProjectId) ?? undefined}
        duplicateCount={duplicateCount}
        duplicateIndex={duplicateIndex}
        headerAction={(
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void addItemsToTransaction([item])
            }}
            disabled={isAdded || isAdding}
            className={`inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded ${
              isAdded
                ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
            }`}
          >
            <Plus className="h-3 w-3 mr-1" />
            {actionLabel}
          </button>
        )}
      />
    )
  }, [addItemsToTransaction, getItemActionLabel, handleSelectItem, isAdding, isItemAlreadyAdded, selectedItemIds])

  const renderGroupedItems = useCallback((
    items: Item[],
    resolveContext: (item: Item) => 'project' | 'businessInventory',
    projectIdOverride?: string | null
  ) => {
    const grouped = groupItems(items, resolveContext)
    return grouped.map(([groupKey, groupData]) => {
      const { context, items: groupItems } = groupData
      if (groupItems.length === 1) {
        return renderItemRow(groupItems[0], context, projectIdOverride)
      }
      const groupSelectionState = getGroupSelectionState(groupItems)
      const selectableItems = getSelectableItems(groupItems)
      const canAddGroup = selectableItems.length > 0 && !isAdding
      const summaryItem = groupItems[0]
      const hasDuplicates = groupItems.length > 1
      return (
        <CollapsedDuplicateGroup
          key={groupKey}
          groupId={groupKey}
          count={groupItems.length}
          selectionState={groupSelectionState}
          onToggleSelection={selectableItems.length > 0 ? (checked) => handleSelectGroup(groupItems, checked) : undefined}
          topRowContent={
            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void addItemsToTransaction(groupItems)
                }}
                disabled={!canAddGroup}
                className={`inline-flex items-center px-2 py-1 border text-xs font-medium rounded ${
                  canAddGroup
                    ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                    : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                }`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add All
              </button>
            </div>
          }
          summary={
            <div className="w-full">
              <ItemPreviewCard
                item={toPreviewData(summaryItem)}
                showCheckbox={false}
                context={context}
                projectId={normalizeProjectId(projectIdOverride ?? summaryItem.projectId ?? null) ?? undefined}
              />
            </div>
          }
        >
          <div className="space-y-3">
            {groupItems.map((item, index) => renderItemRow(
              item,
              context,
              projectIdOverride,
              hasDuplicates ? groupItems.length : undefined,
              hasDuplicates ? index + 1 : undefined
            ))}
          </div>
        </CollapsedDuplicateGroup>
      )
    })
  }, [addItemsToTransaction, getGroupSelectionState, getSelectableItems, groupItems, handleSelectGroup, isAdding, renderItemRow])

  const selectedCount = selectedItemIds.size
  const conflictPreview = useMemo(() => conflictItems.slice(0, CONFLICT_PREVIEW_LIMIT), [conflictItems])
  const remainingConflicts = conflictItems.length - conflictPreview.length

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="relative w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search suggested, project, and outside items"
            className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="mt-4 border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('suggested')}
            className={`pb-2 text-xs font-semibold border-b-2 ${
              activeTab === 'suggested'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Suggested ({suggestedMatches.length})
          </button>
          {targetProjectId && (
            <button
              type="button"
              onClick={() => setActiveTab('project')}
              className={`pb-2 text-xs font-semibold border-b-2 ${
                activeTab === 'project'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Project ({projectMatches.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('outside')}
            className={`pb-2 text-xs font-semibold border-b-2 ${
              activeTab === 'outside'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Outside ({outsideMatches.length})
          </button>
        </nav>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
            checked={isCurrentTabAllSelected}
            onChange={handleToggleSelectAllCurrent}
          />
          Select all
        </label>
        <span className="text-xs text-gray-400">
          {selectableCurrentItems.length} available
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {activeTab === 'suggested' && (
          <>
            {isLoadingSuggested ? (
              <div className="text-sm text-gray-500">Loading suggested items...</div>
            ) : suggestedMatches.length > 0 ? (
              renderGroupedItems(
                suggestedMatches,
                (item) => (normalizeProjectId(item.projectId ?? null) ? 'project' : 'businessInventory')
              )
            ) : (
              <div className="text-sm text-gray-500">No suggested items match this search.</div>
            )}
          </>
        )}
        {activeTab === 'project' && targetProjectId && (
          <>
            {isLoadingProject ? (
              <div className="text-sm text-gray-500">Loading project items...</div>
            ) : projectMatches.length > 0 ? (
              renderGroupedItems(projectMatches, () => 'project', targetProjectId)
            ) : (
              <div className="text-sm text-gray-500">No project items match this search.</div>
            )}
          </>
        )}
        {activeTab === 'outside' && (
          <>
            {isLoadingOutside ? (
              <div className="text-sm text-gray-500">Loading outside items...</div>
            ) : outsideMatches.length > 0 ? (
              renderGroupedItems(
                outsideMatches,
                (item) => (normalizeProjectId(item.projectId ?? null) ? 'project' : 'businessInventory')
              )
            ) : (
              <div className="text-sm text-gray-500">No outside items match this search.</div>
            )}
          </>
        )}
      </div>

      {selectedCount > 0 && (
        <div
          className={`${shouldStick ? 'fixed bottom-0 z-40' : 'relative z-10'} bg-white border-t border-gray-200 shadow-lg`}
          style={
            shouldStick
              ? {
                  width: controlBarWidth ? `${controlBarWidth}px` : '100%',
                  left: controlBarWidth ? '50%' : '0',
                  transform: controlBarWidth ? 'translateX(-50%)' : 'none',
                  maxWidth: '100%'
                }
              : { width: '100%' }
          }
        >
          <div className="px-4 py-3 flex items-center justify-between gap-3">
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

      <BlockingConfirmDialog
        open={isConfirmOpen}
        title={`Reassign ${conflictItems.length === 1 ? 'item' : 'items'}?`}
        description={(
          <div className="space-y-3 text-sm text-gray-700">
            <p>These items are already linked to another transaction. Reassign them anyway?</p>
            <div className="space-y-2">
              {conflictPreview.map(conflict => {
                const description = conflict.item.description || conflict.item.sku || 'Untitled item'
                const transactionLabel = conflict.transactionInfo
                  ? `${conflict.transactionInfo.title} (${conflict.transactionInfo.amount})`
                  : 'Another transaction'
                return (
                  <div key={conflict.item.itemId} className="flex items-start justify-between gap-3">
                    <span className="text-gray-900">{description}</span>
                    <span className="text-gray-500 text-xs">{transactionLabel}</span>
                  </div>
                )
              })}
              {remainingConflicts > 0 && (
                <div className="text-xs text-gray-500">and {remainingConflicts} more</div>
              )}
            </div>
          </div>
        )}
        confirmLabel="Reassign items"
        confirmVariant="danger"
        isConfirming={isConfirming}
        onConfirm={handleConfirmReassign}
        onCancel={handleCancelReassign}
      />
    </div>
  )
}
