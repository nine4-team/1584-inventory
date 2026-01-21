import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ChevronDown, Receipt, Bookmark, Edit, Copy, X } from 'lucide-react'
import DuplicateQuantityMenu from '@/components/ui/DuplicateQuantityMenu'
import ContextLink from '@/components/ContextLink'
import { normalizeDisposition, displayDispositionLabel, DISPOSITION_OPTIONS, dispositionsEqual } from '@/utils/dispositionUtils'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import { useTransactionDisplayInfo } from '@/hooks/useTransactionDisplayInfo'
import { offlineMediaService } from '@/services/offlineMediaService'
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
  onDispositionUpdate?: (itemId: string, disposition: ItemDisposition) => void
  onAddImage?: (itemId: string) => void
  // State
  uploadingImages?: Set<string>
  openDispositionMenu?: string | null
  setOpenDispositionMenu?: (itemId: string | null) => void
  deletingItemIds?: Set<string>
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
  // Transaction display info (optional, will be fetched if not provided)
  transactionDisplayInfo?: { title: string; amount: string } | null
  transactionRoute?: { path: string; projectId: string | null } | null
  isLoadingTransaction?: boolean
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
  onDispositionUpdate,
  onAddImage,
  uploadingImages = new Set(),
  openDispositionMenu,
  setOpenDispositionMenu,
  deletingItemIds = new Set(),
  itemLink,
  onClick,
  editLink,
  context,
  projectId,
  duplicateCount,
  duplicateIndex,
  itemNumber,
  transactionDisplayInfo: providedTransactionDisplayInfo,
  transactionRoute: providedTransactionRoute,
  isLoadingTransaction: providedIsLoadingTransaction
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
  const showEdit = !!onEdit
  const showDelete = false // Never show delete in canonical layout (use selection + bulk actions)
  const showDisposition = !!onDispositionUpdate
  const showLocation = true // Always show location if available
  const showNotes = context === 'transaction' // Show notes in transaction context
  const showMarketValue = context !== 'project' && context !== 'businessInventory'
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  
  const itemId = item.itemId || item.id || ''
  
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

  const getDispositionBadgeClasses = (disposition?: string | null) => {
    const baseClasses = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors hover:opacity-80'
    const d = normalizeDisposition(disposition)

    switch (d) {
      case 'to purchase':
        return `${baseClasses} bg-amber-100 text-amber-800`
      case 'purchased':
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

  const toggleDispositionMenu = (itemId: string) => {
    if (setOpenDispositionMenu) {
      setOpenDispositionMenu(openDispositionMenu === itemId ? null : itemId)
    }
  }

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    if (onDispositionUpdate) {
      onDispositionUpdate(itemId, newDisposition)
    }
    if (setOpenDispositionMenu) {
      setOpenDispositionMenu(null)
    }
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

  const hasProjectPrice = hasNonEmptyMoneyString(item.projectPrice)
  const hasPurchasePrice = hasNonEmptyMoneyString(item.purchasePrice)
  const primaryPrice = hasProjectPrice ? item.projectPrice : hasPurchasePrice ? item.purchasePrice : undefined
  const priceLabel = primaryPrice ? formatCurrency(primaryPrice) : null
  const locationValue = context === 'project' ? item.space : item.businessInventoryLocation

  const hasActions = showBookmark || showEdit || showDuplicate || showDelete || showDisposition

  const cardContent = (
    <>
      {/* Top row: checkbox, price, controls */}
      {(showCheckbox || duplicateCount || priceLabel || hasActions) && (
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
          {hasActions && (
            <div className="flex items-center space-x-2 ml-auto">
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
                  <Bookmark className="h-4 w-4" fill={item.bookmark ? 'currentColor' : 'none'} />
                </button>
              )}
              {showEdit && onEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onEdit(getEditLink())
                  }}
                  className="inline-flex items-center justify-center p-1 text-sm font-medium text-primary-600 bg-transparent focus:outline-none transition-colors"
                  title="Edit item"
                >
                  <Edit className="h-4 w-4" />
                </button>
              )}
              {showDuplicate && onDuplicate && (
                <DuplicateQuantityMenu
                  onDuplicate={(quantity) => onDuplicate(itemId, quantity)}
                  buttonClassName="inline-flex items-center justify-center p-1 text-sm font-medium text-primary-600 bg-transparent focus:outline-none transition-colors"
                  buttonTitle="Duplicate item"
                  buttonContent={<Copy className="h-4 w-4" />}
                />
              )}
              {showDelete && onDelete && (
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onDelete(itemId)
                  }}
                  className="text-red-600 hover:text-red-900 p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={deletingItemIds.has(itemId) ? 'Deleting item' : 'Delete item'}
                  disabled={deletingItemIds.has(itemId)}
                >
                  {deletingItemIds.has(itemId) ? (
                    <span className="text-xs font-medium">...</span>
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </button>
              )}
              {showDisposition && (
                <div className="relative">
                  <span
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleDispositionMenu(itemId)
                    }}
                    className={`disposition-badge ${getDispositionBadgeClasses(item.disposition)}`}
                    title="Change disposition"
                  >
                    {displayDispositionLabel(item.disposition) || 'Not Set'}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </span>

                  {/* Dropdown menu */}
                  {openDispositionMenu === itemId && (
                    <div className="disposition-menu absolute top-full right-0 mt-1 w-32 bg-white border border-gray-200 rounded-md shadow-lg z-40">
                      <div className="py-1">
                        {DISPOSITION_OPTIONS.map((disposition) => (
                          <button
                            key={disposition}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              updateDisposition(itemId, disposition)
                            }}
                            className={`block w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${
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
          {duplicateCount && duplicateCount > 1 && duplicateIndex && (
            <span className="mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              ×{duplicateIndex}/{duplicateCount}
            </span>
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
            showMarketValue={showMarketValue}
            formatCurrency={formatCurrency}
            buildContextUrl={buildContextUrl}
          />
        </div>
      </div>
    </>
  )

  // Determine if we should wrap in a link
  const shouldWrapInLink = !onClick && (itemLink || item.itemId || item.id) && getItemLink() !== '#'
  const linkUrl = shouldWrapInLink ? getItemLink() : undefined

  if (onClick) {
    return (
      <div 
        className="bg-gray-50 border border-gray-200 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition-colors"
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
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:bg-gray-100 transition-colors">
          {cardContent}
        </div>
      </ContextLink>
    )
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
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
  showMarketValue,
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
  showMarketValue: boolean
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
          {(item.sku || (showTransactionLink && item.transactionId) || item.source) && <span className="mx-2 text-gray-400">•</span>}
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
        {showMarketValue && item.marketValue && (
          <div>
            <span className="font-medium">Market Value:</span> {formatCurrency(item.marketValue)}
          </div>
        )}
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
