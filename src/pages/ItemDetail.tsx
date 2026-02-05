import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ArrowLeft, Bookmark, QrCode, FileText, ImagePlus, X, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import ContextBackLink from '@/components/ContextBackLink'
import { Item, ItemImage, ItemDisposition, Transaction, Project } from '@/types'
import { formatDate, formatCurrency } from '@/utils/dateUtils'
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'
import { unifiedItemsService, projectService, integrationService, transactionService, isCanonicalTransactionId, SellItemToProjectError } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import ImagePreview from '@/components/ui/ImagePreview'
import ItemLineageBreadcrumb from '@/components/ui/ItemLineageBreadcrumb'
import { lineageService } from '@/services/lineageService'
import { getUserFriendlyErrorMessage, getErrorAction } from '@/utils/imageUtils'
import { useToast } from '@/components/ui/ToastContext'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { useDuplication } from '@/hooks/useDuplication'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useNetworkState } from '@/hooks/useNetworkState'
import { getOfflineSaveMessage } from '@/utils/offlineUxFeedback'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { projectItemDetail, projectItemEdit, projectItems, projectTransactionDetail } from '@/utils/routes'
import { Combobox } from '@/components/ui/Combobox'
import SpaceSelector from '@/components/spaces/SpaceSelector'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { hydrateItemCache, hydrateProjectCache } from '@/utils/hydrationHelpers'
import BlockingConfirmDialog from '@/components/ui/BlockingConfirmDialog'
import ItemActionsMenu from '@/components/items/ItemActionsMenu'
import { displayDispositionLabel } from '@/utils/dispositionUtils'

type ItemDetailProps = { itemId?: string; projectId?: string; onClose?: () => void }

export default function ItemDetail(props: ItemDetailProps = {}) {
  const { itemId: propItemId, projectId: propProjectId } = props
  const onCloseHandler = props.onClose as unknown as (() => void) | undefined
  const { id, projectId: routeProjectId, itemId } = useParams<{ id?: string; projectId?: string; itemId?: string }>()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const navigate = useStackedNavigate()
  const rawNavigate = useNavigate()
  const { currentAccountId } = useAccount()
  const [searchParams] = useSearchParams()
  const [item, setItem] = useState<Item | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [isLoadingItem, setIsLoadingItem] = useState<boolean>(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isSticky, setIsSticky] = useState(false)
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [isUpdatingTransaction, setIsUpdatingTransaction] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isUpdatingProject, setIsUpdatingProject] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [projectDialogMode, setProjectDialogMode] = useState<'move' | 'sell'>('move')
  const [showRemoveFromTransactionConfirm, setShowRemoveFromTransactionConfirm] = useState(false)
  const [isRemovingFromTransaction, setIsRemovingFromTransaction] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeletingItem, setIsDeletingItem] = useState(false)
  const [showSpaceDialog, setShowSpaceDialog] = useState(false)
  const [spaceIdValue, setSpaceIdValue] = useState<string | null>(null)
  const [isSettingSpace, setIsSettingSpace] = useState(false)
  const { showError, showSuccess } = useToast()
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  const { isOnline } = useNetworkState()
  const stickyRef = useRef<HTMLDivElement>(null)
  const offlineMediaIdsRef = useRef<Set<string>>(new Set())

  // Use itemId if available (from /project/:projectId/items/:itemId), otherwise use id (from /item/:id)
  const actualItemId = propItemId || itemId || id

  const queryProjectId = searchParams.get('project') || ''

  // Determine project context from nested routes or search params (legacy deep links)
  const projectId = propProjectId || routeProjectId || queryProjectId || ''

  // Check if this is a business inventory item (no project context)
  const isBusinessInventoryItem = !projectId && location.pathname.startsWith('/business-inventory/')

  // Use duplication hook
  const { duplicateItem } = useDuplication({
    items: item ? [item] : [],
    setItems: (items) => {
      if (typeof items === 'function') {
        setItem(prev => items([prev!])[0] || prev)
      } else if (items.length > 0) {
        setItem(items[0])
      }
    },
    projectId,
    accountId: currentAccountId || undefined
  })

  // Determine back navigation destination using navigation context
  const backDestination = useMemo(() => {
    const defaultPath = isBusinessInventoryItem
      ? '/business-inventory'
      : projectId
        ? projectItems(projectId)
        : '/projects'

    if (!item) return defaultPath
    return getBackDestination(defaultPath)
  }, [item, projectId, getBackDestination, isBusinessInventoryItem])


  const fetchItem = useCallback(
    async ({ showLoading = true, preserveOnError = false }: { showLoading?: boolean; preserveOnError?: boolean } = {}) => {
      console.log('🔄 ItemDetail useEffect triggered. itemId:', actualItemId, 'id:', id, 'projectId:', projectId)

      if (!actualItemId) {
        console.log('⚠️ No itemId or id in URL parameters')
        if (!preserveOnError) {
          setItem(null)
        }
        return
      }

      const setLoading = (value: boolean) => {
        if (showLoading) {
          setIsLoadingItem(value)
        }
      }

      setLoading(true)
      try {
        if (!currentAccountId) return

        // First, try to hydrate from offlineStore to React Query cache
        // This ensures optimistic items created offline are available
        try {
          await hydrateItemCache(getGlobalQueryClient(), currentAccountId, actualItemId)
        } catch (error) {
          console.warn('Failed to hydrate item cache (non-fatal):', error)
        }

        if (projectId) {
          try {
            await hydrateProjectCache(getGlobalQueryClient(), currentAccountId, projectId)
          } catch (error) {
            console.warn('Failed to hydrate project cache (non-fatal):', error)
          }
        }

        // Check React Query cache first (for optimistic items created offline)
        const queryClient = getGlobalQueryClient()
        const cachedItem = queryClient.getQueryData<Item>(['item', currentAccountId, actualItemId])
        const servedFromCache = Boolean(cachedItem)

        if (cachedItem) {
          console.log('✅ Item found in React Query cache:', cachedItem.itemId)
          setItem(cachedItem)
          if (isBusinessInventoryItem) {
            setProjectName('Business Inventory')
          } else if (projectId) {
            // Still fetch project name
            try {
              const project = await projectService.getProject(currentAccountId, projectId)
              if (project) {
                setProjectName(project.name)
              }
            } catch (error) {
              console.warn('Failed to fetch project name:', error)
            }
          }
          setLoading(false)
        }

        if (isBusinessInventoryItem) {
          console.log('📦 Fetching business inventory item (no project context)...')
          const fetchedItem = await unifiedItemsService.getItemById(currentAccountId, actualItemId)

          if (fetchedItem) {
            console.log('✅ Business inventory item loaded successfully:', fetchedItem.itemId)
            queryClient.setQueryData(['item', currentAccountId, actualItemId], fetchedItem)
            setItem(fetchedItem)
            setProjectName('Business Inventory') // Set a default project name for UI display
          } else if (!servedFromCache) {
            console.error('❌ Business inventory item not found with ID:', actualItemId)
            setItem(null)
          }
        } else if (projectId) {
          console.log('📡 Fetching item and project data...')
          const [fetchedItem, project] = await Promise.all([
            unifiedItemsService.getItemById(currentAccountId, actualItemId),
            projectService.getProject(currentAccountId, projectId)
          ])

          if (fetchedItem) {
            console.log('✅ Item loaded successfully:', fetchedItem.itemId)
            queryClient.setQueryData(['item', currentAccountId, actualItemId], fetchedItem)
            setItem(fetchedItem)
          } else if (!servedFromCache) {
            console.error('❌ Item not found in project:', projectId, 'with ID:', actualItemId)
            setItem(null)
          }

          if (project) {
            console.log('✅ Project loaded:', project.name)
            setProjectName(project.name)
          }
        } else {
          console.error('❌ No project ID found in URL parameters')
          if (!servedFromCache) {
            setItem(null)
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch item:', error)
        if (!preserveOnError) {
          setItem(null)
        }
      } finally {
        setLoading(false)
      }
    },
    [actualItemId, id, projectId, currentAccountId, isBusinessInventoryItem]
  )

  useEffect(() => {
    fetchItem()
  }, [fetchItem])

  useEffect(() => {
    if (!item) return
    const nextProjectId = item.projectId || projectId || ''
    setSelectedProjectId(nextProjectId)
  }, [item, projectId])

  useEffect(() => {
    if (!currentAccountId) return
    let isMounted = true

    const fetchProjects = async () => {
      setLoadingProjects(true)
      try {
        const fetchedProjects = await projectService.getProjects(currentAccountId)
        if (isMounted) {
          setProjects(fetchedProjects)
        }
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        if (isMounted) {
          setLoadingProjects(false)
        }
      }
    }

    fetchProjects()

    return () => {
      isMounted = false
    }
  }, [currentAccountId])

  // Set up real-time listener for item updates
  const subscriptionProjectId = useMemo(() => {
    if (projectId) return projectId
    if (item?.projectId) return item.projectId
    return queryProjectId || null
  }, [projectId, item?.projectId, queryProjectId])

  useEffect(() => {
    if (!subscriptionProjectId || !actualItemId || !currentAccountId) return

    console.log('Setting up real-time listener for item:', actualItemId)

    const unsubscribe = unifiedItemsService.subscribeToProjectItems(
      currentAccountId,
      subscriptionProjectId,
      (items: Item[]) => {
        console.log('Real-time items update:', items.length, 'items')
        const updatedItem = items.find((item: Item) => item.itemId === actualItemId)
        if (updatedItem) {
          console.log('Found updated item with', updatedItem.images?.length || 0, 'images')
          setItem(updatedItem)
        }
      }
    )

    return () => {
      console.log('Cleaning up real-time listener for item:', actualItemId)
      unsubscribe()
    }
  }, [subscriptionProjectId, actualItemId, currentAccountId])

  // Subscribe to item-lineage edges for this item and refetch the item when an edge arrives
  useEffect(() => {
    if (!actualItemId || !currentAccountId) return

    const unsubscribe = lineageService.subscribeToItemLineageForItem(currentAccountId, actualItemId, async () => {
      try {
        const updatedItem = await unifiedItemsService.getItemById(currentAccountId, actualItemId)
        if (updatedItem) {
          setItem(updatedItem)
        }
      } catch (err) {
        console.debug('ItemDetail - failed to refetch item on lineage event', err)
      }
    })

    return () => {
      try { unsubscribe() } catch (err) { /* noop */ }
    }
  }, [actualItemId, currentAccountId])

  // Handle sticky header border
  useEffect(() => {
    const handleScroll = () => {
      if (stickyRef.current) {
        const rect = stickyRef.current.getBoundingClientRect()
        const isElementSticky = rect.top <= 0
        setIsSticky(isElementSticky)
      }
    }

    window.addEventListener('scroll', handleScroll)
    handleScroll() // Check initial state

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // Load transactions when dialog opens
  useEffect(() => {
    if (showTransactionDialog && currentAccountId) {
      loadTransactions()
    }
  }, [showTransactionDialog, currentAccountId, projectId, item?.projectId])

  // Cleanup any queued offline media if component unmounts before images are saved
  useEffect(() => {
    return () => {
      const mediaIds = Array.from(offlineMediaIdsRef.current)
      mediaIds.forEach(mediaId => {
        offlineMediaService.deleteMediaFile(mediaId).catch(error => {
          console.warn('Failed to cleanup offline media on unmount:', error)
        })
      })
    }
  }, [])

  const loadTransactions = async () => {
    if (!currentAccountId) return
    const effectiveProjectId = projectId || item?.projectId
    setLoadingTransactions(true)
    try {
      const txs = effectiveProjectId
        ? await transactionService.getTransactions(currentAccountId, effectiveProjectId)
        : await transactionService.getBusinessInventoryTransactions(currentAccountId)
      setTransactions(txs)
    } catch (error) {
      console.error('Failed to load transactions:', error)
      showError('Failed to load transactions. Please try again.')
    } finally {
      setLoadingTransactions(false)
    }
  }

  const getCanonicalTransactionTitle = (transaction: Transaction): string => {
    if (transaction.transactionId?.startsWith('INV_SALE_')) {
      return 'Design Business Inventory Sale'
    }
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      return 'Design Business Inventory Purchase'
    }
    return transaction.source
  }

  const handleChangeTransaction = async () => {
    if (!item || !currentAccountId || !selectedTransactionId) return

    setIsUpdatingTransaction(true)
    const previousTransactionId = item.transactionId
    const selectedTransaction = transactions.find(tx => tx.transactionId === selectedTransactionId)
    const isReturnTransaction = selectedTransaction?.transactionType === 'Return'
    
    try {
      await unifiedItemsService.assignItemToTransaction(currentAccountId, selectedTransactionId, item.itemId, {
        itemPreviousTransactionId: previousTransactionId,
        isReturnTransaction,
        appendCorrectionEdge: true
      })

      // Refresh the item data
      const updatedItem = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
      if (updatedItem) {
        setItem(updatedItem)
      }

      setShowTransactionDialog(false)
      setSelectedTransactionId('')
      showSuccess('Transaction updated successfully')
    } catch (error) {
      console.error('Failed to update transaction:', error)
      showError('Failed to update transaction. Please try again.')
    } finally {
      setIsUpdatingTransaction(false)
    }
  }

  const handleAssociateProject = useCallback(async (nextProjectId: string) => {
    if (!item || !currentAccountId) return
    if (!nextProjectId || nextProjectId === item.projectId) return
    if (item.transactionId) {
      showError('This item is tied to a transaction. Move the transaction to another project instead.')
      setSelectedProjectId(item.projectId || '')
      return
    }

    setIsUpdatingProject(true)
    setSelectedProjectId(nextProjectId)
    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        projectId: nextProjectId,
        disposition: 'purchased'
      })
      setItem(prev => prev ? { ...prev, projectId: nextProjectId } : prev)

      const nextProject = projects.find(project => project.id === nextProjectId)
      if (nextProject) {
        setProjectName(nextProject.name)
      }

      showSuccess('Project association updated.')
      navigate(buildContextUrl(projectItemDetail(nextProjectId, item.itemId)))
    } catch (error) {
      console.error('Failed to associate project:', error)
      setSelectedProjectId(item.projectId || '')
      showError('Failed to associate project. Please try again.')
    } finally {
      setIsUpdatingProject(false)
      setShowProjectDialog(false)
    }
  }, [item, currentAccountId, showError, showSuccess, navigate, buildContextUrl, projects])

  const openProjectDialog = (mode: 'move' | 'sell' = 'move') => {
    if (mode === 'move' && associateDisabled) return
    setProjectDialogMode(mode)
    setShowProjectDialog(true)
  }

  const handleSellToBusinessInventory = async () => {
    if (!item || !currentAccountId) return
    if (!item.projectId) return
    try {
      const wasOffline = !isOnline
      // This deallocation path creates/updates the canonical inventory sale transaction.
      await integrationService.handleItemDeallocation(currentAccountId, item.itemId, item.projectId, 'inventory')
      if (wasOffline) {
        showSuccess(getOfflineSaveMessage())
        return
      }
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      showSuccess('Moved to business inventory.')
    } catch (error) {
      console.error('Failed to move item to business inventory:', error)
      showError('Failed to move item to business inventory. Please try again.')
    } finally {
    }
  }

  const handleMoveToBusinessInventory = async () => {
    if (!item || !currentAccountId) return
    if (!item.projectId) return
    if (item.transactionId) {
      showError('This item is tied to a transaction. Move the transaction instead.')
      return
    }
    try {
      await integrationService.moveItemToBusinessInventory(currentAccountId, item.itemId, item.projectId)
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      showSuccess('Moved to business inventory.')
    } catch (error) {
      console.error('Failed to move item to business inventory:', error)
      showError('Failed to move item to business inventory. Please try again.')
    }
  }

  const handleSellToProject = async () => {
    if (!item || !currentAccountId) return
    if (!item.projectId) return
    if (!selectedProjectId || selectedProjectId === item.projectId) {
      setShowProjectDialog(false)
      return
    }

    setIsUpdatingProject(true)
    try {
      const wasOffline = !isOnline
      await integrationService.sellItemToProject(
        currentAccountId,
        item.itemId,
        item.projectId,
        selectedProjectId
      )
      if (wasOffline) {
        showSuccess(getOfflineSaveMessage())
        return
      }
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      showSuccess('Sold to project.')
      const nextProject = projects.find(project => project.id === selectedProjectId)
      if (nextProject) {
        setProjectName(nextProject.name)
        navigate(buildContextUrl(projectItemDetail(selectedProjectId, item.itemId)))
      }
    } catch (error) {
      if (error instanceof SellItemToProjectError) {
        switch (error.code) {
          case 'ITEM_NOT_FOUND':
            showError('Item not found. Refresh and try again.')
            break
          case 'SOURCE_PROJECT_MISMATCH':
          case 'CONFLICT':
            showError('This item changed since you opened it. Refresh and try again.')
            break
          case 'NON_CANONICAL_TRANSACTION':
            showError('This item is tied to a transaction. Move the transaction instead.')
            break
          case 'TARGET_SAME_AS_SOURCE':
            showError('Select a different project to sell to.')
            break
          case 'PARTIAL_COMPLETION':
            showError('Item was moved to business inventory. Allocate it to the target project from there.')
            await refreshRealtimeAfterWrite()
            await handleRefreshItem()
            break
          default:
            showError('Failed to sell item to project. Please try again.')
        }
      } else {
        console.error('Failed to sell item to project:', error)
        showError('Failed to sell item to project. Please try again.')
      }
    } finally {
      setIsUpdatingProject(false)
      setShowProjectDialog(false)
    }
  }

  const openTransactionDialog = () => {
    setSelectedTransactionId(item?.transactionId ?? '')
    setShowTransactionDialog(true)
  }

  const handleDuplicateItem = (quantity: number) => {
    if (!item) return
    if (quantity <= 0) return
    duplicateItem(item.itemId, quantity)
  }

  const toggleBookmark = async () => {
    if (!item || !currentAccountId) return

    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        bookmark: !item.bookmark
      })
      setItem({ ...item, bookmark: !item.bookmark })
    } catch (error) {
      console.error('Failed to update bookmark:', error)
    }
  }

  const updateDisposition = async (newDisposition: ItemDisposition) => {
    if (!item || !currentAccountId) {
      return
    }

    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        disposition: newDisposition
      })
      setItem({ ...item, disposition: newDisposition })
    } catch (error) {
      console.error('Failed to update disposition:', error)
      showError('Failed to update disposition. Please try again.')
    }
  }

  const itemProjectId = item?.projectId ?? null
  const editUrl = item
    ? isBusinessInventoryItem
      ? buildContextUrl(`/business-inventory/${item.itemId}/edit`)
      : projectId
        ? buildContextUrl(projectItemEdit(projectId, item.itemId), { project: projectId })
        : buildContextUrl(`/business-inventory/${item.itemId}/edit`)
    : ''
  const derivedRealtimeProjectId = useMemo(() => {
    if (projectId) return projectId
    return itemProjectId
  }, [projectId, itemProjectId])

  const { refreshCollections: refreshRealtimeCollections, items: realtimeItems } = useProjectRealtime(derivedRealtimeProjectId)
  const refreshRealtimeAfterWrite = useCallback(
    () => {
      if (!derivedRealtimeProjectId) return Promise.resolve()
      return refreshRealtimeCollections()
        .catch(err => {
          console.debug('ItemDetail: realtime refresh failed', err)
        })
    },
    [derivedRealtimeProjectId, refreshRealtimeCollections]
  )

  // Navigation state for next/previous items
  const [allItems, setAllItems] = useState<Item[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [isLoadingNavigation, setIsLoadingNavigation] = useState(false)

  // Parse filter and sort from URL params (matching InventoryList logic)
  const filterMode = useMemo(() => {
    const param = searchParams.get('itemFilter')
    const validModes = ['all', 'bookmarked', 'from-inventory', 'to-return', 'returned', 'no-sku', 'no-description', 'no-project-price', 'no-image', 'no-transaction']
    return validModes.includes(param || '') ? param as typeof validModes[number] : 'all'
  }, [searchParams])
  
  const sortMode = useMemo(() => {
    const param = searchParams.get('itemSort')
    return param === 'alphabetical' ? 'alphabetical' : 'creationDate'
  }, [searchParams])
  
  const searchQuery = useMemo(() => {
    return searchParams.get('itemSearch') || ''
  }, [searchParams])

  // Helper function to check if a money string is non-empty (matching InventoryList logic)
  const hasNonEmptyMoneyString = (value: string | null | undefined): boolean => {
    if (!value) return false
    const trimmed = value.trim()
    if (!trimmed) return false
    const parsed = parseFloat(trimmed)
    return !isNaN(parsed) && parsed !== 0
  }

  // Apply same filtering and sorting as InventoryList
  const filteredAndSortedItems = useMemo(() => {
    return allItems.filter(item => {
      // Apply search filter
      const rawQuery = searchQuery.trim()
      const query = rawQuery.toLowerCase()
      const normalizedQuery = query.replace(/[^a-z0-9]/g, '')
      const hasDigit = /\d/.test(rawQuery)
      const allowedOnly = /^[0-9\s,().$-]+$/.test(rawQuery)
      const isAmountQuery = hasDigit && allowedOnly
      const normalizedAmountQuery = isAmountQuery ? normalizeMoneyToTwoDecimalString(rawQuery) : undefined
      const normalizedAmountQueryNumeric = normalizedAmountQuery?.replace(/[^0-9-]/g, '') ?? ''
      const matchesText = !query ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.source || '').toLowerCase().includes(query) ||
        (item.sku || '').toLowerCase().includes(query) ||
        (normalizedQuery && (item.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedQuery)) ||
        (item.paymentMethod || '').toLowerCase().includes(query) ||
        (item.space || '').toLowerCase().includes(query)
      let matchesAmount = false
      if (isAmountQuery && normalizedAmountQuery) {
        const amountValues = [item.price, item.purchasePrice, item.projectPrice, item.marketValue]
        matchesAmount = amountValues.some(value => {
          const normalizedAmount = normalizeMoneyToTwoDecimalString((value ?? '').toString())
          if (!normalizedAmount) return false
          if (normalizedAmount === normalizedAmountQuery) return true
          if (!normalizedAmountQueryNumeric || normalizedAmountQueryNumeric === '-') return false
          const normalizedAmountNumeric = normalizedAmount.replace(/[^0-9-]/g, '')
          return normalizedAmountNumeric.includes(normalizedAmountQueryNumeric)
        })
      }
      const matchesSearch = matchesText || matchesAmount

      // Apply filter based on filterMode
      let matchesFilter = false
      switch (filterMode) {
        case 'all':
          matchesFilter = true
          break
        case 'bookmarked':
          matchesFilter = item.bookmark
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
        case 'from-inventory':
          matchesFilter = item.source === 'Inventory'
          break
        case 'to-return':
          matchesFilter = item.disposition === 'to return'
          break
        case 'returned':
          matchesFilter = item.disposition === 'returned'
          break
        default:
          matchesFilter = true
      }

      return matchesSearch && matchesFilter
    }).sort((a, b) => {
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
  }, [allItems, filterMode, sortMode, searchQuery])

  // Update current index based on filtered/sorted items
  useEffect(() => {
    if (filteredAndSortedItems.length > 0 && actualItemId) {
      const index = filteredAndSortedItems.findIndex(i => i.itemId === actualItemId)
      setCurrentIndex(index)
    }
  }, [filteredAndSortedItems, actualItemId])

  // Fetch items list for navigation
  useEffect(() => {
    if (!currentAccountId || !item) return
    if (isBusinessInventoryItem) {
      // For business inventory, we'd need to fetch from business inventory context
      // For now, skip navigation for business inventory items in this component
      return
    }

    const fetchItemsForNavigation = async () => {
      if (!projectId && !item.projectId) return
      const effectiveProjectId = projectId || item.projectId
      if (!effectiveProjectId) return

      setIsLoadingNavigation(true)
      try {
        const items = await unifiedItemsService.getItemsByProject(currentAccountId, effectiveProjectId)
        setAllItems(items)
      } catch (error) {
        console.error('Failed to fetch items for navigation:', error)
      } finally {
        setIsLoadingNavigation(false)
      }
    }

    fetchItemsForNavigation()
  }, [currentAccountId, item, projectId, isBusinessInventoryItem])

  // Also use realtime items if available
  useEffect(() => {
    if (realtimeItems && realtimeItems.length > 0 && projectId) {
      setAllItems(realtimeItems)
    }
  }, [realtimeItems, projectId])

  const nextItem = currentIndex >= 0 && currentIndex < filteredAndSortedItems.length - 1 ? filteredAndSortedItems[currentIndex + 1] : null
  const previousItem = currentIndex > 0 ? filteredAndSortedItems[currentIndex - 1] : null

  const handleNavigateToItem = (targetItem: Item) => {
    if (!targetItem) return
    const targetProjectId = targetItem.projectId || projectId
    if (targetProjectId) {
      // Preserve filter/sort/search params when navigating between items
      const preservedParams: Record<string, string> = {}
      const returnTo = searchParams.get('returnTo')
      const itemFilter = searchParams.get('itemFilter')
      const itemSort = searchParams.get('itemSort')
      const itemSearch = searchParams.get('itemSearch')
      if (returnTo) preservedParams.returnTo = returnTo
      if (itemFilter) preservedParams.itemFilter = itemFilter
      if (itemSort) preservedParams.itemSort = itemSort
      if (itemSearch) preservedParams.itemSearch = itemSearch
      
      // Use replace: true so next/previous navigation doesn't add to history stack
      // This way the back button goes back to the project list, not through all items
      rawNavigate(buildContextUrl(projectItemDetail(targetProjectId, targetItem.itemId), preservedParams), { replace: true })
    }
  }

  const handleRefreshItem = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await fetchItem({ showLoading: false, preserveOnError: true })
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Error refreshing item:', error)
      showError('Failed to refresh item. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }, [fetchItem, isRefreshing, refreshRealtimeAfterWrite, showError])

  const handleSetSpace = async () => {
    if (!item || !currentAccountId) return
    setIsSettingSpace(true)
    try {
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        spaceId: spaceIdValue
      })
      
      // Update local state
      setItem(prev => prev ? { ...prev, space: spaceIdValue ? 'Loading...' : null } : prev)
      
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      
      showSuccess('Space updated successfully')
      setShowSpaceDialog(false)
      setSpaceIdValue(null)
    } catch (error) {
      console.error('Failed to set space:', error)
      showError('Failed to set space. Please try again.')
    } finally {
      setIsSettingSpace(false)
    }
  }

  const handleDeleteItem = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDeleteItem = async () => {
    if (!item || !currentAccountId) return
    setIsDeletingItem(true)
    try {
      await unifiedItemsService.deleteItem(currentAccountId, item.itemId)
      await refreshRealtimeAfterWrite()
      if (isBusinessInventoryItem) {
        navigate('/business-inventory')
      } else if (projectId) {
        navigate(projectItems(projectId))
      } else {
        navigate('/projects')
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
      showError('Failed to delete item. Please try again.')
    } finally {
      setIsDeletingItem(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleRemoveFromTransaction = async () => {
    if (!item || !currentAccountId) return
    if (!item.transactionId) return

    setIsRemovingFromTransaction(true)
    try {
      await unifiedItemsService.unlinkItemFromTransaction(currentAccountId, item.transactionId, item.itemId, {
        itemCurrentTransactionId: item.transactionId
      })
      await refreshRealtimeAfterWrite()
      await handleRefreshItem()
      showSuccess('Removed from transaction')
    } catch (error) {
      console.error('Failed to remove item from transaction:', error)
      showError('Failed to remove item from transaction. Please try again.')
    } finally {
      setIsRemovingFromTransaction(false)
      setShowRemoveFromTransactionConfirm(false)
    }
  }

  const handleMultipleImageUpload = async (files: File[]) => {
    if (!item || !currentAccountId) return

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })
      setUploadProgress(0)

      console.log('Starting multiple image upload for', files.length, 'files')

      const newImages: ItemImage[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const uploadResult = await OfflineAwareImageService.uploadItemImage(
          file,
          projectName || 'Business Inventory',
          item.itemId,
          currentAccountId,
          progress => {
            const overallProgress = Math.round(((i + progress.percentage / 100) / files.length) * 100)
            setUploadProgress(overallProgress)
          }
        )

        const metadata = uploadResult.url.startsWith('offline://')
          ? {
              offlineMediaId: uploadResult.url.replace('offline://', ''),
              isOfflinePlaceholder: true
            }
          : undefined

        if (metadata?.offlineMediaId) {
          offlineMediaIdsRef.current.add(metadata.offlineMediaId)
        }

        newImages.push({
          url: uploadResult.url,
          alt: uploadResult.fileName,
          isPrimary: item.images?.length === 0 && i === 0, // First image is primary if no images exist
          uploadedAt: new Date(),
          fileName: uploadResult.fileName,
          size: uploadResult.size,
          mimeType: uploadResult.mimeType,
          metadata
        })
      }

      console.log('All uploads completed successfully:', newImages.length, 'images')

      console.log('New image objects created:', newImages.length)

      // Update the item with all new images
      const currentImages = item.images || []
      const updatedImages = [...currentImages, ...newImages]

      console.log('Before update - item.images length:', currentImages.length)
      console.log('After update - updatedImages length:', updatedImages.length)
      console.log('New images URLs:', newImages.map(img => img.url))

      const updatedItemState = { ...item, images: updatedImages }

      if (currentAccountId) {
        console.log('Updating item in database with multiple new images')
        await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })

        // Remove media IDs from tracking since they're now saved to the item
        newImages.forEach(img => {
          if (img.metadata?.offlineMediaId) {
            offlineMediaIdsRef.current.delete(img.metadata.offlineMediaId)
          }
        })

        const queryClient = getGlobalQueryClient()
        const itemCacheKey = ['item', currentAccountId, item.itemId]

        queryClient.setQueryData<Item | undefined>(itemCacheKey, (cached) => {
          if (!cached) {
            return updatedItemState
          }
          return { ...cached, images: updatedImages }
        })

        const effectiveProjectId = projectId || item.projectId || null
        const updateItemCollection = (key: unknown[]) => {
          queryClient.setQueryData<Item[] | undefined>(key, (old) => {
            if (!old) return old
            return old.map(existing =>
              existing.itemId === item.itemId ? { ...existing, images: updatedImages } : existing
            )
          })
        }

        if (effectiveProjectId) {
          updateItemCollection(['project-items', currentAccountId, effectiveProjectId])
        } else {
          updateItemCollection(['business-inventory', currentAccountId])
        }

        if (item.transactionId) {
          updateItemCollection(['transaction-items', currentAccountId, item.transactionId])
        }

        queryClient.invalidateQueries({ queryKey: itemCacheKey })
      } else {
        console.warn('Unable to persist images without an authenticated account context.')
      }

      // Update local state
      setItem(updatedItemState)

      setUploadProgress(100)

      if (!isOnline) {
        console.info('Images saved offline and queued for sync')
      } else {
        console.log('Multiple image upload completed successfully')
      }
    } catch (error) {
      console.error('Error uploading multiple images:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    } finally {
      setUploadsInFlight(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) {
          setUploadProgress(0)
        }
        return next
      })
    }
  }

  const handleSelectFromGallery = async () => {
    if (!item) return

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })
      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        console.log('Selected', files.length, 'files from gallery')
        await handleMultipleImageUpload(files)
      } else {
        console.log('No files selected from gallery')
      }
    } catch (error: any) {
      console.error('Error selecting from gallery:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    } finally {
      setUploadsInFlight(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) {
          setUploadProgress(0)
        }
        return next
      })
    }
  }


  const handleRemoveImage = async (imageUrl: string) => {
    if (!item || !currentAccountId) return

    try {
      // Handle offline media deletion if this is an offline placeholder
      if (imageUrl.startsWith('offline://')) {
        const mediaId = imageUrl.replace('offline://', '')
        offlineMediaIdsRef.current.delete(mediaId)
        try {
          await offlineMediaService.deleteMediaFile(mediaId)
        } catch (error) {
          console.warn('Failed to delete offline media file:', error)
        }
      }

      // Remove from database
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        images: item.images?.filter(img => img.url !== imageUrl) || []
      })

      // Update local state
      const updatedImages = item.images?.filter(img => img.url !== imageUrl) || []
      setItem({ ...item, images: updatedImages })
    } catch (error) {
      console.error('Error removing image:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    }
  }

  const handleSetPrimaryImage = async (imageUrl: string) => {
    if (!item || !currentAccountId) return

    try {
      // Update in database
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        images: item.images?.map(img => ({
          ...img,
          isPrimary: img.url === imageUrl
        })) || []
      })

      // Update local state
      const updatedImages = item.images?.map(img => ({
        ...img,
        isPrimary: img.url === imageUrl
      })) || []
      setItem({ ...item, images: updatedImages })
    } catch (error) {
      console.error('Error setting primary image:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    }
  }

  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: project.name,
      disabled: project.id === item?.projectId
    })),
    [projects, item?.projectId]
  )
  const associateDisabledReason = item?.transactionId
    ? (isCanonicalTransactionId(item.transactionId)
      ? 'This item is tied to a Design Business Inventory transaction. You can’t change its project directly.'
      : 'This item is tied to a transaction. Move the transaction to another project instead.')
    : null
  const associateDisabled = Boolean(associateDisabledReason) || loadingProjects || isUpdatingProject

  if (isLoadingItem) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          {onCloseHandler ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                ;(props.onClose as any)?.()
              }}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </button>
          ) : (
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
          )}
        </div>
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <p className="text-gray-500">Loading item...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          {onCloseHandler ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                ;(props.onClose as any)?.()
              }}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </button>
          ) : (
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
          )}
        </div>
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <p className="text-gray-500">Item not found.</p>
            {projectId && <p className="text-sm text-gray-400 mt-2">Project ID: {projectId}</p>}
            <p className="text-sm text-gray-400 mt-1">Item ID: {actualItemId || 'unknown'}</p>
          </div>
        </div>
      </div>
    )
  }

  const content = (
    <div className="space-y-4">

      {/* Item information */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{item.description}</h1>
        </div>

        {/* Item Images */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <ImagePlus className="h-5 w-5 mr-2" />
              Item Images
            </h3>
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleSelectFromGallery}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                title="Add images from gallery or camera"
              >
                <ImagePlus className="h-3 w-3 mr-1" />
                Add Images
              </button>
              <UploadActivityIndicator isUploading={isUploadingImage} progress={uploadProgress} className="mt-1" />
            </div>
          </div>

          {item.images && item.images.length > 0 ? (
            <ImagePreview
              images={item.images}
              onRemoveImage={handleRemoveImage}
              onSetPrimary={handleSetPrimaryImage}
              maxImages={5}
              size="md"
              showControls={true}
            />
          ) : (
            <div className="text-center py-8">
              <ImagePlus className="mx-auto h-8 w-8 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No images uploaded</h3>
            </div>
          )}
        </div>

        {/* Item Details */}
        <div className="px-6 py-4">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            Item Details
          </h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-3">
            {item.source && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Source</dt>
                <dd className="mt-1 text-sm text-gray-900 capitalize">{item.source}</dd>
              </div>
            )}

            {item.sku && (
              <div>
                <dt className="text-sm font-medium text-gray-500">SKU</dt>
                <dd className="mt-1 text-sm text-gray-900">{item.sku}</dd>
              </div>
            )}

            {item.space && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Space</dt>
                <dd className="mt-1 text-sm text-gray-900">{item.space}</dd>
              </div>
            )}

            {item.purchasePrice && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Purchase Price</dt>
                <p className="text-xs text-gray-500 mt-1">What the item was purchased for</p>
                <dd className="mt-1 text-sm text-gray-900 font-medium">{formatCurrency(item.purchasePrice)}</dd>
                {item.taxAmountPurchasePrice !== undefined && (
                  <p className="mt-1 text-sm text-gray-600">Tax on purchase: {formatCurrency(item.taxAmountPurchasePrice)}</p>
                )}
              </div>
            )}

            {item.projectPrice && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Project Price</dt>
                <p className="text-xs text-gray-500 mt-1">What the client is charged</p>
                <dd className="mt-1 text-sm text-gray-900 font-medium">{formatCurrency(item.projectPrice)}</dd>
                {item.taxAmountProjectPrice !== undefined && (
                  <p className="mt-1 text-sm text-gray-600">Tax on project: {formatCurrency(item.taxAmountProjectPrice)}</p>
                )}
              </div>
            )}

            {item.marketValue && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Market Value</dt>
                <p className="text-xs text-gray-500 mt-1">The fair market value of the item</p>
                <dd className="mt-1 text-sm text-gray-900 font-medium">${item.marketValue}</dd>
              </div>
            )}
            {item.taxRatePct !== undefined && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Tax Rate</dt>
                <p className="text-xs text-gray-500 mt-1">Applied tax rate for this item</p>
                <dd className="mt-1 text-sm text-gray-900 font-medium">{item.taxRatePct}%</dd>
              </div>
            )}

            {item.paymentMethod && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Payment Method</dt>
                <dd className="mt-1 text-sm text-gray-900">{item.paymentMethod}</dd>
              </div>
            )}

            {item.notes && item.notes !== 'No notes' && (
              <div className="sm:col-span-3">
                <dt className="text-sm font-medium text-gray-500">Notes</dt>
                <dd className="mt-1 text-sm text-gray-900 bg-gray-50 p-3 rounded-md">{item.notes}</dd>
              </div>
            )}
          </dl>
        </div>


        {/* Metadata */}
        <div className="px-6 py-4 bg-gray-50">
          <div className="relative">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Project</dt>
                <dd className="mt-1 text-sm text-gray-900">{projectName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(item.dateCreated)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transaction</dt>
                <dd className="mt-1 text-sm text-gray-900 flex items-center gap-2">
                  {item.transactionId ? (
                    <>
                      <ContextLink
                        to={isBusinessInventoryItem
                          ? buildContextUrl(`/business-inventory/transaction/${item.transactionId}`)
                          : projectId
                            ? buildContextUrl(projectTransactionDetail(projectId, item.transactionId))
                            : item.projectId
                              ? buildContextUrl(projectTransactionDetail(item.projectId, item.transactionId))
                              : buildContextUrl('/projects')
                        }
                        className="text-primary-600 hover:text-primary-800 underline"
                      >
                        {item.transactionId.startsWith('INV_PURCHASE')
                          ? 'INV_PURCHASE...'
                          : (item.transactionId.length > 12 ? `${item.transactionId.slice(0, 12)}...` : item.transactionId)}
                      </ContextLink>
                    </>
                  ) : (
                    <span className="text-gray-500">Not assigned</span>
                  )}
                </dd>
              </div>
            {/* Lineage breadcrumb (compact) */}
            {item.itemId && (
              <div className="sm:col-span-3 mt-2">
                <ItemLineageBreadcrumb itemId={item.itemId} />
              </div>
            )}
            </dl>

          </div>
        </div>
      </div>

      {/* Transaction Change Dialog */}
      {showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {item?.transactionId ? 'Change Transaction' : 'Assign to Transaction'}
              </h3>
            </div>
            <div className="px-6 py-4">
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
                    ...transactions.map((transaction) => ({
                      id: transaction.transactionId,
                      label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${getCanonicalTransactionTitle(transaction)} - $${transaction.amount}`
                    }))
                  ]
                }
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap justify-between gap-3">
              {item?.transactionId ? (
                <button
                  onClick={() => {
                    setShowTransactionDialog(false)
                    setShowRemoveFromTransactionConfirm(true)
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
                  disabled={isUpdatingTransaction}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowTransactionDialog(false)
                    setSelectedTransactionId('')
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
        </div>
      )}

      <BlockingConfirmDialog
        open={showRemoveFromTransactionConfirm}
        title="Remove item from transaction?"
        description={
          <div className="text-sm text-gray-700 space-y-2">
            <p>This will remove the item from this transaction.</p>
            <p className="text-gray-600">The item will not be deleted.</p>
          </div>
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirming={isRemovingFromTransaction}
        onCancel={() => {
          if (isRemovingFromTransaction) return
          setShowRemoveFromTransactionConfirm(false)
        }}
        onConfirm={handleRemoveFromTransaction}
      />
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
        }}
        onConfirm={confirmDeleteItem}
      />
      {showProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {projectDialogMode === 'sell' ? 'Sell to Project' : 'Move to Project'}
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
              {projectDialogMode === 'move' && associateDisabledReason && (
                <p className="text-xs text-gray-500">{associateDisabledReason}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (isUpdatingProject) return
                  setShowProjectDialog(false)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isUpdatingProject}
              >
                Cancel
              </button>
              <button
                onClick={
                  projectDialogMode === 'sell'
                    ? handleSellToProject
                    : () => handleAssociateProject(selectedProjectId)
                }
                disabled={!selectedProjectId || isUpdatingProject || (associateDisabled && projectDialogMode !== 'sell')}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingProject
                  ? projectDialogMode === 'sell'
                    ? 'Selling...'
                    : 'Moving...'
                  : projectDialogMode === 'sell'
                    ? 'Sell'
                    : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSpaceDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set Space
              </h3>
            </div>
            <div className="px-6 py-4">
              <SpaceSelector
                projectId={projectId || item?.projectId || ''}
                value={spaceIdValue}
                onChange={setSpaceIdValue}
                placeholder="Select or create a space..."
                allowCreate={true}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSpaceDialog(false)
                  setSpaceIdValue(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isSettingSpace}
              >
                Cancel
              </button>
              <button
                onClick={handleSetSpace}
                disabled={isSettingSpace}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSettingSpace ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {onCloseHandler ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-medium text-gray-900">Item</h3>
            <div className="flex items-center space-x-2">
              {item.disposition ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {displayDispositionLabel(item.disposition)}
                </span>
              ) : null}
              <button
                onClick={toggleBookmark}
                className={`inline-flex items-center justify-center p-2 text-sm font-medium transition-colors ${
                  item.bookmark
                    ? 'text-red-700 bg-transparent'
                    : 'text-primary-600 bg-transparent'
                } focus:outline-none`}
                title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
              >
                <Bookmark className="h-5 w-5" fill={item.bookmark ? 'currentColor' : 'none'} />
              </button>

              <ItemActionsMenu
                itemId={item.itemId}
                itemProjectId={item.projectId ?? null}
                itemTransactionId={item.transactionId ?? null}
                disposition={item.disposition}
                isPersisted={true}
                currentProjectId={projectId || item.projectId || null}
                triggerSize="md"
                onEdit={() => {
                  navigate(editUrl)
                }}
                onDuplicate={handleDuplicateItem}
                onAddToTransaction={openTransactionDialog}
                onSellToBusiness={handleSellToBusinessInventory}
                onSellToProject={() => openProjectDialog('sell')}
                onMoveToBusiness={handleMoveToBusinessInventory}
                onMoveToProject={() => openProjectDialog('move')}
                onAddToSpace={() => {
                  setSpaceIdValue(null) // Reset or set to current space if we had the ID
                  setShowSpaceDialog(true)
                }}
                onChangeStatus={updateDisposition}
                onDelete={handleDeleteItem}
              />

              {ENABLE_QR && (
                <button
                  className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  onClick={() => window.open(`/qr-image/${item.qrKey}`, '_blank')}
                  title="View QR Code"
                >
                  <QrCode className="h-4 w-4" />
                </button>
              )}

              <button
                onClick={(e) => {
                  e.preventDefault()
                  ;(props.onClose as any)?.()
                }}
                className="text-gray-400 hover:text-gray-600"
                type="button"
                aria-label="Close item view"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            </div>
          {content}
        </div>
      ) : (
        <>
          <div
            ref={stickyRef}
            className={`sticky top-0 bg-gray-50 z-10 px-4 py-2 ${isSticky ? 'border-b border-gray-200' : ''}`}
          >
            {/* Back button and controls row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {onCloseHandler ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      ;(props.onClose as any)?.()
                    }}
                    className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </button>
                ) : (
                  <ContextBackLink
                    fallback={backDestination}
                    className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </ContextBackLink>
                )}
                <button
                  onClick={handleRefreshItem}
                  className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  aria-label="Refresh item"
                  title="Refresh"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex flex-wrap items-center space-x-2">
                {item.disposition ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                    {displayDispositionLabel(item.disposition)}
                  </span>
                ) : null}
                <button
                  onClick={toggleBookmark}
                  className={`inline-flex items-center justify-center p-2 text-sm font-medium transition-colors ${
                    item.bookmark
                      ? 'text-red-700 bg-transparent'
                      : 'text-primary-600 bg-transparent'
                  } focus:outline-none`}
                  title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
                >
                  <Bookmark className="h-5 w-5" fill={item.bookmark ? 'currentColor' : 'none'} />
                </button>

                <ItemActionsMenu
                  itemId={item.itemId}
                  itemProjectId={item.projectId ?? null}
                  itemTransactionId={item.transactionId ?? null}
                  disposition={item.disposition}
                  isPersisted={true}
                  currentProjectId={projectId || item.projectId || null}
                  triggerSize="md"
                  onEdit={() => {
                    navigate(editUrl)
                  }}
                  onDuplicate={handleDuplicateItem}
                  onAddToTransaction={openTransactionDialog}
                  onSellToBusiness={handleSellToBusinessInventory}
                  onSellToProject={() => openProjectDialog('sell')}
                  onMoveToBusiness={handleMoveToBusinessInventory}
                  onMoveToProject={() => openProjectDialog('move')}
                  onAddToSpace={() => {
                    setSpaceIdValue(null)
                    setShowSpaceDialog(true)
                  }}
                  onChangeStatus={updateDisposition}
                  onDelete={handleDeleteItem}
                />

                {ENABLE_QR && (
                  <button
                    className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    onClick={() => window.open(`/qr-image/${item.qrKey}`, '_blank')}
                    title="View QR Code"
                  >
                    <QrCode className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          {content}
          
          {/* Sticky bottom navigation bar */}
          {!onCloseHandler && item && (nextItem || previousItem) && (
            <div className="sticky bottom-0 bg-white border-t border-gray-200 z-10 px-4 py-1.5 shadow-md">
              <div className="max-w-7xl mx-auto">
                {(filterMode !== 'all' || sortMode !== 'creationDate' || searchQuery.trim()) && (
                  <div className="text-[10px] text-gray-500 mb-1 text-center">
                    {[
                      searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : null,
                      filterMode !== 'all' ? `Filter: ${filterMode}` : null,
                      sortMode !== 'creationDate' ? `Sort: ${sortMode}` : null
                    ].filter(Boolean).join(' / ')}
                  </div>
                )}
                <div className="flex items-center justify-between">
                <button
                  onClick={() => previousItem && handleNavigateToItem(previousItem)}
                  disabled={!previousItem}
                  className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded transition-colors ${
                    previousItem
                      ? 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                      : 'text-gray-400 bg-gray-50 cursor-not-allowed'
                  }`}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                  Previous
                </button>
                
                <span className="text-xs text-gray-500">
                  {currentIndex >= 0 && filteredAndSortedItems.length > 0
                    ? `${currentIndex + 1} of ${filteredAndSortedItems.length}`
                    : ''}
                </span>
                
                <button
                  onClick={() => nextItem && handleNavigateToItem(nextItem)}
                  disabled={!nextItem}
                  className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded transition-colors ${
                    nextItem
                      ? 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                      : 'text-gray-400 bg-gray-50 cursor-not-allowed'
                  }`}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}



