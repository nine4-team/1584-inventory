import type { Item } from '@/types'
import { normalizeMoneyToTwoDecimalString } from '@/utils/money'

export type ItemSearchLocationField = 'space' | 'businessInventoryLocation'

export type ItemSearchOptions = {
  locationFields?: ItemSearchLocationField[]
}

export type ItemSearchMatchResult = {
  matchesText: boolean
  matchesAmount: boolean
  matches: boolean
  isAmountQuery: boolean
}

const AMOUNT_QUERY_PATTERN = /^[0-9\s,().$-]+$/

export function isAmountLikeQuery(rawQuery: string): boolean {
  const trimmed = rawQuery.trim()
  if (!trimmed) return false
  return /\d/.test(trimmed) && AMOUNT_QUERY_PATTERN.test(trimmed)
}

const normalizeAlphanumeric = (value: string) => value.replace(/[^a-z0-9]/g, '')

type AmountPrefixRange = {
  minCents: number
  maxCents: number
}

const toCents = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const normalized = normalizeMoneyToTwoDecimalString(String(value))
  if (!normalized) return null
  const numeric = Number.parseFloat(normalized)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 100)
}

export function getAmountPrefixRange(rawQuery: string): AmountPrefixRange | null {
  const trimmed = rawQuery.trim()
  if (!trimmed) return null
  if (!/\d/.test(trimmed) || !AMOUNT_QUERY_PATTERN.test(trimmed)) return null
  if (/[-()]/.test(trimmed)) return null

  const cleaned = trimmed.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const parts = cleaned.split('.')
  if (parts.length > 2) return null

  const whole = parts[0]
  if (!whole) return null
  const fractional = parts[1] ?? ''
  const wholeValue = Number.parseInt(whole, 10)
  if (!Number.isFinite(wholeValue)) return null

  if (!fractional) {
    const minCents = wholeValue * 100
    return { minCents, maxCents: minCents + 99 }
  }

  if (fractional.length === 1) {
    const digit = Number.parseInt(fractional, 10)
    if (!Number.isFinite(digit)) return null
    const minCents = wholeValue * 100 + digit * 10
    return { minCents, maxCents: minCents + 9 }
  }

  const normalized = normalizeMoneyToTwoDecimalString(`${whole}.${fractional}`)
  if (!normalized) return null
  const exact = toCents(normalized)
  if (exact === null) return null
  return { minCents: exact, maxCents: exact }
}

export function matchesItemSearch(
  item: Item,
  rawQuery: string,
  options?: ItemSearchOptions
): ItemSearchMatchResult {
  const trimmedQuery = rawQuery.trim()
  const query = trimmedQuery.toLowerCase()
  const normalizedSkuQuery = normalizeAlphanumeric(query)
  const locationFields = options?.locationFields ?? ['space', 'businessInventoryLocation']

  const matchesText = !query ||
    (item.description || '').toLowerCase().includes(query) ||
    (item.source || '').toLowerCase().includes(query) ||
    (item.sku || '').toLowerCase().includes(query) ||
    (normalizedSkuQuery &&
      (item.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedSkuQuery)) ||
    (item.paymentMethod || '').toLowerCase().includes(query) ||
    locationFields.some(field => ((item as Record<string, unknown>)[field] as string | undefined | null || '')
      .toLowerCase()
      .includes(query))

  const amountRange = getAmountPrefixRange(trimmedQuery)
  const isAmountQuery = Boolean(amountRange)
  let matchesAmount = false

  if (amountRange) {
    const amountValues = [item.price, item.purchasePrice, item.projectPrice, item.marketValue]
    matchesAmount = amountValues.some(value => {
      const cents = toCents(value)
      if (cents === null) return false
      return cents >= amountRange.minCents && cents <= amountRange.maxCents
    })
  }

  const matches = matchesText || matchesAmount

  return {
    matchesText,
    matchesAmount,
    matches,
    isAmountQuery
  }
}
