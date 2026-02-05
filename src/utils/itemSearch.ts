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

  const isAmountQuery = isAmountLikeQuery(trimmedQuery)
  let matchesAmount = false

  if (isAmountQuery) {
    const normalizedAmountQuery = normalizeMoneyToTwoDecimalString(trimmedQuery)
    const normalizedAmountQueryNumeric = normalizedAmountQuery?.replace(/[^0-9-]/g, '') ?? ''
    const rawDigitsQuery = trimmedQuery.replace(/[^0-9]/g, '')

    if (normalizedAmountQuery) {
      const amountValues = [item.price, item.purchasePrice, item.projectPrice, item.marketValue]
      matchesAmount = amountValues.some(value => {
        const normalizedAmount = normalizeMoneyToTwoDecimalString((value ?? '').toString())
        if (!normalizedAmount) return false
        if (normalizedAmount === normalizedAmountQuery) return true
        const normalizedAmountNumeric = normalizedAmount.replace(/[^0-9-]/g, '')
        if (normalizedAmountQueryNumeric && normalizedAmountQueryNumeric !== '-' &&
          normalizedAmountNumeric.includes(normalizedAmountQueryNumeric)) {
          return true
        }
        return rawDigitsQuery.length > 0 && normalizedAmountNumeric.includes(rawDigitsQuery)
      })
    }
  }

  const matches = matchesText || matchesAmount

  return {
    matchesText,
    matchesAmount,
    matches,
    isAmountQuery
  }
}
