import { Bookmark, Camera, ChevronDown, Edit, Copy } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { Item } from '@/types'
import { normalizeDisposition, dispositionsEqual, displayDispositionLabel, DISPOSITION_OPTIONS } from '@/utils/dispositionUtils'
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
    const baseClasses = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition-colors hover:opacity-80'
    const d = normalizeDisposition(disposition)

    switch (d) {
      case 'to purchase':
        return `${baseClasses} bg-amber-100 text-amber-800`
      case 'purchased':
        return `${baseClasses} bg-green-100 text-green-800`
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
        <div className="flex items-start gap-4">
          {/* Checkbox on the left */}
          <div className="pt-1">
            <input
              type="checkbox"
              aria-label={`Select ${item.description || `item ${itemNumber}`}`}
              className="h-4 w-4 text-primary-600 border-gray-300 rounded"
              checked={isSelected}
              onChange={(e) => onSelect(item.itemId, e.target.checked)}
            />
          </div>

          {/* Image */}
          {item.images && item.images.length > 0 ? (
            <div className="mr-4">
              <img
                src={item.images.find(img => img.isPrimary)?.url || item.images[0].url}
                alt={item.images[0].alt || item.images[0].fileName}
                className="h-12 w-12 rounded-md object-cover border border-gray-200"
              />
            </div>
          ) : (
            <div className="mr-4">
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
            </div>
          )}

          {/* Content - wrapped in Link for navigation */}
          <ContextLink to={getItemLink()} className="flex-1">
            <div>
              <div className="flex items-center space-x-4 mb-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  Item {itemNumber}
                  {duplicateCount && duplicateCount > 1 && duplicateIndex && (
                    <span className="ml-1 text-primary-600">×{duplicateIndex}/{duplicateCount}</span>
                  )}
                </span>
                {priceLabel && (
                  <span className="text-sm text-gray-500">
                    {priceLabel}
                    {hasNonEmptyMoneyString(item.taxAmountPurchasePrice) && (
                      <>
                        {' • Tax: '}
                        {formatCurrency(item.taxAmountPurchasePrice)}
                      </>
                    )}
                  </span>
                )}
                {!priceLabel && item.source && (
                  <span className="text-sm text-gray-500">{item.source}</span>
                )}
              </div>

              <h4 className="text-sm font-medium text-gray-900 mb-1">
                {item.description || 'No description'}
              </h4>

              {locationValue && (
                <div className="text-sm text-gray-500 mb-2">
                  <span className="font-medium">Location:</span> {locationValue}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                {item.sku && (
                  <div>
                    <span className="font-medium">SKU:</span> {item.sku}
                  </div>
                )}
                {item.marketValue && (
                  <div>
                    <span className="font-medium">Market Value:</span> {formatCurrency(item.marketValue)}
                  </div>
                )}
              </div>

              {item.notes && (
                <div className="mt-2 text-sm text-gray-600">
                  <span className="font-medium">Notes:</span> {item.notes}
                </div>
              )}
            </div>
          </ContextLink>

          {/* Action buttons on the right */}
          <div className="flex items-center space-x-2 ml-auto">
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onBookmark(item.itemId)
              }}
              className={`inline-flex items-center justify-center p-2 border text-sm font-medium rounded-md transition-colors ${
                item.bookmark
                  ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                  : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500`}
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
              className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
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
              className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
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
      </div>
    </li>
  )
}