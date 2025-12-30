import type { ItemDisposition } from '@/types'

// Canonical disposition values in display order
export const DISPOSITION_OPTIONS: ItemDisposition[] = ['to purchase', 'purchased', 'to return', 'returned', 'inventory']

// Label map for consistent display across the app
const DISPOSITION_LABELS: Record<ItemDisposition, string> = {
  'to purchase': 'To Purchase',
  'purchased': 'Purchased',
  'to return': 'To Return',
  'returned': 'Returned',
  'inventory': 'Inventory'
}

// Normalize and compare disposition values across the app
// IMPORTANT: Do not auto-default null/undefined values. Only UI forms should set defaults.
export function normalizeDisposition(raw?: string | null): string | null {
  if (!raw) return null
  // Trim and lowercase for normalization, but preserve null/undefined
  const normalized = raw.trim().toLowerCase()
  // Handle legacy 'keep' value by mapping to 'purchased'
  if (normalized === 'keep') return 'purchased'
  // Handle variations of 'to purchase' (spacing, casing)
  if (normalized === 'to purchase' || normalized === 'topurchase' || normalized === 'to-purchase') return 'to purchase'
  return normalized
}

export function dispositionsEqual(a?: string | null, b?: string | null): boolean {
  const normA = normalizeDisposition(a)
  const normB = normalizeDisposition(b)
  // Both null/undefined are considered equal
  if (!normA && !normB) return true
  return normA === normB
}

export function displayDispositionLabel(raw?: string | null): string {
  const normalized = normalizeDisposition(raw)
  if (!normalized) return ''
  // Use label map if available, otherwise capitalize first letter
  if (normalized in DISPOSITION_LABELS) {
    return DISPOSITION_LABELS[normalized as ItemDisposition]
  }
  // Fallback for any unexpected values
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}


