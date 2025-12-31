import { useEffect, useState } from 'react'
import { Bookmark, Camera, ChevronDown, Edit, Copy, Receipt } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { Item } from '@/types'
import { normalizeDisposition, dispositionsEqual, displayDispositionLabel, DISPOSITION_OPTIONS } from '@/utils/dispositionUtils'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useAccount } from '@/contexts/AccountContext'
import type { ItemDisposition } from '@/types'

interface InventoryItemRowProps {
  item: Item
  isSelected: boolean
  onSelect: (itemId: string, checked: boolean) => void
  onBookmark: (itemId: string) => void
  onDuplicate: (itemId: string) => void
  onEdit: (href: string) => void
  onDispositionUpdate: (itemId: string, disposition: ItemDisposition) => void
  onAddImage: (itemId: string) => void
  uploadingImages: Set<string>
  openDispositionMenu: string | null
  setOpenDispositionMenu: (itemId: string | null) => void
  context: 'project' | 'businessInventory'
  projectId?: string // Required for project context
  itemNumber: number
  duplicateCount?: number
  duplicateIndex?: number
}

export default function InventoryItemRow({
  item,
  isSelected,
  onSelect,
  onBookmark,
  onDuplicate,
  onEdit,
  onDispositionUpdate,
  onAddImage,
  uploadingImages,
  openDispositionMenu,
  setOpenDispositionMenu,
  context,
  projectId,
  itemNumber,
  duplicateCount,
  duplicateIndex
}: InventoryItemRowProps) {
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  const [transactionDisplayInfo, setTransactionDisplayInfo] = useState<{title: string, amount: string} | null>(null)
  const [transactionRoute, setTransactionRoute] = useState<{path: string, projectId: string | null} | null>(null)

  // Fetch transaction display info and route when component mounts or transactionId changes
  useEffect(() => {
    const fetchTransactionData = async () => {
      if (item.transactionId && currentAccountId) {
        const [displayInfo, route] = await Promise.all([
          getTransactionDisplayInfo(currentAccountId, item.transactionId, 20),
          getTransactionRoute(item.transactionId, currentAccountId, projectId)
        ])
        setTransactionDisplayInfo(displayInfo)
        setTransactionRoute(route)
      } else {
        setTransactionDisplayInfo(null)
        setTransactionRoute(null)
      }
    }

    fetchTransactionData()
  }, [item.transactionId, currentAccountId, projectId])

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
    setOpenDispositionMenu(openDispositionMenu === itemId ? null : itemId)
  }

  const updateDisposition = async (itemId: string, newDisposition: ItemDisposition) => {
    onDispositionUpdate(itemId, newDisposition)
    setOpenDispositionMenu(null)
  }

  // Determine the link destination based on context
  const getItemLink = () => {
    if (context === 'project' && projectId) {
      return `/item/${item.itemId}?project=${projectId}`
    } else if (context === 'businessInventory') {
      return `/business-inventory/${item.itemId}`
    }
    return `/item/${item.itemId}`
  }

  // Determine the edit link based on context
  const getEditLink = () => {
    if (context === 'project' && projectId) {
      return `/project/${projectId}/items/${item.itemId}/edit`
    } else if (context === 'businessInventory') {
      return `/business-inventory/${item.itemId}/edit`
    }
    return `/item/${item.itemId}/edit`
  }

  const hasProjectPrice = hasNonEmptyMoneyString(item.projectPrice)
  const hasPurchasePrice = hasNonEmptyMoneyString(item.purchasePrice)
  const primaryPrice = hasProjectPrice ? item.projectPrice : hasPurchasePrice ? item.purchasePrice : undefined
  const priceLabel = primaryPrice ? formatCurrency(primaryPrice) : null
  const locationValue = context === 'project' ? item.space : item.businessInventoryLocation

  return (
    <li className="relative bg-white">
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        {/* Top row: checkbox, item count, price, controls */}
        <div className="flex items-center gap-4 mb-3">
          {/* Checkbox */}
          <input
            type="checkbox"
            aria-label={`Select ${item.description || `item ${itemNumber}`}`}
            className="h-4 w-4 text-primary-600 border-gray-300 rounded"
            checked={isSelected}
            onChange={(e) => onSelect(item.itemId, e.target.checked)}
          />

          {/* Duplicate count for individual items in groups */}
          {duplicateCount && duplicateCount > 1 && duplicateIndex && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              ×{duplicateIndex}/{duplicateCount}
            </span>
          )}

          {/* Price */}
          {priceLabel && (
            <span className="text-sm text-gray-500">
              {priceLabel}
            </span>
          )}


          {/* Action buttons on the right */}
          <div className="flex items-center space-x-2 ml-auto">
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onBookmark(item.itemId)
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
            <ContextLink
              to={getEditLink()}
              onClick={(e) => {
                e.stopPropagation()
                onEdit(getEditLink())
              }}
              className="inline-flex items-center justify-center p-1 text-sm font-medium text-primary-600 bg-transparent focus:outline-none transition-colors"
              title="Edit item"
            >
              <Edit className="h-4 w-4" />
            </ContextLink>
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDuplicate(item.itemId)
              }}
              className="inline-flex items-center justify-center p-1 text-sm font-medium text-primary-600 bg-transparent focus:outline-none transition-colors"
              title="Duplicate item"
            >
              <Copy className="h-4 w-4" />
            </button>
            <div className="relative">
              <span
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleDispositionMenu(item.itemId)
                }}
                className={`disposition-badge ${getDispositionBadgeClasses(item.disposition)}`}
                title="Change disposition"
              >
                {displayDispositionLabel(item.disposition) || 'Not Set'}
                <ChevronDown className="h-3 w-3 ml-1" />
              </span>

              {/* Dropdown menu */}
              {openDispositionMenu === item.itemId && (
                <div className="disposition-menu absolute top-full right-0 mt-1 w-32 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                  <div className="py-1">
                    {DISPOSITION_OPTIONS.map((disposition) => (
                      <button
                        key={disposition}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          updateDisposition(item.itemId, disposition)
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
          </div>
        </div>

        {/* Bottom row: image and text content in two columns */}
        <div className="flex gap-4">
          {/* Left column: Image */}
          <div className="flex-shrink-0">
            {item.images && item.images.length > 0 ? (
              <img
                src={item.images.find(img => img.isPrimary)?.url || item.images[0].url}
                alt={item.images[0].alt || item.images[0].fileName}
                className="h-12 w-12 rounded-md object-cover border border-gray-200"
              />
            ) : (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAddImage(item.itemId)
                }}
                disabled={uploadingImages.has(item.itemId)}
                className="w-12 h-12 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-50"
                title="Add image (camera or gallery)"
              >
                <Camera className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Right column: All text content wrapped in link */}
          <ContextLink to={getItemLink()} className="flex-1 min-w-0">
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                {item.description || 'No description'}
              </h4>

              {locationValue && (
                <div className="text-sm text-gray-500 mb-2">
                  <span className="font-medium">Location:</span> {locationValue}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                {/* SKU and conditional transaction/source display */}
                <div>
                  {item.sku && <span className="font-medium">SKU: {item.sku}</span>}
                  {(item.sku || transactionDisplayInfo || item.source) && <span className="mx-2 text-gray-400">•</span>}
                  {transactionDisplayInfo ? (
                    <span className="inline-flex items-center text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
                      <Receipt className="h-3 w-3 mr-1" />
                      <ContextLink
                        to={transactionRoute ? buildContextUrl(transactionRoute.path, transactionRoute.projectId ? { project: transactionRoute.projectId } : undefined) : ''}
                        className="hover:underline font-medium"
                        title={`View transaction: ${transactionDisplayInfo.title}`}
                      >
                        {transactionDisplayInfo.title} {transactionDisplayInfo.amount}
                      </ContextLink>
                    </span>
                  ) : (
                    item.source && <span className="text-xs font-medium text-gray-600">{item.source}</span>
                  )}
                </div>
                {item.marketValue && (
                  <div>
                    <span className="font-medium">Market Value:</span> {formatCurrency(item.marketValue)}
                  </div>
                )}
              </div>
            </div>
          </ContextLink>
        </div>
      </div>
    </li>
  )
}