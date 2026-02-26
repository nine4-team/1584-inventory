/**
 * Parses itemized receipt text (e.g. from HomeGoods / TJ Maxx receipts)
 * into structured item data ready for creation.
 *
 * Expected line format:
 *   DEPT - DESCRIPTION SKU $PRICE T
 *   e.g. "53 - ACCENT FURNISH 252972 $129.99 T"
 */

export type ParsedReceiptItem = {
  name: string
  sku: string
  priceCents: number
}

export type ParseReceiptResult = {
  items: ParsedReceiptItem[]
  skippedLines: string[]
}

/**
 * Regex breakdown:
 *   ^\d+\s*-\s*       department number + dash (discarded)
 *   (.+?)             description (non-greedy)
 *   \s+(\d{4,})       SKU (4+ digit number)
 *   \s+\$?([\d,]+\.\d{2})  price with optional $ and optional commas
 *   \s*T?\s*$          optional taxable flag
 */
const LINE_RE = /^\d+\s*-\s*(.+?)\s+(\d{4,})\s+\$?([\d,]+\.\d{2})\s*T?\s*$/

function priceToCents(priceStr: string): number {
  const cleaned = priceStr.replace(/,/g, '')
  return Math.round(Number.parseFloat(cleaned) * 100)
}

export function parseReceiptList(text: string): ParseReceiptResult {
  const items: ParsedReceiptItem[] = []
  const skippedLines: string[] = []

  const lines = text.split('\n')

  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) continue

    const match = line.match(LINE_RE)
    if (match) {
      items.push({
        name: match[1].trim(),
        sku: match[2],
        priceCents: priceToCents(match[3]),
      })
    } else {
      skippedLines.push(line)
    }
  }

  return { items, skippedLines }
}
