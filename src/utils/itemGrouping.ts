import { Item, TransactionItemFormData } from '@/types'
import { normalizeDisposition } from '@/utils/dispositionUtils'

/**
 * Normalizes a string by trimming whitespace and converting to lowercase
 */
function normalizeString(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

/**
 * Normalizes a price string for comparison
 */
function normalizePrice(price: string | null | undefined): string {
  const normalized = normalizeString(price)
  const sanitized = normalized.replace(/[^0-9.-]/g, '')
  if (!sanitized) {
    return ''
  }

  const numeric = Number.parseFloat(sanitized)
  if (!Number.isFinite(numeric)) {
    return sanitized
  }

  return numeric.toFixed(2)
}

/**
 * Gets the effective price for grouping (projectPrice ?? purchasePrice ?? '')
 */
function getEffectivePrice(item: Item): string {
  return item.projectPrice || item.purchasePrice || ''
}

function getPrimaryImageName(images?: { fileName?: string }[]): string {
  if (!images || images.length === 0) return ''
  return normalizeString(images[0]?.fileName || '')
}

/**
 * Generates a grouping key for inventory list items (project or business inventory)
 * Groups items by SKU (excluding null SKU), plus other visual fields for identical appearance
 */
export function getInventoryListGroupKey(item: Item, context: 'project' | 'businessInventory'): string {
  const normalizedSku = normalizeString(item.sku)
  const normalizedDescription = normalizeString(item.description)
  const normalizedImageName = getPrimaryImageName(item.images)

  const groupingSeed = normalizedSku || normalizedDescription || normalizedImageName

  // Don't group items without SKU, description, or image name
  if (!groupingSeed) {
    return `unique-${item.itemId}`
  }

  const normalizedSource = normalizeString(item.source)
  const normalizedPrice = normalizePrice(getEffectivePrice(item))
  const normalizedDisposition = normalizeDisposition(item.disposition)

  // Create a stable grouping key: SKU first, then other visual fields (excluding location)
  return [
    groupingSeed, // Primary grouping key (SKU -> description -> image name)
    normalizedSource,
    normalizedPrice,
    normalizedDisposition,
    item.bookmark.toString() // Include bookmark state in grouping
  ].join('|')
}

/**
 * Generates a grouping key for transaction form items
 */
export function getTransactionFormGroupKey(item: TransactionItemFormData): string {
  // Use uiGroupKey if available (set by import logic), otherwise compute from fields
  if (item.uiGroupKey) {
    return item.uiGroupKey
  }

  const normalizedSku = normalizeString(item.sku)
  const normalizedDescription = normalizeString(item.description)
  const normalizedImageName = getPrimaryImageName(item.images)

  const groupingSeed = normalizedSku || normalizedDescription || normalizedImageName

  if (!groupingSeed) {
    return `unique-${item.id || Math.random()}`
  }

  const normalizedPrice = normalizePrice(item.purchasePrice || item.price)

  // Create a stable grouping key: SKU first, then other visual fields
  return [
    groupingSeed, // Primary grouping key (SKU -> description -> image name)
    normalizedPrice
  ].join('|')
}

/**
 * Groups transaction detail items for display in transaction detail view
 * Uses the same grouping logic as inventory lists
 */
export function getTransactionDetailGroupKey(item: Item, context: 'project' | 'businessInventory'): string {
  return getInventoryListGroupKey(item, context)
}

/**
 * Strips Wayfair-style quantity suffix from description (if needed)
 * Example: "Pillow (1/24)" -> "Pillow"
 */
export function stripWayfairQtySuffix(description: string): string {
  return description.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
}