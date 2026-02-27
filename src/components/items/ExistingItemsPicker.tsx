import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Search, Sparkles, X } from 'lucide-react'
import { Item } from '@/types'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { useToast } from '@/components/ui/ToastContext'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import ItemPreviewCard, { type ItemPreviewData } from '@/components/items/ItemPreviewCard'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import { searchItemsByDescription } from '@/utils/aiSpaceSearch'

type ExistingItemsPickerMode = 'space' | 'transaction'

type PickerTab = 'suggested' | 'project' | 'outside'

type ItemDisableState = {
  disabled: boolean
  reason?: string
}

type ExistingItemsPickerProps = {
  mode: ExistingItemsPickerMode
  projectId?: string | null
  transactionSource?: string | null
  includeSuggested?: boolean
  includeProject?: boolean
  includeOutside?: boolean
  includeBusinessInventory?: boolean
  excludedItemIds?: Set<string>
  isItemAlreadyAdded?: (item: Item) => boolean
  isItemDisabled?: (item: Item) => ItemDisableState
  onAddItems: (items: Item[]) => void | Promise<void>
  containerId?: string
  sentinelId?: string
  stickyMode?: 'fixed' | 'sticky'
}

const SUGGESTED_LIMIT = 50

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

const resolveSearchPlaceholder = (tabs: PickerTab[]) => {
  const labels = tabs.map(tab => {
    if (tab === 'suggested') return 'suggested'
    if (tab === 'project') return 'project'
    return 'outside'
  })
  if (labels.length === 1) return `Search ${labels[0]} items`
  if (labels.length === 2) return `Search ${labels[0]} and ${labels[1]} items`
  return `Search ${labels[0]}, ${labels[1]}, and ${labels[2]} items`
}

export default function ExistingItemsPicker({
  mode,
  projectId,
  transactionSource,
  includeSuggested,
  includeProject,
  includeOutside,
  includeBusinessInventory,
  excludedItemIds,
  isItemAlreadyAdded,
  isItemDisabled,
  onAddItems,
  containerId,
  sentinelId,
  stickyMode = 'fixed'
}: ExistingItemsPickerProps) {
  const { currentAccountId } = useAccount()
  const { showError } = useToast()
  const [activeTab, setActiveTab] = useState<PickerTab>(() => {
    if (mode === 'transaction') return 'suggested'
    return 'project'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestedItems, setSuggestedItems] = useState<Item[]>([])
  const [projectItems, setProjectItems] = useState<Item[]>([])
  const [outsideItems, setOutsideItems] = useState<Item[]>([])
  const [isLoadingSuggested, setIsLoadingSuggested] = useState(false)
  const [isLoadingProject, setIsLoadingProject] = useState(false)
  const [isLoadingOutside, setIsLoadingOutside] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [isAiSearching, setIsAiSearching] = useState(false)
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([])
  const [aiFilteredIds, setAiFilteredIds] = useState<Set<string> | null>(null)
  const [shouldStick, setShouldStick] = useState(true)
  const [controlBarWidth, setControlBarWidth] = useState<number | undefined>(undefined)

  const targetProjectId = normalizeProjectId(projectId)
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const resolvedIncludeSuggested = mode === 'transaction' && (includeSuggested ?? true)
  const resolvedIncludeProject = includeProject ?? true
  const resolvedIncludeOutside = includeOutside ?? (mode === 'transaction')
  const resolvedIncludeBusinessInventory = includeBusinessInventory ?? (
    resolvedIncludeOutside && (mode === 'transaction' ? targetProjectId !== null : true)
  )

  const availableTabs = useMemo(() => {
    const tabs: PickerTab[] = []
    if (resolvedIncludeSuggested) tabs.push('suggested')
    if (resolvedIncludeProject && targetProjectId) tabs.push('project')
    if (resolvedIncludeOutside) tabs.push('outside')
    return tabs
  }, [resolvedIncludeOutside, resolvedIncludeProject, resolvedIncludeSuggested, targetProjectId])

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0] ?? (mode === 'transaction' ? 'suggested' : 'project'))
    }
  }, [activeTab, availableTabs, mode])

  const applyExclusions = useCallback((items: Item[]) => {
    if (!excludedItemIds || excludedItemIds.size === 0) return items
    return items.filter(item => !excludedItemIds.has(item.itemId))
  }, [excludedItemIds])

  const getItemDisableState = useCallback((item: Item): ItemDisableState => {
    if (isItemDisabled) return isItemDisabled(item)
    return { disabled: false }
  }, [isItemDisabled])

  const isItemMarkedAdded = useCallback((item: Item) => {
    if (!isItemAlreadyAdded) return false
    return isItemAlreadyAdded(item)
  }, [isItemAlreadyAdded])

  const isItemSelectable = useCallback((item: Item) => {
    if (isItemMarkedAdded(item)) return false
    return !getItemDisableState(item).disabled
  }, [getItemDisableState, isItemMarkedAdded])

  const getItemActionLabel = useCallback((item: Item) => {
    if (isItemMarkedAdded(item)) return 'Added'
    return 'Add'
  }, [isItemMarkedAdded])

  const getSelectableItems = useCallback((items: Item[]) => {
    return items.filter(isItemSelectable)
  }, [isItemSelectable])

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

  const suggestedFiltered = useMemo(() => {
    if (!aiFilteredIds) return suggestedMatches
    return suggestedMatches.filter(item => aiFilteredIds.has(item.itemId))
  }, [aiFilteredIds, suggestedMatches])

  const projectFiltered = useMemo(() => {
    if (!aiFilteredIds) return projectMatches
    return projectMatches.filter(item => aiFilteredIds.has(item.itemId))
  }, [aiFilteredIds, projectMatches])

  const outsideFiltered = useMemo(() => {
    if (!aiFilteredIds) return outsideMatches
    return outsideMatches.filter(item => aiFilteredIds.has(item.itemId))
  }, [aiFilteredIds, outsideMatches])

  const allVisibleItems = useMemo(() => {
    const map = new Map<string, Item>()
    suggestedFiltered.forEach(item => map.set(item.itemId, item))
    projectFiltered.forEach(item => map.set(item.itemId, item))
    outsideFiltered.forEach(item => map.set(item.itemId, item))
    return map
  }, [suggestedFiltered, projectFiltered, outsideFiltered])

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
    if (!currentAccountId || !resolvedIncludeSuggested || !transactionSource) {
      setSuggestedItems([])
      return
    }
    let cancelled = false
    const loadSuggested = async () => {
      setIsLoadingSuggested(true)
      try {
        const items = await transactionService.getSuggestedItemsForTransaction(
          currentAccountId,
          transactionSource,
          SUGGESTED_LIMIT
        )
        if (!cancelled) {
          setSuggestedItems(applyExclusions(items || []))
        }
      } catch (error) {
        if (!cancelled) {
          console.error('ExistingItemsPicker: failed to load suggested items', error)
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
  }, [applyExclusions, currentAccountId, resolvedIncludeSuggested, transactionSource])

  useEffect(() => {
    if (!currentAccountId || !resolvedIncludeProject || !targetProjectId) {
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
          setProjectItems(applyExclusions(items || []))
        }
      } catch (error) {
        if (!cancelled) {
          console.error('ExistingItemsPicker: failed to load project items', error)
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
  }, [applyExclusions, currentAccountId, normalizedQuery, resolvedIncludeProject, targetProjectId])

  useEffect(() => {
    if (!currentAccountId || !resolvedIncludeOutside) {
      setOutsideItems([])
      return
    }
    let cancelled = false
    const loadOutsideItems = async () => {
      setIsLoadingOutside(true)
      try {
        const items = await unifiedItemsService.searchItemsOutsideProject(currentAccountId, {
          excludeProjectId: targetProjectId,
          includeBusinessInventory: resolvedIncludeBusinessInventory,
          searchQuery: normalizedQuery || undefined
        })
        if (!cancelled) {
          setOutsideItems(applyExclusions(items || []))
        }
      } catch (error) {
        if (!cancelled) {
          console.error('ExistingItemsPicker: failed to load outside items', error)
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
  }, [applyExclusions, currentAccountId, normalizedQuery, resolvedIncludeBusinessInventory, resolvedIncludeOutside, targetProjectId])

  useEffect(() => {
    if (!normalizedQuery) return
    const counts: Record<PickerTab, number> = {
      suggested: suggestedFiltered.length,
      project: projectFiltered.length,
      outside: outsideFiltered.length
    }
    const nextTab = availableTabs.find(tab => counts[tab] > 0)
    if (nextTab && counts[activeTab] === 0 && activeTab !== nextTab) {
      setActiveTab(nextTab)
    }
  }, [activeTab, availableTabs, normalizedQuery, outsideFiltered.length, projectFiltered.length, suggestedFiltered.length])

  const currentTabItems = useMemo(() => {
    if (activeTab === 'outside') return outsideFiltered
    if (activeTab === 'project') return projectFiltered
    return suggestedFiltered
  }, [activeTab, outsideFiltered, projectFiltered, suggestedFiltered])

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
    if (stickyMode !== 'fixed') return
    if (!containerId || !sentinelId) {
      setShouldStick(true)
      return
    }

    const checkScrollPosition = () => {
      const container = document.getElementById(containerId)
      const sentinel = document.getElementById(sentinelId)

      if (!container || !sentinel) {
        setShouldStick(true)
        return
      }

      const sentinelRect = sentinel.getBoundingClientRect()
      const isFullyScrolledPast = sentinelRect.bottom < 0
      setShouldStick(!isFullyScrolledPast)
    }

    checkScrollPosition()

    const sentinel = document.getElementById(sentinelId)
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
  }, [containerId, sentinelId, stickyMode])

  useEffect(() => {
    if (stickyMode !== 'fixed') return
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
  }, [containerId, stickyMode])

  const handleAddItems = useCallback(async (items: Item[]) => {
    if (isAdding || items.length === 0) return
    const addableItems = items.filter(isItemSelectable)
    if (addableItems.length === 0) return
    setIsAdding(true)
    try {
      await onAddItems(addableItems)
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        addableItems.forEach(item => next.delete(item.itemId))
        return next
      })
    } catch (error) {
      console.error('ExistingItemsPicker: failed to add items', error)
      showError('Failed to add selected items')
    } finally {
      setIsAdding(false)
    }
  }, [isAdding, isItemSelectable, onAddItems, showError])

  const handleAddSelected = useCallback(async () => {
    const items = Array.from(selectedItemIds)
      .map(itemId => allVisibleItems.get(itemId))
      .filter((item): item is Item => Boolean(item))
    await handleAddItems(items)
  }, [allVisibleItems, handleAddItems, selectedItemIds])

  const handleAiSearch = useCallback(async () => {
    if (!aiDescription.trim() || isAiSearching) return
    setIsAiSearching(true)
    setAiUnmatched([])
    try {
      const allItems = Array.from(allVisibleItems.values()).map(item => ({
        id: item.itemId,
        name: item.description ?? '',
        notes: item.notes ?? null,
      }))
      const result = await searchItemsByDescription(aiDescription.trim(), allItems)
      const matchedIds = new Set(
        result.matches
          .map(m => m.itemId)
          .filter(id => allVisibleItems.has(id))
      )
      setAiFilteredIds(matchedIds)
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        matchedIds.forEach(id => next.add(id))
        return next
      })
      setAiUnmatched(result.unmatched)
    } catch {
      showError('AI search failed. Check your connection and try again.')
    } finally {
      setIsAiSearching(false)
      setAiMode(false)
      setAiDescription('')
    }
  }, [aiDescription, allVisibleItems, isAiSearching, showError])

  const renderItemRow = useCallback((
    item: Item,
    contextOverride?: 'project' | 'businessInventory',
    projectIdOverride?: string | null,
    duplicateCount?: number,
    duplicateIndex?: number,
    isLastItem?: boolean
  ) => {
    const isAdded = isItemMarkedAdded(item)
    const disableState = getItemDisableState(item)
    const isSelectable = isItemSelectable(item)
    const actionLabel = getItemActionLabel(item)
    const context = contextOverride ?? (normalizeProjectId(item.projectId ?? null) ? 'project' : 'businessInventory')
    const resolvedProjectId = projectIdOverride ?? item.projectId ?? null
    const footer = disableState.reason ? (
      <span className="text-xs text-gray-500">{disableState.reason}</span>
    ) : undefined

    return (
      <ItemPreviewCard
        key={item.itemId}
        item={toPreviewData(item)}
        isSelected={selectedItemIds.has(item.itemId)}
        onSelect={isSelectable ? handleSelectItem : undefined}
        showCheckbox={isSelectable}
        context={context}
        projectId={normalizeProjectId(resolvedProjectId) ?? undefined}
        duplicateCount={duplicateCount}
        duplicateIndex={duplicateIndex}
        menuDirection={isLastItem ? 'top' : 'bottom'}
        footer={footer}
        headerAction={(
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void handleAddItems([item])
            }}
            disabled={isAdded || disableState.disabled || isAdding}
            className={`inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded ${
              isAdded || disableState.disabled || isAdding
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
  }, [getItemActionLabel, getItemDisableState, handleAddItems, handleSelectItem, isAdding, isItemMarkedAdded, isItemSelectable, selectedItemIds])

  const renderGroupedItems = useCallback((
    items: Item[],
    resolveContext: (item: Item) => 'project' | 'businessInventory',
    projectIdOverride?: string | null
  ) => {
    const lastItemId = items[items.length - 1]?.itemId
    const grouped = groupItems(items, resolveContext)
    return grouped.map(([groupKey, groupData]) => {
      const { context, items: groupItems } = groupData
      if (groupItems.length === 1) {
        const item = groupItems[0]
        return renderItemRow(item, context, projectIdOverride, undefined, undefined, item.itemId === lastItemId)
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
                  void handleAddItems(groupItems)
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
              hasDuplicates ? index + 1 : undefined,
              item.itemId === lastItemId
            ))}
          </div>
        </CollapsedDuplicateGroup>
      )
    })
  }, [getGroupSelectionState, getSelectableItems, groupItems, handleAddItems, handleSelectGroup, isAdding, renderItemRow])

  const selectedCount = selectedItemIds.size
  const searchPlaceholder = resolveSearchPlaceholder(availableTabs)

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setAiFilteredIds(null) }}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-base sm:text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <button
          type="button"
          onClick={() => { setAiMode(true); setAiUnmatched([]); setAiFilteredIds(null) }}
          disabled={isAiSearching}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 whitespace-nowrap flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          title="AI Search"
        >
          {isAiSearching
            ? <Loader2 className="h-4 w-4 animate-spin text-primary-500" />
            : <Sparkles className="h-4 w-4 text-primary-500" />
          }
          AI Search
        </button>
      </div>

      {aiMode && (
        <div className="mt-2 flex gap-2 items-start">
          <input
            type="text"
            autoFocus
            value={aiDescription}
            onChange={(event) => setAiDescription(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleAiSearch() }}
            placeholder="Describe items to find, e.g. white linen sofa, brass lamp…"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-base sm:text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={() => void handleAiSearch()}
            disabled={!aiDescription.trim() || isAiSearching}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-primary-500 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
          >
            {isAiSearching && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAiSearching ? 'Searching…' : 'Find Items'}
          </button>
          <button
            type="button"
            onClick={() => { setAiMode(false); setAiDescription(''); setAiUnmatched([]) }}
            className="p-2 text-gray-400 hover:text-gray-600"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {aiFilteredIds !== null && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
          <span className="flex-1 text-xs text-primary-800">
            AI Results — {aiFilteredIds.size} match{aiFilteredIds.size !== 1 ? 'es' : ''}
          </span>
          <button
            type="button"
            onClick={() => setAiFilteredIds(null)}
            className="text-primary-500 hover:text-primary-700 flex-shrink-0 text-xs font-medium"
          >
            Clear
          </button>
        </div>
      )}

      {aiUnmatched.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="flex-1 text-xs text-amber-800">
            No match found for: {aiUnmatched.map(p => `"${p}"`).join(', ')}
          </span>
          <button
            type="button"
            onClick={() => setAiUnmatched([])}
            className="text-amber-500 hover:text-amber-700 flex-shrink-0"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {availableTabs.length > 1 && (
        <div className="mt-4 border-b border-gray-200">
          <nav className="-mb-px flex flex-wrap gap-3">
            {availableTabs.includes('suggested') && (
              <button
                type="button"
                onClick={() => setActiveTab('suggested')}
                className={`pb-2 text-xs font-semibold border-b-2 ${
                  activeTab === 'suggested'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Suggested ({suggestedFiltered.length})
              </button>
            )}
            {availableTabs.includes('project') && (
              <button
                type="button"
                onClick={() => setActiveTab('project')}
                className={`pb-2 text-xs font-semibold border-b-2 ${
                  activeTab === 'project'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Project ({projectFiltered.length})
              </button>
            )}
            {availableTabs.includes('outside') && (
              <button
                type="button"
                onClick={() => setActiveTab('outside')}
                className={`pb-2 text-xs font-semibold border-b-2 ${
                  activeTab === 'outside'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Outside ({outsideFiltered.length})
              </button>
            )}
          </nav>
        </div>
      )}

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
            ) : suggestedFiltered.length > 0 ? (
              renderGroupedItems(
                suggestedFiltered,
                (item) => (normalizeProjectId(item.projectId ?? null) ? 'project' : 'businessInventory')
              )
            ) : (
              <div className="text-sm text-gray-500">No suggested items match this search.</div>
            )}
          </>
        )}
        {activeTab === 'project' && (
          <>
            {isLoadingProject ? (
              <div className="text-sm text-gray-500">Loading project items...</div>
            ) : projectFiltered.length > 0 ? (
              renderGroupedItems(projectFiltered, () => 'project', targetProjectId)
            ) : (
              <div className="text-sm text-gray-500">No project items match this search.</div>
            )}
          </>
        )}
        {activeTab === 'outside' && (
          <>
            {isLoadingOutside ? (
              <div className="text-sm text-gray-500">Loading outside items...</div>
            ) : outsideFiltered.length > 0 ? (
              renderGroupedItems(
                outsideFiltered,
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
          className={
            stickyMode === 'fixed'
              ? `${shouldStick ? 'fixed bottom-0 z-40' : 'relative z-10'} bg-white border-t border-gray-200 shadow-lg`
              : 'sticky bottom-0 z-20 bg-white border-t border-gray-200 shadow-lg'
          }
          style={
            stickyMode === 'fixed' && shouldStick
              ? {
                  width: controlBarWidth ? `${controlBarWidth}px` : '100%',
                  left: controlBarWidth ? '50%' : '0',
                  transform: controlBarWidth ? 'translateX(-50%)' : 'none',
                  maxWidth: '100%'
                }
              : stickyMode === 'fixed'
                ? { width: '100%' }
                : undefined
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
    </div>
  )
}
