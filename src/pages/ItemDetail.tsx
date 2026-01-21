import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ArrowLeft, Bookmark, QrCode, Trash2, Edit, FileText, ImagePlus, ChevronDown, Copy, X, RefreshCw } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import ContextBackLink from '@/components/ContextBackLink'
import { Item, ItemImage, ItemDisposition, Transaction, Project } from '@/types'
import { normalizeDisposition, dispositionsEqual, displayDispositionLabel, DISPOSITION_OPTIONS } from '@/utils/dispositionUtils'
import { formatDate, formatCurrency } from '@/utils/dateUtils'
import { unifiedItemsService, projectService, integrationService, transactionService, isCanonicalTransactionId } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import ImagePreview from '@/components/ui/ImagePreview'
import ItemLineageBreadcrumb from '@/components/ui/ItemLineageBreadcrumb'
import DuplicateQuantityMenu from '@/components/ui/DuplicateQuantityMenu'
import { lineageService } from '@/services/lineageService'
import { getUserFriendlyErrorMessage, getErrorAction } from '@/utils/imageUtils'
import { useToast } from '@/components/ui/ToastContext'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { useDuplication } from '@/hooks/useDuplication'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useNetworkState } from '@/hooks/useNetworkState'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { projectItemDetail, projectItemEdit, projectItems, projectTransactionDetail } from '@/utils/routes'
import { Combobox } from '@/components/ui/Combobox'
import { supabase } from '@/services/supabase'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { hydrateItemCache, hydrateProjectCache } from '@/utils/hydrationHelpers'

export default function ItemDetail({ itemId: propItemId, projectId: propProjectId, onClose }: { itemId?: string; projectId?: string; onClose?: () => void } = {}) {
  const { id, projectId: routeProjectId, itemId } = useParams<{ id?: string; projectId?: string; itemId?: string }>()
  const ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'
  const navigate = useStackedNavigate()
  const { currentAccountId } = useAccount()
  const [searchParams] = useSearchParams()
  const [item, setItem] = useState<Item | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [isLoadingItem, setIsLoadingItem] = useState<boolean>(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [openDispositionMenu, setOpenDispositionMenu] = useState(false)
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
    if (!currentAccountId || isBusinessInventoryItem) return
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
  }, [currentAccountId, isBusinessInventoryItem])

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

  // Close disposition menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDispositionMenu && !event.target) return

      const target = event.target as Element
      if (!target.closest('.disposition-menu') && !target.closest('.disposition-badge')) {
        setOpenDispositionMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDispositionMenu])

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
    if (showTransactionDialog && currentAccountId && (projectId || item?.projectId)) {
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
    const effectiveProjectId = projectId || item?.projectId
    if (!currentAccountId || !effectiveProjectId) return
    setLoadingTransactions(true)
    try {
      const txs = await transactionService.getTransactions(currentAccountId, effectiveProjectId)
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
      return 'Company Inventory Sale'
    }
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      return 'Company Inventory Purchase'
    }
    return transaction.source
  }

  const handleChangeTransaction = async () => {
    if (!item || !currentAccountId || !selectedTransactionId) return

    setIsUpdatingTransaction(true)
    const previousTransactionId = item.transactionId
    const effectiveProjectId = projectId || item.projectId

    try {
      // Update the item's transactionId
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        transactionId: selectedTransactionId
      })

      // Update lineage pointers
      try {
        await lineageService.updateItemLineagePointers(currentAccountId, item.itemId, selectedTransactionId)
      } catch (lineageError) {
        console.warn('Failed to update lineage pointers for item:', item.itemId, lineageError)
      }

      // Remove item from old transaction's item_ids array
      if (previousTransactionId) {
        try {
          const { data: oldTxData, error: fetchOldError } = await supabase
            .from('transactions')
            .select('item_ids')
            .eq('account_id', currentAccountId)
            .eq('transaction_id', previousTransactionId)
            .single()

          if (!fetchOldError && oldTxData) {
            const currentItemIds: string[] = Array.isArray(oldTxData.item_ids) ? oldTxData.item_ids : []
            const updatedItemIds = currentItemIds.filter(id => id !== item.itemId)

            await supabase
              .from('transactions')
              .update({
                item_ids: updatedItemIds,
                updated_at: new Date().toISOString()
              })
              .eq('account_id', currentAccountId)
              .eq('transaction_id', previousTransactionId)
          }
        } catch (oldTxError) {
          console.warn('Failed to update old transaction item_ids:', oldTxError)
        }
      }

      // Add item to new transaction's item_ids array
      try {
        const { data: newTxData, error: fetchNewError } = await supabase
          .from('transactions')
          .select('item_ids')
          .eq('account_id', currentAccountId)
          .eq('transaction_id', selectedTransactionId)
          .single()

        if (!fetchNewError && newTxData) {
          const currentItemIds: string[] = Array.isArray(newTxData.item_ids) ? newTxData.item_ids : []
          if (!currentItemIds.includes(item.itemId)) {
            const updatedItemIds = [...currentItemIds, item.itemId]

            await supabase
              .from('transactions')
              .update({
                item_ids: updatedItemIds,
                updated_at: new Date().toISOString()
              })
              .eq('account_id', currentAccountId)
              .eq('transaction_id', selectedTransactionId)
          }
        }
      } catch (newTxError) {
        console.warn('Failed to update new transaction item_ids:', newTxError)
      }

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
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, { projectId: nextProjectId })
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
    }
  }, [item, currentAccountId, showError, showSuccess, navigate, buildContextUrl, projects])

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
    console.log('🎯 updateDisposition called with:', newDisposition, 'Current item:', item?.itemId)

    if (!item || !currentAccountId) {
      console.error('❌ No item available for disposition update')
      return
    }

    console.log('📝 Updating disposition from', item.disposition, 'to', newDisposition)

    try {
      // Update the disposition in the database first
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
        disposition: newDisposition
      })
      console.log('💾 Database updated successfully')

      // Update local state
      setItem({ ...item, disposition: newDisposition })
      setOpenDispositionMenu(false)

      // If disposition is set to 'inventory', trigger deallocation process
      if (newDisposition === 'inventory') {
        console.log('🚀 Starting deallocation process for item:', item.itemId)
        try {
          await integrationService.handleItemDeallocation(
            currentAccountId,
            item.itemId,
            item.projectId || '',
            newDisposition
          )
          console.log('✅ Deallocation completed successfully')
          // Refresh the item data after deallocation
          const updatedItem = await unifiedItemsService.getItemById(currentAccountId, item.itemId)
          if (updatedItem) {
            setItem(updatedItem)
          }
        } catch (deallocationError) {
          console.error('❌ Failed to handle deallocation:', deallocationError)
          // Revert the disposition change if deallocation fails
          await unifiedItemsService.updateItem(currentAccountId, item.itemId, {
            disposition: item.disposition // Revert to previous disposition
          })
          setItem({ ...item, disposition: item.disposition })
          showError('Failed to move item to inventory. Please try again.')
        }
      }
    } catch (error) {
      console.error('Failed to update disposition:', error)
      showError('Failed to update disposition. Please try again.')
    }
  }

  const toggleDispositionMenu = () => {
    console.log('🖱️ toggleDispositionMenu called, current state:', openDispositionMenu, 'item:', item?.itemId)
    setOpenDispositionMenu(!openDispositionMenu)
  }

  const getDispositionBadgeClasses = (disposition?: string | null) => {
    const baseClasses = 'inline-flex items-center px-3 py-2 rounded-full text-sm font-medium cursor-pointer transition-colors hover:opacity-80'
    const d = normalizeDisposition(disposition)

    switch (d) {
      case 'to purchase':
        return `${baseClasses} bg-amber-100 text-amber-800`
      case 'purchased':
        // Use the primary (brown) palette to match item preview cards
        return `${baseClasses} bg-primary-100 text-primary-600`
      case 'to return':
        return `${baseClasses} bg-red-100 text-red-700`
      case 'returned':
        return `${baseClasses} bg-red-800 text-red-100`
      case 'inventory':
        return `${baseClasses} bg-primary-100 text-primary-600`
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`
    }
  }

  const itemProjectId = item?.projectId ?? null
  const derivedRealtimeProjectId = useMemo(() => {
    if (projectId) return projectId
    return itemProjectId
  }, [projectId, itemProjectId])

  const { refreshCollections: refreshRealtimeCollections } = useProjectRealtime(derivedRealtimeProjectId)
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

  const handleDeleteItem = async () => {
    if (!item || !currentAccountId) return

    if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
      return
    }

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
    () => projects.map(project => ({ id: project.id, label: project.name })),
    [projects]
  )
  const selectedProjectValue = selectedProjectId && projectOptions.some(option => option.id === selectedProjectId)
    ? selectedProjectId
    : ''
  const associateDisabledReason = item?.transactionId
    ? (isCanonicalTransactionId(item.transactionId)
      ? 'This item is tied to a Company Inventory transaction. Use inventory allocation/deallocation instead.'
      : 'This item is tied to a transaction. Move the transaction to another project instead.')
    : null
  const associateDisabled = Boolean(associateDisabledReason) || loadingProjects || isUpdatingProject || isBusinessInventoryItem

  if (isLoadingItem) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          {onClose ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                onClose()
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
          {onClose ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                onClose()
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
              {!isBusinessInventoryItem && (
                <div className="sm:col-span-3">
                  <Combobox
                    label="Associate with project"
                    value={selectedProjectValue}
                    onChange={handleAssociateProject}
                    helperText="If you accidentally added this item to the wrong project."
                    disabled={associateDisabled}
                    loading={loadingProjects || isUpdatingProject}
                    placeholder={loadingProjects ? 'Loading projects...' : 'Select a project'}
                    options={projectOptions}
                  />
                  {associateDisabledReason && (
                    <p className="mt-1 text-xs text-amber-600">{associateDisabledReason}</p>
                  )}
                </div>
              )}
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
                      {(projectId || item.projectId) && !isBusinessInventoryItem && (
                        <button
                          onClick={() => {
                            setSelectedTransactionId(item.transactionId || '')
                            setShowTransactionDialog(true)
                          }}
                          className="text-xs px-2 py-1 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded border border-primary-300 hover:border-primary-400 transition-colors"
                          title="Change transaction"
                        >
                          Change
                        </button>
                      )}
                    </>
                  ) : (
                    (projectId || item.projectId) && !isBusinessInventoryItem && (
                      <button
                        onClick={() => {
                          setSelectedTransactionId('')
                          setShowTransactionDialog(true)
                        }}
                        className="text-xs px-2 py-1 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded border border-primary-300 hover:border-primary-400 transition-colors"
                        title="Assign to transaction"
                      >
                        Assign
                      </button>
                    )
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

            {/* Delete button in lower right corner */}
            <div className="absolute bottom-0 right-0">
              <button
                onClick={handleDeleteItem}
                className="inline-flex items-center justify-center p-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                title="Delete Item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Change Dialog */}
      {showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Change Transaction
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
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
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
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {onClose ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Item</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleBookmark}
                className={`inline-flex items-center justify-center p-2 border text-sm font-medium rounded-md ${
                  item.bookmark
                    ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                    : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500`}
                title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
              >
                <Bookmark className="h-4 w-4" fill={item.bookmark ? 'currentColor' : 'none'} />
              </button>

              <ContextLink
                to={isBusinessInventoryItem
                  ? buildContextUrl(`/business-inventory/${item.itemId}/edit`)
                : projectId
                  ? buildContextUrl(projectItemEdit(projectId, item.itemId), { project: projectId })
                  : buildContextUrl(`/business-inventory/${item.itemId}/edit`)
                }
                className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                title="Edit Item"
              >
                <Edit className="h-4 w-4" />
              </ContextLink>

              <DuplicateQuantityMenu
                onDuplicate={(quantity) => duplicateItem(item.itemId, quantity)}
                buttonClassName="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                buttonTitle="Duplicate Item"
                buttonContent={<Copy className="h-4 w-4" />}
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

              <div className="relative">
                <span
                  onClick={toggleDispositionMenu}
                  className={`disposition-badge ${getDispositionBadgeClasses(item.disposition)}`}
                >
                  {displayDispositionLabel(item.disposition)}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </span>

                {/* Dropdown menu */}
                {openDispositionMenu && (
                  <div className="disposition-menu absolute top-full right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                    <div className="py-2">
                      {DISPOSITION_OPTIONS.map((disposition) => (
                        <button
                          key={disposition}
                          onClick={() => updateDisposition(disposition)}
                          className={`block w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${
                            dispositionsEqual(item.disposition, disposition) ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                          }`}
                        >
                          {displayDispositionLabel(disposition)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.preventDefault()
                  onClose()
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
                {onClose ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      onClose()
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

              <div className="flex flex-wrap gap-2 sm:space-x-2">
                <button
                  onClick={toggleBookmark}
                  className={`inline-flex items-center justify-center p-2 border text-sm font-medium rounded-md ${
                    item.bookmark
                      ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                      : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                  } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500`}
                  title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
                >
                  <Bookmark className="h-4 w-4" fill={item.bookmark ? 'currentColor' : 'none'} />
                </button>

                <ContextLink
                  to={isBusinessInventoryItem
                    ? buildContextUrl(`/business-inventory/${item.itemId}/edit`)
                  : projectId
                    ? buildContextUrl(projectItemEdit(projectId, item.itemId), { project: projectId })
                    : buildContextUrl(`/business-inventory/${item.itemId}/edit`)
                  }
                  className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  title="Edit Item"
                >
                  <Edit className="h-4 w-4" />
                </ContextLink>

                <DuplicateQuantityMenu
                  onDuplicate={(quantity) => duplicateItem(item.itemId, quantity)}
                  buttonClassName="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  buttonTitle="Duplicate Item"
                  buttonContent={<Copy className="h-4 w-4" />}
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


                <div className="relative">
                  <span
                    onClick={toggleDispositionMenu}
                    className={`disposition-badge ${getDispositionBadgeClasses(item.disposition)}`}
                  >
                    {displayDispositionLabel(item.disposition)}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </span>

                  {/* Dropdown menu */}
                  {openDispositionMenu && (
                    <div className="disposition-menu absolute top-full right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                      <div className="py-2">
                        {DISPOSITION_OPTIONS.map((disposition) => (
                          <button
                            key={disposition}
                            onClick={() => updateDisposition(disposition)}
                            className={`block w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${
                              dispositionsEqual(item.disposition, disposition) ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                            }`}
                          >
                            {displayDispositionLabel(disposition)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          {content}
        </>
      )}
    </div>
  )
}



