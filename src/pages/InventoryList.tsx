import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, RotateCcw, Camera, Trash2, QrCode, Filter, ArrowUpDown, Receipt } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { unifiedItemsService, integrationService, transactionService, projectService, SellItemToProjectError } from '@/services/inventoryService'
import { supabase } from '@/services/supabase'
import { lineageService } from '@/services/lineageService'
import { ImageUploadService } from '@/services/imageService'
import { Item, ItemImage, Transaction, Project } from '@/types'
import { normalizeDisposition } from '@/utils/dispositionUtils'
import type { ItemDisposition } from '@/types'
import { useToast } from '@/components/ui/ToastContext'
import { useBookmark } from '@/hooks/useBookmark'
import { useDuplication } from '@/hooks/useDuplication'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useNetworkState } from '@/hooks/useNetworkState'
import { getOfflineSaveMessage } from '@/utils/offlineUxFeedback'
import { useAccount } from '@/contexts/AccountContext'
import { projectItemNew } from '@/utils/routes'
import { getInventoryListGroupKey } from '@/utils/itemGrouping'
import CollapsedDuplicateGroup from '@/components/ui/CollapsedDuplicateGroup'
import InventoryItemRow from '@/components/items/InventoryItemRow'
import BulkItemControls from '@/components/ui/BulkItemControls'
import { useTransactionDisplayInfo } from '@/hooks/useTransactionDisplayInfo'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { ConflictResolutionView } from '@/components/ConflictResolutionView'
import BlockingConfirmDialog from '@/components/ui/BlockingConfirmDialog'
import { Combobox } from '@/components/ui/Combobox'

interface InventoryListProps {
  projectId: string
  projectName: string
  items: Item[]
}

const ITEM_FILTER_MODES = [
  'all',
  'bookmarked',
  'from-inventory',
  'to-return',
  'returned',
  'no-sku',
  'no-description',
  'no-project-price',
  'no-image',
  'no-transaction',
] as const
const ITEM_SORT_MODES = ['alphabetical', 'creationDate'] as const
const DEFAULT_ITEM_FILTER = 'all'
const DEFAULT_ITEM_SORT = 'creationDate'

const parseItemFilterMode = (value: string | null) =>
  ITEM_FILTER_MODES.includes(value as (typeof ITEM_FILTER_MODES)[number])
    ? (value as (typeof ITEM_FILTER_MODES)[number])
    : DEFAULT_ITEM_FILTER

const parseItemSortMode = (value: string | null) =>
  ITEM_SORT_MODES.includes(value as (typeof ITEM_SORT_MODES)[number])
    ? (value as (typeof ITEM_SORT_MODES)[number])
    : DEFAULT_ITEM_SORT

export default function InventoryList({ projectId, projectName, items: propItems }: InventoryListProps) {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('itemSearch') ?? '')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<Item[]>(propItems || [])
  const [error, setError] = useState<string | null>(null)
  const itemListContainerRef = useRef<HTMLDivElement>(null)
  const [itemListContainerWidth, setItemListContainerWidth] = useState<number | undefined>(undefined)
  const { isOnline } = useNetworkState()
  
  // Show loading spinner only if account is loading - items come from props (parent handles that loading)
  const isLoading = accountLoading
  const [uploadingImages, setUploadingImages] = useState<Set<string>>(new Set())
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [transactionTargetItemId, setTransactionTargetItemId] = useState<string | null>(null)
  const [isUpdatingTransaction, setIsUpdatingTransaction] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [projectDialogMode, setProjectDialogMode] = useState<'move' | 'sell'>('move')
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectTargetItemId, setProjectTargetItemId] = useState<string | null>(null)
  const [isUpdatingProject, setIsUpdatingProject] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetItemId, setDeleteTargetItemId] = useState<string | null>(null)
  const [isDeletingItem, setIsDeletingItem] = useState(false)
  const [filterMode, setFilterMode] = useState<
    'all'
    | 'bookmarked'
    | 'from-inventory'
    | 'to-return'
    | 'returned'
    | 'no-sku'
    | 'no-description'
    | 'no-project-price'
    | 'no-image'
    | 'no-transaction'
  >(() => parseItemFilterMode(searchParams.get('itemFilter')))
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortMode, setSortMode] = useState<'alphabetical' | 'creationDate'>(() =>
    parseItemSortMode(searchParams.get('itemSort'))
  )
  const [showSortMenu, setShowSortMenu] = useState(false)
  const isSyncingFromUrlRef = useRef(false)
  const { showSuccess, showError } = useToast()
  const { refreshCollections: refreshRealtimeCollections } = useProjectRealtime(projectId)
  const hasRestoredScrollRef = useRef(false)
  const refreshRealtimeAfterWrite = useCallback(() => {
    return refreshRealtimeCollections().catch(err => {
      console.debug('InventoryList: realtime refresh failed', err)
    })
  }, [refreshRealtimeCollections])

  // Track item list container width for bulk controls
  useEffect(() => {
    const updateWidth = () => {
      if (itemListContainerRef.current) {
        setItemListContainerWidth(itemListContainerRef.current.offsetWidth)
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  useEffect(() => {
    const nextSearchQuery = searchParams.get('itemSearch') ?? ''
    const nextFilterMode = parseItemFilterMode(searchParams.get('itemFilter'))
    const nextSortMode = parseItemSortMode(searchParams.get('itemSort'))

    const hasChanges =
      searchQuery !== nextSearchQuery ||
      filterMode !== nextFilterMode ||
      sortMode !== nextSortMode

    if (!hasChanges) return

    isSyncingFromUrlRef.current = true
    if (searchQuery !== nextSearchQuery) setSearchQuery(nextSearchQuery)
    if (filterMode !== nextFilterMode) setFilterMode(nextFilterMode)
    if (sortMode !== nextSortMode) setSortMode(nextSortMode)
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

      setParam('itemSearch', searchQuery, '')
      setParam('itemFilter', filterMode, DEFAULT_ITEM_FILTER)
      setParam('itemSort', sortMode, DEFAULT_ITEM_SORT)

      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true })
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
  }, [filterMode, searchParams, searchQuery, setSearchParams, sortMode])

  const parseMoney = (value?: string | number | null) => {
    if (value === undefined || value === null) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    return value.trim().length > 0 && Number.isFinite(Number.parseFloat(value))
  }

  const formatCurrency = (amount?: string | number | null) => {
    const numeric = parseMoney(amount)
    return numeric.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  const getPrimaryPrice = (item: Item) => {
    if (hasNonEmptyMoneyString(item.projectPrice)) return item.projectPrice
    if (hasNonEmptyMoneyString(item.purchasePrice)) return item.purchasePrice
    return undefined
  }

  // Debug logging
  useEffect(() => {
    console.log('🔍 InventoryList - accountLoading:', accountLoading, 'propItems length:', propItems?.length || 0, 'isLoading:', isLoading)
  }, [accountLoading, propItems, isLoading])

  useEffect(() => {
    console.log('🔍 InventoryList - propItems changed:', propItems?.length || 0)
    setItems(propItems || [])
  }, [propItems])

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

  // Per-visible-item lineage subscriptions: when an item has a lineage edge, refetch that item and update/remove as needed
  useEffect(() => {
    if (!currentAccountId || items.length === 0) return

    const unsubMap = new Map<string, () => void>()
    try {
      items.forEach(item => {
        if (!item?.itemId) return
        const unsub = lineageService.subscribeToItemLineageForItem(currentAccountId, item.itemId, async () => {
          try {
            const updated = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
            if (updated) {
              // If updated item still belongs to this project, update it; otherwise remove it from the list
              if (updated.projectId === projectId) {
                setItems(prev => prev.map(i => i.itemId === updated.itemId ? updated : i))
              } else {
                setItems(prev => prev.filter(i => i.itemId !== updated.itemId))
              }
            }
          } catch (err) {
            console.debug('InventoryList - failed to refetch item on lineage event', err)
          }
        })
        unsubMap.set(item.itemId, unsub)
      })
    } catch (err) {
      console.debug('InventoryList - failed to setup per-item lineage subscriptions', err)
    }

    return () => {
      unsubMap.forEach(u => {
        try { u() } catch (e) { /* noop */ }
      })
    }
  }, [items.map(i => i.itemId).join(','), currentAccountId, projectId])

 

  // Reset uploading state on unmount to prevent hanging state
  useEffect(() => {
    return () => {
      setUploadingImages(new Set())
    }
  }, [])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if ((showFilterMenu || showSortMenu) && !target.closest('.filter-menu') && !target.closest('.filter-button') && !target.closest('.sort-menu') && !target.closest('.sort-button')) {
        setShowFilterMenu(false)
        setShowSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterMenu, showSortMenu])

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

  // Use centralized bookmark hook
  const { toggleBookmark } = useBookmark<Item>({
    items,
    setItems,
    updateItemService: (itemId, updates) => {
      if (!currentAccountId) throw new Error('Account ID is required')
      return unifiedItemsService.updateItem(currentAccountId, itemId, updates)
    },
    projectId
  })

  // Use centralized duplication hook
  const { duplicateItem } = useDuplication({
    items,
    setItems,
    projectId,
    accountId: currentAccountId || undefined
  })

  // Use navigation context for proper back navigation
  const { buildContextUrl } = useNavigationContext()
  const stackedNavigate = useStackedNavigate()

  const handleNavigateToEdit = useCallback(
    (href: string) => {
      if (!href || href === '#') return

      const targetUrl = buildContextUrl(
        href,
        projectId ? { project: projectId } : undefined
      )
      stackedNavigate(targetUrl, undefined, { scrollY: window.scrollY })
    },
    [buildContextUrl, projectId, stackedNavigate]
  )

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    console.log('🎯 InventoryList updateDisposition called:', itemId, newDisposition)

    try {
      const item = items.find((item: Item) => item.itemId === itemId)
      if (!item) {
        console.error('❌ Item not found for disposition update:', itemId)
        return
      }
      const wasOffline = !isOnline

      console.log('📝 Updating disposition from', item.disposition, 'to', newDisposition)

      // Update in Supabase
      if (!currentAccountId) throw new Error('Account ID is required')
      await unifiedItemsService.updateItem(currentAccountId, itemId, { disposition: newDisposition })
      console.log('💾 Database updated successfully')

      // If disposition is set to 'inventory', trigger deallocation process
      if (newDisposition === 'inventory') {
        console.log('🚀 Starting deallocation process for item:', itemId)
        try {
          await integrationService.handleItemDeallocation(
            currentAccountId,
            itemId,
            item.projectId || '',
            newDisposition
          )
          console.log('✅ Deallocation completed successfully')
          if (wasOffline) {
            showSuccess(getOfflineSaveMessage())
          }
        } catch (deallocationError) {
          console.error('❌ Failed to handle deallocation:', deallocationError)
          // Revert the disposition change if deallocation fails
          await unifiedItemsService.updateItem(currentAccountId, itemId, {
            disposition: item.disposition // Revert to previous disposition
          })
          setError('Failed to move item to inventory. Please try again.')
          return
        }
      } else {
        // For non-inventory dispositions, update local state optimistically
        setItems(items.map(item =>
          item.itemId === itemId
            ? { ...item, disposition: newDisposition as ItemDisposition }
            : item
        ))

      }
    } catch (error) {
      console.error('❌ Failed to update disposition:', error)
      setError('Failed to update item disposition. Please try again.')
    }
  }

  const openTransactionDialog = (itemId: string) => {
    const item = items.find((entry) => entry.itemId === itemId)
    setTransactionTargetItemId(itemId)
    setSelectedTransactionId(item?.transactionId ?? '')
    setShowTransactionDialog(true)
  }

  const loadTransactions = async () => {
    if (!currentAccountId) return
    setLoadingTransactions(true)
    try {
      const txs = await transactionService.getTransactions(currentAccountId, projectId)
      setTransactions(txs)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoadingTransactions(false)
    }
  }

  useEffect(() => {
    if (!showTransactionDialog) return
    if (transactions.length > 0) return
    loadTransactions()
  }, [showTransactionDialog, transactions.length])

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
    } catch (error) {
      console.error('Failed to update transaction:', error)
      setError('Failed to update transaction. Please try again.')
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
    } catch (error) {
      console.error('Failed to remove item from transaction:', error)
      setError('Failed to remove item from transaction. Please try again.')
    } finally {
      setIsUpdatingTransaction(false)
    }
  }

  const openProjectDialog = async (itemId: string, mode: 'move' | 'sell' = 'move') => {
    setProjectTargetItemId(itemId)
    setSelectedProjectId('')
    setProjectDialogMode(mode)
    setShowProjectDialog(true)
    if (projects.length === 0 && currentAccountId) {
      setLoadingProjects(true)
      try {
        const fetchedProjects = await projectService.getProjects(currentAccountId)
        setProjects(fetchedProjects)
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        setLoadingProjects(false)
      }
    }
  }

  const handleMoveToProject = async () => {
    if (!currentAccountId || !projectTargetItemId || !selectedProjectId) return
    const item = items.find(entry => entry.itemId === projectTargetItemId)
    if (!item) return
    if (selectedProjectId === item.projectId) {
      setShowProjectDialog(false)
      return
    }

    setIsUpdatingProject(true)
    try {
      await unifiedItemsService.updateItem(currentAccountId, projectTargetItemId, {
        projectId: selectedProjectId,
        disposition: 'purchased'
      })
      await refreshRealtimeAfterWrite()
      setItems(prev => prev.filter(entry => entry.itemId !== projectTargetItemId))
      setShowProjectDialog(false)
      setProjectTargetItemId(null)
    } catch (error) {
      console.error('Failed to move item to project:', error)
      setError('Failed to move item to project. Please try again.')
    } finally {
      setIsUpdatingProject(false)
    }
  }

  const handleSellToProject = async () => {
    if (!currentAccountId || !projectTargetItemId || !selectedProjectId) return
    const item = items.find(entry => entry.itemId === projectTargetItemId)
    if (!item?.projectId) return
    if (selectedProjectId === item.projectId) {
      setShowProjectDialog(false)
      return
    }

    setIsUpdatingProject(true)
    try {
      const wasOffline = !isOnline
      await integrationService.sellItemToProject(currentAccountId, item.itemId, item.projectId, selectedProjectId)
      if (wasOffline) {
        showSuccess(getOfflineSaveMessage())
        return
      }
      await refreshRealtimeAfterWrite()
      setItems(prev => prev.filter(entry => entry.itemId !== projectTargetItemId))
      showSuccess('Sold to project.')
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
      setProjectTargetItemId(null)
      setSelectedProjectId('')
    }
  }

  const handleSellToBusinessInventory = async (itemId: string) => {
    if (!currentAccountId) return
    const item = items.find(entry => entry.itemId === itemId)
    if (!item?.projectId) return
    try {
      const wasOffline = !isOnline
      await integrationService.handleItemDeallocation(currentAccountId, itemId, item.projectId, 'inventory')
      if (wasOffline) {
        showSuccess(getOfflineSaveMessage())
        return
      }
      await refreshRealtimeAfterWrite()
    } catch (error) {
      console.error('Failed to move item to business inventory:', error)
      setError('Failed to move item to business inventory. Please try again.')
    }
  }

  const handleMoveToBusinessInventory = async (itemId: string) => {
    if (!currentAccountId) return
    const item = items.find(entry => entry.itemId === itemId)
    if (!item?.projectId) return
    if (item.transactionId) {
      showError('This item is tied to a transaction. Move the transaction instead.')
      return
    }
    try {
      await integrationService.moveItemToBusinessInventory(currentAccountId, itemId, item.projectId)
      await refreshRealtimeAfterWrite()
      showSuccess('Moved to business inventory.')
    } catch (error) {
      console.error('Failed to move item to business inventory:', error)
      setError('Failed to move item to business inventory. Please try again.')
    }
  }

  const handleDeleteItem = async () => {
    if (!currentAccountId || !deleteTargetItemId) return
    setIsDeletingItem(true)
    try {
      await unifiedItemsService.deleteItem(currentAccountId, deleteTargetItemId)
      await refreshRealtimeAfterWrite()
      setItems(prev => prev.filter(entry => entry.itemId !== deleteTargetItemId))
      setShowDeleteConfirm(false)
      setDeleteTargetItemId(null)
    } catch (error) {
      console.error('Failed to delete item:', error)
      setError('Failed to delete item. Please try again.')
    } finally {
      setIsDeletingItem(false)
    }
  }



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
      }
    } catch (error: any) {
      console.error('Error adding image:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      showError('Failed to add image. Please try again.')
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
      projectName,
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
    // The real-time listener will handle the UI update

    // Show success notification on the last file
    if (allFiles && allFiles.indexOf(file) === allFiles.length - 1) {
      const message = allFiles.length > 1 ? `${allFiles.length} images uploaded successfully!` : 'Image uploaded successfully!'
      showSuccess(message)
    }
  }

  const handleBulkAssignToTransaction = async (transactionId: string) => {
    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const itemIds = Array.from(selectedItems)
    if (itemIds.length === 0) return

    try {
      // Group by previous transaction ID to handle removals correctly
      const itemsByPrevTx = new Map<string | null, string[]>()
      itemIds.forEach(id => {
          const item = items.find(i => i.itemId === id)
          const prevTx = item?.transactionId || null
          if (!itemsByPrevTx.has(prevTx)) {
              itemsByPrevTx.set(prevTx, [])
          }
          itemsByPrevTx.get(prevTx)!.push(id)
      })

      // Execute assignments in parallel groups
      await Promise.all(Array.from(itemsByPrevTx.entries()).map(([prevTx, ids]) => 
          unifiedItemsService.assignItemsToTransaction(currentAccountId, transactionId, ids, {
              itemPreviousTransactionId: prevTx
          })
      ))

      showSuccess(`Assigned ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} to transaction`)
    } catch (error) {
      console.error('Failed to assign items to transaction:', error)
      setError('Failed to assign items to transaction. Please try again.')
      throw error
    }
  }

  const handleBulkSetLocation = async (location: string) => {
    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const itemIds = Array.from(selectedItems)
    if (itemIds.length === 0) return

    try {
      const updatePromises = itemIds.map(itemId =>
        unifiedItemsService.updateItem(currentAccountId, itemId, {
          space: location
        })
      )

      await Promise.all(updatePromises)
      showSuccess(`Updated location for ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to set location:', error)
      setError('Failed to set location. Please try again.')
      throw error
    }
  }

  const handleBulkSetDisposition = async (disposition: ItemDisposition) => {
    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const itemIds = Array.from(selectedItems)
    if (itemIds.length === 0) return

    try {
      const updatePromises = itemIds.map(async (itemId) => {
        const item = items.find(i => i.itemId === itemId)
        if (!item) return

        // Update disposition
        await unifiedItemsService.updateItem(currentAccountId, itemId, {
          disposition: disposition
        })

        // If disposition is set to 'inventory', trigger deallocation process
        if (disposition === 'inventory') {
          try {
            await integrationService.handleItemDeallocation(
              currentAccountId,
              itemId,
              item.projectId || '',
              disposition
            )
          } catch (deallocationError) {
            console.error('Failed to handle deallocation for item:', itemId, deallocationError)
            // Revert the disposition change if deallocation fails
            await unifiedItemsService.updateItem(currentAccountId, itemId, {
              disposition: item.disposition || null
            })
            throw deallocationError
          }
        }
      })

      await Promise.all(updatePromises)
      showSuccess(`Updated disposition for ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to set disposition:', error)
      setError('Failed to set disposition. Please try again.')
      throw error
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return

    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const idsToDelete = Array.from(selectedItems)

    try {
      const deletePromises = idsToDelete.map(itemId =>
        unifiedItemsService.deleteItem(currentAccountId, itemId)
      )

      await Promise.all(deletePromises)
      await refreshRealtimeAfterWrite()

      setItems(prev => prev.filter(item => !idsToDelete.includes(item.itemId)))
      setSelectedItems(new Set())
      setError(null)
      showSuccess(`Deleted ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to delete items:', error)
      setError('Failed to delete some items. Please try again.')
      // Reload items to ensure UI stays in sync if delete failed
      await handleRetry()
      throw error
    }
  }

  const handleBulkSetSku = async (sku: string) => {
    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    const itemIds = Array.from(selectedItems)
    if (itemIds.length === 0) return

    try {
      const updatePromises = itemIds.map(itemId =>
        unifiedItemsService.updateItem(currentAccountId, itemId, {
          sku: sku
        })
      )

      await Promise.all(updatePromises)
      await refreshRealtimeAfterWrite()
      showSuccess(`Updated SKU for ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to set SKU:', error)
      setError('Failed to set SKU. Please try again.')
      throw error
    }
  }

  const handleRetry = async () => {
    if (!currentAccountId) {
      setError('Account ID is required to reload inventory.')
      return
    }

    setError(null)

    try {
      const refreshedItems = await unifiedItemsService.getItemsByProject(currentAccountId, projectId)
      setItems(refreshedItems)
    } catch (retryError) {
      console.error('Failed to reload inventory:', retryError)
      setError('Failed to reload inventory. Please try again.')
    }
  }

  const filteredItems = items.filter(item => {
    // Apply search filter
    const query = searchQuery.toLowerCase().trim()
    const normalizedQuery = query.replace(/[^a-z0-9]/g, '')

    const matchesSearch = !query ||
      (item.description || '').toLowerCase().includes(query) ||
      (item.source || '').toLowerCase().includes(query) ||
      (item.sku || '').toLowerCase().includes(query) ||
      // Fuzzy match SKU (ignoring special chars) - helps with "3SEAT-001" vs "3SEAT001" or "3SEAT 001"
      (normalizedQuery && (item.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedQuery)) ||
      (item.paymentMethod || '').toLowerCase().includes(query) ||
      (item.space || '').toLowerCase().includes(query)

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

  const lastItemId = filteredItems[filteredItems.length - 1]?.itemId

  // Group filtered items by their grouping key
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>()

    filteredItems.forEach(item => {
      const groupKey = getInventoryListGroupKey(item, 'project')
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    })

    // Convert to array - items are already sorted in filteredItems
    return Array.from(groups.entries())
      .map(([groupKey, items]) => ({ groupKey, items }))
  }, [filteredItems])

  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.id,
      label: project.name,
      disabled: project.id === projectId
    })),
    [projects, projectId]
  )

  return (
    <div className="space-y-4">
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
                    ...transactions.map((transaction) => ({
                      id: transaction.transactionId,
                      label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${transaction.source} - $${transaction.amount}`
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
                onClick={projectDialogMode === 'sell' ? handleSellToProject : handleMoveToProject}
                disabled={!selectedProjectId || isUpdatingProject}
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
      {/* Controls - Sticky Container */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 py-3 mb-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Select All Checkbox */}
          <label className="flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
              onChange={(e) => handleSelectAll(e.target.checked)}
              checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
            />
            <span className="ml-2 text-sm font-medium text-gray-700">Select all</span>
          </label>

          {/* Add Button */}
          <ContextLink
            to={buildContextUrl(projectItemNew(projectId), { project: projectId })}
            className="inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-900 transition-colors duration-200 flex-shrink-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add
          </ContextLink>

          {/* Counter (when visible) */}
          {selectedItems.size > 0 && (
            <span className="text-sm text-gray-500 flex-shrink-0">
              {selectedItems.size} of {filteredItems.length} selected
            </span>
          )}

          {/* Sort Button */}
          <div className="relative flex-shrink-0">
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
              <div className="sort-menu absolute top-full left-0 mt-1 w-[min(10rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto sm:left-auto sm:right-0 sm:w-40">
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
          <div className="relative flex-shrink-0">
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
              <div className="filter-menu absolute top-full left-0 mt-1 w-[min(14rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-[70vh] overflow-y-auto sm:left-auto sm:right-0 sm:w-56">
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
                    Bookmarked
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
                  <button
                    onClick={() => {
                      setFilterMode('to-return')
                      setShowFilterMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      filterMode === 'to-return' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    To Return
                  </button>
                  <button
                    onClick={() => {
                      setFilterMode('returned')
                      setShowFilterMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      filterMode === 'returned' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    Returned
                  </button>
                  <button
                    onClick={() => {
                      setFilterMode('from-inventory')
                      setShowFilterMenu(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      filterMode === 'from-inventory' ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                    }`}
                  >
                    From Inventory
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* QR Code Button */}
          {ENABLE_QR && (
            <button
              className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors duration-200 flex-shrink-0"
              disabled={selectedItems.size === 0}
              title="Generate QR Codes"
            >
              <QrCode className="h-4 w-4" />
            </button>
          )}

          {/* Search Bar - wraps onto its own line on mobile */}
          <div className="relative flex-1 min-w-[200px] w-full sm:w-auto">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
      </div>
    </div>

      {/* Conflict Resolution */}
      {currentAccountId && (
        <ConflictResolutionView
          accountId={currentAccountId}
          projectId={projectId}
          onConflictsResolved={() => {
            // Refresh items after conflicts are resolved
            refreshRealtimeAfterWrite()
          }}
        />
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-gray-400 animate-spin mb-4">
            <svg fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Loading inventory...</h3>
          <p className="text-sm text-gray-500">Fetching your project items.</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-red-400 mb-4">⚠️</div>
          <h3 className="text-lg font-medium text-red-900 mb-2">Error loading inventory</h3>
          <p className="text-sm text-red-500 mb-6 max-w-sm mx-auto">{error}</p>
          <button
            onClick={handleRetry}
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors duration-200 w-full sm:w-auto max-w-xs"
          >
            <RotateCcw className="h-5 w-5 mr-2" />
            Retry
          </button>
        </div>
      )}

      {/* Items List */}
      {!isLoading && !error && filteredItems.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">📦</div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            No items yet
          </h3>
        </div>
      ) : (
        !isLoading && !error && (
          <div ref={itemListContainerRef} className="bg-white overflow-visible sm:overflow-hidden sm:rounded-md" style={{ paddingBottom: selectedItems.size > 0 ? '80px' : '0' }}>
            <ul className="space-y-3 pb-3">
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
                      onSellToBusiness={handleSellToBusinessInventory}
                      onSellToProject={(itemId) => openProjectDialog(itemId, 'sell')}
                      onMoveToBusiness={handleMoveToBusinessInventory}
                      onMoveToProject={(itemId) => openProjectDialog(itemId, 'move')}
                      onChangeStatus={updateDisposition}
                      onDelete={(itemId) => {
                        setDeleteTargetItemId(itemId)
                        setShowDeleteConfirm(true)
                      }}
                      onAddImage={handleAddImage}
                      uploadingImages={uploadingImages}
                      context="project"
                      projectId={projectId}
                      itemNumber={groupIndex + 1}
                    />
                  )
                }

                // Multiple items - render as collapsed group
                const firstItem = groupItems[0]
                const groupSelectionState = getGroupSelectionState(groupItems)
                const locationValue = firstItem.space || firstItem.businessInventoryLocation
                const hasAnyPrice = groupItems.some(item => getPrimaryPrice(item) !== undefined)
                const totalPrice = groupItems.reduce((sum, item) => sum + parseMoney(getPrimaryPrice(item)), 0)
                const firstItemPrice = parseMoney(getPrimaryPrice(firstItem))

                // Component to handle transaction display info for grouped items
                const GroupedItemSummary = () => {
                  const { buildContextUrl } = useNavigationContext()
                  const { displayInfo: transactionDisplayInfo, route: transactionRoute, isLoading: isLoadingTransaction } = useTransactionDisplayInfo(
                    currentAccountId,
                    firstItem.transactionId,
                    projectId
                  )

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
                              {firstItem.sku && (firstItem.transactionId || firstItem.source) && (
                                <span className="mx-2 text-gray-400">•</span>
                              )}
                              {firstItem.transactionId ? (
                                // Always show transaction area when transactionId exists
                                transactionDisplayInfo ? (
                                  <span className="inline-flex items-center text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
                                    <Receipt className="h-3 w-3 mr-1" />
                                    <span
                                      className="hover:underline font-medium cursor-pointer"
                                      title={`View transaction: ${transactionDisplayInfo.title}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (transactionRoute) {
                                          window.location.href = buildContextUrl(transactionRoute.path, transactionRoute.projectId ? { project: transactionRoute.projectId } : undefined)
                                        }
                                      }}
                                    >
                                      {transactionDisplayInfo.title} {transactionDisplayInfo.amount}
                                    </span>
                                  </span>
                                ) : isLoadingTransaction ? (
                                  <span className="inline-flex items-center text-xs font-medium text-gray-500">
                                    <Receipt className="h-3 w-3 mr-1" />
                                    Loading transaction...
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-xs font-medium text-gray-500">
                                    <Receipt className="h-3 w-3 mr-1" />
                                    Transaction
                                  </span>
                                )
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
                      <ul className="space-y-3 rounded-lg overflow-visible list-none p-0 m-0">
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
                            onSellToBusiness={handleSellToBusinessInventory}
                                  onSellToProject={(itemId) => openProjectDialog(itemId, 'sell')}
                            onMoveToBusiness={handleMoveToBusinessInventory}
                                  onMoveToProject={(itemId) => openProjectDialog(itemId, 'move')}
                            onChangeStatus={updateDisposition}
                            onDelete={(itemId) => {
                              setDeleteTargetItemId(itemId)
                              setShowDeleteConfirm(true)
                            }}
                            onAddImage={handleAddImage}
                            uploadingImages={uploadingImages}
                            context="project"
                            projectId={projectId}
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
        )
      )}

      {/* Bulk Item Controls */}
      <BulkItemControls
        selectedItemIds={selectedItems}
        projectId={projectId}
        onAssignToTransaction={handleBulkAssignToTransaction}
        enableAssignToTransaction={isOnline}
        onSetLocation={handleBulkSetLocation}
        onSetDisposition={handleBulkSetDisposition}
        onSetSku={handleBulkSetSku}
        onDelete={handleBulkDelete}
        onClearSelection={() => setSelectedItems(new Set())}
        itemListContainerWidth={itemListContainerWidth}
      />
    </div>
  )
}

