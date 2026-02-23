export function normalizeMoneyToTwoDecimalString(input: string): string | undefined {
  if (!input) return undefined

  // Keep digits, comma, dot, minus, parentheses, and currency symbols.
  const trimmed = input.trim()
  if (!trimmed) return undefined

  const isNegative = /^\(.*\)$/.test(trimmed) || trimmed.includes('-')

  // Remove currency symbols and whitespace.
  const cleaned = trimmed
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '')

  const num = Number.parseFloat(cleaned)
  if (!Number.isFinite(num)) return undefined

  const final = isNegative ? -Math.abs(num) : num
  return final.toFixed(2)
}

export function parseMoneyToNumber(input: string | undefined): number | undefined {
  if (!input) return undefined
  const normalized = normalizeMoneyToTwoDecimalString(input)
  if (!normalized) return undefined
  const n = Number.parseFloat(normalized)
  return Number.isFinite(n) ? n : undefined
}

export function sumSelectedTransactionAmounts(
  transactions: Array<{ transactionId: string; amount?: string | null; transactionType?: string | null }>,
  selectedIds: Set<string>,
  computedTotalByTxId?: Record<string, string>,
  isCanonicalId?: (id: string) => boolean,
): number {
  return transactions
    .filter(t => selectedIds.has(t.transactionId))
    .reduce((sum, t) => {
      const display = isCanonicalId?.(t.transactionId) && computedTotalByTxId?.[t.transactionId]
        ? computedTotalByTxId[t.transactionId]
        : t.amount
      const amount = parseMoneyToSafeNumber(display)
      const type = (t.transactionType ?? '').toLowerCase()
      const isNegative = type === 'return' || type === 'sale'
      return sum + (isNegative ? -amount : amount)
    }, 0)
}

function parseMoneyToSafeNumber(value?: string | null): number {
  if (!value) return 0
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}


