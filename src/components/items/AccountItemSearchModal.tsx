import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { Item } from '@/types'
import { projectService, unifiedItemsService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import AddExistingItemsModal from '@/components/items/AddExistingItemsModal'
import ItemPreviewCard, { type ItemPreviewData } from '@/components/items/ItemPreviewCard'
import { isAmountLikeQuery, matchesItemSearch } from '@/utils/itemSearch'

type SearchScope = 'all' | 'projects' | 'businessInventory'

type AccountItemSearchModalProps = {
  open: boolean
  onClose: () => void
}

const PAGE_LIMIT = 30
const DEBOUNCE_MS = 250

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
  transactionId: item.transactionId ?? item.latestTransactionId ?? null,
  source: item.source,
  space: item.space,
  businessInventoryLocation: item.businessInventoryLocation,
  bookmark: item.bookmark,
  notes: item.notes
})

export default function AccountItemSearchModal({ open, onClose }: AccountItemSearchModalProps) {
  const { currentAccountId } = useAccount()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [scope, setScope] = useState<SearchScope>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Item[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastFetchCount, setLastFetchCount] = useState<number>(0)
  const [projectNameById, setProjectNameById] = useState<Record<string, string>>({})

  const normalizedQuery = query.trim()
  const isAmountQuery = isAmountLikeQuery(normalizedQuery)
  const shouldFetch = normalizedQuery.length === 0 || normalizedQuery.length >= 2
  const isTooShort = normalizedQuery.length === 1

  // Autofocus the input when opened.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Reset pagination when query changes.
  useEffect(() => {
    setPage(1)
  }, [normalizedQuery])

  useEffect(() => {
    if (!open) return
    if (!currentAccountId) return

    let cancelled = false

    const loadProjects = async () => {
      try {
        const projects = await projectService.getProjects(currentAccountId)
        if (cancelled) return
        const mapped = projects.reduce<Record<string, string>>((acc, project) => {
          if (project.id && project.name) {
            acc[project.id] = project.name
          }
          return acc
        }, {})
        setProjectNameById(mapped)
      } catch (error) {
        if (!cancelled) {
          console.error('AccountItemSearchModal: failed to load projects', error)
          setProjectNameById({})
        }
      }
    }

    void loadProjects()

    return () => {
      cancelled = true
    }
  }, [currentAccountId, open])

  // Fetch results (debounced).
  useEffect(() => {
    if (!open) return
    if (!currentAccountId) return

    if (!shouldFetch) {
      setItems([])
      setLastFetchCount(0)
      setErrorMessage(null)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      const run = async () => {
        setIsLoading(true)
        setErrorMessage(null)

        try {
          const results = await unifiedItemsService.searchAccountItems(currentAccountId, {
            searchQuery: isAmountQuery ? undefined : normalizedQuery || undefined,
            includeBusinessInventory: true,
            pagination: { page, limit: PAGE_LIMIT }
          })

          if (cancelled) return

          setLastFetchCount(results.length)
          setItems(prev => {
            if (page === 1) return results
            const map = new Map<string, Item>()
            prev.forEach(item => map.set(item.itemId, item))
            results.forEach(item => map.set(item.itemId, item))
            return Array.from(map.values())
          })
        } catch (error) {
          if (cancelled) return
          console.error('AccountItemSearchModal: failed to search items', error)
          setErrorMessage('Could not load results. Please try again.')
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      void run()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [currentAccountId, normalizedQuery, open, page, shouldFetch])

  const visibleItems = useMemo(() => {
    const filtered = items.filter(item =>
      matchesItemSearch(item, normalizedQuery, {
        locationFields: ['space', 'businessInventoryLocation']
      }).matches
    )

    if (scope === 'projects') return filtered.filter(item => Boolean(item.projectId))
    if (scope === 'businessInventory') return filtered.filter(item => !item.projectId)
    return filtered
  }, [items, normalizedQuery, scope])

  const hasMore = shouldFetch && lastFetchCount === PAGE_LIMIT

  const scopeButtonClass = (value: SearchScope) =>
    `pb-2 text-xs font-semibold border-b-2 ${
      scope === value
        ? 'border-primary-600 text-primary-600'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`

  return (
    <AddExistingItemsModal
      open={open}
      title="Search items"
      onClose={onClose}
      contentClassName="p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="relative w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search items by description, SKU, source, payment method, or location"
            className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-base sm:text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="border-b border-gray-200">
          <nav className="-mb-px flex flex-wrap gap-4">
            <button type="button" onClick={() => setScope('all')} className={scopeButtonClass('all')}>
              All
            </button>
            <button
              type="button"
              onClick={() => setScope('projects')}
              className={scopeButtonClass('projects')}
            >
              Projects
            </button>
            <button
              type="button"
              onClick={() => setScope('businessInventory')}
              className={scopeButtonClass('businessInventory')}
            >
              Business inventory
            </button>
          </nav>
        </div>

        <div className="text-xs text-gray-500">
          {normalizedQuery.length === 0 ? 'Showing recent items.' : `Searching for “${normalizedQuery}”.`}
        </div>
        {isAmountQuery && normalizedQuery.length > 0 && (
          <div className="text-xs text-gray-500">
            Amount search looks at loaded items. Load more to search further.
          </div>
        )}

        {isTooShort && (
          <div className="text-sm text-gray-500">Type 2+ characters to search.</div>
        )}

        {!isTooShort && (
          <div className="space-y-3">
            {isLoading && page === 1 ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : errorMessage ? (
              <div className="text-sm text-gray-600">{errorMessage}</div>
            ) : visibleItems.length > 0 ? (
              <>
                {visibleItems.map((item, index) => {
                  const context: 'project' | 'businessInventory' = item.projectId ? 'project' : 'businessInventory'
                  const projectName = item.projectId ? projectNameById[item.projectId] : undefined
                  const isLastItem = index === visibleItems.length - 1
                  return (
                    <ItemPreviewCard
                      key={item.itemId}
                      item={toPreviewData(item)}
                      context={context}
                      projectId={item.projectId ?? undefined}
                      menuDirection={isLastItem ? 'top' : 'bottom'}
                      footer={(
                        <span className="text-xs text-gray-500">
                          {context === 'project'
                            ? (projectName ? `Project: ${projectName}` : 'Project item')
                            : 'Business inventory'}
                        </span>
                      )}
                    />
                  )
                })}

                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setPage(p => p + 1)}
                      disabled={isLoading}
                      className={`inline-flex items-center px-3 py-2 border text-xs font-medium rounded ${
                        isLoading
                          ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                          : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                      }`}
                    >
                      {isLoading ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500">
                {normalizedQuery.length === 0 ? 'No recent items found.' : 'No items match this search.'}
              </div>
            )}
          </div>
        )}
      </div>
    </AddExistingItemsModal>
  )
}

