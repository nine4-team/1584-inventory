import { Plus, Search, Filter, FileUp, FileDown, ArrowUpDown, Check } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { Transaction, BudgetCategory } from '@/types'
import { transactionService, isCanonicalSaleOrPurchaseTransactionId, computeCanonicalTransactionTotal } from '@/services/inventoryService'
import type { Transaction as TransactionType } from '@/types'
import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { useAccount } from '@/contexts/AccountContext'
import { projectTransactionDetail, projectTransactionImport, projectTransactionImportAmazon, projectTransactionNew } from '@/utils/routes'
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
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'

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
const RECEIPT_FILTER_MODES = ['all', 'yes', 'no'] as const
const TRANSACTION_TYPE_FILTER_MODES = ['all', 'purchase', 'return'] as const
const PURCHASE_METHOD_FILTER_MODES = ['all', 'client-card', 'design-business', 'missing'] as const
const COMPLETENESS_FILTER_MODES = ['all', 'needs-review', 'complete'] as const
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
const DEFAULT_PURCHASE_METHOD_FILTER = 'all'
const DEFAULT_BUDGET_CATEGORY_FILTER = 'all'
const DEFAULT_COMPLETENESS_FILTER = 'all'

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

const parsePurchaseMethodFilter = (value: string | null) =>
  PURCHASE_METHOD_FILTER_MODES.includes(value as (typeof PURCHASE_METHOD_FILTER_MODES)[number])
    ? (value as (typeof PURCHASE_METHOD_FILTER_MODES)[number])
    : DEFAULT_PURCHASE_METHOD_FILTER

const parseCompletenessFilter = (value: string | null) =>
  COMPLETENESS_FILTER_MODES.includes(value as (typeof COMPLETENESS_FILTER_MODES)[number])
    ? (value as (typeof COMPLETENESS_FILTER_MODES)[number])
    : DEFAULT_COMPLETENESS_FILTER

const parseBudgetCategoryFilter = (value: string | null) =>
  value && value !== DEFAULT_BUDGET_CATEGORY_FILTER ? value : DEFAULT_BUDGET_CATEGORY_FILTER

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
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  // Cache for computed totals: transactionId -> computed total string
  const [computedTotalByTxId, setComputedTotalByTxId] = useState<Record<string, string>>({})

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams.get('txSearch') ?? '')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showImportSubmenu, setShowImportSubmenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [filterMenuView, setFilterMenuView] = useState<
    'main'
    | 'source'
    | 'purchase-method'
    | 'reimbursement-status'
    | 'transaction-type'
    | 'email-receipt'
    | 'budget-category'
    | 'completeness'
  >('main')
  const [filterMode, setFilterMode] = useState<'all' | 'we-owe' | 'client-owes'>(() =>
    parseFilterMode(searchParams.get('txFilter'))
  )
  const [sourceFilter, setSourceFilter] = useState<string>(() => searchParams.get('txSource') ?? DEFAULT_SOURCE_FILTER)
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'yes' | 'no'>(() =>
    parseReceiptFilter(searchParams.get('txReceipt'))
  )
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'purchase' | 'return'>(() =>
    parseTransactionTypeFilter(searchParams.get('txType'))
  )
  const [purchaseMethodFilter, setPurchaseMethodFilter] = useState<'all' | 'client-card' | 'design-business' | 'missing'>(() =>
    parsePurchaseMethodFilter(searchParams.get('txPurchaseMethod'))
  )
  const [budgetCategoryFilter, setBudgetCategoryFilter] = useState<string>(() =>
    parseBudgetCategoryFilter(searchParams.get('txCategory'))
  )
  const [completenessFilter, setCompletenessFilter] = useState<'all' | 'needs-review' | 'complete'>(() =>
    parseCompletenessFilter(searchParams.get('txCompleteness'))
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
    const nextPurchaseMethodFilter = parsePurchaseMethodFilter(searchParams.get('txPurchaseMethod'))
    const nextBudgetCategoryFilter = parseBudgetCategoryFilter(searchParams.get('txCategory'))
    const nextCompletenessFilter = parseCompletenessFilter(searchParams.get('txCompleteness'))

    const hasChanges =
      searchQuery !== nextSearchQuery ||
      filterMode !== nextFilterMode ||
      sourceFilter !== nextSourceFilter ||
      receiptFilter !== nextReceiptFilter ||
      transactionTypeFilter !== nextTransactionTypeFilter ||
      sortMode !== nextSortMode ||
      purchaseMethodFilter !== nextPurchaseMethodFilter ||
      budgetCategoryFilter !== nextBudgetCategoryFilter ||
      completenessFilter !== nextCompletenessFilter

    if (!hasChanges) return

    isSyncingFromUrlRef.current = true
    if (searchQuery !== nextSearchQuery) setSearchQuery(nextSearchQuery)
    if (filterMode !== nextFilterMode) setFilterMode(nextFilterMode)
    if (sourceFilter !== nextSourceFilter) setSourceFilter(nextSourceFilter)
    if (receiptFilter !== nextReceiptFilter) setReceiptFilter(nextReceiptFilter)
    if (transactionTypeFilter !== nextTransactionTypeFilter) setTransactionTypeFilter(nextTransactionTypeFilter)
    if (sortMode !== nextSortMode) setSortMode(nextSortMode)
    if (purchaseMethodFilter !== nextPurchaseMethodFilter) setPurchaseMethodFilter(nextPurchaseMethodFilter)
    if (budgetCategoryFilter !== nextBudgetCategoryFilter) setBudgetCategoryFilter(nextBudgetCategoryFilter)
    if (completenessFilter !== nextCompletenessFilter) setCompletenessFilter(nextCompletenessFilter)
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
    setParam('txPurchaseMethod', purchaseMethodFilter, DEFAULT_PURCHASE_METHOD_FILTER)
    setParam('txCategory', budgetCategoryFilter, DEFAULT_BUDGET_CATEGORY_FILTER)
    setParam('txCompleteness', completenessFilter, DEFAULT_COMPLETENESS_FILTER)

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true, state: location.state })
    }
  }, [
    filterMode,
    location.state,
    budgetCategoryFilter,
    completenessFilter,
    purchaseMethodFilter,
    receiptFilter,
    searchQuery,
    setSearchParams,
    sortMode,
    sourceFilter,
    transactionTypeFilter,
  ])

  useLayoutEffect(() => {
    if (hasRestoredScrollRef.current || isLoading) return
    const state = location.state && typeof location.state === 'object' ? (location.state as Record<string, unknown>) : null
    const restoreScrollY = state?.restoreScrollY
    if (!Number.isFinite(restoreScrollY)) return

    hasRestoredScrollRef.current = true
    window.scrollTo({ top: restoreScrollY as number, behavior: 'auto' })

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

  // Batch compute and self-heal canonical transaction totals
  useEffect(() => {
    const batchComputeAndHealTotals = async () => {
      if (!currentAccountId || transactions.length === 0) return

      // Identify canonical transactions
      const canonicalTransactions = transactions.filter(tx =>
        isCanonicalSaleOrPurchaseTransactionId(tx.transactionId)
      )

      if (canonicalTransactions.length === 0) return

      // Batch compute totals for canonical transactions
      const computePromises = canonicalTransactions.map(async (tx) => {
        try {
          const computed = await computeCanonicalTransactionTotal(
            currentAccountId,
            tx.transactionId
          )
          
          // Only proceed if compute succeeded (non-null)
          if (computed === null) {
            console.log('⏭️ Skipped healing (compute failed) for canonical transaction:', tx.transactionId)
            setComputedTotalByTxId(prev => {
              if (!(tx.transactionId in prev)) return prev
              const next = { ...prev }
              delete next[tx.transactionId]
              return next
            })
            return
          }

          // Store computed total in cache for immediate display
          setComputedTotalByTxId(prev => ({
            ...prev,
            [tx.transactionId]: computed
          }))

          const storedAmount = parseFloat(tx.amount || '0').toFixed(2)
          
          // Only heal if computed total differs from stored amount
          if (computed !== storedAmount) {
            console.log('🔧 Canonical transaction total mismatch in list:', {
              transactionId: tx.transactionId,
              stored: storedAmount,
              computed
            })
            
            // Only heal if projectId is available
            const resolvedProjectId = projectId || tx.projectId
            if (!resolvedProjectId) {
              console.log('⏭️ Skipped healing (missing projectId) for canonical transaction:', tx.transactionId)
              return
            }
            
            // Batch update stored amount (non-blocking)
            try {
              await transactionService.updateTransaction(
                currentAccountId,
                resolvedProjectId,
                tx.transactionId,
                { amount: computed }
              )
              console.log('✅ Self-healed canonical transaction amount in list:', tx.transactionId, computed)
              
              // Update local state
              setTransactions(prev => prev.map(t =>
                t.transactionId === tx.transactionId
                  ? { ...t, amount: computed }
                  : t
              ))
              
              // Clear cache entry once stored amount matches computed value
              setComputedTotalByTxId(prev => {
                const next = { ...prev }
                delete next[tx.transactionId]
                return next
              })
            } catch (healError) {
              console.warn('⚠️ Failed to self-heal canonical transaction amount in list:', tx.transactionId, healError)
            }
          } else {
            // Stored amount matches computed - clear cache entry
            setComputedTotalByTxId(prev => {
              const next = { ...prev }
              delete next[tx.transactionId]
              return next
            })
          }
        } catch (error) {
          console.warn('⚠️ Failed to compute canonical transaction total in list:', tx.transactionId, error)
          setComputedTotalByTxId(prev => {
            if (!(tx.transactionId in prev)) return prev
            const next = { ...prev }
            delete next[tx.transactionId]
            return next
          })
        }
      })

      // Run computations in parallel but don't block UI
      Promise.all(computePromises).catch(err => {
        console.warn('⚠️ Batch canonical total computation failed:', err)
      })
    }

    batchComputeAndHealTotals()
  }, [transactions, currentAccountId, projectId])


  const selectedBudgetCategory = useMemo(
    () => budgetCategories.find(category => category.id === budgetCategoryFilter),
    [budgetCategories, budgetCategoryFilter]
  )

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

    if (receiptFilter === 'yes') {
      filtered = filtered.filter(t => t.receiptEmailed)
    } else if (receiptFilter === 'no') {
      filtered = filtered.filter(t => !t.receiptEmailed)
    }

    if (purchaseMethodFilter !== 'all') {
      const normalized = (tValue: string | null | undefined) => (tValue ?? '').trim().toLowerCase()
      const clientValue = normalized('client')
      const designBusinessValue = normalized('design business')
      filtered = filtered.filter(t => {
        const value = normalized(t.paymentMethod)
        if (purchaseMethodFilter === 'missing') return value.length === 0
        if (purchaseMethodFilter === 'client-card') return value.includes(clientValue)
        return value.includes(designBusinessValue)
      })
    }

    if (budgetCategoryFilter !== DEFAULT_BUDGET_CATEGORY_FILTER) {
      const selectedCategoryName = selectedBudgetCategory?.name?.trim()
      filtered = filtered.filter(t => {
        if (t.categoryId) return t.categoryId === budgetCategoryFilter
        if (!selectedCategoryName) return false
        return (t.budgetCategory ?? '').trim() === selectedCategoryName
      })
    }

    if (completenessFilter !== DEFAULT_COMPLETENESS_FILTER) {
      if (completenessFilter === 'needs-review') {
        filtered = filtered.filter(t => t.needsReview === true)
      } else {
        filtered = filtered.filter(t => t.needsReview !== true)
      }
    }

    // Apply search filter (source/title/type/notes/amount)
    if (searchQuery) {
      const rawQuery = searchQuery.trim()
      const query = rawQuery.toLowerCase()
      const hasDigit = /\d/.test(rawQuery)
      const allowedOnly = /^[0-9\s,().$-]+$/.test(rawQuery)
      const isAmountQuery = hasDigit && allowedOnly
      const normalizedQuery = isAmountQuery ? normalizeMoneyToTwoDecimalString(rawQuery) : undefined
      const normalizedQueryNumeric = normalizedQuery?.replace(/[^0-9-]/g, '') ?? ''
      filtered = filtered.filter(t => {
        const title = getCanonicalTransactionTitle(t).toLowerCase()
        const source = t.source?.toLowerCase() ?? ''
        const type = t.transactionType?.toLowerCase() ?? ''
        const notes = t.notes?.toLowerCase() ?? ''

        const matchesText =
          title.includes(query) ||
          source.includes(query) ||
          type.includes(query) ||
          notes.includes(query)

        let matchesAmount = false
        if (isAmountQuery && normalizedQuery) {
          const normalizedAmount = normalizeMoneyToTwoDecimalString((t.amount ?? '').toString())
          if (normalizedAmount) {
            if (normalizedAmount === normalizedQuery) {
              matchesAmount = true
            } else if (normalizedQueryNumeric && normalizedQueryNumeric !== '-') {
              const normalizedAmountNumeric = normalizedAmount.replace(/[^0-9-]/g, '')
              matchesAmount = normalizedAmountNumeric.includes(normalizedQueryNumeric)
            }
          }
        }

        return matchesText || matchesAmount
      })
    }

    // Apply sorting
    return sortTransactionsByMode(filtered, sortMode)
  }, [
    transactions,
    filterMode,
    receiptFilter,
    sourceFilter,
    searchQuery,
    sortMode,
    transactionTypeFilter,
    purchaseMethodFilter,
    budgetCategoryFilter,
    completenessFilter,
    selectedBudgetCategory,
  ])

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

  // Close menus when clicking outside
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
      if (!target.closest('.add-menu') && !target.closest('.add-button')) {
        setShowAddMenu(false)
        setShowImportSubmenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Close menus on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAddMenu(false)
        setShowImportSubmenu(false)
        setShowFilterMenu(false)
        setShowSortMenu(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
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
          {/* Add Menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                const next = !showAddMenu
                setShowAddMenu(next)
                if (!next) setShowImportSubmenu(false)
              }}
              className="add-button inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-200 flex-shrink-0"
              title="Add transaction"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </button>

            {showAddMenu && (
              <div className="add-menu absolute top-full left-0 mt-1 w-[min(13rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10">
                <div className="py-1">
                  <ContextLink
                    to={buildContextUrl(projectTransactionNew(projectId), { project: projectId })}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setShowAddMenu(false)
                      setShowImportSubmenu(false)
                    }}
                  >
                    Create Manually
                  </ContextLink>

                  <button
                    type="button"
                    onClick={() => setShowImportSubmenu((prev) => !prev)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between"
                    aria-expanded={showImportSubmenu}
                  >
                    <span>Import Invoice</span>
                    <span className="text-gray-400">{showImportSubmenu ? '▾' : '▸'}</span>
                  </button>

                  {showImportSubmenu && (
                    <div className="pb-1">
                      <ContextLink
                        to={buildContextUrl(projectTransactionImport(projectId), { project: projectId })}
                        className="block w-full text-left px-6 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => {
                          setShowAddMenu(false)
                          setShowImportSubmenu(false)
                        }}
                      >
                        Wayfair
                      </ContextLink>
                      <ContextLink
                        to={buildContextUrl(projectTransactionImportAmazon(projectId), { project: projectId })}
                        className="block w-full text-left px-6 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => {
                          setShowAddMenu(false)
                          setShowImportSubmenu(false)
                        }}
                      >
                        Amazon
                      </ContextLink>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

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
                filterMode === 'all' &&
                sourceFilter === 'all' &&
                receiptFilter === 'all' &&
                transactionTypeFilter === 'all' &&
                purchaseMethodFilter === 'all' &&
                budgetCategoryFilter === 'all' &&
                completenessFilter === 'all'
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
              <div className="filter-menu absolute top-full right-0 mt-1 w-[min(14rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto sm:left-auto sm:right-0 sm:w-56">
                {filterMenuView === 'main' ? (
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setFilterMode('all')
                        setSourceFilter('all')
                        setReceiptFilter('all')
                        setTransactionTypeFilter('all')
                        setPurchaseMethodFilter('all')
                        setBudgetCategoryFilter('all')
                        setCompletenessFilter('all')
                        setShowFilterMenu(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'all' &&
                        sourceFilter === 'all' &&
                        receiptFilter === 'all' &&
                        transactionTypeFilter === 'all' &&
                        purchaseMethodFilter === 'all' &&
                        budgetCategoryFilter === 'all' &&
                        completenessFilter === 'all'
                          ? 'bg-primary-50 text-primary-600'
                          : 'text-gray-700'
                      }`}
                    >
                      <span>All Transactions</span>
                      {filterMode === 'all' &&
                      sourceFilter === 'all' &&
                      receiptFilter === 'all' &&
                      transactionTypeFilter === 'all' &&
                      purchaseMethodFilter === 'all' &&
                      budgetCategoryFilter === 'all' &&
                      completenessFilter === 'all' ? (
                        <Check className="h-4 w-4" />
                      ) : null}
                    </button>

                    <button
                      onClick={() => setFilterMenuView('transaction-type')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        transactionTypeFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Transaction type"
                    >
                      <div className="flex items-center justify-between">
                        <span>Transaction Type</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {transactionTypeFilter === 'all'
                            ? 'All'
                            : transactionTypeFilter === 'purchase'
                            ? 'Purchase'
                            : 'Return'}
                        </span>
                      </div>
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('completeness')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        completenessFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Completeness"
                    >
                      <div className="flex items-center justify-between">
                        <span>Completeness</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {completenessFilter === 'all'
                            ? 'All'
                            : completenessFilter === 'needs-review'
                            ? 'Needs Review'
                            : 'Complete'}
                        </span>
                      </div>
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('email-receipt')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        receiptFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Email receipt"
                    >
                      <div className="flex items-center justify-between">
                        <span>Email Receipt</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {receiptFilter === 'all' ? 'All' : receiptFilter === 'yes' ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('purchase-method')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        purchaseMethodFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Purchased by"
                    >
                      <div className="flex items-center justify-between">
                        <span>Purchased By</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {purchaseMethodFilter === 'all'
                            ? 'All'
                            : purchaseMethodFilter === 'client-card'
                            ? 'Client'
                            : purchaseMethodFilter === 'missing'
                            ? 'Not Set'
                            : 'Design Business'}
                        </span>
                      </div>
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('budget-category')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        budgetCategoryFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Budget category"
                    >
                      <div className="flex items-center justify-between">
                        <span>Budget Category</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {budgetCategoryFilter === 'all'
                            ? 'All'
                            : selectedBudgetCategory?.name ?? 'Unknown'}
                        </span>
                      </div>
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
                          {sourceFilter === 'all' ? 'All' : sourceFilter}
                        </span>
                      </div>
                    </button>

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => setFilterMenuView('reimbursement-status')}
                      className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                      aria-label="Reimbursement status"
                    >
                      <div className="flex items-center justify-between">
                        <span>Reimbursement</span>
                        <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                          {filterMode === 'all'
                            ? 'All'
                            : filterMode === 'we-owe'
                            ? 'Owed to Client'
                            : 'Owed to Design Business'}
                        </span>
                      </div>
                    </button>
                  </div>
                ) : filterMenuView === 'source' ? (
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
                ) : filterMenuView === 'purchase-method' ? (
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
                        setPurchaseMethodFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        purchaseMethodFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All</span>
                      {purchaseMethodFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setPurchaseMethodFilter('client-card')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        purchaseMethodFilter === 'client-card' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Client</span>
                      {purchaseMethodFilter === 'client-card' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setPurchaseMethodFilter('design-business')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        purchaseMethodFilter === 'design-business' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Design Business</span>
                      {purchaseMethodFilter === 'design-business' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setPurchaseMethodFilter('missing')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        purchaseMethodFilter === 'missing' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Not Set</span>
                      {purchaseMethodFilter === 'missing' ? <Check className="h-4 w-4" /> : null}
                    </button>
                  </div>
                ) : filterMenuView === 'reimbursement-status' ? (
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
                        setFilterMode('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All Statuses</span>
                      {filterMode === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('we-owe')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'we-owe' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Owed to Client</span>
                      {filterMode === 'we-owe' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setFilterMode('client-owes')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        filterMode === 'client-owes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Owed to Design Business</span>
                      {filterMode === 'client-owes' ? <Check className="h-4 w-4" /> : null}
                    </button>
                  </div>
                ) : filterMenuView === 'transaction-type' ? (
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
                        setTransactionTypeFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        transactionTypeFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All Types</span>
                      {transactionTypeFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setTransactionTypeFilter('purchase')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
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
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        transactionTypeFilter === 'return' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Return</span>
                      {transactionTypeFilter === 'return' ? <Check className="h-4 w-4" /> : null}
                    </button>
                  </div>
                ) : filterMenuView === 'completeness' ? (
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
                        setCompletenessFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        completenessFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All</span>
                      {completenessFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setCompletenessFilter('needs-review')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        completenessFilter === 'needs-review' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Needs Review</span>
                      {completenessFilter === 'needs-review' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setCompletenessFilter('complete')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        completenessFilter === 'complete' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Complete</span>
                      {completenessFilter === 'complete' ? <Check className="h-4 w-4" /> : null}
                    </button>
                  </div>
                ) : filterMenuView === 'budget-category' ? (
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
                        setBudgetCategoryFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        budgetCategoryFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All</span>
                      {budgetCategoryFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    {budgetCategories.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No categories</div>
                    ) : (
                      budgetCategories.map(category => (
                        <button
                          key={category.id}
                          onClick={() => {
                            setBudgetCategoryFilter(category.id)
                            setShowFilterMenu(false)
                            setFilterMenuView('main')
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                            budgetCategoryFilter === category.id ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          <span>{category.name}</span>
                          {budgetCategoryFilter === category.id ? <Check className="h-4 w-4" /> : null}
                        </button>
                      ))
                    )}
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
                        setReceiptFilter('all')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        receiptFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>All</span>
                      {receiptFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setReceiptFilter('yes')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        receiptFilter === 'yes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>Yes</span>
                      {receiptFilter === 'yes' ? <Check className="h-4 w-4" /> : null}
                    </button>
                    <button
                      onClick={() => {
                        setReceiptFilter('no')
                        setShowFilterMenu(false)
                        setFilterMenuView('main')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                        receiptFilter === 'no' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                      }`}
                    >
                      <span>No</span>
                      {receiptFilter === 'no' ? <Check className="h-4 w-4" /> : null}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Search Bar - wraps onto its own line on mobile */}
          {/* Export Button */}
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200 flex-shrink-0"
            title="Export all transactions to CSV"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export
          </button>

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
            {searchQuery ||
            filterMode !== 'all' ||
            sourceFilter !== 'all' ||
            receiptFilter !== 'all' ||
            transactionTypeFilter !== 'all' ||
            purchaseMethodFilter !== 'all' ||
            budgetCategoryFilter !== 'all' ||
            completenessFilter !== 'all'
              ? 'Try adjusting your search or filter criteria.'
              : 'No transactions found.'
            }
          </p>
        </div>
      ) : (
        <div className="bg-white overflow-hidden sm:rounded-md">
          <ul className="space-y-3 pb-3">
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
                  className="block bg-gray-50 border border-gray-200 rounded-lg transition-colors duration-200 hover:bg-gray-100"
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
                        <span className="font-medium text-gray-700">
                          {formatCurrency(
                            isCanonicalSaleOrPurchaseTransactionId(transaction.transactionId) && computedTotalByTxId[transaction.transactionId]
                              ? computedTotalByTxId[transaction.transactionId]
                              : transaction.amount
                          )}
                        </span>
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
                      ) : null}
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
