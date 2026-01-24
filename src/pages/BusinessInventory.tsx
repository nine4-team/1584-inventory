import { Plus, Search, Package, Receipt, Filter, QrCode, Trash2, Camera, DollarSign, ArrowUpDown, RefreshCw, Check } from 'lucide-react'
import { useMemo } from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { Item, Transaction, ItemImage, Project, ItemDisposition, BudgetCategory } from '@/types'
import type { Transaction as TransactionType } from '@/types'
import { unifiedItemsService, projectService, integrationService, transactionService } from '@/services/inventoryService'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { useToast } from '@/components/ui/ToastContext'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { useNetworkState } from '@/hooks/useNetworkState'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'
import { formatCurrency, formatDate } from '@/utils/dateUtils'
import { COMPANY_INVENTORY, COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { supabase } from '@/services/supabase'
import { useBookmark } from '@/hooks/useBookmark'
import { useDuplication } from '@/hooks/useDuplication'
import { useAccount } from '@/contexts/AccountContext'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import InventoryItemRow from '@/components/items/InventoryItemRow'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import BlockingConfirmDialog from '@/components/ui/BlockingConfirmDialog'
import { Combobox } from '@/components/ui/Combobox'

interface FilterOptions {
  status?: string
  searchQuery?: string
}

const BUSINESS_ITEM_FILTER_MODES = [
  'all',
  'bookmarked',
  'no-sku',
  'no-description',
  'no-project-price',
  'no-image',
  'no-transaction',
] as const
const BUSINESS_ITEM_SORT_MODES = ['alphabetical', 'creationDate'] as const
const BUSINESS_TX_STATUS_FILTER_MODES = ['all', 'pending', 'completed', 'canceled', 'inventory-only'] as const
const BUSINESS_TX_REIMBURSEMENT_FILTER_MODES = ['all', 'we-owe', 'client-owes'] as const
const BUSINESS_TX_RECEIPT_FILTER_MODES = ['all', 'yes', 'no'] as const
const BUSINESS_TX_TYPE_FILTER_MODES = ['all', 'purchase', 'return'] as const
const BUSINESS_TX_COMPLETENESS_FILTER_MODES = ['all', 'needs-review', 'complete'] as const
const BUSINESS_TX_SORT_MODES = ['date-desc', 'date-asc', 'created-desc', 'created-asc'] as const

const DEFAULT_BUSINESS_ITEM_FILTER = 'all'
const DEFAULT_BUSINESS_ITEM_SORT = 'creationDate'
const DEFAULT_BUSINESS_TX_STATUS_FILTER = 'all'
const DEFAULT_BUSINESS_TX_REIMBURSEMENT_FILTER = 'all'
const DEFAULT_BUSINESS_TX_RECEIPT_FILTER = 'all'
const DEFAULT_BUSINESS_TX_TYPE_FILTER = 'all'
const DEFAULT_BUSINESS_TX_BUDGET_CATEGORY_FILTER = 'all'
const DEFAULT_BUSINESS_TX_COMPLETENESS_FILTER = 'all'
const DEFAULT_BUSINESS_TX_SOURCE_FILTER = 'all'
const DEFAULT_BUSINESS_TX_SORT = 'date-desc'
const DEFAULT_BUSINESS_TAB = 'inventory'

const parseBusinessItemFilterMode = (value: string | null) =>
  BUSINESS_ITEM_FILTER_MODES.includes(value as (typeof BUSINESS_ITEM_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_ITEM_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_ITEM_FILTER

const parseBusinessItemSortMode = (value: string | null) =>
  BUSINESS_ITEM_SORT_MODES.includes(value as (typeof BUSINESS_ITEM_SORT_MODES)[number])
    ? (value as (typeof BUSINESS_ITEM_SORT_MODES)[number])
    : DEFAULT_BUSINESS_ITEM_SORT

const parseBusinessTxStatusFilterMode = (value: string | null) =>
  BUSINESS_TX_STATUS_FILTER_MODES.includes(value as (typeof BUSINESS_TX_STATUS_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_TX_STATUS_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_TX_STATUS_FILTER

const parseBusinessTxReimbursementFilterMode = (value: string | null) =>
  BUSINESS_TX_REIMBURSEMENT_FILTER_MODES.includes(value as (typeof BUSINESS_TX_REIMBURSEMENT_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_TX_REIMBURSEMENT_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_TX_REIMBURSEMENT_FILTER

const parseBusinessTxReceiptFilterMode = (value: string | null) => {
  if (value === 'no-email') return 'no'
  return BUSINESS_TX_RECEIPT_FILTER_MODES.includes(value as (typeof BUSINESS_TX_RECEIPT_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_TX_RECEIPT_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_TX_RECEIPT_FILTER
}

const parseBusinessTxTypeFilterMode = (value: string | null) =>
  BUSINESS_TX_TYPE_FILTER_MODES.includes(value as (typeof BUSINESS_TX_TYPE_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_TX_TYPE_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_TX_TYPE_FILTER

const parseBusinessTxCompletenessFilterMode = (value: string | null) =>
  BUSINESS_TX_COMPLETENESS_FILTER_MODES.includes(value as (typeof BUSINESS_TX_COMPLETENESS_FILTER_MODES)[number])
    ? (value as (typeof BUSINESS_TX_COMPLETENESS_FILTER_MODES)[number])
    : DEFAULT_BUSINESS_TX_COMPLETENESS_FILTER

const parseBusinessTxBudgetCategoryFilter = (value: string | null) =>
  value && value !== DEFAULT_BUSINESS_TX_BUDGET_CATEGORY_FILTER ? value : DEFAULT_BUSINESS_TX_BUDGET_CATEGORY_FILTER

const parseBusinessTxSourceFilter = (value: string | null) =>
  value && value !== DEFAULT_BUSINESS_TX_SOURCE_FILTER ? value : DEFAULT_BUSINESS_TX_SOURCE_FILTER

const parseBusinessTxSortMode = (value: string | null) =>
  BUSINESS_TX_SORT_MODES.includes(value as (typeof BUSINESS_TX_SORT_MODES)[number])
    ? (value as (typeof BUSINESS_TX_SORT_MODES)[number])
    : DEFAULT_BUSINESS_TX_SORT

export default function BusinessInventory() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const { items: snapshotItems, transactions: snapshotTransactions, isLoading: realtimeLoading, refreshCollections } =
    useBusinessInventoryRealtime()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const { buildContextUrl } = useNavigationContext()
  const stackedNavigate = useStackedNavigate()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'inventory' | 'transactions'>(() => {
    const tab = searchParams.get('bizTab')
    return tab === 'transactions' ? 'transactions' : DEFAULT_BUSINESS_TAB
  })
  const [items, setItems] = useState<Item[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filters] = useState<FilterOptions>({
    status: '',
    searchQuery: ''
  })
  const handleNavigateToEdit = useCallback(
    (href: string) => {
      if (!href || href === '#') return
      stackedNavigate(buildContextUrl(href), undefined, { scrollY: window.scrollY })
    },
    [buildContextUrl, stackedNavigate]
  )

  const handleTransactionNavigate = useCallback(
    (transactionId: string) => {
      if (!transactionId) return
      stackedNavigate(
        buildContextUrl(`/business-inventory/transaction/${transactionId}`),
        undefined,
        { scrollY: window.scrollY }
      )
    },
    [buildContextUrl, stackedNavigate]
  )

  const [inventorySearchQuery, setInventorySearchQuery] = useState<string>(() =>
    searchParams.get('bizItemSearch') ?? ''
  )
  const [transactionSearchQuery, setTransactionSearchQuery] = useState<string>(() =>
    searchParams.get('bizTxSearch') ?? ''
  )

  // Filter state for transactions tab
  const [showTransactionFilterMenu, setShowTransactionFilterMenu] = useState(false)
  const [transactionFilterMenuView, setTransactionFilterMenuView] = useState<
    'main'
    | 'status'
    | 'source'
    | 'reimbursement-status'
    | 'transaction-type'
    | 'email-receipt'
    | 'budget-category'
    | 'completeness'
  >('main')
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<'all' | 'pending' | 'completed' | 'canceled' | 'inventory-only'>(() =>
    parseBusinessTxStatusFilterMode(searchParams.get('bizTxFilter'))
  )
  const [transactionReimbursementFilter, setTransactionReimbursementFilter] = useState<'all' | 'we-owe' | 'client-owes'>(() =>
    parseBusinessTxReimbursementFilterMode(searchParams.get('bizTxReimbursement'))
  )
  const [transactionReceiptFilter, setTransactionReceiptFilter] = useState<'all' | 'yes' | 'no'>(() =>
    parseBusinessTxReceiptFilterMode(searchParams.get('bizTxReceipt'))
  )
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'purchase' | 'return'>(() =>
    parseBusinessTxTypeFilterMode(searchParams.get('bizTxType'))
  )
  const [transactionBudgetCategoryFilter, setTransactionBudgetCategoryFilter] = useState<string>(() =>
    parseBusinessTxBudgetCategoryFilter(searchParams.get('bizTxCategory'))
  )
  const [transactionCompletenessFilter, setTransactionCompletenessFilter] = useState<'all' | 'needs-review' | 'complete'>(() =>
    parseBusinessTxCompletenessFilterMode(searchParams.get('bizTxCompleteness'))
  )
  const [transactionSourceFilter, setTransactionSourceFilter] = useState<string>(() =>
    parseBusinessTxSourceFilter(searchParams.get('bizTxSource'))
  )
  const [transactionSortMode, setTransactionSortMode] = useState<'date-desc' | 'date-asc' | 'created-desc' | 'created-asc'>(() =>
    parseBusinessTxSortMode(searchParams.get('bizTxSort'))
  )
  const [showTransactionSortMenu, setShowTransactionSortMenu] = useState(false)

  // Image upload state
  const [uploadingImages, setUploadingImages] = useState<Set<string>>(new Set())

  // Filter and selection state for inventory items (matching InventoryList.tsx)
  const [filterMode, setFilterMode] = useState<
    'all'
    | 'bookmarked'
    | 'no-sku'
    | 'no-description'
    | 'no-project-price'
    | 'no-image'
    | 'no-transaction'
  >(() => parseBusinessItemFilterMode(searchParams.get('bizItemFilter')))
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortMode, setSortMode] = useState<'alphabetical' | 'creationDate'>(() =>
    parseBusinessItemSortMode(searchParams.get('bizItemSort'))
  )
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectTargetItemId, setProjectTargetItemId] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [isUpdatingProject, setIsUpdatingProject] = useState(false)
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [transactionsForDialog, setTransactionsForDialog] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [transactionTargetItemId, setTransactionTargetItemId] = useState<string | null>(null)
  const [isUpdatingTransaction, setIsUpdatingTransaction] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetItemId, setDeleteTargetItemId] = useState<string | null>(null)
  const [isDeletingItem, setIsDeletingItem] = useState(false)
  const { showSuccess, showError } = useToast()
  const { showOfflineSaved } = useOfflineFeedback()
  const { isOnline } = useNetworkState()
  const isSyncingFromUrlRef = useRef(false)
  const hasRestoredInventoryScrollRef = useRef(false)
  const hasRestoredTransactionScrollRef = useRef(false)
  const isLoading = accountLoading || realtimeLoading

  useEffect(() => {
    const nextTab = searchParams.get('bizTab')
    const nextActiveTab = nextTab === 'transactions' ? 'transactions' : DEFAULT_BUSINESS_TAB
    const nextItemSearch = searchParams.get('bizItemSearch') ?? ''
    const nextTxSearch = searchParams.get('bizTxSearch') ?? ''
    const nextItemFilter = parseBusinessItemFilterMode(searchParams.get('bizItemFilter'))
    const nextItemSort = parseBusinessItemSortMode(searchParams.get('bizItemSort'))
    const nextTxStatusFilter = parseBusinessTxStatusFilterMode(searchParams.get('bizTxFilter'))
    const nextTxReimbursementFilter = parseBusinessTxReimbursementFilterMode(searchParams.get('bizTxReimbursement'))
    const nextTxReceiptFilter = parseBusinessTxReceiptFilterMode(searchParams.get('bizTxReceipt'))
    const nextTxTypeFilter = parseBusinessTxTypeFilterMode(searchParams.get('bizTxType'))
    const nextTxBudgetCategoryFilter = parseBusinessTxBudgetCategoryFilter(searchParams.get('bizTxCategory'))
    const nextTxCompletenessFilter = parseBusinessTxCompletenessFilterMode(searchParams.get('bizTxCompleteness'))
    const nextTxSourceFilter = parseBusinessTxSourceFilter(searchParams.get('bizTxSource'))
    const nextTxSort = parseBusinessTxSortMode(searchParams.get('bizTxSort'))

    const hasChanges =
      activeTab !== nextActiveTab ||
      inventorySearchQuery !== nextItemSearch ||
      transactionSearchQuery !== nextTxSearch ||
      filterMode !== nextItemFilter ||
      sortMode !== nextItemSort ||
      transactionStatusFilter !== nextTxStatusFilter ||
      transactionReimbursementFilter !== nextTxReimbursementFilter ||
      transactionReceiptFilter !== nextTxReceiptFilter ||
      transactionTypeFilter !== nextTxTypeFilter ||
      transactionBudgetCategoryFilter !== nextTxBudgetCategoryFilter ||
      transactionCompletenessFilter !== nextTxCompletenessFilter ||
      transactionSourceFilter !== nextTxSourceFilter ||
      transactionSortMode !== nextTxSort

    if (!hasChanges) return

    isSyncingFromUrlRef.current = true
    if (activeTab !== nextActiveTab) setActiveTab(nextActiveTab)
    if (inventorySearchQuery !== nextItemSearch) setInventorySearchQuery(nextItemSearch)
    if (transactionSearchQuery !== nextTxSearch) setTransactionSearchQuery(nextTxSearch)
    if (filterMode !== nextItemFilter) setFilterMode(nextItemFilter)
    if (sortMode !== nextItemSort) setSortMode(nextItemSort)
    if (transactionStatusFilter !== nextTxStatusFilter) setTransactionStatusFilter(nextTxStatusFilter)
    if (transactionReimbursementFilter !== nextTxReimbursementFilter) setTransactionReimbursementFilter(nextTxReimbursementFilter)
    if (transactionReceiptFilter !== nextTxReceiptFilter) setTransactionReceiptFilter(nextTxReceiptFilter)
    if (transactionTypeFilter !== nextTxTypeFilter) setTransactionTypeFilter(nextTxTypeFilter)
    if (transactionBudgetCategoryFilter !== nextTxBudgetCategoryFilter) setTransactionBudgetCategoryFilter(nextTxBudgetCategoryFilter)
    if (transactionCompletenessFilter !== nextTxCompletenessFilter) setTransactionCompletenessFilter(nextTxCompletenessFilter)
    if (transactionSourceFilter !== nextTxSourceFilter) setTransactionSourceFilter(nextTxSourceFilter)
    if (transactionSortMode !== nextTxSort) setTransactionSortMode(nextTxSort)
  }, [searchParams])

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isSyncingFromUrlRef.current) {
      isSyncingFromUrlRef.current = false
      return
    }

    const updateUrl = () => {
      const nextParams = new URLSearchParams(searchParams)
      const setParam = (key: string, value: string, defaultValue: string) => {
        if (!value || value === defaultValue) {
          nextParams.delete(key)
        } else {
          nextParams.set(key, value)
        }
      }

      setParam('bizTab', activeTab, DEFAULT_BUSINESS_TAB)
      setParam('bizItemSearch', inventorySearchQuery, '')
      setParam('bizTxSearch', transactionSearchQuery, '')
      setParam('bizItemFilter', filterMode, DEFAULT_BUSINESS_ITEM_FILTER)
      setParam('bizItemSort', sortMode, DEFAULT_BUSINESS_ITEM_SORT)
      setParam('bizTxFilter', transactionStatusFilter, DEFAULT_BUSINESS_TX_STATUS_FILTER)
      setParam('bizTxReimbursement', transactionReimbursementFilter, DEFAULT_BUSINESS_TX_REIMBURSEMENT_FILTER)
      setParam('bizTxReceipt', transactionReceiptFilter, DEFAULT_BUSINESS_TX_RECEIPT_FILTER)
      setParam('bizTxType', transactionTypeFilter, DEFAULT_BUSINESS_TX_TYPE_FILTER)
      setParam('bizTxCategory', transactionBudgetCategoryFilter, DEFAULT_BUSINESS_TX_BUDGET_CATEGORY_FILTER)
      setParam('bizTxCompleteness', transactionCompletenessFilter, DEFAULT_BUSINESS_TX_COMPLETENESS_FILTER)
      setParam('bizTxSource', transactionSourceFilter, DEFAULT_BUSINESS_TX_SOURCE_FILTER)
      setParam('bizTxSort', transactionSortMode, DEFAULT_BUSINESS_TX_SORT)

      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true, state: location.state })
      }
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(updateUrl, 500)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [
    activeTab,
    filterMode,
    inventorySearchQuery,
    location.state,
    searchParams,
    setSearchParams,
    sortMode,
    transactionStatusFilter,
    transactionReimbursementFilter,
    transactionReceiptFilter,
    transactionSearchQuery,
    transactionTypeFilter,
    transactionBudgetCategoryFilter,
    transactionCompletenessFilter,
    transactionSourceFilter,
    transactionSortMode,
  ])

  // Batch allocation state
  const [projects, setProjects] = useState<Project[]>([])
  const [showBatchAllocationModal, setShowBatchAllocationModal] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [batchAllocationForm, setBatchAllocationForm] = useState({
    projectId: '',
    space: ''
  })
  const [isAllocating, setIsAllocating] = useState(false)
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])

  // Close filter menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if ((showFilterMenu || showTransactionFilterMenu || showSortMenu) && !event.target) return

      const target = event.target as Element
      if (!target.closest('.filter-menu') && !target.closest('.filter-button') && !target.closest('.transaction-filter-menu') && !target.closest('.transaction-filter-button') && !target.closest('.sort-menu') && !target.closest('.sort-button') && !target.closest('.transaction-sort-menu') && !target.closest('.transaction-sort-button')) {
        setShowFilterMenu(false)
        setShowTransactionFilterMenu(false)
        setShowSortMenu(false)
        setShowTransactionSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterMenu, showTransactionFilterMenu, showSortMenu, showTransactionSortMenu])

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    try {
      const item = items.find((it: Item) => it.itemId === itemId)
      if (!item) {
        console.error('Item not found for disposition update:', itemId)
        return
      }

      if (!currentAccountId) throw new Error('Account ID is required')
      const wasOffline = !isOnline
      await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: newDisposition })

      if (newDisposition === 'inventory') {
        try {
          await integrationService.handleItemDeallocation(currentAccountId, itemId, item.projectId || '', newDisposition)
          if (wasOffline) {
            showOfflineSaved(null)
          } else {
            showSuccess && showSuccess('Item moved to inventory')
          }
          await refreshRealtimeAfterWrite()
        } catch (deallocationError) {
          console.error('Failed to handle deallocation:', deallocationError)
          await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: item.disposition })
          showError && showError('Failed to move item to inventory. Please try again.')
          return
        }
      } else {
        setItems(prev => prev.map(i => i.itemId === itemId ? { ...i, disposition: newDisposition } : i))
        if (wasOffline) {
          showOfflineSaved(null)
        }
        await refreshRealtimeAfterWrite()
      }
    } catch (error) {
      console.error('Failed to update disposition:', error)
      showError && showError('Failed to update disposition. Please try again.')
    }
  }

  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: project.name,
      disabled: false
    })),
    [projects]
  )

  const openProjectDialog = (itemId: string) => {
    setProjectTargetItemId(itemId)
    setSelectedProjectId('')
    setShowProjectDialog(true)
  }

  const openTransactionDialog = (itemId: string) => {
    const targetItem = items.find(entry => entry.itemId === itemId)
    setTransactionTargetItemId(itemId)
    setSelectedTransactionId(targetItem?.transactionId ?? '')
    setShowTransactionDialog(true)
  }

  const loadTransactions = async () => {
    if (!currentAccountId) return
    setLoadingTransactions(true)
    try {
      const txs = await transactionService.getBusinessInventoryTransactions(currentAccountId)
      setTransactionsForDialog(txs)
    } catch (error) {
      console.error('Failed to load transactions:', error)
      showError && showError('Failed to load transactions. Please try again.')
    } finally {
      setLoadingTransactions(false)
    }
  }

  useEffect(() => {
    if (!showTransactionDialog) return
    if (transactionsForDialog.length > 0) return
    loadTransactions()
  }, [showTransactionDialog, transactionsForDialog.length])

  const handleMoveToProject = async () => {
    if (!currentAccountId || !projectTargetItemId || !selectedProjectId) return
    setIsUpdatingProject(true)
    try {
      const wasOffline = !isOnline
      await unifiedItemsService.allocateItemToProject(
        currentAccountId,
        projectTargetItemId,
        selectedProjectId,
        undefined,
        undefined,
        undefined
      )
      if (wasOffline) {
        showOfflineSaved(null)
        setShowProjectDialog(false)
        setProjectTargetItemId(null)
        return
      }
      await refreshRealtimeAfterWrite()
      setItems(prev => prev.filter(item => item.itemId !== projectTargetItemId))
      setShowProjectDialog(false)
      setProjectTargetItemId(null)
    } catch (error) {
      console.error('Failed to allocate item to project:', error)
      showError && showError('Failed to move item to project. Please try again.')
    } finally {
      setIsUpdatingProject(false)
    }
  }

  const handleChangeTransaction = async () => {
    if (!currentAccountId || !transactionTargetItemId || !selectedTransactionId) return
    const item = items.find(entry => entry.itemId === transactionTargetItemId)
    if (!item) return
    const previousTransactionId = item.transactionId

    setIsUpdatingTransaction(true)
    try {
      await unifiedItemsService.assignItemToTransaction(currentAccountId, selectedTransactionId, transactionTargetItemId, {
        itemPreviousTransactionId: previousTransactionId
      })

      await refreshRealtimeAfterWrite()
      setShowTransactionDialog(false)
      setTransactionTargetItemId(null)
      setSelectedTransactionId('')
      showSuccess && showSuccess('Transaction updated successfully')
    } catch (error) {
      console.error('Failed to update transaction:', error)
      showError && showError('Failed to update transaction. Please try again.')
    } finally {
      setIsUpdatingTransaction(false)
    }
  }

  const handleRemoveFromTransaction = async () => {
    if (!currentAccountId || !transactionTargetItemId) return
    const item = items.find(entry => entry.itemId === transactionTargetItemId)
    if (!item?.transactionId) return

    setIsUpdatingTransaction(true)
    try {
      await unifiedItemsService.unlinkItemFromTransaction(currentAccountId, item.transactionId, item.itemId, {
        itemCurrentTransactionId: item.transactionId
      })
      await refreshRealtimeAfterWrite()
      setShowTransactionDialog(false)
      setTransactionTargetItemId(null)
      setSelectedTransactionId('')
      showSuccess && showSuccess('Removed from transaction')
    } catch (error) {
      console.error('Failed to remove item from transaction:', error)
      showError && showError('Failed to remove item from transaction. Please try again.')
    } finally {
      setIsUpdatingTransaction(false)
    }
  }

  const handleDeleteItem = async () => {
    if (!currentAccountId || !deleteTargetItemId) return
    setIsDeletingItem(true)
    try {
      await unifiedItemsService.deleteItem(currentAccountId, deleteTargetItemId)
      await refreshRealtimeAfterWrite()
      setItems(prev => prev.filter(item => item.itemId !== deleteTargetItemId))
      setShowDeleteConfirm(false)
      setDeleteTargetItemId(null)
    } catch (error) {
      console.error('Failed to delete item:', error)
      showError && showError('Failed to delete item. Please try again.')
    } finally {
      setIsDeletingItem(false)
    }
  }

  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    return value.trim().length > 0 && Number.isFinite(Number.parseFloat(value))
  }

  // Compute filtered items (matching InventoryList.tsx)
  const filteredItems = useMemo(() => {
    let filtered = items.filter(item => {
      // Apply search filter
      const query = (inventorySearchQuery || '').toLowerCase().trim()
      const matchesSearch = !query ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.sku || '').toLowerCase().includes(query) ||
        (item.source || '').toLowerCase().includes(query) ||
        (item.paymentMethod || '').toLowerCase().includes(query) ||
        (item.businessInventoryLocation || '').toLowerCase().includes(query)

      // Apply status filter
      const matchesStatus = !filters.status || item.inventoryStatus === filters.status

      // Apply filter based on filterMode
      let matchesFilter = false
      switch (filterMode) {
        case 'all':
          matchesFilter = true
          break
        case 'bookmarked':
          matchesFilter = !!item.bookmark
          break
        case 'no-sku':
          matchesFilter = !item.sku?.trim()
          break
        case 'no-description':
          matchesFilter = !item.description?.trim()
          break
        case 'no-project-price':
          matchesFilter = !hasNonEmptyMoneyString(item.projectPrice)
          break
        case 'no-image':
          matchesFilter = !item.images || item.images.length === 0
          break
        case 'no-transaction':
          matchesFilter = !item.transactionId
          break
        default:
          matchesFilter = true
      }

      return matchesSearch && matchesStatus && matchesFilter
    })

    // Apply sorting
    filtered.sort((a, b) => {
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

    return filtered
  }, [items, inventorySearchQuery, filters.status, filterMode, sortMode])

  const lastItemId = filteredItems[filteredItems.length - 1]?.itemId

  // Canonical transaction title for display only
  const getCanonicalTransactionTitle = (transaction: TransactionType): string => {
    if (transaction.transactionId?.startsWith('INV_SALE_')) return COMPANY_INVENTORY_SALE
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) return COMPANY_INVENTORY_PURCHASE
    return transaction.source
  }

  // Group filtered items by their grouping key
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>()

    filteredItems.forEach(item => {
      const groupKey = getInventoryListGroupKey(item, 'businessInventory')
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    })

    // Convert to array - items are already sorted in filteredItems
    return Array.from(groups.entries())
      .map(([groupKey, items]) => ({ groupKey, items }))
  }, [filteredItems])

  const selectedTransactionBudgetCategory = useMemo(
    () => budgetCategories.find(category => category.id === transactionBudgetCategoryFilter),
    [budgetCategories, transactionBudgetCategoryFilter]
  )

  const availableTransactionSources = useMemo(() => {
    const titles = transactions
      .map(t => getCanonicalTransactionTitle(t))
      .filter(Boolean)
    return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b))
  }, [transactions])

  // Compute filtered transactions
  const filteredTransactions = useMemo(() => {
    const parseDate = (value?: string | null): number => {
      if (!value) return 0
      const ms = Date.parse(value)
      return Number.isFinite(ms) ? ms : 0
    }

    let filtered = transactions

    // Apply status filter based on filter mode
    if (transactionStatusFilter !== 'all') {
      if (transactionStatusFilter === 'inventory-only') {
        // Show only business inventory transactions (projectId == null)
        filtered = filtered.filter(t => t.projectId === null)
      } else {
        // Apply status filter for other modes
        filtered = filtered.filter(t => t.status === transactionStatusFilter)
      }
    }

    if (transactionReimbursementFilter !== 'all') {
      if (transactionReimbursementFilter === 'we-owe') {
        filtered = filtered.filter(t => t.reimbursementType === COMPANY_OWES_CLIENT)
      } else if (transactionReimbursementFilter === 'client-owes') {
        filtered = filtered.filter(t => t.reimbursementType === CLIENT_OWES_COMPANY)
      }
    }

    if (transactionSourceFilter !== DEFAULT_BUSINESS_TX_SOURCE_FILTER) {
      filtered = filtered.filter(t => getCanonicalTransactionTitle(t) === transactionSourceFilter)
    }

    if (transactionTypeFilter !== 'all') {
      const filterValue = transactionTypeFilter.toLowerCase()
      filtered = filtered.filter(t => (t.transactionType ?? '').toLowerCase() === filterValue)
    }

    if (transactionReceiptFilter === 'yes') {
      filtered = filtered.filter(t => t.receiptEmailed)
    } else if (transactionReceiptFilter === 'no') {
      filtered = filtered.filter(t => !t.receiptEmailed)
    }

    if (transactionBudgetCategoryFilter !== DEFAULT_BUSINESS_TX_BUDGET_CATEGORY_FILTER) {
      const selectedCategoryName = selectedTransactionBudgetCategory?.name?.trim()
      filtered = filtered.filter(t => {
        if (t.categoryId) return t.categoryId === transactionBudgetCategoryFilter
        if (!selectedCategoryName) return false
        return (t.budgetCategory ?? '').trim() === selectedCategoryName
      })
    }

    if (transactionCompletenessFilter !== DEFAULT_BUSINESS_TX_COMPLETENESS_FILTER) {
      if (transactionCompletenessFilter === 'needs-review') {
        filtered = filtered.filter(t => t.needsReview === true)
      } else {
        filtered = filtered.filter(t => t.needsReview !== true)
      }
    }

    // Apply search filter
    if (transactionSearchQuery) {
      const query = transactionSearchQuery.toLowerCase()
      filtered = filtered.filter(t =>
        getCanonicalTransactionTitle(t).toLowerCase().includes(query) ||
        t.source?.toLowerCase().includes(query) ||
        t.transactionType?.toLowerCase().includes(query) ||
        t.projectName?.toLowerCase().includes(query) ||
        t.notes?.toLowerCase().includes(query)
      )
    }

    const sorted = [...filtered].sort((a, b) => {
      if (transactionSortMode === 'date-desc' || transactionSortMode === 'date-asc') {
        const dateDiff = parseDate(a.transactionDate) - parseDate(b.transactionDate)
        if (dateDiff !== 0) return transactionSortMode === 'date-asc' ? dateDiff : -dateDiff
      }
      if (transactionSortMode === 'created-desc' || transactionSortMode === 'created-asc') {
        const createdDiff = parseDate(a.createdAt) - parseDate(b.createdAt)
        if (createdDiff !== 0) return transactionSortMode === 'created-asc' ? createdDiff : -createdDiff
      }
      const createdDiff = parseDate(a.createdAt) - parseDate(b.createdAt)
      if (createdDiff !== 0) return -createdDiff
      return a.transactionId.localeCompare(b.transactionId)
    })

    return sorted
  }, [
    transactions,
    transactionStatusFilter,
    transactionReimbursementFilter,
    transactionReceiptFilter,
    transactionSearchQuery,
    transactionSortMode,
    transactionTypeFilter,
    transactionBudgetCategoryFilter,
    transactionCompletenessFilter,
    transactionSourceFilter,
    selectedTransactionBudgetCategory
  ])

  const inventoryValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const rawValue = item.projectPrice ?? item.purchasePrice ?? 0
      const parsed = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue)
      return sum + (Number.isFinite(parsed) ? parsed : 0)
    }, 0)
  }, [items])

  const tabs = [
    { id: 'inventory' as const, name: 'Items', icon: Package },
    { id: 'transactions' as const, name: 'Transactions', icon: Receipt }
  ]

  const refreshRealtimeAfterWrite = useCallback(async () => {
    try {
      await refreshCollections()
    } catch (error) {
      console.debug('BusinessInventory: realtime refresh failed', error)
    }
  }, [refreshCollections])

  useEffect(() => {
    setItems(snapshotItems)
  }, [snapshotItems])

  useEffect(() => {
    if (hasRestoredInventoryScrollRef.current || isLoading || activeTab !== 'inventory') return
    const state = location.state && typeof location.state === 'object' ? (location.state as Record<string, unknown>) : null
    const restoreScrollY = state?.restoreScrollY
    if (!Number.isFinite(restoreScrollY)) return

    // If we have a scroll position to restore, but no items yet, wait for items to load
    // to ensure the page has enough height to scroll.
    if (filteredItems.length === 0 && (restoreScrollY as number) > 0) return

    hasRestoredInventoryScrollRef.current = true
    requestAnimationFrame(() => window.scrollTo(0, restoreScrollY as number))

    const { restoreScrollY: _restoreScrollY, ...rest } = state || {}
    const nextState = Object.keys(rest).length > 0 ? rest : undefined
    navigate(location.pathname + location.search, { replace: true, state: nextState })
  }, [activeTab, isLoading, location.pathname, location.search, location.state, navigate, filteredItems])

  useEffect(() => {
    if (hasRestoredTransactionScrollRef.current || isLoading || activeTab !== 'transactions') return
    const state = location.state && typeof location.state === 'object' ? (location.state as Record<string, unknown>) : null
    const restoreScrollY = state?.restoreScrollY
    if (!Number.isFinite(restoreScrollY)) return

    // If we have a scroll position to restore, but no transactions yet, wait for transactions to load
    // to ensure the page has enough height to scroll.
    if (filteredTransactions.length === 0 && (restoreScrollY as number) > 0) return

    hasRestoredTransactionScrollRef.current = true
    requestAnimationFrame(() => window.scrollTo(0, restoreScrollY as number))

    const { restoreScrollY: _restoreScrollY, ...rest } = state || {}
    const nextState = Object.keys(rest).length > 0 ? rest : undefined
    navigate(location.pathname + location.search, { replace: true, state: nextState })
  }, [activeTab, isLoading, location.pathname, location.search, location.state, navigate, filteredTransactions])

  useEffect(() => {
    setTransactions(snapshotTransactions)
  }, [snapshotTransactions])

  useEffect(() => {
    const loadProjects = async () => {
      if (!currentAccountId) {
        setProjects([])
        return
      }
      try {
        const projectsData = await projectService.getProjects(currentAccountId)
        setProjects(projectsData)
      } catch (error) {
        console.error('Error loading projects:', error)
        setProjects([])
      }
    }

    loadProjects()
  }, [currentAccountId])

  useEffect(() => {
    const loadBudgetCategories = async () => {
      if (!currentAccountId) {
        setBudgetCategories([])
        return
      }
      try {
        const categories = await budgetCategoriesService.getCategories(currentAccountId, true)
        setBudgetCategories(categories)
      } catch (error) {
        console.error('Error loading budget categories:', error)
        setBudgetCategories([])
      }
    }

    loadBudgetCategories()
  }, [currentAccountId])

  // Per-visible-item lineage subscriptions: refetch single item on new edges to keep list in sync
  useEffect(() => {
    if (!currentAccountId || items.length === 0) return

    const unsubMap = new Map<string, () => void>()
    try {
      items.forEach(item => {
        if (!item?.itemId) return
        const unsub = lineageService.subscribeToItemLineageForItem(currentAccountId, item.itemId, async () => {
          try {
            const updatedItem = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
            if (updatedItem) {
              // If it is still a business inventory item, update it; otherwise remove it from the list
              if (!updatedItem.projectId) {
                setItems(prev => prev.map(i => i.itemId === updatedItem.itemId ? updatedItem : i))
              } else {
                setItems(prev => prev.filter(i => i.itemId !== updatedItem.itemId))
              }
              // Also refresh transactions to ensure deletions/creations are reflected
              try {
                await refreshCollections({ force: true })
              } catch (tErr) {
                console.debug('BusinessInventory - failed to reload transactions after lineage event', tErr)
              }
            }
          } catch (err) {
            console.debug('BusinessInventory - failed to refetch item on lineage event', err)
          }
        })
        unsubMap.set(item.itemId, unsub)
      })
    } catch (err) {
      console.debug('BusinessInventory - failed to setup per-item lineage subscriptions', err)
    }

    return () => {
      unsubMap.forEach(u => {
        try { u() } catch (e) { /* noop */ }
      })
    }
  }, [items.map(i => i.itemId).join(','), currentAccountId, refreshCollections])

  // Reset uploading state on unmount to prevent hanging state
  useEffect(() => {
    return () => {
      setUploadingImages(new Set())
    }
  }, [])

  const handleRefreshInventory = useCallback(async () => {
    if (!currentAccountId || isRefreshing) return
    setIsRefreshing(true)
    try {
      const [projectsData] = await Promise.all([
        projectService.getProjects(currentAccountId),
        refreshCollections({ force: true })
      ])
      setProjects(projectsData)
    } catch (error) {
      console.error('Error refreshing business inventory data:', error)
      showError && showError('Failed to refresh business inventory. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }, [currentAccountId, isRefreshing, refreshCollections, showError])


  const handleInventorySearchChange = (searchQuery: string) => {
    setInventorySearchQuery(searchQuery)
  }

  // Use centralized bookmark hook
  const { toggleBookmark } = useBookmark<Item>({
    items,
    setItems,
    updateItemService: (itemId: string, updates: Partial<Item>) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      return unifiedItemsService.updateItem(currentAccountId, itemId, updates)
    }
  })

  // Use duplication hook for business inventory items
  const { duplicateItem } = useDuplication({
    items,
    setItems,
    duplicationService: async (itemId: string) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      // Since we're using the unified service, we need to create a duplicate item
      const originalItem = await unifiedItemsService.getItemById(currentAccountId, itemId)
      if (!originalItem) throw new Error('Item not found')

      // Create a new item with similar data but new ID
      // Rename destructured `itemId` to `originalItemId` to avoid redeclaring the `itemId` parameter
      const { itemId: originalItemId, dateCreated, lastUpdated, ...itemData } = originalItem
      const result = await unifiedItemsService.createItem(currentAccountId, {
        ...itemData,
        inventoryStatus: 'available',
        projectId: null,
        disposition: 'inventory' // Business inventory duplicates should always be marked inventory
      })
      return result.itemId
    },
    onDuplicateComplete: async (newItemIds: string[]) => {
      if (!currentAccountId || newItemIds.length === 0) return

      try {
        const fetchedItems = await Promise.all(
          newItemIds.map(async (newItemId) => {
            try {
              return await unifiedItemsService.getItemById(currentAccountId, newItemId)
            } catch (error) {
              console.debug('BusinessInventory - failed to fetch duplicated item', error)
              return null
            }
          })
        )

        const newItems = fetchedItems.filter((item): item is Item => item !== null && !item.projectId)
        if (newItems.length > 0) {
          setItems(prev => {
            const existingIds = new Set(prev.map(item => item.itemId))
            const uniqueNewItems = newItems.filter(item => !existingIds.has(item.itemId))
            if (uniqueNewItems.length === 0) return prev
            return [...uniqueNewItems, ...prev]
          })
          return
        }
      } catch (error) {
        console.debug('BusinessInventory - failed to insert duplicated items', error)
      }

      try {
        const refreshedItems = await unifiedItemsService.getBusinessInventoryItems(currentAccountId, filters)
        setItems(refreshedItems)
      } catch (error) {
        console.debug('BusinessInventory - failed to refresh after duplication', error)
      }
    }
  })

  // Batch allocation functions
  const openBatchAllocationModal = () => {
    setShowBatchAllocationModal(true)
  }

  const closeBatchAllocationModal = () => {
    setShowBatchAllocationModal(false)
    setShowProjectDropdown(false)
    setBatchAllocationForm({
      projectId: '',
      space: ''
    })
  }

  const getSelectedProjectName = () => {
    const selectedProject = projects.find(p => p.id === batchAllocationForm.projectId)
    return selectedProject ? `${selectedProject.name} - ${selectedProject.clientName}` : 'Select a project...'
  }

  const handleBatchAllocationSubmit = async () => {
    if (!batchAllocationForm.projectId || selectedItems.size === 0 || !currentAccountId) return

    setIsAllocating(true)
    try {
      const itemIds = Array.from(selectedItems)
      await unifiedItemsService.batchAllocateItemsToProject(
        currentAccountId,
        itemIds,
        batchAllocationForm.projectId,
        {
          space: batchAllocationForm.space
        }
      )

      // Clear selections and close modal
      setSelectedItems(new Set())
      closeBatchAllocationModal()

      // Show success message
      alert(`Successfully allocated ${itemIds.length} items to project!`)
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Error batch allocating items:', error)
      alert('Error allocating items. Please try again.')
    } finally {
      setIsAllocating(false)
    }
  }

  const handleDeleteSelectedItems = async () => {
    if (selectedItems.size === 0 || !currentAccountId) return

    const itemCount = selectedItems.size
    const confirmMessage = itemCount === 1
      ? 'Are you sure you want to delete this item? This action cannot be undone.'
      : `Are you sure you want to delete ${itemCount} items? This action cannot be undone.`

    if (!window.confirm(confirmMessage)) {
      return
    }

    const itemIds = Array.from(selectedItems)

    try {
      let successCount = 0
      let errorCount = 0
      const successfullyDeletedIds: string[] = []

      // Delete items one by one
      for (const itemId of itemIds) {
        try {
          await unifiedItemsService.deleteItem(currentAccountId, itemId)
          successCount++
          successfullyDeletedIds.push(itemId)
        } catch (error) {
          console.error(`Error deleting item ${itemId}:`, error)
          errorCount++
        }
      }

      if (successfullyDeletedIds.length > 0) {
        setItems(prevItems => prevItems.filter(item => !successfullyDeletedIds.includes(item.itemId)))
        setSelectedItems(prevSelected => {
          const updatedSelection = new Set(prevSelected)
          successfullyDeletedIds.forEach(id => updatedSelection.delete(id))
          return updatedSelection
        })
      }

      if (errorCount > 0) {
        // If there were errors, reload the items to make sure state reflects the server
        await refreshCollections({ force: true })
      }
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Error deleting items:', error)
      // Reload items on error to restore state
      await refreshCollections({ force: true })
      alert('Error deleting items. Please try again.')
    }
  }

  // Image handling functions
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
        await refreshRealtimeAfterWrite()
      }
    } catch (error: any) {
      console.error('Error adding image:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      alert('Failed to add image. Please try again.')
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
      'Business Inventory',
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

    // Show success notification on the last file
    if (allFiles && allFiles.indexOf(file) === allFiles.length - 1) {
      const message = allFiles.length > 1 ? `${allFiles.length} images uploaded successfully!` : 'Image uploaded successfully!'
      alert(message)
    }
  }


  // Filter handlers (matching InventoryList.tsx)
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

  // Guard against no account when not loading
  if (!isLoading && !accountLoading && !currentAccountId) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Business Inventory</h1>
        </div>
        <div className="bg-white shadow rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="px-4 py-5 sm:p-6">
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-yellow-600" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No Account Selected
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Please select or create an account to manage inventory.
              </p>
              <div className="mt-6">
                <Link
                  to="/settings"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BlockingConfirmDialog
        open={showDeleteConfirm}
        title="Delete item?"
        description={
          <div className="text-sm text-gray-700 space-y-2">
            <p>This will permanently delete the item.</p>
            <p className="text-gray-600">This action cannot be undone.</p>
          </div>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirming={isDeletingItem}
        onCancel={() => {
          if (isDeletingItem) return
          setShowDeleteConfirm(false)
          setDeleteTargetItemId(null)
        }}
        onConfirm={handleDeleteItem}
      />
      {showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Associate with Transaction
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <Combobox
                label="Select Transaction"
                value={selectedTransactionId}
                onChange={setSelectedTransactionId}
                disabled={loadingTransactions || isUpdatingTransaction}
                loading={loadingTransactions}
                placeholder={loadingTransactions ? "Loading transactions..." : "Select a transaction"}
                options={
                  loadingTransactions ? [] : [
                    { id: '', label: 'Select a transaction' },
                    ...transactionsForDialog.map((transaction) => ({
                      id: transaction.transactionId,
                      label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${getCanonicalTransactionTitle(transaction)} - $${transaction.amount}`
                    }))
                  ]
                }
              />
              {transactionTargetItemId && items.find(item => item.itemId === transactionTargetItemId)?.transactionId && (
                <button
                  type="button"
                  onClick={handleRemoveFromTransaction}
                  className="text-sm text-gray-700 hover:text-gray-900"
                  disabled={isUpdatingTransaction}
                >
                  Your selection will become the new transaction, but a record of the item will stay in the old transaction.
                </button>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (isUpdatingTransaction) return
                  setShowTransactionDialog(false)
                  setSelectedTransactionId('')
                  setTransactionTargetItemId(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isUpdatingTransaction}
              >
                Cancel
              </button>
              <button
                onClick={handleChangeTransaction}
                disabled={!selectedTransactionId || isUpdatingTransaction}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingTransaction ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Move to Project
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <Combobox
                label="Select Project"
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                disabled={loadingProjects || isUpdatingProject}
                loading={loadingProjects}
                placeholder={loadingProjects ? "Loading projects..." : "Select a project"}
                options={projectOptions}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (isUpdatingProject) return
                  setShowProjectDialog(false)
                  setSelectedProjectId('')
                  setProjectTargetItemId(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isUpdatingProject}
              >
                Cancel
              </button>
              <button
                onClick={handleMoveToProject}
                disabled={!selectedProjectId || isUpdatingProject}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingProject ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{COMPANY_INVENTORY}</h1>
            <button
              onClick={handleRefreshInventory}
              className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Refresh business inventory"
              title="Refresh"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-sm text-gray-500">Track items held by the business outside active projects.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div>
              <div className="text-sm text-gray-500">Items</div>
              <div className="text-2xl font-semibold text-gray-900">{items.length}</div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div>
              <div className="text-sm text-gray-500">Inventory Value</div>
              <div className="text-2xl font-semibold text-gray-900">{formatCurrency(inventoryValue)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white shadow rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-base flex items-center ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {tab.name}
                </button>
              )
            })}
          </nav>
        </div>


        {/* Tab Content */}
        <div className="px-6 py-6">
          {activeTab === 'inventory' && (
            <>
              {/* Header - Just Add Item button */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-2">
                <ContextLink
                  to={buildContextUrl('/business-inventory/add')}
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
                      placeholder="Search items by description, SKU, or location..."
                      value={inventorySearchQuery || ''}
                      onChange={(e) => handleInventorySearchChange(e.target.value)}
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
                    <div className="filter-menu absolute top-full right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10">
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
                          Bookmarked Only
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-sku')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-sku' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No SKU
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-description')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-description' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Description
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-project-price')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-project-price' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Project Price
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-image')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-image' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Image
                        </button>
                        <button
                          onClick={() => {
                            setFilterMode('no-transaction')
                            setShowFilterMenu(false)
                          }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                            filterMode === 'no-transaction' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                          }`}
                        >
                          No Transaction
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Allocate to Project Button */}
                <button
                  onClick={openBatchAllocationModal}
                  className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
                  disabled={selectedItems.size === 0}
                  title="Allocate selected items to project"
                >
                  <DollarSign className="h-4 w-4" />
                </button>

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
                  onClick={handleDeleteSelectedItems}
                  className="inline-flex items-center justify-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200"
                  disabled={selectedItems.size === 0}
                  title="Delete Selected Items"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

              {/* Items List */}
              {filteredItems.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">📦</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">
                    No items found
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {inventorySearchQuery || filters.status || filterMode === 'bookmarked'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'No items found.'
                    }
                  </p>
                </div>
              ) : (
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
                            isLastItem={item.itemId === lastItemId}
                            onSelect={handleSelectItem}
                            onBookmark={toggleBookmark}
                            onDuplicate={duplicateItem}
                            onEdit={handleNavigateToEdit}
                            onAddToTransaction={openTransactionDialog}
                            onMoveToProject={openProjectDialog}
                            onChangeStatus={updateDisposition}
                            onDelete={(itemId) => {
                              setDeleteTargetItemId(itemId)
                              setShowDeleteConfirm(true)
                            }}
                            onAddImage={handleAddImage}
                            uploadingImages={uploadingImages}
                            context="businessInventory"
                            itemNumber={groupIndex + 1}
                          />
                        )
                      }

                      // Multiple items - render as collapsed group
                      const firstItem = groupItems[0]
                      const groupSelectionState = getGroupSelectionState(groupItems)
                      const hasAnyPrice = firstItem.projectPrice || firstItem.purchasePrice
                      const totalPrice = groupItems.reduce((sum, item) => {
                        const price = parseFloat(item.projectPrice || item.purchasePrice || '0') || 0
                        return sum + price
                      }, 0)
                      const firstItemPrice = parseFloat(firstItem.projectPrice || firstItem.purchasePrice || '0') || 0

                      // Component to handle transaction display info for grouped items
                      const GroupedItemSummary = () => {
                        const { buildContextUrl } = useNavigationContext()
                        const [transactionDisplayInfo, setTransactionDisplayInfo] = useState<{title: string, amount: string} | null>(null)
                        const [transactionRoute, setTransactionRoute] = useState<{path: string, projectId: string | null} | null>(null)

                        useEffect(() => {
                          const fetchTransactionData = async () => {
                            if (firstItem.transactionId && currentAccountId) {
                              const [displayInfo, route] = await Promise.all([
                                getTransactionDisplayInfo(currentAccountId, firstItem.transactionId, 20),
                                getTransactionRoute(firstItem.transactionId, currentAccountId, null)
                              ])
                              setTransactionDisplayInfo(displayInfo)
                              setTransactionRoute(route)
                            } else {
                              setTransactionDisplayInfo(null)
                              setTransactionRoute(null)
                            }
                          }

                          fetchTransactionData()
                        }, [firstItem.transactionId, currentAccountId])

                        return (
                          <>
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
                              <div>
                                {firstItem.description && (
                                  <h4 className="text-sm font-medium text-gray-900 mb-1">
                                    {firstItem.description}
                                  </h4>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                                  {/* SKU and conditional transaction/source display */}
                                  <div>
                                    {firstItem.sku && <span className="font-medium">SKU: {firstItem.sku}</span>}
                                  {firstItem.sku && (transactionDisplayInfo || firstItem.source) && (
                                    <span className="mx-2 text-gray-400">•</span>
                                  )}
                                    {transactionDisplayInfo ? (
                                      <span
                                        className="inline-flex items-center text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer hover:underline"
                                        title={`View transaction: ${transactionDisplayInfo.title}`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          if (transactionRoute) {
                                            window.location.href = buildContextUrl(
                                              transactionRoute.path,
                                              transactionRoute.projectId ? { project: transactionRoute.projectId } : undefined
                                            )
                                          }
                                        }}
                                      >
                                        <Receipt className="h-3 w-3 mr-1" />
                                        {transactionDisplayInfo.title} {transactionDisplayInfo.amount}
                                      </span>
                                    ) : (
                                      firstItem.source && <span className="text-xs font-medium text-gray-600">{firstItem.source}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )
                      }

                      return (
                        <li key={groupKey} className="relative">
                          <CollapsedDuplicateGroup
                            groupId={groupKey}
                            count={groupItems.length}
                            selectionState={groupSelectionState}
                            onToggleSelection={(checked) => handleSelectGroup(groupItems, checked)}
                            topRowContent={
                              hasAnyPrice && (
                                <span className="text-sm text-gray-500">
                                  {formatCurrency(totalPrice)}
                                  {groupItems.length > 1 && totalPrice !== firstItemPrice && (
                                    <span className="text-xs text-gray-400">
                                      {' ('}{formatCurrency(totalPrice / groupItems.length)} each)
                                    </span>
                                  )}
                                </span>
                              )
                            }
                            summary={<GroupedItemSummary />}
                          >
                            {/* Render individual items in the expanded group */}
                            <ul className="divide-y divide-gray-200 rounded-lg overflow-visible list-none p-0 m-0">
                              {groupItems.map((item, itemIndex) => (
                                <InventoryItemRow
                                  key={item.itemId}
                                  item={item}
                                  isSelected={selectedItems.has(item.itemId)}
                                  isLastItem={item.itemId === lastItemId}
                                  onSelect={handleSelectItem}
                                  onBookmark={toggleBookmark}
                                  onDuplicate={duplicateItem}
                                  onEdit={handleNavigateToEdit}
                                  onAddToTransaction={openTransactionDialog}
                                  onMoveToProject={openProjectDialog}
                                  onChangeStatus={updateDisposition}
                                  onDelete={(itemId) => {
                                    setDeleteTargetItemId(itemId)
                                    setShowDeleteConfirm(true)
                                  }}
                                  onAddImage={handleAddImage}
                                  uploadingImages={uploadingImages}
                                  context="businessInventory"
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
              )}
            </>
          )}

          {activeTab === 'transactions' && (
            <>
              {/* Header - Add Transaction button */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                <ContextLink
                  to={buildContextUrl('/business-inventory/transaction/add')}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-200 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Transaction
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
                      placeholder="Search transactions by source, type, project, or notes..."
                      value={transactionSearchQuery || ''}
                      onChange={(e) => setTransactionSearchQuery(e.target.value)}
                    />
                  </div>

                  {/* Filter Controls */}
                  <div className="flex items-center justify-end gap-4 p-3 rounded-lg">
                    {/* Sort Button */}
                    <div className="relative">
                      <button
                        onClick={() => setShowTransactionSortMenu(!showTransactionSortMenu)}
                        className={`transaction-sort-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                          transactionSortMode === 'date-desc'
                            ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                            : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
                        }`}
                        title="Sort transactions"
                      >
                        <ArrowUpDown className="h-4 w-4 mr-2" />
                        Sort
                      </button>

                      {showTransactionSortMenu && (
                        <div className="transaction-sort-menu absolute top-full right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                          <div className="py-1">
                            <button
                              onClick={() => {
                                setTransactionSortMode('date-desc')
                                setShowTransactionSortMenu(false)
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionSortMode === 'date-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              <span>Purchase Date (newest)</span>
                              {transactionSortMode === 'date-desc' ? <Check className="h-4 w-4" /> : null}
                            </button>
                            <button
                              onClick={() => {
                                setTransactionSortMode('date-asc')
                                setShowTransactionSortMenu(false)
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionSortMode === 'date-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              <span>Purchase Date (oldest)</span>
                              {transactionSortMode === 'date-asc' ? <Check className="h-4 w-4" /> : null}
                            </button>
                            <button
                              onClick={() => {
                                setTransactionSortMode('created-desc')
                                setShowTransactionSortMenu(false)
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionSortMode === 'created-desc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              <span>Created Date (newest)</span>
                              {transactionSortMode === 'created-desc' ? <Check className="h-4 w-4" /> : null}
                            </button>
                            <button
                              onClick={() => {
                                setTransactionSortMode('created-asc')
                                setShowTransactionSortMenu(false)
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                transactionSortMode === 'created-asc' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                              }`}
                            >
                              <span>Created Date (oldest)</span>
                              {transactionSortMode === 'created-asc' ? <Check className="h-4 w-4" /> : null}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Filter Button */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          const next = !showTransactionFilterMenu
                          setShowTransactionFilterMenu(next)
                          if (next) setTransactionFilterMenuView('main')
                        }}
                        className={`transaction-filter-button inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md transition-colors duration-200 ${
                          transactionStatusFilter === 'all' &&
                          transactionReimbursementFilter === 'all' &&
                          transactionReceiptFilter === 'all' &&
                          transactionTypeFilter === 'all' &&
                          transactionBudgetCategoryFilter === 'all' &&
                          transactionCompletenessFilter === 'all' &&
                          transactionSourceFilter === 'all'
                            ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                            : 'border-primary-500 text-primary-600 bg-primary-50 hover:bg-primary-100'
                        }`}
                        title="Filter transactions"
                      >
                        <Filter className="h-4 w-4 mr-2" />
                        Filter
                      </button>

                      {/* Transaction Filter Dropdown Menu */}
                      {showTransactionFilterMenu && (
                        <div className="transaction-filter-menu absolute top-full right-0 mt-1 w-[min(14rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto">
                          {transactionFilterMenuView === 'main' ? (
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('all')
                                  setTransactionReimbursementFilter('all')
                                  setTransactionReceiptFilter('all')
                                  setTransactionTypeFilter('all')
                                  setTransactionBudgetCategoryFilter('all')
                                  setTransactionCompletenessFilter('all')
                                  setTransactionSourceFilter('all')
                                  setShowTransactionFilterMenu(false)
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'all' &&
                                  transactionReimbursementFilter === 'all' &&
                                  transactionReceiptFilter === 'all' &&
                                  transactionTypeFilter === 'all' &&
                                  transactionBudgetCategoryFilter === 'all' &&
                                  transactionCompletenessFilter === 'all' &&
                                  transactionSourceFilter === 'all'
                                    ? 'bg-primary-50 text-primary-600'
                                    : 'text-gray-700'
                                }`}
                              >
                                <span>All Transactions</span>
                                {transactionStatusFilter === 'all' &&
                                transactionReimbursementFilter === 'all' &&
                                transactionReceiptFilter === 'all' &&
                                transactionTypeFilter === 'all' &&
                                transactionBudgetCategoryFilter === 'all' &&
                                transactionCompletenessFilter === 'all' &&
                                transactionSourceFilter === 'all' ? (
                                  <Check className="h-4 w-4" />
                                ) : null}
                              </button>

                              <button
                                onClick={() => setTransactionFilterMenuView('transaction-type')}
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
                                onClick={() => setTransactionFilterMenuView('status')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Status"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Status</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionStatusFilter === 'all'
                                      ? 'All'
                                      : transactionStatusFilter === 'inventory-only'
                                      ? 'Inventory Only'
                                      : transactionStatusFilter.charAt(0).toUpperCase() + transactionStatusFilter.slice(1)}
                                  </span>
                                </div>
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => setTransactionFilterMenuView('completeness')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionCompletenessFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Completeness"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Completeness</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionCompletenessFilter === 'all'
                                      ? 'All'
                                      : transactionCompletenessFilter === 'needs-review'
                                      ? 'Needs Review'
                                      : 'Complete'}
                                  </span>
                                </div>
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => setTransactionFilterMenuView('email-receipt')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReceiptFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Email receipt"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Email Receipt</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionReceiptFilter === 'all' ? 'All' : transactionReceiptFilter === 'yes' ? 'Yes' : 'No'}
                                  </span>
                                </div>
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => setTransactionFilterMenuView('budget-category')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionBudgetCategoryFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Budget category"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Budget Category</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionBudgetCategoryFilter === 'all'
                                      ? 'All'
                                      : selectedTransactionBudgetCategory?.name ?? 'Unknown'}
                                  </span>
                                </div>
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => setTransactionFilterMenuView('source')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionSourceFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Source"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Source</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionSourceFilter === 'all' ? 'All' : transactionSourceFilter}
                                  </span>
                                </div>
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => setTransactionFilterMenuView('reimbursement-status')}
                                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReimbursementFilter !== 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                                aria-label="Reimbursement status"
                              >
                                <div className="flex items-center justify-between">
                                  <span>Reimbursement</span>
                                  <span className="text-xs text-gray-500 truncate max-w-[10rem]">
                                    {transactionReimbursementFilter === 'all'
                                      ? 'All'
                                      : transactionReimbursementFilter === 'we-owe'
                                      ? 'Owed to Client'
                                      : 'Owed to Design Business'}
                                  </span>
                                </div>
                              </button>
                            </div>
                          ) : transactionFilterMenuView === 'status' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All</span>
                                {transactionStatusFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('pending')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'pending' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Pending</span>
                                {transactionStatusFilter === 'pending' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('completed')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'completed' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Completed</span>
                                {transactionStatusFilter === 'completed' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('canceled')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'canceled' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Canceled</span>
                                {transactionStatusFilter === 'canceled' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionStatusFilter('inventory-only')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionStatusFilter === 'inventory-only' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Inventory Only</span>
                                {transactionStatusFilter === 'inventory-only' ? <Check className="h-4 w-4" /> : null}
                              </button>
                            </div>
                          ) : transactionFilterMenuView === 'source' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionSourceFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionSourceFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All sources</span>
                                {transactionSourceFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              {availableTransactionSources.map(source => (
                                <button
                                  key={source}
                                  onClick={() => {
                                    setTransactionSourceFilter(source)
                                    setShowTransactionFilterMenu(false)
                                    setTransactionFilterMenuView('main')
                                  }}
                                  className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                    transactionSourceFilter === source ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                  }`}
                                >
                                  <span>{source}</span>
                                  {transactionSourceFilter === source ? <Check className="h-4 w-4" /> : null}
                                </button>
                              ))}
                            </div>
                          ) : transactionFilterMenuView === 'reimbursement-status' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionReimbursementFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReimbursementFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All Statuses</span>
                                {transactionReimbursementFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionReimbursementFilter('we-owe')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReimbursementFilter === 'we-owe' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Owed to Client</span>
                                {transactionReimbursementFilter === 'we-owe' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionReimbursementFilter('client-owes')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReimbursementFilter === 'client-owes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Owed to Design Business</span>
                                {transactionReimbursementFilter === 'client-owes' ? <Check className="h-4 w-4" /> : null}
                              </button>
                            </div>
                          ) : transactionFilterMenuView === 'transaction-type' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionTypeFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
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
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
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
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionTypeFilter === 'return' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Return</span>
                                {transactionTypeFilter === 'return' ? <Check className="h-4 w-4" /> : null}
                              </button>
                            </div>
                          ) : transactionFilterMenuView === 'completeness' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionCompletenessFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionCompletenessFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All</span>
                                {transactionCompletenessFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionCompletenessFilter('needs-review')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionCompletenessFilter === 'needs-review' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Needs Review</span>
                                {transactionCompletenessFilter === 'needs-review' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionCompletenessFilter('complete')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionCompletenessFilter === 'complete' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Complete</span>
                                {transactionCompletenessFilter === 'complete' ? <Check className="h-4 w-4" /> : null}
                              </button>
                            </div>
                          ) : transactionFilterMenuView === 'budget-category' ? (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionBudgetCategoryFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionBudgetCategoryFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All</span>
                                {transactionBudgetCategoryFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              {budgetCategories.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">No categories</div>
                              ) : (
                                budgetCategories.map(category => (
                                  <button
                                    key={category.id}
                                    onClick={() => {
                                      setTransactionBudgetCategoryFilter(category.id)
                                      setShowTransactionFilterMenu(false)
                                      setTransactionFilterMenuView('main')
                                    }}
                                    className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                      transactionBudgetCategoryFilter === category.id ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                    }`}
                                  >
                                    <span>{category.name}</span>
                                    {transactionBudgetCategoryFilter === category.id ? <Check className="h-4 w-4" /> : null}
                                  </button>
                                ))
                              )}
                            </div>
                          ) : (
                            <div className="py-1">
                              <button
                                onClick={() => setTransactionFilterMenuView('main')}
                                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                ← Back
                              </button>

                              <div className="my-1 border-t border-gray-100" />

                              <button
                                onClick={() => {
                                  setTransactionReceiptFilter('all')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReceiptFilter === 'all' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>All</span>
                                {transactionReceiptFilter === 'all' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionReceiptFilter('yes')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReceiptFilter === 'yes' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>Yes</span>
                                {transactionReceiptFilter === 'yes' ? <Check className="h-4 w-4" /> : null}
                              </button>
                              <button
                                onClick={() => {
                                  setTransactionReceiptFilter('no')
                                  setShowTransactionFilterMenu(false)
                                  setTransactionFilterMenuView('main')
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                                  transactionReceiptFilter === 'no' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                                }`}
                              >
                                <span>No</span>
                                {transactionReceiptFilter === 'no' ? <Check className="h-4 w-4" /> : null}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
                    {transactionSearchQuery ||
                    transactionStatusFilter !== 'all' ||
                    transactionReimbursementFilter !== 'all' ||
                    transactionReceiptFilter !== 'all' ||
                    transactionTypeFilter !== 'all' ||
                    transactionBudgetCategoryFilter !== 'all' ||
                    transactionCompletenessFilter !== 'all' ||
                    transactionSourceFilter !== 'all'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'No inventory-related transactions found.'
                    }
                  </p>
                </div>
              ) : (
                <div className="bg-white overflow-hidden sm:rounded-md -mx-6">
                  <ul className="space-y-3 pb-3">
                    {filteredTransactions.map((transaction) => (
                      <li key={transaction.transactionId} className="relative">
                        <a
                          href={buildContextUrl(`/business-inventory/transaction/${transaction.transactionId}`)}
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
                        >
                          <div className="block bg-gray-50 border border-gray-200 rounded-lg transition-colors duration-200 hover:bg-gray-100">
                            <div className="px-4 py-4 sm:px-6">
                            {/* Top row: Header with source and status */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center">
                                <h3 className="text-base font-medium text-gray-900">
                                  {getCanonicalTransactionTitle(transaction)}
                                </h3>
                              </div>
                              <div className="flex items-center flex-wrap gap-2">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium no-icon ${
                                  transaction.status === 'completed'
                                    ? 'bg-green-100 text-green-800'
                                    : transaction.status === 'pending'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {transaction.status === 'completed' ? 'Completed' :
                                   transaction.status === 'pending' ? 'Pending' :
                                   transaction.status === 'canceled' ? 'Canceled' :
                                   transaction.status}
                                </span>
                              </div>
                            </div>

                            {/* Bottom row: Details */}
                            <div className="space-y-2">
                              {/* Details row - Price, project, date */}
                              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                <span className="font-medium text-gray-700">{formatCurrency(transaction.amount)}</span>
                                {transaction.projectName && (
                                  <>
                                    <span className="hidden sm:inline">•</span>
                                    <span className="font-medium text-gray-700">
                                      {transaction.projectName}
                                    </span>
                                  </>
                                )}
                                <span className="hidden sm:inline">•</span>
                                <span className="font-medium text-gray-700">
                                  {formatDate(transaction.transactionDate)}
                                </span>
                              </div>

                              {/* Notes */}
                              {transaction.notes && (
                                <p className="text-sm text-gray-600 line-clamp-2">
                                  {transaction.notes}
                                </p>
                              )}

                            </div>

                            </div>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Batch Allocation Modal */}
      {showBatchAllocationModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Allocate {selectedItems.size} Items to Project
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Select Project
                  </label>
                  <div className="relative mt-1">
                    <button
                      type="button"
                      onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                      className="project-dropdown-button relative w-full bg-white border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      <span className={`block truncate ${!batchAllocationForm.projectId ? 'text-gray-500' : 'text-gray-900'}`}>
                        {getSelectedProjectName()}
                      </span>
                      <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </button>

                    {showProjectDropdown && (
                      <div className="project-dropdown absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base border border-gray-200 overflow-auto focus:outline-none sm:text-sm">
                        {projects.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => {
                              setBatchAllocationForm(prev => ({ ...prev, projectId: project.id }))
                              setShowProjectDropdown(false)
                            }}
                            className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${
                              batchAllocationForm.projectId === project.id ? 'bg-primary-50 text-primary-600' : 'text-gray-900'
                            }`}
                          >
                            <div className="font-medium">{project.name}</div>
                            <div className="text-sm text-gray-500">{project.clientName}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Space (Optional)
                  </label>
                  <input
                    type="text"
                    value={batchAllocationForm.space}
                    onChange={(e) => setBatchAllocationForm(prev => ({ ...prev, space: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder="e.g. Living Room, Bedroom, etc."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeBatchAllocationModal}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBatchAllocationSubmit}
                  disabled={!batchAllocationForm.projectId || isAllocating}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                >
                  {isAllocating ? 'Allocating...' : `Allocate ${selectedItems.size} Items`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
