import React, { useEffect, useRef, useState } from 'react'
import { Camera, Receipt, Bookmark } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useTransactionDisplayInfo } from '@/hooks/useTransactionDisplayInfo'
import { offlineMediaService } from '@/services/offlineMediaService'
import ItemActionsMenu from '@/components/items/ItemActionsMenu'
import { displayDispositionLabel } from '@/utils/dispositionUtils'
import type { ItemDisposition, ItemImage } from '@/types'

// Common interface for item data that can be displayed
export interface ItemPreviewData {
  itemId?: string // For Item type
  id?: string // For TransactionItemFormData type
  description: string
  sku?: string
  purchasePrice?: string
  projectPrice?: string
  marketValue?: string
  disposition?: ItemDisposition | string | null
  images?: ItemImage[]
  projectId?: string | null
  transactionId?: string | null
  source?: string
  space?: string
  businessInventoryLocation?: string
  bookmark?: boolean
  notes?: string
}

interface ItemPreviewCardProps {
  item: ItemPreviewData
  // Selection
  isSelected?: boolean
  onSelect?: (itemId: string, checked: boolean) => void
  showCheckbox?: boolean // Whether to show checkbox (default: false)
  // Actions
  onBookmark?: (itemId: string) => void
  onDuplicate?: (itemId: string, quantity?: number) => void | Promise<void>
  onEdit?: (href: string) => void
  onDelete?: (itemId: string) => void
  onAddToTransaction?: (itemId: string) => void
  onRemoveFromTransaction?: (itemId: string) => void
  onSellToBusiness?: (itemId: string) => void
  onSellToProject?: (itemId: string) => void
  onMoveToBusiness?: (itemId: string) => void
  onMoveToProject?: (itemId: string) => void
  onChangeStatus?: (itemId: string, disposition: ItemDisposition) => void
  onAddImage?: (itemId: string) => void
  // State
  uploadingImages?: Set<string>
  // Navigation
  itemLink?: string // Custom link for item detail page
  onClick?: () => void // Custom click handler for item detail
  editLink?: string // Custom link for edit page
  context?: 'project' | 'businessInventory' | 'transaction'
  projectId?: string
  // Display helpers
  duplicateCount?: number
  duplicateIndex?: number
  itemNumber?: number
  menuDirection?: 'auto' | 'top' | 'bottom'
  // Transaction display info (optional, will be fetched if not provided)
  transactionDisplayInfo?: { title: string; amount: string } | null
  transactionRoute?: { path: string; projectId: string | null } | null
  isLoadingTransaction?: boolean
  headerAction?: React.ReactNode
  footer?: React.ReactNode
}

export default function ItemPreviewCard({
  item,
  isSelected = false,
  onSelect,
  showCheckbox = false,
  onBookmark,
  onDuplicate,
  onEdit,
  onDelete,
  onAddToTransaction,
  onRemoveFromTransaction,
  onSellToBusiness,
  onSellToProject,
  onMoveToBusiness,
  onMoveToProject,
  onChangeStatus,
  onAddImage,
  uploadingImages = new Set(),
  itemLink,
  onClick,
  editLink,
  context,
  projectId,
  duplicateCount,
  duplicateIndex,
  itemNumber,
  menuDirection,
  transactionDisplayInfo: providedTransactionDisplayInfo,
  transactionRoute: providedTransactionRoute,
  isLoadingTransaction: providedIsLoadingTransaction,
  headerAction,
  footer
}: ItemPreviewCardProps) {
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})
  const resolvedUrlsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    resolvedUrlsRef.current = resolvedUrls
  }, [resolvedUrls])

  // Resolve offline image URLs
  useEffect(() => {
    let isMounted = true

    const resolveOfflineImages = async () => {
      if (!item.images) return

      for (const image of item.images) {
        if (!image.url.startsWith('offline://')) continue
        if (resolvedUrls[image.url]) continue

        const mediaId = image.url.replace('offline://', '')
        try {
          const mediaFile = await offlineMediaService.getMediaFile(mediaId)
          if (!mediaFile?.blob || !isMounted) continue

          const objectUrl = URL.createObjectURL(mediaFile.blob)
          setResolvedUrls(prev => {
            if (prev[image.url]) {
              URL.revokeObjectURL(objectUrl)
              return prev
            }
            return {
              ...prev,
              [image.url]: objectUrl
            }
          })
        } catch (error) {
          console.warn('Failed to resolve offline image preview:', error)
        }
      }
    }

    resolveOfflineImages()

    return () => {
      isMounted = false
    }
  }, [item.images, resolvedUrls])

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(resolvedUrlsRef.current).forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Determine which controls to show based on context (canonical configuration)
  const showTransactionLink = context !== 'transaction' // Hide in transaction context
  const showBookmark = (context === 'project' || context === 'businessInventory' || context === 'transaction') && !!onBookmark
  const showDuplicate = (context === 'project' || context === 'businessInventory' || context === 'transaction') && !!onDuplicate
  const showLocation = true // Always show location if available
  const showNotes = context === 'transaction' // Show notes in transaction context
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  
  const itemId = item.itemId || item.id || ''
  const isPersisted = Boolean(item.itemId || (item.id && !item.id.toString().startsWith('item-')))
  
  // Fetch transaction display info if not provided and transactionId exists
  const shouldFetchTransactionInfo = showTransactionLink && item.transactionId && !providedTransactionDisplayInfo
  const accountIdForTransactionInfo = shouldFetchTransactionInfo ? currentAccountId ?? null : null
  const transactionIdForTransactionInfo = shouldFetchTransactionInfo ? item.transactionId ?? null : null
  const { displayInfo: fetchedTransactionDisplayInfo, route: fetchedTransactionRoute, isLoading: fetchedIsLoadingTransaction } = useTransactionDisplayInfo(
    accountIdForTransactionInfo,
    transactionIdForTransactionInfo,
    projectId
  )
  
  const transactionDisplayInfo = providedTransactionDisplayInfo ?? fetchedTransactionDisplayInfo
  const transactionRoute = providedTransactionRoute ?? fetchedTransactionRoute
  const isLoadingTransaction = providedIsLoadingTransaction ?? fetchedIsLoadingTransaction

  const formatCurrency = (amount?: string | number | null) => {
    const value =
      typeof amount === 'number'
        ? amount
        : typeof amount === 'string'
          ? Number.parseFloat(amount)
          : undefined

    if (value === undefined || Number.isNaN(value)) {
      return '$0.00'
    }

    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  const hasNonEmptyMoneyString = (value?: string | number | null) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'string') return false
    if (!value.trim()) return false
    const n = Number.parseFloat(value)
    return Number.isFinite(n)
  }

  // Determine the link destination based on context
  const getItemLink = () => {
    if (itemLink) return itemLink
    if (context === 'project' && projectId && item.itemId) {
      return `/item/${item.itemId}?project=${projectId}`
    } else if (context === 'businessInventory' && item.itemId) {
      return `/business-inventory/${item.itemId}`
    } else if (item.itemId) {
      return `/item/${item.itemId}`
    }
    return '#'
  }

  // Determine the edit link based on context
  const getEditLink = () => {
    if (editLink) return editLink
    if (context === 'project' && projectId && item.itemId) {
      return `/project/${projectId}/items/${item.itemId}/edit`
    } else if (context === 'businessInventory' && item.itemId) {
      return `/business-inventory/${item.itemId}/edit`
    } else if (item.itemId) {
      return `/item/${item.itemId}/edit`
    }
    return '#'
  }

  const handleDuplicate = (quantity: number) => {
    if (!onDuplicate) return
    onDuplicate(itemId, quantity)
  }

  const hasProjectPrice = hasNonEmptyMoneyString(item.projectPrice)
  const hasPurchasePrice = hasNonEmptyMoneyString(item.purchasePrice)
  const primaryPrice = hasProjectPrice ? item.projectPrice : hasPurchasePrice ? item.purchasePrice : undefined
  const priceLabel = primaryPrice ? formatCurrency(primaryPrice) : null
  const locationValue = context === 'project' ? item.space : item.businessInventoryLocation

  const hasActions = showBookmark || showDuplicate || onEdit || onAddToTransaction || onRemoveFromTransaction || onSellToBusiness || onSellToProject || onMoveToBusiness || onMoveToProject || onChangeStatus || onDelete
  const hasHeaderAction = Boolean(headerAction)

  const cardContent = (
    <>
      {/* Top row: checkbox, price, controls */}
      {(showCheckbox || duplicateCount || priceLabel || hasActions || hasHeaderAction) && (
        <div className="flex items-center gap-4 mb-3">
          {/* Checkbox */}
          {showCheckbox && onSelect && (
            <input
              type="checkbox"
              aria-label={`Select ${item.description || `item ${itemNumber || ''}`}`}
              className="h-4 w-4 text-primary-600 border-gray-300 rounded"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation()
                onSelect(itemId, e.target.checked)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* Price */}
          {priceLabel && (
            <span className="text-sm text-gray-500">
              {priceLabel}
            </span>
          )}

          {/* Action buttons on the right */}
          {(hasActions || hasHeaderAction) && (
            <div className="flex items-center gap-0.5 ml-auto">
              {duplicateCount && duplicateCount > 1 && duplicateIndex ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {duplicateIndex}/{duplicateCount}
                </span>
              ) : null}
              {headerAction}
              {hasActions && item.disposition ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 whitespace-nowrap">
                  {displayDispositionLabel(item.disposition)}
                </span>
              ) : null}
              {showBookmark && onBookmark && (
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onBookmark(itemId)
                  }}
                  className={`inline-flex items-center justify-center p-1 text-sm font-medium transition-colors ${
                    item.bookmark
                      ? 'text-red-700 bg-transparent'
                      : 'text-primary-600 bg-transparent'
                  } focus:outline-none`}
                  title={item.bookmark ? 'Remove Bookmark' : 'Add Bookmark'}
                >
                  <Bookmark className="h-5 w-5" fill={item.bookmark ? 'currentColor' : 'none'} />
                </button>
              )}
              {hasActions && (
                <ItemActionsMenu
                  itemId={itemId}
                  itemProjectId={item.projectId ?? projectId ?? null}
                  itemTransactionId={item.transactionId ?? null}
                  disposition={item.disposition}
                  isPersisted={isPersisted}
                  currentProjectId={projectId ?? null}
                  triggerSize="md"
                  menuDirection={menuDirection}
                  onEdit={
                    onEdit
                      ? () => {
                          onEdit(getEditLink())
                        }
                      : undefined
                  }
                  onDuplicate={showDuplicate ? handleDuplicate : undefined}
                  onAddToTransaction={
                    onAddToTransaction
                      ? () => {
                          onAddToTransaction(itemId)
                        }
                      : undefined
                  }
                  onRemoveFromTransaction={
                    onRemoveFromTransaction
                      ? () => {
                          onRemoveFromTransaction(itemId)
                        }
                      : undefined
                  }
                  onSellToBusiness={
                    onSellToBusiness
                      ? () => {
                          onSellToBusiness(itemId)
                        }
                      : undefined
                  }
                  onSellToProject={
                    onSellToProject
                      ? () => {
                          onSellToProject(itemId)
                        }
                      : undefined
                  }
                  onMoveToBusiness={
                    onMoveToBusiness
                      ? () => {
                          onMoveToBusiness(itemId)
                        }
                      : undefined
                  }
                  onMoveToProject={
                    onMoveToProject
                      ? () => {
                          onMoveToProject(itemId)
                        }
                      : undefined
                  }
                  onChangeStatus={
                    onChangeStatus
                      ? (nextStatus) => {
                          onChangeStatus(itemId, nextStatus)
                        }
                      : undefined
                  }
                  onDelete={
                    onDelete
                      ? () => {
                          onDelete(itemId)
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom row: image and text content in two columns */}
      <div className="flex gap-4">
        {/* Left column: Image */}
        <div className="flex-shrink-0 flex flex-col items-center">
          {item.images && item.images.length > 0 ? (
            (() => {
              const primaryImage = item.images.find(img => img.isPrimary) || item.images[0]
              const resolvedUrl = resolvedUrls[primaryImage.url] || primaryImage.url
              return (
                <img
                  src={resolvedUrl}
                  alt={primaryImage.alt || primaryImage.fileName}
                  className="h-12 w-12 rounded-md object-cover border border-gray-200"
                />
              )
            })()
          ) : (
            onAddImage ? (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAddImage(itemId)
                }}
                className="w-12 h-12 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-50"
                title="Add image (camera or gallery)"
              >
                <Camera className="h-5 w-5" />
              </button>
            ) : (
              <div className="w-12 h-12 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                <Camera className="h-5 w-5" />
              </div>
            )
          )}
        </div>

        {/* Right column: All text content */}
        <div className="flex-1 min-w-0">
          <ItemContent
            item={item}
            showTransactionLink={showTransactionLink}
            transactionDisplayInfo={transactionDisplayInfo}
            transactionRoute={transactionRoute}
            isLoadingTransaction={isLoadingTransaction}
            locationValue={showLocation ? locationValue : undefined}
            showNotes={showNotes}
            formatCurrency={formatCurrency}
            buildContextUrl={buildContextUrl}
          />
        </div>
      </div>
      {footer && (
        <div className="mt-3 flex justify-end">
          {footer}
        </div>
      )}
    </>
  )

  // Determine if we should wrap in a link
  const shouldWrapInLink = !onClick && (itemLink || item.itemId || item.id) && getItemLink() !== '#'
  const linkUrl = shouldWrapInLink ? getItemLink() : undefined

  if (onClick) {
    return (
      <div 
        className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-5 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={(e) => {
          // Only trigger onClick if the click wasn't on an interactive element
          const target = e.target as HTMLElement
          if (!target.closest('button') && !target.closest('a') && !target.closest('input[type="checkbox"]')) {
            onClick()
          }
        }}
      >
        {cardContent}
      </div>
    )
  }

  if (shouldWrapInLink && linkUrl) {
    return (
      <ContextLink to={linkUrl} className="block">
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-5 hover:bg-gray-100 transition-colors">
          {cardContent}
        </div>
      </ContextLink>
    )
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-5">
      {cardContent}
    </div>
  )
}

// Separate component for item content to avoid nesting ContextLink issues
function ItemContent({
  item,
  showTransactionLink,
  transactionDisplayInfo,
  transactionRoute,
  isLoadingTransaction,
  locationValue,
  showNotes,
  formatCurrency,
  buildContextUrl
}: {
  item: ItemPreviewData
  showTransactionLink: boolean
  transactionDisplayInfo?: { title: string; amount: string } | null
  transactionRoute?: { path: string; projectId: string | null } | null
  isLoadingTransaction?: boolean
  locationValue?: string
  showNotes: boolean
  formatCurrency: (amount?: string | number | null) => string
  buildContextUrl: (path: string, params?: { project?: string }) => string
}) {
  return (
    <div>
      {item.description && (
        <h4 className="text-sm font-medium text-gray-900 mb-1">
          {item.description}
        </h4>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
        {/* SKU and conditional transaction/source display */}
        <div>
          {item.sku && <span className="font-medium">SKU: {item.sku}</span>}
          {item.sku && ((showTransactionLink && item.transactionId) || item.source) && (
            <span className="mx-2 text-gray-400">•</span>
          )}
          {showTransactionLink && item.transactionId ? (
            // Always show transaction area when transactionId exists
            transactionDisplayInfo ? (
              <span
                className="inline-flex items-center text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  if (transactionRoute) {
                    // Programmatically navigate instead of using nested link
                    window.location.href = buildContextUrl(transactionRoute.path, transactionRoute.projectId ? { project: transactionRoute.projectId } : undefined)
                  }
                }}
                title={`View transaction: ${transactionDisplayInfo.title}`}
              >
                <Receipt className="h-3 w-3 mr-1" />
                {transactionDisplayInfo.title} {transactionDisplayInfo.amount}
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
            item.source && <span className="text-xs font-medium text-gray-600">{item.source}</span>
          )}
        </div>
      </div>

      {locationValue && (
        <div className="text-sm text-gray-500 mt-2">
          <span className="font-medium">Location:</span> {locationValue}
        </div>
      )}

      {showNotes && item.notes && (
        <div className="text-sm text-gray-600 mt-2">
          <span className="font-medium">Notes:</span> {item.notes}
        </div>
      )}
    </div>
  )
}
