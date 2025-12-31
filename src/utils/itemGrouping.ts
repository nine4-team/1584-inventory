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
  return normalized.replace(/[^0-9.-]/g, '') // Remove currency symbols and extra characters
}

/**
 * Gets the effective price for grouping (projectPrice ?? purchasePrice ?? '')
 */
function getEffectivePrice(item: Item): string {
  return item.projectPrice || item.purchasePrice || ''
}

/**
 * Generates a grouping key for inventory list items (project or business inventory)
 * Groups items by SKU (excluding null SKU), plus other visual fields for identical appearance
 */
export function getInventoryListGroupKey(item: Item, context: 'project' | 'businessInventory'): string {
  const normalizedSku = normalizeString(item.sku)

  // Don't group items with null/empty SKU
  if (!normalizedSku) {
    // Return unique key to prevent grouping
    return `unique-${item.itemId}`
  }

  const normalizedSource = normalizeString(item.source)
  const normalizedPrice = normalizePrice(getEffectivePrice(item))
  const normalizedDisposition = normalizeDisposition(item.disposition)

  // Create a stable grouping key: SKU first, then other visual fields (excluding location)
  return [
    normalizedSku, // Primary grouping key
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

  // Don't group items with null/empty SKU
  if (!normalizedSku) {
    // Return unique key to prevent grouping
    return `unique-${item.id || Math.random()}`
  }

  const normalizedPrice = normalizePrice(item.purchasePrice || item.price)

  // Create a stable grouping key: SKU first, then other visual fields
  return [
    normalizedSku, // Primary grouping key
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