import { Plus, Search, Filter, FileUp, ArrowUpDown } from 'lucide-react'
import { useParams } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useState, useEffect, useMemo } from 'react'
import { Transaction, TransactionCompleteness, BudgetCategory } from '@/types'
import { transactionService } from '@/services/inventoryService'
import type { Transaction as TransactionType } from '@/types'
import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { useAccount } from '@/contexts/AccountContext'
import { projectTransactionDetail, projectTransactionImport, projectTransactionNew } from '@/utils/routes'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { hydrateProjectTransactionsCache } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'

// Canonical transaction title for display only
const getCanonicalTransactionTitle = (transaction: TransactionType): string => {
  if (transaction.transactionId?.startsWith('INV_SALE_')) return COMPANY_INVENTORY_SALE
  if (transaction.transactionId?.startsWith('INV_PURCHASE_')) return COMPANY_INVENTORY_PURCHASE
  return transaction.source
}
import { formatDate, formatCurrency } from '@/utils/dateUtils'

// Remove any unwanted icons from transaction type badges
const removeUnwantedIcons = () => {
  const badges = document.querySelectorAll('.no-icon')
  badges.forEach(badge => {
    // Remove any child elements that aren't text nodes
    const children = Array.from(badge.childNodes)
    children.forEach(child => {
      if (child.nodeType !== Node.TEXT_NODE) {
        badge.removeChild(child)
      }
    })
  })
}

// Get budget category display name from transaction (handles both legacy and new fields)
const getBudgetCategoryDisplayName = (transaction: TransactionType, categories: BudgetCategory[]): string | undefined => {
  // First try the new categoryId field
  if (transaction.categoryId) {
    const category = categories.find(c => c.id === transaction.categoryId)
    return category?.name
  }
  // Fall back to legacy budgetCategory field
  return transaction.budgetCategory
}

interface TransactionsListProps {
  projectId?: string
  transactions?: Transaction[]
}

export default function TransactionsList({ projectId: propProjectId, transactions: propTransactions }: TransactionsListProps) {
  const { id, projectId: routeProjectId } = useParams<{ id?: string; projectId?: string }>()
  const { currentAccountId } = useAccount()
  // Use prop if provided, otherwise fall back to route param
  const projectId = propProjectId || routeProjectId || id
  const { buildContextUrl } = useNavigationContext()
  const [transactions, setTransactions] = useState<Transaction[]>(propTransactions || [])
  const [isLoading, setIsLoading] = useState(!propTransactions)
  const [completenessById, setCompletenessById] = useState<Record<string, TransactionCompleteness | null>>({})
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [filterMenuView, setFilterMenuView] = useState<'main' | 'source'>('main')
  const [filterMode, setFilterMode] = useState<'all' | 'we-owe' | 'client-owes'>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  // Sort state
  const [sortMode, setSortMode] = useState<
    'date-desc'
    | 'date-asc'
    | 'source-asc'
    | 'source-desc'
    | 'amount-desc'
    | 'amount-asc'
  >('date-desc')
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Load budget categories for display
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

  useEffect(() => {
    // If transactions are passed as a prop, just update the state
    if (propTransactions) {
      setTransactions(propTransactions)
      return
    }

    // If no transactions prop, fetch them
    let unsubscribe: (() => void) | undefined

    const setupSubscription = (initialTransactions: Transaction[]) => {
      if (!projectId || !currentAccountId || unsubscribe) return
      unsubscribe = transactionService.subscribeToTransactions(
        currentAccountId,
        projectId,
        (updatedTransactions) => {
          setTransactions(updatedTransactions)
        },
        initialTransactions
      )
    }

    const loadTransactions = async () => {
      if (!projectId || !currentAccountId) {
        setIsLoading(false)
        return
      }

      // Only load if transactions were not passed in props
      if (!propTransactions) {
        let subscriptionSeed: Transaction[] = []
        let hasCachedSnapshot = false

        try {
          // First, try to hydrate from offlineStore to React Query cache
          // This ensures optimistic transactions created offline are available
          try {
            await hydrateProjectTransactionsCache(getGlobalQueryClient(), currentAccountId, projectId)
          } catch (error) {
            console.warn('Failed to hydrate project transactions cache (non-fatal):', error)
          }

          // Check React Query cache first (for optimistic transactions created offline)
          const queryClient = getGlobalQueryClient()
          const cachedTransactions = queryClient.getQueryData<Transaction[]>(['project-transactions', currentAccountId, projectId])
          
          if (cachedTransactions && cachedTransactions.length > 0) {
            hasCachedSnapshot = true
            subscriptionSeed = cachedTransactions
            console.log('✅ Transactions found in React Query cache:', cachedTransactions.length)
            setTransactions(cachedTransactions)
          }

          // Always fetch latest transactions to reconcile any stale cache entries
          const fetchedTransactions = await transactionService.getTransactions(currentAccountId, projectId)
          subscriptionSeed = fetchedTransactions
          setTransactions(fetchedTransactions)
        } catch (error) {
          console.error('Error loading transactions:', error)
          if (!hasCachedSnapshot) {
            setTransactions([])
          }
        } finally {
          setIsLoading(false)
          // Start realtime subscription once we have the best-known snapshot
          setupSubscription(subscriptionSeed)
        }
      }
    }

    loadTransactions()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [projectId, currentAccountId, propTransactions])

  // Load completeness metrics for each transaction to show "Missing items" badge
  useEffect(() => {
    let mounted = true
    const loadCompletenessForTransactions = async () => {
      if (!projectId || !currentAccountId || transactions.length === 0) return
      try {
        // If the backend surfaces `needsReview` on the transaction, we can skip
        // the per-transaction completeness fetch for the list view to improve perf.
        const txsToFetch = transactions.filter(t => t.needsReview === undefined)
        const promises = txsToFetch.map(t =>
          transactionService.getTransactionCompleteness(currentAccountId, projectId, t.transactionId)
            .catch(err => {
              console.debug('Failed to load completeness for', t.transactionId, err)
              return null
            })
        )
        const results = await Promise.all(promises)
        if (!mounted) return
        const map: Record<string, TransactionCompleteness | null> = {}
        // Populate map only for transactions we fetched
        txsToFetch.forEach((t, idx) => {
          map[t.transactionId] = results[idx]
        })
        setCompletenessById(map)
      } catch (err) {
        console.error('Error loading transaction completeness:', err)
      }
    }

    loadCompletenessForTransactions()
    return () => { mounted = false }
  }, [transactions, projectId, currentAccountId])

  // Filter transactions based on search and filter mode
  const filteredTransactions = useMemo(() => {
    const parseMoney = (value: string | undefined): number => {
      if (!value) return 0
      const n = Number.parseFloat(value)
      return Number.isFinite(n) ? n : 0
    }

    const parseDate = (value: string | undefined): number => {
      if (!value) return 0
      const ms = Date.parse(value)
      return Number.isFinite(ms) ? ms : 0
    }

    let filtered = transactions

    // Apply reimbursement type filter based on filter mode
    if (filterMode !== 'all') {
      if (filterMode === 'we-owe') {
        filtered = filtered.filter(t => t.reimbursementType === COMPANY_OWES_CLIENT)
      } else if (filterMode === 'client-owes') {
        filtered = filtered.filter(t => t.reimbursementType === CLIENT_OWES_COMPANY)
      }
    }

    // Apply source filter (based on what we display in the title)
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(t => getCanonicalTransactionTitle(t) === sourceFilter)
    }

    // Apply search filter (source/title/type/notes/amount)
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim()
      const numericQuery = query.replace(/[^0-9.]/g, '')
      filtered = filtered.filter(t => {
        const title = getCanonicalTransactionTitle(t).toLowerCase()
        const source = t.source?.toLowerCase() ?? ''
        const type = t.transactionType?.toLowerCase() ?? ''
        const notes = t.notes?.toLowerCase() ?? ''
        const amountStr = (t.amount ?? '').toString()
        const amountNormalized = amountStr.replace(/[^0-9.]/g, '')

        const matchesText =
          title.includes(query) ||
          source.includes(query) ||
          type.includes(query) ||
          notes.includes(query)

        const matchesAmount =
          numericQuery.length > 0 &&
          (amountStr.toLowerCase().includes(query) || amountNormalized.includes(numericQuery))

        return matchesText || matchesAmount
      })
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'date-desc' || sortMode === 'date-asc') {
        const diff = parseDate(a.transactionDate) - parseDate(b.transactionDate)
        if (diff !== 0) return sortMode === 'date-asc' ? diff : -diff
      }
      if (sortMode === 'source-asc' || sortMode === 'source-desc') {
        const aTitle = getCanonicalTransactionTitle(a)
        const bTitle = getCanonicalTransactionTitle(b)
        const diff = aTitle.localeCompare(bTitle)
        if (diff !== 0) return sortMode === 'source-asc' ? diff : -diff
      }
      if (sortMode === 'amount-desc' || sortMode === 'amount-asc') {
        const diff = parseMoney(a.amount) - parseMoney(b.amount)
        if (diff !== 0) return sortMode === 'amount-asc' ? diff : -diff
      }
      // Stable-ish tie-breaker to avoid jitter during realtime updates
      return a.transactionId.localeCompare(b.transactionId)
    })

    return sorted
  }, [transactions, filterMode, sourceFilter, searchQuery, sortMode])

  const availableSources = useMemo(() => {
    const titles = transactions
      .map(t => getCanonicalTransactionTitle(t))
      .filter(Boolean)
    return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b))
  }, [transactions])

  // Close filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!event.target) return

      const target = event.target as Element
      if (!target.closest('.filter-menu') && !target.closest('.filter-button')) {
        setShowFilterMenu(false)
      }
      if (!target.closest('.sort-menu') && !target.closest('.sort-button')) {
        setShowSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Clean up any unwanted icons from transaction type badges
  useEffect(() => {
    removeUnwantedIcons()
    // Also run after a short delay to catch any dynamically added icons
    const timer = setTimeout(removeUnwantedIcons, 100)
    const timer2 = setTimeout(removeUnwantedIcons, 500)
    return () => {
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [transactions])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="text-sm text-gray-500">
        No project selected.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls - Sticky Container */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 py-3 mb-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Add Button */}
          <ContextLink
            to={buildContextUrl(projectTransactionNew(projectId), { project: projectId })}
            className="inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-200 flex-shrink-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add
          </ContextLink>

          {/* Import Wayfair Invoice Button */}
          <ContextLink
            to={buildContextUrl(projectTransactionImport(projectId), { project: projectId })}
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200 flex-shrink-0"
            title="Import a Wayfair invoice PDF"
          >
            <FileUp className="h-4 w-4 mr-2" />
            Import Wayfair Invoice
          </ContextLink>

          {/* Sort Button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className={`sort-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                sortMode === 'date-desc'
                  ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                  : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
              }`}
              title="Sort transactions"
            >
              <ArrowUpDown className="h-4 w-4 mr-2" />
              Sort
            </button>

            {showSortMenu && (
              <div className="sort-menu absolute top-full right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                <div className="py-1">
                  <button
                    onClick={() => {
                      setSortMode('date-desc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'date-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Date (newest)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('date-asc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'date-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Date (oldest)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('source-asc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'source-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Source (A→Z)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('source-desc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'source-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Source (Z→A)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('amount-desc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'amount-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Price (high→low)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('amount-asc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'amount-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Price (low→high)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Filter Button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                const next = !showFilterMenu
                setShowFilterMenu(next)
                if (next) setFilterMenuView('main')
              }}
              className={`filter-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                filterMode === 'all' && sourceFilter === 'all'
                  ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                  : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
              }`}
              title="Filter transactions"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </button>

            {/* Filter Dropdown Menu */}
            {showFilterMenu && (
              <div className="filter-menu absolute top-full right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                {filterMenuView === 'main' ? (
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
                      All Transactions
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('we-owe')
                        setShowFilterMenu(false)
                      }}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'we-owe' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      We Owe
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('client-owes')
                        setShowFilterMenu(false)
                      }}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'client-owes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      Client Owes
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('source')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        sourceFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Source"
                    >
                      <div className="flex items-center justify-between">
                        <span>Source</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {sourceFilter === 'all' ? 'All sources' : sourceFilter}
                        </span>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="py-1">
                    <button
                      onClick={() => setFilterMenuView('main')}
                      className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      ← Back
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => {
                        setSourceFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        sourceFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      All sources
                    </button>
                    {availableSources.map(source => (
                      <button
                        key={source}
                        onClick={() => {
                          setSourceFilter(source)
                          setShowFilterMenu(false)
                          setFilterMenuView('main')
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                          sourceFilter === source ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                        }`}
                      >
                        {source}
                      </button>
                    ))}
                  </div>
                )}
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
              placeholder="Search transactions by source or amount..."
              value={searchQuery || ''}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
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
            {searchQuery || filterMode !== 'all' || sourceFilter !== 'all'
              ? 'Try adjusting your search or filter criteria.'
              : 'No transactions found.'
            }
          </p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {filteredTransactions.map((transaction) => (
              <li key={transaction.transactionId} className="relative">
                <ContextLink
                  to={buildContextUrl(projectTransactionDetail(projectId, transaction.transactionId), { project: projectId, transactionId: transaction.transactionId })}
                  className="block bg-gray-50 transition-colors duration-200 hover:bg-gray-100"
                >
                  <div className="px-4 py-4 sm:px-6">
                    {/* Top row: Header with canonical title and type */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center">
                        <h3 className="text-base font-medium text-gray-900">
                          {getCanonicalTransactionTitle(transaction)}
                        </h3>
                      </div>
                    </div>

                    {/* Bottom row: Details */}
                    <div className="space-y-2">
                      {/* Details row - Price, payment method, date */}
                      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                        <span className="font-medium text-gray-700">{formatCurrency(transaction.amount)}</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="font-medium text-gray-700 capitalize">{transaction.paymentMethod}</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="font-medium text-gray-700">{formatDate(transaction.transactionDate)}</span>
                      </div>

                      {/* Notes */}
                      {transaction.notes && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {transaction.notes}
                        </p>
                      )}
                    </div>
                    {/* Badges moved to bottom of preview container */}
                    <div className="mt-3 flex items-center flex-wrap gap-2">
                      {(() => {
                        const categoryName = getBudgetCategoryDisplayName(transaction, budgetCategories)
                        return categoryName ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
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
                            {categoryName}
                          </span>
                        ) : null
                      })()}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium no-icon ${
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
                      {transaction.needsReview === true ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Needs Review
                        </span>
                      ) : (
                        completenessById[transaction.transactionId] && completenessById[transaction.transactionId]?.completenessStatus !== 'complete' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Missing Items
                          </span>
                        )
                      )}
                    </div>

                  </div>
                </ContextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
