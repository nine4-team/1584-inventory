import { Plus, Search, Filter, FileUp, FileDown, ArrowUpDown, Check } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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

const sortTransactionsByMode = (items: Transaction[], sortMode: typeof TRANSACTION_SORT_MODES[number]) => {
  return [...items].sort((a, b) => {
    if (sortMode === 'date-desc' || sortMode === 'date-asc') {
      const diff = parseDate(a.transactionDate) - parseDate(b.transactionDate)
      if (diff !== 0) return sortMode === 'date-asc' ? diff : -diff
    }
    if (sortMode === 'created-desc' || sortMode === 'created-asc') {
      const diff = parseDate(a.createdAt) - parseDate(b.createdAt)
      if (diff !== 0) return sortMode === 'created-asc' ? diff : -diff
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
    const createdDiff = parseDate(a.createdAt) - parseDate(b.createdAt)
    if (createdDiff !== 0) return -createdDiff
    // Stable-ish tie-breaker to avoid jitter during realtime updates
    return a.transactionId.localeCompare(b.transactionId)
  })
}

const escapeCsvValue = (value: string): string => {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const buildTransactionsCsv = (items: Transaction[], categories: BudgetCategory[]) => {
  const header = [
    'Transaction ID',
    'Transaction Date',
    'Source',
    'Canonical Source',
    'Transaction Type',
    'Payment Method',
    'Amount',
    'Budget Category',
    'Category ID',
    'Notes',
    'Reimbursement Type',
    'Status',
    'Receipt Emailed',
    'Tax Rate Pct',
    'Subtotal',
    'Created At',
    'Project ID',
  ]
  const rows = items.map(transaction => {
    const categoryName = getBudgetCategoryDisplayName(transaction, categories) ?? ''
    return [
      transaction.transactionId ?? '',
      transaction.transactionDate ?? '',
      transaction.source ?? '',
      getCanonicalTransactionTitle(transaction) ?? '',
      transaction.transactionType ?? '',
      transaction.paymentMethod ?? '',
      transaction.amount ?? '',
      categoryName,
      transaction.categoryId ?? '',
      transaction.notes ?? '',
      transaction.reimbursementType ?? '',
      transaction.status ?? '',
      transaction.receiptEmailed ? 'true' : 'false',
      transaction.taxRatePct != null ? String(transaction.taxRatePct) : '',
      transaction.subtotal ?? '',
      transaction.createdAt ?? '',
      transaction.projectId ?? '',
    ].map(value => escapeCsvValue(String(value)))
  })

  return [header.map(value => escapeCsvValue(value)).join(','), ...rows.map(row => row.join(','))].join('\n')
}

interface TransactionsListProps {
  projectId?: string
  transactions?: Transaction[]
}

const TRANSACTION_FILTER_MODES = ['all', 'we-owe', 'client-owes'] as const
const RECEIPT_FILTER_MODES = ['all', 'no-email'] as const
const TRANSACTION_TYPE_FILTER_MODES = ['all', 'purchase', 'return'] as const
const TRANSACTION_SORT_MODES = [
  'date-desc',
  'date-asc',
  'created-desc',
  'created-asc',
  'source-asc',
  'source-desc',
  'amount-desc',
  'amount-asc',
] as const
const DEFAULT_FILTER_MODE = 'all'
const DEFAULT_SOURCE_FILTER = 'all'
const DEFAULT_RECEIPT_FILTER = 'all'
const DEFAULT_TRANSACTION_TYPE_FILTER = 'all'
const DEFAULT_SORT_MODE = 'date-desc'

const parseFilterMode = (value: string | null) =>
  TRANSACTION_FILTER_MODES.includes(value as (typeof TRANSACTION_FILTER_MODES)[number])
    ? (value as (typeof TRANSACTION_FILTER_MODES)[number])
    : DEFAULT_FILTER_MODE

const parseSortMode = (value: string | null) =>
  TRANSACTION_SORT_MODES.includes(value as (typeof TRANSACTION_SORT_MODES)[number])
    ? (value as (typeof TRANSACTION_SORT_MODES)[number])
    : DEFAULT_SORT_MODE

const parseReceiptFilter = (value: string | null) =>
  RECEIPT_FILTER_MODES.includes(value as (typeof RECEIPT_FILTER_MODES)[number])
    ? (value as (typeof RECEIPT_FILTER_MODES)[number])
    : DEFAULT_RECEIPT_FILTER

const parseTransactionTypeFilter = (value: string | null) =>
  TRANSACTION_TYPE_FILTER_MODES.includes(value as (typeof TRANSACTION_TYPE_FILTER_MODES)[number])
    ? (value as (typeof TRANSACTION_TYPE_FILTER_MODES)[number])
    : DEFAULT_TRANSACTION_TYPE_FILTER

export default function TransactionsList({ projectId: propProjectId, transactions: propTransactions }: TransactionsListProps) {
  const { id, projectId: routeProjectId } = useParams<{ id?: string; projectId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const stackedNavigate = useStackedNavigate()
  const { currentAccountId } = useAccount()
  // Use prop if provided, otherwise fall back to route param
  const projectId = propProjectId || routeProjectId || id
  const { buildContextUrl } = useNavigationContext()
  const [transactions, setTransactions] = useState<Transaction[]>(propTransactions || [])
  const [isLoading, setIsLoading] = useState(!propTransactions)
  const [completenessById, setCompletenessById] = useState<Record<string, TransactionCompleteness | null>>({})
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams.get('txSearch') ?? '')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [filterMenuView, setFilterMenuView] = useState<'main' | 'source'>('main')
  const [filterMode, setFilterMode] = useState<'all' | 'we-owe' | 'client-owes'>(() =>
    parseFilterMode(searchParams.get('txFilter'))
  )
  const [sourceFilter, setSourceFilter] = useState<string>(() => searchParams.get('txSource') ?? DEFAULT_SOURCE_FILTER)
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'no-email'>(() =>
    parseReceiptFilter(searchParams.get('txReceipt'))
  )
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'purchase' | 'return'>(() =>
    parseTransactionTypeFilter(searchParams.get('txType'))
  )

  // Sort state
  const [sortMode, setSortMode] = useState<
    'date-desc'
    | 'date-asc'
    | 'created-desc'
    | 'created-asc'
    | 'source-asc'
    | 'source-desc'
    | 'amount-desc'
    | 'amount-asc'
  >(() => parseSortMode(searchParams.get('txSort')))
  const [showSortMenu, setShowSortMenu] = useState(false)
  const isSyncingFromUrlRef = useRef(false)
  const hasRestoredScrollRef = useRef(false)

  const handleTransactionNavigate = useCallback(
    (transactionId: string) => {
      if (!projectId || !transactionId) return
      stackedNavigate(
        buildContextUrl(
          projectTransactionDetail(projectId, transactionId),
          { project: projectId, transactionId }
        ),
        undefined,
        { scrollY: window.scrollY }
      )
    },
    [buildContextUrl, projectId, stackedNavigate]
  )

  useEffect(() => {
    const nextSearchQuery = searchParams.get('txSearch') ?? ''
    const nextFilterMode = parseFilterMode(searchParams.get('txFilter'))
    const nextSourceFilter = searchParams.get('txSource') ?? DEFAULT_SOURCE_FILTER
    const nextReceiptFilter = parseReceiptFilter(searchParams.get('txReceipt'))
    const nextTransactionTypeFilter = parseTransactionTypeFilter(searchParams.get('txType'))
    const nextSortMode = parseSortMode(searchParams.get('txSort'))

    const hasChanges =
      searchQuery !== nextSearchQuery ||
      filterMode !== nextFilterMode ||
      sourceFilter !== nextSourceFilter ||
      receiptFilter !== nextReceiptFilter ||
      transactionTypeFilter !== nextTransactionTypeFilter ||
      sortMode !== nextSortMode

    if (!hasChanges) return

    isSyncingFromUrlRef.current = true
    if (searchQuery !== nextSearchQuery) setSearchQuery(nextSearchQuery)
    if (filterMode !== nextFilterMode) setFilterMode(nextFilterMode)
    if (sourceFilter !== nextSourceFilter) setSourceFilter(nextSourceFilter)
    if (receiptFilter !== nextReceiptFilter) setReceiptFilter(nextReceiptFilter)
    if (transactionTypeFilter !== nextTransactionTypeFilter) setTransactionTypeFilter(nextTransactionTypeFilter)
    if (sortMode !== nextSortMode) setSortMode(nextSortMode)
  }, [searchParams])

  useEffect(() => {
    if (isSyncingFromUrlRef.current) {
      isSyncingFromUrlRef.current = false
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    const setParam = (key: string, value: string, defaultValue: string) => {
      if (!value || value === defaultValue) {
        nextParams.delete(key)
      } else {
        nextParams.set(key, value)
      }
    }

    setParam('txSearch', searchQuery, '')
    setParam('txFilter', filterMode, DEFAULT_FILTER_MODE)
    setParam('txSource', sourceFilter, DEFAULT_SOURCE_FILTER)
    setParam('txReceipt', receiptFilter, DEFAULT_RECEIPT_FILTER)
    setParam('txType', transactionTypeFilter, DEFAULT_TRANSACTION_TYPE_FILTER)
    setParam('txSort', sortMode, DEFAULT_SORT_MODE)

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true, state: location.state })
    }
  }, [filterMode, location.state, receiptFilter, searchQuery, setSearchParams, sortMode, sourceFilter, transactionTypeFilter])

  useEffect(() => {
    if (hasRestoredScrollRef.current || isLoading) return
    const state = location.state && typeof location.state === 'object' ? (location.state as Record<string, unknown>) : null
    const restoreScrollY = state?.restoreScrollY
    if (!Number.isFinite(restoreScrollY)) return

    hasRestoredScrollRef.current = true
    requestAnimationFrame(() => window.scrollTo(0, restoreScrollY as number))

    const { restoreScrollY: _restoreScrollY, ...rest } = state || {}
    const nextState = Object.keys(rest).length > 0 ? rest : undefined
    navigate(location.pathname + location.search, { replace: true, state: nextState })
  }, [isLoading, location.pathname, location.search, location.state, navigate])

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

    if (transactionTypeFilter !== 'all') {
      const filterValue = transactionTypeFilter.toLowerCase()
      filtered = filtered.filter(t => (t.transactionType ?? '').toLowerCase() === filterValue)
    }

    if (receiptFilter === 'no-email') {
      filtered = filtered.filter(t => !t.receiptEmailed)
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
    return sortTransactionsByMode(filtered, sortMode)
  }, [transactions, filterMode, receiptFilter, sourceFilter, searchQuery, sortMode, transactionTypeFilter])

  const handleExportCsv = useCallback(() => {
    if (!transactions.length) return
    const sortedTransactions = sortTransactionsByMode(transactions, sortMode)
    const csv = buildTransactionsCsv(sortedTransactions, budgetCategories)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStamp = new Date().toISOString().slice(0, 10)
    const fileName = `project-${projectId ?? 'transactions'}-${dateStamp}.csv`
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [transactions, sortMode, budgetCategories, projectId])

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

          {/* Export CSV Button */}
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200 flex-shrink-0"
            title="Export all transactions to CSV"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export CSV
          </button>

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
              <div className="sort-menu absolute top-full left-0 mt-1 w-[min(13rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto sm:left-auto sm:right-0 sm:w-52">
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
                    Purchase Date (newest)
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
                    Purchase Date (oldest)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('created-desc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'created-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Created Date (newest)
                  </button>
                  <button
                    onClick={() => {
                      setSortMode('created-asc')
                      setShowSortMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      sortMode === 'created-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Created Date (oldest)
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
                filterMode === 'all' && sourceFilter === 'all' && receiptFilter === 'all' && transactionTypeFilter === 'all'
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
              <div className="filter-menu absolute top-full left-0 mt-1 w-[min(14rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto sm:left-auto sm:right-0 sm:w-56">
                {filterMenuView === 'main' ? (
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setFilterMode('all')
                        setSourceFilter('all')
                        setReceiptFilter('all')
                        setTransactionTypeFilter('all')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All Transactions</span>
                      {filterMode === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('we-owe')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'we-owe' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>We Owe</span>
                      {filterMode === 'we-owe' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('client-owes')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'client-owes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Client Owes</span>
                      {filterMode === 'client-owes' ? <Check className="h-4 w-4" /> : null}
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => {
                        setTransactionTypeFilter('purchase')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        transactionTypeFilter === 'purchase' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Purchase</span>
                      {transactionTypeFilter === 'purchase' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setTransactionTypeFilter('return')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        transactionTypeFilter === 'return' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Return</span>
                      {transactionTypeFilter === 'return' ? <Check className="h-4 w-4" /> : null}
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => {
                        setReceiptFilter(receiptFilter === 'no-email' ? 'all' : 'no-email')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        receiptFilter === 'no-email' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>No Email Receipt</span>
                      {receiptFilter === 'no-email' ? <Check className="h-4 w-4" /> : null}
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
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        sourceFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All sources</span>
                      {sourceFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    {availableSources.map(source => (
                      <button
                        key={source}
                        onClick={() => {
                          setSourceFilter(source)
                          setShowFilterMenu(false)
                          setFilterMenuView('main')
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                          sourceFilter === source ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                        }`}
                      >
                        <span>{source}</span>
                        {sourceFilter === source ? <Check className="h-4 w-4" /> : null}
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
            {searchQuery || filterMode !== 'all' || sourceFilter !== 'all' || receiptFilter !== 'all'
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
                <a
                  href={buildContextUrl(
                    projectTransactionDetail(projectId, transaction.transactionId),
                    { project: projectId, transactionId: transaction.transactionId }
                  )}
                  onClick={(event) => {
                    if (
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.altKey ||
                      event.ctrlKey ||
                      event.shiftKey
                    ) {
                      return
                    }
                    event.preventDefault()
                    handleTransactionNavigate(transaction.transactionId)
                  }}
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
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
