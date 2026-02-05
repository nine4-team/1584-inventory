import { normalizeMoneyToTwoDecimalString, parseMoneyToNumber } from '@/utils/money'

export type WayfairInvoiceLineItem = {
  description: string
  sku?: string
  qty: number
  unitPrice?: string
  subtotal?: string
  shipping?: string
  adjustment?: string
  tax?: string
  total: string
  /**
   * Raw attribute lines captured from the invoice *below the SKU* (e.g. "Fabric: Linen", "Color: Taupe", "Size: King").
   * These are intended to be appended into item notes during import.
   */
  attributeLines?: string[]
  attributes?: {
    color?: string
    size?: string
  }
  shippedOn?: string
  section?: 'shipped' | 'to_be_shipped' | 'unknown'
}

export type WayfairInvoiceParseResult = {
  invoiceNumber?: string
  orderDate?: string // YYYY-MM-DD
  invoiceLastUpdated?: string
  orderTotal?: string
  subtotal?: string
  shippingDeliveryTotal?: string
  taxTotal?: string
  adjustmentsTotal?: string
  calculatedSubtotal?: string // subtotal + shipping + delivery - adjustments
  lineItems: WayfairInvoiceLineItem[]
  warnings: string[]
}

const DESCRIPTION_BUFFER_LIMIT = 8

const ORDER_LEVEL_ATTRIBUTE_PREFIXES = [
  'order ',
  'payment',
  'currency',
  'tax ',
  'taxable ',
  'tax-exempt',
  'tax exempt',
  'billing',
  'bill to',
  'ship to',
  'shipping address',
  'shipping country',
  'shipping state',
  'shipping city',
  'shipping method',
]

const ORDER_LEVEL_ATTRIBUTE_EXACT = new Set([
  'order country',
  'order state',
  'order city',
  'order postal code',
  'order zip',
  'order id',
  'order number',
  'order total',
  'payment type',
  'currency',
  'tax exempt',
  'tax exemption certificate',
])

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseDateToIso(input: string): string | undefined {
  const s = input.trim()
  if (!s) return undefined

  // 1) MM/DD/YYYY
  const mdy = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (mdy) {
    const month = Number(mdy[1])
    const day = Number(mdy[2])
    const year = Number(mdy[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day))
      return toIsoDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    }
  }

  // 2) Month DD, YYYY (e.g., Dec 1, 2024)
  const monthName = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(\d{4})\b/i)
  if (monthName) {
    const monthKey = monthName[1].toLowerCase().slice(0, 3)
    const monthIndex: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    }
    const month = monthIndex[monthKey]
    const day = Number(monthName[2])
    const year = Number(monthName[3])
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, month, day)
      return toIsoDate(d)
    }
  }

  // 3) Fallback to Date.parse
  const parsed = Date.parse(s)
  if (Number.isFinite(parsed)) {
    return toIsoDate(new Date(parsed))
  }

  return undefined
}

function extractFirstMatch(text: string, regex: RegExp): string | undefined {
  const m = text.match(regex)
  return m?.[1]?.trim() || undefined
}

function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractMoneyTokens(line: string): string[] {
  // Capture tokens like "$12.34", "-$12.34", "(12.34)", "($12.34)"
  // Note: normalizeMoneyToTwoDecimalString will interpret parentheses as negative.
  return (line.match(/(?:\(\s*\$?\s*[\d,]+\.\d{2}\s*\)|-?\$?\s*[\d,]+\.\d{2})/g) || [])
    .map(t => normalizeMoneyToTwoDecimalString(t) || '')
    .filter(Boolean)
}

function absMoneyString(input: string | undefined): string | undefined {
  if (!input) return undefined
  const n = parseMoneyToNumber(input)
  if (n === undefined) return undefined
  return Math.abs(n).toFixed(2)
}

function extractQty(line: string): number | undefined {
  // 1) Explicit qty label
  const qtyMatch = line.match(/\bQty\b\s*[:#]?\s*(\d{1,3})\b/i)
  if (qtyMatch) {
    const q = Number(qtyMatch[1])
    if (Number.isFinite(q) && q > 0) return q
  }

  // 2) Table-ish pattern: "<unitPrice> <qty> <subtotal>" (qty between money columns)
  const betweenMoneyMatch = line.match(/\$?\s*[\d,]+\.\d{2}\s+(\d{1,3})\s+\$?\s*[\d,]+\.\d{2}/)
  if (betweenMoneyMatch) {
    const q = Number(betweenMoneyMatch[1])
    if (Number.isFinite(q) && q > 0) return q
  }

  // 3) Legacy/simple pattern: "... <qty> <unitPrice> <total>" (qty appears before trailing money)
  const qtyWithTwoMoneyAtEnd = line.match(/^(.*)\b(\d{1,3})\b\s+\$?\s*[\d,]+\.\d{2}\s+\$?\s*[\d,]+\.\d{2}\s*$/)
  if (qtyWithTwoMoneyAtEnd) {
    const q = Number(qtyWithTwoMoneyAtEnd[2])
    if (Number.isFinite(q) && q > 0) return q
  }

  return undefined
}

function isLikelyWayfairTableHeaderLine(line: string): boolean {
  const s = line.trim()
  if (!s) return false

  // Common invoice table headers. pdf text extraction sometimes yields these as fragmented lines.
  // We keep this conservative to avoid dropping valid item descriptions.
  if (/^(?:Item|Unit Price|Qty|Subtotal|Adjustment|Tax|Total)$/i.test(s)) return true
  if (/^Shipping\s*&\s*Delivery$/i.test(s)) return true
  if (/^Shipping\s*(?:and|&)\s*Delivery$/i.test(s)) return true
  if (/^Delivery$/i.test(s)) return true

  // Full header row in one line
  if (/\bUnit Price\b/i.test(s) && /\bQty\b/i.test(s) && /\bSubtotal\b/i.test(s) && /\bTotal\b/i.test(s)) return true
  if (/\bShipping\b/i.test(s) && /\bDelivery\b/i.test(s) && /\bAdjustment\b/i.test(s) && /\bTax\b/i.test(s)) return true

  return false
}

/**
 * pdf text extraction can occasionally merge a table header row with the first item row (especially at page breaks).
 * We do NOT want to drop the entire merged line as "header".
 *
 * This tries to strip leading header fragments and return the remaining payload (item description / other content).
 * It only strips when we see multiple header phrases within the first ~80 characters to avoid false positives.
 */
function stripLeadingMergedWayfairTableHeader(line: string): string | undefined {
  let s = line.replace(/\s+/g, ' ').trim()
  if (!s) return undefined

  const headerPhrases = [
    'Shipping & Delivery',
    'Shipping and Delivery',
    'Unit Price',
    'Subtotal',
    'Adjustment',
    'Delivery',
    'Item',
    'Qty',
    'Tax',
    'Total',
  ]

  const scanWindow = s.slice(0, 80).toLowerCase()
  const phraseHitCount = headerPhrases.reduce((count, phrase) => {
    return count + (scanWindow.includes(phrase.toLowerCase()) ? 1 : 0)
  }, 0)

  // Require a few distinct header phrases to be present; this keeps stripping conservative.
  if (phraseHitCount < 4) return undefined

  // 1) Simple: repeatedly strip header labels if they appear as a prefix token sequence.
  // This handles cases like: "Item Unit Price Qty ... Total <payload>"
  let changed = false
  for (let i = 0; i < 20; i++) {
    const before = s
    s = s
      .replace(/^Item\s+/i, '')
      .replace(/^Unit Price\s+/i, '')
      .replace(/^Qty\s+/i, '')
      .replace(/^Subtotal\s+/i, '')
      .replace(/^Shipping\s*(?:and|&)\s*Delivery\s+/i, '')
      .replace(/^Delivery\s+/i, '')
      .replace(/^Adjustment\s+/i, '')
      .replace(/^Tax\s+/i, '')
      .replace(/^Total\s+/i, '')
      .trim()

    if (s !== before) changed = true
    if (s === before) break
  }
  if (changed && s) return s

  // 2) Fallback: if the full header row appears early, cut to the content after the last header phrase match.
  // We only consider matches that occur near the start of the line.
  const lower = line.toLowerCase()
  let cutIdx = -1
  const candidates: Array<{ phrase: string; idx: number }> = []
  for (const phrase of headerPhrases) {
    const idx = lower.indexOf(phrase.toLowerCase())
    if (idx >= 0 && idx < 80) candidates.push({ phrase, idx })
  }
  if (candidates.length < 4) return undefined

  for (const c of candidates) {
    cutIdx = Math.max(cutIdx, c.idx + c.phrase.length)
  }

  if (cutIdx > 0 && cutIdx < line.length - 1) {
    const payload = line.slice(cutIdx).replace(/\s+/g, ' ').trim()
    if (payload) return payload
  }

  return undefined
}

function normalizeAttributeLine(key: string, value: string): string {
  const normalizedKey = key.replace(/\s+/g, ' ').trim()
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  return `${normalizedKey}: ${normalizedValue}`.trim()
}

const WAYFAIR_DOUBLE_QUOTE_CHARS = '"\u201c\u201d\u201e\u2033\u2036\uFF02'
const WAYFAIR_DOUBLE_QUOTE_NORMALIZER = new RegExp(`[${WAYFAIR_DOUBLE_QUOTE_CHARS}]`, 'g')
const WAYFAIR_DOUBLE_QUOTE_EDGE_STRIPPER = new RegExp(
  `^[${WAYFAIR_DOUBLE_QUOTE_CHARS}]+|[${WAYFAIR_DOUBLE_QUOTE_CHARS}]+$`,
  'g',
)

function stripOuterWayfairQuotes(input: string): string {
  return input.replace(WAYFAIR_DOUBLE_QUOTE_EDGE_STRIPPER, '').trim()
}

function normalizeDescriptionFragment(input: string | undefined): string | undefined {
  const s = (input || '').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  // If a fragment is entirely wrapped in quotes, strip them. This is common for product titles.
  const stripped = stripOuterWayfairQuotes(s)
  return stripped || s
}

function splitAttributeSpillover(label: string, value: string): { cleanedValue: string; spillover?: string } {
  const trimmedLabel = label.trim().toLowerCase()
  const trimmedValue = value.replace(/\s+/g, ' ').trim()
  if (!trimmedValue) return { cleanedValue: trimmedValue }

  const canonicalValue = trimmedValue.replace(WAYFAIR_DOUBLE_QUOTE_NORMALIZER, '"')

  const looksLikeMeasurement = (text: string): boolean => {
    return /[\d]/.test(text) || /\b(?:cm|mm|inch|inches|ft|foot|feet|x)\b/i.test(text)
  }
  const looksDescriptive = (text: string): boolean => {
    // Must be at least 4 chars and have letters
    if (text.length < 4 || !/[A-Za-z]/.test(text)) return false
    // Don't treat dimension continuations like " x 36" as descriptive text
    if (/^\s*x\s+\d+(?:\.\d+)?(?:\s*(?:"|'|inch|inches|cm|mm|ft|feet|in|L|W|H|D))?\s*$/i.test(text)) return false
    return true
  }

  if (trimmedLabel === 'size') {
    // Common failure mode: value contains inches quotes and the *next* item's title got merged into this row,
    // e.g. `138" L x 105.96" W " Vintage Landscape - DCXXXIV "`.
    // Prefer splitting the trailing quoted descriptive segment from the measurement.
    const trailingQuotedDescriptorWithSpaces = canonicalValue.match(/"\s*([^"]*[A-Za-z][^"]*)\s*"\s*$/)
    if (trailingQuotedDescriptorWithSpaces && trailingQuotedDescriptorWithSpaces.index !== undefined) {
      const base = trimmedValue.slice(0, trailingQuotedDescriptorWithSpaces.index).trim()
      const candidate = stripOuterWayfairQuotes(trailingQuotedDescriptorWithSpaces[1].trim())
      if (base && looksLikeMeasurement(base) && looksDescriptive(candidate)) {
        return {
          cleanedValue: base,
          spillover: candidate,
        }
      }
    }

    const whitespaceSeparatedDescriptor = canonicalValue.match(/\s"([^"]*[A-Za-z][^"]*)"\s*$/)
    if (whitespaceSeparatedDescriptor && whitespaceSeparatedDescriptor.index !== undefined) {
      const base = trimmedValue.slice(0, whitespaceSeparatedDescriptor.index).trim()
      const candidate = stripOuterWayfairQuotes(whitespaceSeparatedDescriptor[1].trim())
      if (base && looksLikeMeasurement(base) && looksDescriptive(candidate)) {
        return {
          cleanedValue: base,
          spillover: candidate,
        }
      }
    }

    const trailingQuotedDescriptor = canonicalValue.match(/"([^"]*[A-Za-z][^"]*)"\s*$/)
    if (trailingQuotedDescriptor && trailingQuotedDescriptor.index !== undefined) {
      const base = trimmedValue.slice(0, trailingQuotedDescriptor.index).trim()
      const candidate = stripOuterWayfairQuotes(trailingQuotedDescriptor[1].trim())
      if (base && looksLikeMeasurement(base) && looksDescriptive(candidate)) {
        return {
          cleanedValue: base,
          spillover: candidate,
        }
      }
    }

    const quotedTailMatch = canonicalValue.match(/^(.*?)(?:\s+"([^"]+)"\s*)$/)
    if (quotedTailMatch) {
      const canonicalBase = quotedTailMatch[1]
      const base = trimmedValue.slice(0, canonicalBase.length).trim()
      const candidate = stripOuterWayfairQuotes(quotedTailMatch[2].trim())
      if (base && looksLikeMeasurement(base) && looksDescriptive(candidate)) {
        return {
          cleanedValue: base,
          spillover: candidate,
        }
      }
    }
  }

  return { cleanedValue: trimmedValue }
}

function isLikelyWayfairSkuToken(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  // Wayfair item codes are typically compact alphanumerics like "W004170933", "FOW21689".
  // Require both a letter and a digit to avoid picking up pure numbers like invoice IDs.
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9-]{6,20}$/.test(t)
}

function extractStandaloneSkuLine(line: string): string | undefined {
  const s = line.trim()
  if (!s) return undefined
  if (extractMoneyTokens(s).length > 0) return undefined

  const labeled = s.match(/^(?:SKU|Item\s*(?:#|No\.?|Number|ID))\s*[:#]?\s*([A-Za-z0-9-]{4,30})\s*$/i)
  if (labeled?.[1]) return labeled[1].trim()

  if (isLikelyWayfairSkuToken(s)) return s
  return undefined
}

function extractLeadingSkuFromMoneyRow(line: string): { lineWithoutSku: string; sku?: string } {
  const normalized = line.replace(/\s+/g, ' ').trim()
  if (!normalized) return { lineWithoutSku: line }

  const tokenCount = extractMoneyTokens(normalized).length
  if (tokenCount < 2) return { lineWithoutSku: line }

  const match = normalized.match(/^([A-Za-z0-9-]{6,20})\s+(.+)$/)
  if (!match) return { lineWithoutSku: line }

  const candidateSku = match[1].trim()
  if (!isLikelyWayfairSkuToken(candidateSku)) return { lineWithoutSku: line }

  const remainder = match[2].trim()
  if (!remainder) return { lineWithoutSku: line }

  if (extractMoneyTokens(remainder).length < 2) return { lineWithoutSku: line }

  return {
    lineWithoutSku: remainder,
    sku: candidateSku,
  }
}

function splitSkuPrefixFromDescription(description: string): { sku?: string; cleanedDescription: string } {
  const s = description.replace(/\s+/g, ' ').trim()
  if (!s) return { cleanedDescription: s }

  const m = s.match(/^([A-Za-z0-9-]{6,20})\s+(.+)$/)
  if (!m) return { cleanedDescription: s }

  const possibleSku = m[1].trim()
  if (!isLikelyWayfairSkuToken(possibleSku)) return { cleanedDescription: s }

  return {
    sku: possibleSku,
    cleanedDescription: m[2].trim(),
  }
}

function extractDescriptionFragmentBeforeMoney(line: string): { fragment?: string; remainder: string } {
  if (!line) return { remainder: line }
  const moneyMatch = line.match(/\$?\s*[\d,]+\.\d{2}/)
  if (!moneyMatch || moneyMatch.index === undefined || moneyMatch.index <= 0) return { remainder: line }

  const fragment = line.slice(0, moneyMatch.index).trim()
  const remainder = line.slice(moneyMatch.index).trim()
  if (!fragment || !remainder) return { remainder: line }

  const normalizedFragment = fragment.replace(/\s+/g, ' ').trim()
  if (!/[A-Za-z]/.test(normalizedFragment)) return { remainder: line }

  const alphaTokens = normalizedFragment.split(/\s+/).filter(token => /[A-Za-z]/.test(token))
  if (alphaTokens.length < 2) {
    // Avoid treating standalone SKU tokens or short prefixes (e.g., "SKU") as description fragments.
    if (isLikelyWayfairSkuToken(normalizedFragment)) return { remainder: line }
    if (normalizedFragment.length < 6) return { remainder: line }
  }

  return {
    fragment: normalizedFragment,
    remainder,
  }
}

function isLikelyOrderLevelAttributeLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  if (!normalized) return false
  if (ORDER_LEVEL_ATTRIBUTE_EXACT.has(normalized)) return true
  return ORDER_LEVEL_ATTRIBUTE_PREFIXES.some(prefix => normalized.startsWith(prefix))
}

function extractStandaloneAttributeLine(line: string): {
  key?: 'color' | 'size'
  value: string
  rawLine: string
  label: string
  spillover?: string
} | undefined {
  const s = line.trim()
  if (!s) return undefined

  const isSizeLine = /^Size\s*:/i.test(s)
  // Only treat these as standalone attribute lines (no money columns).
  // Size lines can include decimal measurements that look like money, so allow them.
  if (!isSizeLine && extractMoneyTokens(s).length > 0) return undefined

  // Most Wayfair attribute lines are "Key: Value" (Fabric, Color, Size, Material, Finish, etc.)
  // Keep this conservative to reduce false positives.
  const kvMatch = s.match(/^([A-Za-z][A-Za-z0-9 /&()-]{0,30})\s*:\s*(.+)$/)
  if (kvMatch) {
    const key = kvMatch[1].trim()
    const value = kvMatch[2].trim()
    if (!value) return undefined

    const normalizedKey = key.replace(/\s+/g, ' ').trim()
    const { cleanedValue, spillover } = splitAttributeSpillover(normalizedKey, value)
    const rawLine = `${normalizedKey}: ${cleanedValue}`.trim()
    const lowerKey = normalizedKey.toLowerCase()
    if (lowerKey === 'color') return { key: 'color', value: cleanedValue, rawLine, label: normalizedKey, spillover }
    if (lowerKey === 'size') return { key: 'size', value: cleanedValue, rawLine, label: normalizedKey, spillover }
    return { value: cleanedValue, rawLine, label: normalizedKey, spillover }
  }

  return undefined
}

function appendStandaloneAttributeToLineItem(
  lineItem: WayfairInvoiceLineItem,
  attribute: { key?: 'color' | 'size'; value: string; rawLine: string }
): void {
  const existingLines = lineItem.attributeLines || []
  const normalizedLines = [...existingLines, attribute.rawLine.trim()].filter(Boolean)
  lineItem.attributeLines = Array.from(new Set(normalizedLines))

  if (attribute.key) {
    if (!lineItem.attributes) lineItem.attributes = {}
    lineItem.attributes[attribute.key] = attribute.value
  }
}

function trySplitSizeAttributeLineWithSpillover(line: string): { cleanedSizeLine: string; spillover: string; cleanedSizeValue: string } | undefined {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  const m = s.match(/^Size\s*:\s*(.+)$/i)
  if (!m?.[1]) return undefined

  // Some Wayfair PDFs merge the *next* item's title into the previous item's `Size:` row, e.g.
  // `Size: 138" L x 105.96" W " Vintage Landscape - DCXXXIV "`.
  // We want to:
  // - keep the measurement as a `Size:` attribute line (usually belongs to the previous item)
  // - treat the quoted title as a description seed for the next item (spillover)
  const { cleanedValue, spillover } = splitAttributeSpillover('Size', m[1])
  const normalizedSpillover = normalizeDescriptionFragment(spillover)
  if (!normalizedSpillover) return undefined

  const cleanedSizeValue = cleanedValue.replace(/\s+/g, ' ').trim()
  if (!cleanedSizeValue) return undefined

  return {
    cleanedSizeLine: `Size: ${cleanedSizeValue}`,
    spillover: normalizedSpillover,
    cleanedSizeValue,
  }
}

function extractInlineAttributesFromDescription(description: string): {
  cleanedDescription: string
  attributes?: { color?: string; size?: string }
  attributeLines?: string[]
} {
  let s = description.replace(/\s+/g, ' ').trim()
  const attributes: { color?: string; size?: string } = {}
  const attributeLines: string[] = []

  // Remove stray table header fragments that sometimes get prepended by PDF line reconstruction.
  // Keep conservative: only remove the single word "Delivery" when it is the leading token.
  s = s.replace(/^Delivery\s+/i, '')

  const inlineAttributePattern = /\b(Fabric|Color|Size)\s*:\s*([^:]+?)(?=\s+(?:Fabric|Color|Size)\b|$)/gi
  const inlineMatches = Array.from(s.matchAll(inlineAttributePattern))

  if (inlineMatches.length > 0) {
    for (const match of inlineMatches) {
      const label = match[1]?.trim()
      const rawValue = match[2]?.trim()
      if (!label || !rawValue) continue

      const value = rawValue.replace(/[,\s]+$/g, '').trim()
      if (!value) continue

      attributeLines.push(normalizeAttributeLine(label, value))
      const lower = label.toLowerCase()
      if (lower === 'color') {
        attributes.color = value
      } else if (lower === 'size') {
        // Always capture size attributes - they commonly contain quotes and dimension patterns
        attributes.size = value
      }
    }

    const inlineAttributeCleanupRegex = new RegExp(inlineAttributePattern.source, inlineAttributePattern.flags)
    s = s.replace(inlineAttributeCleanupRegex, ' ').replace(/\s+/g, ' ').trim()
  }

  return {
    cleanedDescription: s,
    attributes: (attributes.color || attributes.size) ? attributes : undefined,
    attributeLines: attributeLines.length > 0 ? Array.from(new Set(attributeLines)) : undefined,
  }
}

function extractTrailingSkuFromDescriptionLine(line: string): { cleanedLine: string; sku?: string } {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return { cleanedLine: s }
  if (extractMoneyTokens(s).length > 0) return { cleanedLine: s }

  const parts = s.split(' ').filter(Boolean)
  if (parts.length < 2) return { cleanedLine: s }

  const last = parts[parts.length - 1]
  if (!isLikelyWayfairSkuToken(last)) return { cleanedLine: s }

  const cleanedLine = parts.slice(0, -1).join(' ').trim()
  return { cleanedLine, sku: last }
}

const CONTINUATION_LEADING_WORDS = new Set([
  'and',
  'for',
  'with',
  'of',
  'set',
  'pair',
  'per',
  'by',
  'in',
  'on',
  'to',
  'the',
])

function isSoftLeadingWordContinuation(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  const cleaned = trimmed.replace(/^[^A-Za-z0-9(]+/, '')
  if (!cleaned) return false
  const firstToken = cleaned.split(/\s+/)[0]?.toLowerCase()
  if (!firstToken) return false
  if (firstToken.startsWith('(')) return true
  return CONTINUATION_LEADING_WORDS.has(firstToken)
}

const lineItemsWithDanglingParenthesis = new WeakSet<WayfairInvoiceLineItem>()

function isLikelyParentheticalLead(line: string): boolean {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return false
  if (s.length > 120) return false
  if (!s.includes('(')) return false
  if (s.includes(')')) return false
  if (/[:@]/.test(s)) return false
  // Reject lines that look like attribute lines (e.g., "Color: Red (Set")
  if (/^[A-Za-z][^:]*:\s*/.test(s)) return false

  const prefix = s.slice(0, s.indexOf('(')).trim()
  if (!prefix) return false
  const prefixWords = prefix.split(/\s+/).filter(Boolean)
  if (prefixWords.length > 4) return false
  if (prefix.length > 30) return false

  return true
}

function shouldPreserveContinuationOnReset(
  allowLooseContinuationForPreviousItem: boolean,
  awaitingPostMoneyContinuation: boolean,
  bufferedDescriptionParts: string[],
  pendingSku: string | undefined,
  pendingAttributes: { color?: string; size?: string },
  pendingAttributeLines: string[],
): boolean {
  if (!allowLooseContinuationForPreviousItem && !awaitingPostMoneyContinuation) return false
  const hasBufferedDescription = bufferedDescriptionParts.some(part => part && part.trim())
  if (hasBufferedDescription) return false
  if (pendingSku) return false
  if (pendingAttributeLines.length > 0) return false
  if (pendingAttributes.color || pendingAttributes.size) return false
  return true
}
function hasUnclosedParenthesis(text: string | undefined): boolean {
  if (!text) return false
  let balance = 0
  for (const char of text) {
    if (char === '(') {
      balance++
    } else if (char === ')') {
      if (balance > 0) balance--
    }
  }
  return balance > 0
}

function isLikelyParentheticalContinuation(line: string): boolean {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return false
  if (s.length > 60) return false
  if (!s.includes(')')) return false
  if (/[:@]/.test(s)) return false
  return /^[A-Za-z0-9()[\] ,./'&-]+$/.test(s)
}

function isLikelyDimensionContinuation(line: string): boolean {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return false
  // Match patterns like "x 30\"", "x 36\"", "x 20 cm", etc.
  return /^x\s+\d+(?:\.\d+)?(?:\s*(?:"|'|inch|inches|cm|mm|ft|feet|in|L|W|H|D))?\s*$/i.test(s)
}

function isLikelyItemPositionIndicator(line: string): boolean {
  const s = line.replace(/\s+/g, ' ').trim()
  if (!s) return false
  // Match patterns like "1 of 3", "2 of 3", "(1 of 2)", etc.
  // These indicate item positioning in a set and shouldn't be part of the description
  return /^\(?\d+\s+of\s+\d+\)?\.?$/.test(s)
}

function parseLineItemFromLine(line: string, bufferedDescription: string): Omit<WayfairInvoiceLineItem, 'shippedOn' | 'section'> | undefined {
  const moneyTokens = extractMoneyTokens(line)
  if (moneyTokens.length < 2) return undefined

  const qty = extractQty(line)
  if (!qty || qty <= 0) return undefined

  // For Wayfair invoices, the first money token is typically unit price and the last is total.
  // We keep additional fields best-effort since templates vary.
  const unitPrice = moneyTokens[0]
  const total = moneyTokens[moneyTokens.length - 1]

  // Often: unitPrice, subtotal, shipping, adjustment, tax, total (or similar)
  const subtotal = moneyTokens.length >= 3 ? moneyTokens[1] : undefined

  // Only treat the second-to-last token as tax when there are enough columns to support it.
  // (For 2-3 tokens, the "second-to-last" is not reliably tax.)
  const tax = moneyTokens.length >= 4 ? moneyTokens[moneyTokens.length - 2] : undefined

  // Middle tokens (excluding unitPrice, subtotal, tax, total) may include shipping + adjustment.
  // Heuristic:
  // - If any middle token is negative (e.g. "($15.96)" -> "-15.96"), treat it as adjustment (stored as ABS value).
  // - Otherwise, if two tokens exist, treat as [shipping, adjustment].
  // - If one token exists and it isn't negative, treat it as shipping.
  let shipping: string | undefined
  let adjustment: string | undefined

  const middleBeforeTax = moneyTokens.length >= 6 ? moneyTokens.slice(2, -2) : (moneyTokens.length === 5 ? moneyTokens.slice(2, -2) : [])
  if (middleBeforeTax.length > 0) {
    const negIdx = middleBeforeTax.findIndex(t => t.startsWith('-'))
    if (negIdx >= 0) {
      adjustment = absMoneyString(middleBeforeTax[negIdx])
      const remaining = middleBeforeTax.filter((_, i) => i !== negIdx)
      shipping = remaining[0]
    } else if (middleBeforeTax.length >= 2) {
      shipping = middleBeforeTax[0]
      adjustment = absMoneyString(middleBeforeTax[1])
    } else {
      shipping = middleBeforeTax[0]
    }
  }

  const description = (bufferedDescription || '').trim() || line.replace(/\s+\$?\s*[\d,]+\.\d{2}.*$/, '').trim()
  if (!description) return undefined

  return {
    description,
    qty,
    unitPrice,
    subtotal,
    shipping,
    adjustment,
    tax,
    total
  }
}

export function parseWayfairInvoiceText(fullText: string): WayfairInvoiceParseResult {
  const warnings: string[] = []

  const invoiceNumber =
    extractFirstMatch(fullText, /\bInvoice\s*(?:Number|#)?\s*[:#]?\s*(\d{6,})\b/i) ||
    extractFirstMatch(fullText, /\bInvoice\s*[:#]?\s*(\d{6,})\b/i)

  const orderDateRaw =
    extractFirstMatch(fullText, /\bOrder\s*Date\s*[:#]?\s*([^\n\r]+)\b/i) ||
    extractFirstMatch(fullText, /\bOrder\s*Placed\s*[:#]?\s*([^\n\r]+)\b/i)
  const orderDate = orderDateRaw ? parseDateToIso(orderDateRaw) : undefined

  const orderTotalRaw = extractFirstMatch(fullText, /\bOrder\s*Total\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/i)
  const subtotalRaw = extractFirstMatch(fullText, /\bSubtotal\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/i)
  const shippingDeliveryRaw = extractFirstMatch(fullText, /\bShipping(?:\s*(?:&|and)\s*Delivery)?\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/i) ||
    extractFirstMatch(fullText, /\bDelivery\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/i)
  const taxTotalRaw = extractFirstMatch(fullText, /\bTax(?:\s*Total)?\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/i)
  const adjustmentsRaw = extractFirstMatch(fullText, /\bAdjustments?\s*[:#]?\s*(\(?-?\$?\s*[\d,]+\.\d{2}\)?)/i)

  const orderTotal = orderTotalRaw ? normalizeMoneyToTwoDecimalString(orderTotalRaw) : undefined
  const subtotal = subtotalRaw ? normalizeMoneyToTwoDecimalString(subtotalRaw) : undefined
  const shippingDeliveryTotal = shippingDeliveryRaw ? normalizeMoneyToTwoDecimalString(shippingDeliveryRaw) : undefined
  const taxTotal = taxTotalRaw ? normalizeMoneyToTwoDecimalString(taxTotalRaw) : undefined
  const adjustmentsTotal = adjustmentsRaw ? normalizeMoneyToTwoDecimalString(adjustmentsRaw) : undefined

  // Calculate: Order Total - Tax Total (business requirement for Calculated Subtotal)
  let calculatedSubtotal: string | undefined
  if (orderTotal && taxTotal) {
    const totalNum = parseMoneyToNumber(orderTotal) || 0
    const taxNum = parseMoneyToNumber(taxTotal) || 0
    const calculated = totalNum - taxNum
    calculatedSubtotal = calculated.toFixed(2)
  }

  if (!invoiceNumber) warnings.push('Could not confidently find an invoice number.')
  if (!orderDate) warnings.push('Could not confidently find an order date; defaulting to today is recommended.')
  if (!orderTotal) warnings.push('Could not confidently find an order total; totals reconciliation will be limited.')

  const lines = normalizeLines(fullText)

  let currentSection: 'shipped' | 'to_be_shipped' | 'unknown' = 'unknown'
  let currentShippedOn: string | undefined
  /**
   * Parser model:
   * - The “money row” (unit price / qty / totals) is the only hard anchor.
   * - Description/SKU/attribute lines are soft-attached to the nearest money row.
   *
   * Important: pdf text extraction can reorder or merge visual rows, so this state machine
   * is intentionally defensive and includes recovery heuristics below.
   */
  let bufferedDescriptionParts: string[] = []
  /**
   * The SKU is often emitted on its own line, but it can appear either:
   * - after the description lines, or
   * - after the money row (ordering drift).
   */
  let pendingSku: string | undefined
  /**
   * We keep both:
   * - `pendingAttributeLines` for display/notes fidelity
   * - `pendingAttributes` for structured fields (color/size)
   */
  let pendingAttributes: { color?: string; size?: string } = {}
  let pendingAttributeLines: string[] = []
  /**
   * After parsing a money row we allow some “loose” continuation lines (bullets, parenthetical fragments, etc.)
   * to be appended to the previous item.
   */
  let allowLooseContinuationForPreviousItem = false
  /**
   * Indicates we’ve just parsed a money row and are still within the trailing block where
   * SKUs/attributes/continuations may arrive slightly out-of-order.
   */
  let awaitingPostMoneyContinuation = false
  /**
   * Pointer to the most recent item created from a money row that did not yet receive a SKU.
   * (pdf extraction can emit the SKU after the money row)
   */
  let lastItemAwaitingSku: WayfairInvoiceLineItem | undefined
  /**
   * Lines that appear after a money row while we are still waiting for a SKU.
   * These can belong either to the previous item (if a delayed SKU follows)
   * or to the next item (if a new money row appears first).
   */
  let deferredPostMoneyLines: string[] = []
  let deferredPostMoneyItem: WayfairInvoiceLineItem | undefined

  const enqueueDescriptionFragment = (fragment?: string) => {
    const normalized = normalizeDescriptionFragment(fragment)
    if (!normalized) return
    allowLooseContinuationForPreviousItem = false
    awaitingPostMoneyContinuation = false
    bufferedDescriptionParts.push(normalized)
    if (bufferedDescriptionParts.length > DESCRIPTION_BUFFER_LIMIT) bufferedDescriptionParts.shift()
  }

  const lineItems: WayfairInvoiceLineItem[] = []

  for (const rawLine of lines) {
    let line = rawLine.trim()

    const shippedOnMatch = line.match(/\bShipped\s+On\s+(.+)\b/i)
    if (shippedOnMatch) {
      currentSection = 'shipped'
      const shippedOnIso = parseDateToIso(shippedOnMatch[1])
      currentShippedOn = shippedOnIso
      bufferedDescriptionParts = []
      pendingSku = undefined
      pendingAttributes = {}
      pendingAttributeLines = []
      allowLooseContinuationForPreviousItem = false
      awaitingPostMoneyContinuation = false
      lastItemAwaitingSku = undefined
      deferredPostMoneyLines = []
      deferredPostMoneyItem = undefined
      continue
    }

    if (/\bItems\s+to\s+be\s+Shipped\b/i.test(line) || /\bTo\s+be\s+Shipped\b/i.test(line)) {
      currentSection = 'to_be_shipped'
      currentShippedOn = undefined
      bufferedDescriptionParts = []
      pendingSku = undefined
      pendingAttributes = {}
      pendingAttributeLines = []
      allowLooseContinuationForPreviousItem = false
      awaitingPostMoneyContinuation = false
      lastItemAwaitingSku = undefined
      deferredPostMoneyLines = []
      deferredPostMoneyItem = undefined
      continue
    }

    // Wayfair invoices often have: [Name line], [SKU line], [attribute lines], [money row].
    // Capture the SKU line and don't let it get merged into the description buffer.
    const standaloneSku = extractStandaloneSkuLine(line)
    if (standaloneSku) {
      // Highest priority: if the last parsed item is explicitly awaiting its SKU, attach it there,
      // even if we've already buffered spillover description text (common when Size lines include
      // a quoted title for the *next* item).
      const previousLineItem = lineItems[lineItems.length - 1]
      if (previousLineItem && lastItemAwaitingSku === previousLineItem && !previousLineItem.sku) {
        if (deferredPostMoneyItem === previousLineItem && deferredPostMoneyLines.length > 0) {
          const baseDescription = previousLineItem.description.trim()
          const joiner = /[-–—]$/.test(baseDescription) ? ' ' : ' - '
          previousLineItem.description = `${baseDescription}${joiner}${deferredPostMoneyLines.join(' ').trim()}`.trim()
          deferredPostMoneyLines = []
          deferredPostMoneyItem = undefined
        }
        previousLineItem.sku = standaloneSku
        lastItemAwaitingSku = undefined
        continue
      }

      if (bufferedDescriptionParts.length > 0) {
        pendingSku = standaloneSku
        allowLooseContinuationForPreviousItem = false
        awaitingPostMoneyContinuation = false
      } else {
        if (previousLineItem && !previousLineItem.sku) {
          previousLineItem.sku = standaloneSku
          if (lastItemAwaitingSku === previousLineItem) lastItemAwaitingSku = undefined
        } else {
          pendingSku = standaloneSku
          allowLooseContinuationForPreviousItem = false
          awaitingPostMoneyContinuation = false
        }
      }
      continue
    }

    const standaloneAttr = extractStandaloneAttributeLine(line)
    if (standaloneAttr) {
      const attrSpillover = normalizeDescriptionFragment(standaloneAttr.spillover)
      if (isLikelyOrderLevelAttributeLabel(standaloneAttr.label)) {
        bufferedDescriptionParts = []
        pendingSku = undefined
        pendingAttributes = {}
        pendingAttributeLines = []
        allowLooseContinuationForPreviousItem = false
        awaitingPostMoneyContinuation = false
        enqueueDescriptionFragment(attrSpillover)
        continue
      }

      const hasPendingDescription = bufferedDescriptionParts.some(part => part && part.trim())
      const hasPendingSku = Boolean(pendingSku)
      const hasPendingAttrState = pendingAttributeLines.length > 0 || !!pendingAttributes.color || !!pendingAttributes.size

      // If we *just* parsed an item (awaitingPostMoneyContinuation), prefer attaching attributes
      // to the previous item, even if the next SKU was encountered slightly early due to PDF token ordering.
      if (!hasPendingDescription && awaitingPostMoneyContinuation) {
        const previousLineItem = lineItems[lineItems.length - 1]
        if (previousLineItem) {
          appendStandaloneAttributeToLineItem(previousLineItem, standaloneAttr)
          enqueueDescriptionFragment(attrSpillover)
          continue
        }
      }

      if (!hasPendingDescription && !hasPendingSku && !hasPendingAttrState) {
        const previousLineItem = lineItems[lineItems.length - 1]
        if (previousLineItem) {
          appendStandaloneAttributeToLineItem(previousLineItem, standaloneAttr)
          enqueueDescriptionFragment(attrSpillover)
          continue
        }
      }

      awaitingPostMoneyContinuation = false
      pendingAttributeLines.push(standaloneAttr.rawLine)
      if (standaloneAttr.key) pendingAttributes[standaloneAttr.key] = standaloneAttr.value
      enqueueDescriptionFragment(attrSpillover)
      continue
    }

    if (isLikelyWayfairTableHeaderLine(line)) {
      const preserveContinuation = shouldPreserveContinuationOnReset(
        allowLooseContinuationForPreviousItem,
        awaitingPostMoneyContinuation,
        bufferedDescriptionParts,
        pendingSku,
        pendingAttributes,
        pendingAttributeLines,
      )
      const payload = stripLeadingMergedWayfairTableHeader(line)
      bufferedDescriptionParts = []
      pendingSku = undefined
      pendingAttributes = {}
      pendingAttributeLines = []
      if (!preserveContinuation) {
        allowLooseContinuationForPreviousItem = false
        awaitingPostMoneyContinuation = false
      }
      if (payload) {
        line = payload
        // fall through and process payload as a normal line
      } else {
        continue
      }
    }

    // Skip obvious header/summary lines to avoid false positives.
    if (
      /\b(Order Total|Subtotal|Tax Total|Tax|Adjustments?|Invoice|Order Date)\b/i.test(line) ||
      /\b(Ship(?:ping)?|Handling|Payment|Bill(?:ing)?|Address)\b/i.test(line)
    ) {
      const preserveContinuation = shouldPreserveContinuationOnReset(
        allowLooseContinuationForPreviousItem,
        awaitingPostMoneyContinuation,
        bufferedDescriptionParts,
        pendingSku,
        pendingAttributes,
        pendingAttributeLines,
      )
      bufferedDescriptionParts = []
      pendingSku = undefined
      pendingAttributes = {}
      pendingAttributeLines = []
      if (!preserveContinuation) {
        allowLooseContinuationForPreviousItem = false
        awaitingPostMoneyContinuation = false
      }
      continue
    }

    const hasPendingDescription = bufferedDescriptionParts.some(part => part && part.trim())
    const previousItem = lineItems[lineItems.length - 1]
    
    // Check for continuation BEFORE extracting SKU, so continuation lines aren't misclassified
    const previousHasDanglingParenthesis = !!previousItem && lineItemsWithDanglingParenthesis.has(previousItem)
    const looksLikeParentheticalTail =
      !!previousItem &&
      previousHasDanglingParenthesis &&
      isLikelyParentheticalContinuation(line)
    const looksLikeParentheticalLead =
      !!previousItem &&
      previousHasDanglingParenthesis &&
      (allowLooseContinuationForPreviousItem || awaitingPostMoneyContinuation) &&
      isLikelyParentheticalLead(line)
    const startsWithBullet = /^[-–•]/.test(line)
    const looksLikeSoftContinuation =
      !!previousItem &&
      (allowLooseContinuationForPreviousItem || awaitingPostMoneyContinuation) &&
      isSoftLeadingWordContinuation(line)
    // Handle trailing bullet fragments, dangling parenthetical tails, or soft continuations belonging to the previous item.
    const canAppendToPreviousDescription =
      !hasPendingDescription &&
      !pendingSku &&
      Boolean(previousItem) &&
      extractMoneyTokens(line).length === 0 &&
      !isLikelyItemPositionIndicator(line) &&
      (
        startsWithBullet ||
        looksLikeParentheticalTail ||
        looksLikeParentheticalLead ||
        looksLikeSoftContinuation
      )

    if (canAppendToPreviousDescription && previousItem) {
      const cleanedFragment = startsWithBullet ? line.replace(/^[-–•]\s*/, '').trim() : line.trim()
      if (cleanedFragment) {
        const baseDescription = previousItem.description.trim()
        const joiner = (looksLikeParentheticalTail || looksLikeParentheticalLead)
          ? ' '
          : /[-–—]$/.test(baseDescription)
            ? ' '
            : ' - '
        previousItem.description = `${baseDescription}${joiner}${cleanedFragment}`.trim()
        if (previousItem !== lastItemAwaitingSku) {
          awaitingPostMoneyContinuation = false
        }
        if (hasUnclosedParenthesis(previousItem.description)) {
          lineItemsWithDanglingParenthesis.add(previousItem)
          // Keep allowLooseContinuationForPreviousItem true so next line (e.g., "of 2)") can also be appended
        } else {
          lineItemsWithDanglingParenthesis.delete(previousItem)
          allowLooseContinuationForPreviousItem = false
        }
      }
      continue
    }

    const shouldDeferPostMoneyLine =
      !!previousItem &&
      previousItem === lastItemAwaitingSku &&
      awaitingPostMoneyContinuation &&
      extractMoneyTokens(line).length === 0 &&
      !startsWithBullet &&
      !looksLikeParentheticalTail &&
      !looksLikeParentheticalLead &&
      !looksLikeSoftContinuation &&
      !isLikelyItemPositionIndicator(line)

    if (shouldDeferPostMoneyLine) {
      deferredPostMoneyLines.push(line.trim())
      deferredPostMoneyItem = previousItem
      continue
    }

    // Handle dimension continuation lines (e.g., "x 30\"", "x 36\"") that should be appended to Size attributes
    const looksLikeDimensionContinuation =
      !!previousItem &&
      previousItem.attributeLines?.some(l => /^Size:/i.test(l)) &&
      extractMoneyTokens(line).length === 0 &&
      isLikelyDimensionContinuation(line)

    if (looksLikeDimensionContinuation && previousItem && previousItem.attributeLines) {
      const sizeLineIdx = previousItem.attributeLines.findIndex(l => /^Size:/i.test(l))
      if (sizeLineIdx >= 0) {
        const cleanedFragment = line.trim()
        previousItem.attributeLines[sizeLineIdx] = `${previousItem.attributeLines[sizeLineIdx]} ${cleanedFragment}`
        if (previousItem.attributes?.size) {
          previousItem.attributes.size = `${previousItem.attributes.size} ${cleanedFragment}`
        }
      }
      continue
    }

    if (!pendingSku) {
      const skuFromMoneyRow = extractLeadingSkuFromMoneyRow(line)
      if (skuFromMoneyRow.sku) {
        pendingSku = skuFromMoneyRow.sku
        line = skuFromMoneyRow.lineWithoutSku
      }
    }

    // Capture description fragments that were merged in front of the money columns on the same line.
    const preMoneyFragment = extractDescriptionFragmentBeforeMoney(line)
    if (preMoneyFragment.fragment) {
      allowLooseContinuationForPreviousItem = false
      awaitingPostMoneyContinuation = false
      bufferedDescriptionParts.push(preMoneyFragment.fragment)
      if (bufferedDescriptionParts.length > DESCRIPTION_BUFFER_LIMIT) bufferedDescriptionParts.shift()
      line = preMoneyFragment.remainder
    }

    // Accumulate possible multi-line descriptions, then parse when we see a numeric row.
    const bufferedDescriptionText = bufferedDescriptionParts.join(' ').trim()
    if (
      bufferedDescriptionText &&
      hasUnclosedParenthesis(bufferedDescriptionText) &&
      /^\d+\)/.test(line) &&
      extractMoneyTokens(line).length >= 2
    ) {
      const closeMatch = line.match(/^(\d+\))/)
      if (closeMatch?.[1]) {
        bufferedDescriptionParts.push(closeMatch[1])
      }
    }
    const bufferedDescriptionTextForParse = bufferedDescriptionParts.join(' ').trim()
    const deferredDescriptionText = deferredPostMoneyLines.join(' ').trim()
    const maybeParsed = parseLineItemFromLine(line, bufferedDescriptionTextForParse || deferredDescriptionText)
    if (maybeParsed) {
      const usedDeferredDescription = !bufferedDescriptionTextForParse && deferredPostMoneyLines.length > 0
      const extracted = extractInlineAttributesFromDescription(maybeParsed.description)
      const skuSplit = pendingSku
        ? { sku: pendingSku, cleanedDescription: extracted.cleanedDescription }
        : splitSkuPrefixFromDescription(extracted.cleanedDescription)

      const mergedAttributes = {
        ...extracted.attributes,
        ...pendingAttributes,
      }
      const allAttributeLines = [
        ...(pendingAttributeLines || []),
        ...(extracted.attributeLines || []),
      ].map(l => l.trim()).filter(Boolean)

      // Recovery: if a PDF merged the next item's title into a `Size:` attribute line,
      // we can split it back out and use the spillover as the item's description seed.
      //
      // Why this exists:
      // - Our primary description buffer depends on line ordering.
      // - In some extractions, the title is not emitted as its own line; it only exists inside a `Size:` row.
      // - Without this, we can produce `description: ""` for the next SKU.
      let recoveredDescription: string | undefined
      if (!skuSplit.cleanedDescription.trim() && allAttributeLines.length > 0) {
        for (let i = 0; i < allAttributeLines.length; i++) {
          const candidate = allAttributeLines[i]
          if (!/^Size\s*:/i.test(candidate)) continue
          const split = trySplitSizeAttributeLineWithSpillover(candidate)
          if (!split) continue

          recoveredDescription = split.spillover
          allAttributeLines[i] = split.cleanedSizeLine
          mergedAttributes.size = mergedAttributes.size || split.cleanedSizeValue
          break
        }
      }

      const dedupedAttributeLines = allAttributeLines.length > 0
        ? Array.from(new Set(allAttributeLines))
        : undefined

      const finalDescription = (skuSplit.cleanedDescription.trim() || recoveredDescription || '').trim()

      const newItem: WayfairInvoiceLineItem = {
        ...maybeParsed,
        sku: skuSplit.sku,
        description: finalDescription,
        attributeLines: dedupedAttributeLines,
        attributes: (mergedAttributes.color || mergedAttributes.size) ? mergedAttributes : undefined,
        shippedOn: currentShippedOn,
        section: currentSection,
      }

      // If we recovered the description from a `Size:` spillover, the cleaned size almost certainly belongs
      // to the *previous* item row (the size line visually sits under the previous SKU). Move it back when safe.
      if (recoveredDescription && newItem.attributeLines?.length) {
        const previousItem = lineItems[lineItems.length - 1]
        const sizeLineIdx = newItem.attributeLines.findIndex(l => /^Size\s*:/i.test(l))
        const sizeLine = sizeLineIdx >= 0 ? newItem.attributeLines[sizeLineIdx] : undefined

        const previousAlreadyHasSize = Boolean(previousItem?.attributeLines?.some(l => /^Size\s*:/i.test(l)) || previousItem?.attributes?.size)
        const canTransferToPrevious =
          Boolean(previousItem) &&
          Boolean(sizeLine) &&
          !previousAlreadyHasSize &&
          previousItem?.section === currentSection

        if (canTransferToPrevious && previousItem && sizeLine) {
          appendStandaloneAttributeToLineItem(previousItem, { key: 'size', value: sizeLine.replace(/^Size\s*:\s*/i, '').trim(), rawLine: sizeLine })
          const nextAttributeLines = newItem.attributeLines.filter((_, idx) => idx !== sizeLineIdx)
          newItem.attributeLines = nextAttributeLines.length > 0 ? nextAttributeLines : undefined
          if (newItem.attributes?.size) {
            delete newItem.attributes.size
            if (!newItem.attributes.color && !newItem.attributes.size) {
              newItem.attributes = undefined
            }
          }
        }
      }

      lineItems.push(newItem)
      lastItemAwaitingSku = newItem.sku ? undefined : newItem
      const descriptionSource = bufferedDescriptionText || maybeParsed.description
      if (hasUnclosedParenthesis(descriptionSource)) {
        lineItemsWithDanglingParenthesis.add(newItem)
      } else {
        lineItemsWithDanglingParenthesis.delete(newItem)
      }
      allowLooseContinuationForPreviousItem = true
      awaitingPostMoneyContinuation = true
      bufferedDescriptionParts = []
      pendingSku = undefined
      pendingAttributes = {}
      pendingAttributeLines = []
      if (usedDeferredDescription) {
        deferredPostMoneyLines = []
        deferredPostMoneyItem = undefined
      }
      continue
    }

    // Buffer text that looks like a description line (avoid buffering lines that are mostly numbers).
    if (!/^\$?\s*[\d,]+\.\d{2}\s*$/.test(line) && !/^\d+$/.test(line)) {
      // If PDF extraction merged a trailing SKU onto the end of the description line, split it off.
      if (!pendingSku) {
        const trailingSku = extractTrailingSkuFromDescriptionLine(line)
        if (trailingSku.sku) {
          pendingSku = trailingSku.sku
          line = trailingSku.cleanedLine
          awaitingPostMoneyContinuation = false
        }
      }

      // If PDF extraction merged SKU + name into one line, split and keep SKU separately.
      if (!pendingSku) {
        const split = splitSkuPrefixFromDescription(line)
        if (split.sku) {
          pendingSku = split.sku
          allowLooseContinuationForPreviousItem = false
          awaitingPostMoneyContinuation = false
          bufferedDescriptionParts.push(split.cleanedDescription)
          if (bufferedDescriptionParts.length > DESCRIPTION_BUFFER_LIMIT) bufferedDescriptionParts.shift()
          continue
        }
      }

      // If PDF extraction merged inline attribute key/value pairs into the description line, strip them and capture.
      const inline = extractInlineAttributesFromDescription(line)
      if (inline.attributeLines) {
        awaitingPostMoneyContinuation = false
        pendingAttributeLines.push(...inline.attributeLines)
      }
      if (inline.attributes?.color) pendingAttributes.color = inline.attributes.color
      if (inline.attributes?.size) pendingAttributes.size = inline.attributes.size

      let descriptionForBuffer = inline.cleanedDescription
      if (!pendingSku && descriptionForBuffer) {
        const trailingSkuAfterInline = extractTrailingSkuFromDescriptionLine(descriptionForBuffer)
        if (trailingSkuAfterInline.sku) {
          pendingSku = trailingSkuAfterInline.sku
          descriptionForBuffer = trailingSkuAfterInline.cleanedLine
          awaitingPostMoneyContinuation = false
        }
      }

      if (descriptionForBuffer) {
        allowLooseContinuationForPreviousItem = false
        awaitingPostMoneyContinuation = false
        bufferedDescriptionParts.push(descriptionForBuffer)
        if (bufferedDescriptionParts.length > DESCRIPTION_BUFFER_LIMIT) bufferedDescriptionParts.shift()
      }
    }
  }

  if (lineItems.length === 0) {
    warnings.push('No line items were detected. The PDF may be image-based or the template changed.')
  }

  const sumLineTotals = lineItems.reduce((sum, li) => sum + (parseMoneyToNumber(li.total) || 0), 0)
  if (orderTotal) {
    const orderTotalNum = parseMoneyToNumber(orderTotal) || 0
    const diff = Math.abs(sumLineTotals - orderTotalNum)
    if (diff > 0.05) {
      warnings.push(`Line totals ($${sumLineTotals.toFixed(2)}) do not match order total ($${orderTotalNum.toFixed(2)}). Difference: $${diff.toFixed(2)}.`)
    }
  }

  return {
    invoiceNumber,
    orderDate,
    orderTotal,
    subtotal,
    shippingDeliveryTotal,
    taxTotal,
    adjustmentsTotal,
    calculatedSubtotal,
    lineItems,
    warnings,
  }
}


