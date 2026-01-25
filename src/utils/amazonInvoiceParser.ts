import { normalizeMoneyToTwoDecimalString, parseMoneyToNumber } from '@/utils/money'

export type AmazonInvoiceLineItem = {
  description: string
  qty: number
  unitPrice?: string
  total: string
  shippedOn?: string
}

export type AmazonInvoiceParseResult = {
  orderNumber?: string
  orderPlacedDate?: string // YYYY-MM-DD
  grandTotal?: string
  projectCode?: string
  paymentMethod?: string
  tax?: string
  shipping?: string
  lineItems: AmazonInvoiceLineItem[]
  warnings: string[]
}

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

  // 2) Month DD, YYYY (e.g., January 15, 2026)
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

function extractLastMatch(text: string, regex: RegExp): string | undefined {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
  const globalRegex = new RegExp(regex.source, flags)
  let match
  let lastMatch
  while ((match = globalRegex.exec(text)) !== null) {
    lastMatch = match
  }
  return lastMatch?.[1]?.trim()
}

function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractMoneyTokens(line: string): string[] {
  // Capture tokens like "$12.34", "-$12.34", "(12.34)", "($12.34)"
  return (line.match(/\$?\d{1,3}(?:,\d{3})*\.\d{2}/g) || [])
    .map(t => normalizeMoneyToTwoDecimalString(t) || '')
    .filter(Boolean)
}

function isAmazonInvoice(fullText: string): boolean {
  const hasOrderNumber = /Amazon\.com order number:/i.test(fullText)
  const hasFinalDetails = /Final Details for Order #/i.test(fullText)
  const hasOrderPlacedAndAmazon = /Order Placed:/i.test(fullText) && /Amazon\.com/i.test(fullText)
  
  return hasOrderNumber || hasFinalDetails || hasOrderPlacedAndAmazon
}

const IGNORE_LINES = [
  /^Sold by:/i,
  /^Condition:/i,
  /^Business Price$/i,
  /^Items Ordered Price$/i,
  /^Shipping Address:/i,
  /^Shipping Speed:/i,
  /^Item\(s\) Subtotal:/i,
  /^Shipping & Handling:/i,
  /^Total before tax:/i,
  /^(Sales Tax|Estimated Tax):/i,
  /^Total for This Shipment:/i,
  /^Payment information$/i,
  /^Payment Method:/i,
  /^Billing address$/i,
  /^Credit Card transactions/i,
  /^-- \d+ of \d+ --$/,
  /^Order Total:/i,
  /^Grand Total:/i,
]

function shouldIgnoreLine(line: string): boolean {
  return IGNORE_LINES.some(pattern => pattern.test(line))
}

export function parseAmazonInvoiceText(fullText: string): AmazonInvoiceParseResult {
  const warnings: string[] = []

  // Vendor signature check
  if (!isAmazonInvoice(fullText)) {
    return {
      lineItems: [],
      warnings: ['Not an Amazon invoice'],
    }
  }

  // Parse header fields
  const orderNumber =
    extractFirstMatch(fullText, /Amazon\.com order number:\s*([^\n\r]+)/i) ||
    extractFirstMatch(fullText, /Final Details for Order #([^\n\r]+)/i)

  const orderPlacedDateRaw = extractFirstMatch(fullText, /Order Placed:\s*([^\n\r]+)/i)
  const orderPlacedDate = orderPlacedDateRaw ? parseDateToIso(orderPlacedDateRaw) : undefined

  const grandTotalRaw =
    extractFirstMatch(fullText, /Grand Total:\s*\$?\s*([\d,]+\.\d{2})/i) ||
    extractFirstMatch(fullText, /Order Total:\s*\$?\s*([\d,]+\.\d{2})/i)
  const grandTotal = grandTotalRaw ? normalizeMoneyToTwoDecimalString(grandTotalRaw) : undefined

  const projectCodeRaw = extractFirstMatch(fullText, /Project code:\s*([^\n\r]+)/i)
  const projectCode = projectCodeRaw?.trim() || undefined

  const paymentMethodMatch = fullText.match(/(Visa|Mastercard|American Express|Discover)\s*\|\s*Last digits:\s*(\d{4})/i)
  const paymentMethod = paymentMethodMatch 
    ? `${paymentMethodMatch[1]} | Last digits: ${paymentMethodMatch[2]}`.trim()
    : undefined

  const taxRaw = extractFirstMatch(fullText, /Estimated Tax:\s*\$?\s*([\d,]+\.\d{2})/i)
  const tax = taxRaw ? normalizeMoneyToTwoDecimalString(taxRaw) : undefined

  const shippingRaw = extractLastMatch(fullText, /Shipping & Handling:\s*\$?\s*([\d,]+\.\d{2})/i)
  const shipping = shippingRaw ? normalizeMoneyToTwoDecimalString(shippingRaw) : undefined

  if (!orderNumber) warnings.push('Could not confidently find an order number.')
  if (!orderPlacedDate) warnings.push('Could not confidently find an order date; defaulting to today is recommended.')
  if (!grandTotal) warnings.push('Missing order total')

  const lines = normalizeLines(fullText)

  // Split by shipments and parse line items
  const lineItems: AmazonInvoiceLineItem[] = []
  let currentShippedOn: string | undefined
  let currentItemStart: number | undefined
  let currentDescriptionParts: string[] = []
  let currentQty: number | undefined
  let currentUnitPrice: string | undefined
  let currentDescriptionLocked = false
  let isInAddressBlock = false

  const addressBlockStart = /^(Shipping Address|Billing address):?/i
  const addressBlockEnd = /^(Shipping Speed:|Item\(s\) Subtotal:|Total before tax:|Sales Tax:|Estimated Tax:|Total for This Shipment:|Payment information$|Credit Card transactions|Shipped on|-- \d+ of \d+ --$)/i

  const finalizeCurrentItem = () => {
    if (currentItemStart === undefined || currentQty === undefined || currentDescriptionParts.length === 0) {
      return
    }

    const description = currentDescriptionParts.join(' ').trim()
    if (!description) return

    // Find unit price if not already found
    if (!currentUnitPrice) {
      for (let j = currentItemStart + 1; j < lines.length; j++) {
        // Stop if we hit the next item or shipment
        if (lines[j].match(/^\d+\s+of:/) || lines[j].match(/Shipped on/i)) {
          break
        }
        
        const moneyTokens = extractMoneyTokens(lines[j])
        if (moneyTokens.length > 0 && !shouldIgnoreLine(lines[j])) {
          // Check if this line is mostly just a price
          const lineWithoutMoney = lines[j].replace(/\$?\d{1,3}(?:,\d{3})*\.\d{2}/g, '').trim()
          if (lineWithoutMoney.length < 15) {
            currentUnitPrice = moneyTokens[0]
            break
          }
        }
      }
    }

    if (currentUnitPrice) {
      const unitPriceNum = parseMoneyToNumber(currentUnitPrice) || 0
      const totalNum = unitPriceNum * currentQty
      const total = normalizeMoneyToTwoDecimalString(String(totalNum)) || '0.00'
      lineItems.push({
        description,
        qty: currentQty,
        unitPrice: currentUnitPrice,
        total,
        shippedOn: currentShippedOn,
      })
    } else {
      warnings.push(`Could not find unit price for item: ${description.slice(0, 50)}`)
    }

    // Reset for next item
    currentItemStart = undefined
    currentDescriptionParts = []
    currentQty = undefined
    currentUnitPrice = undefined
    currentDescriptionLocked = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (addressBlockStart.test(line)) {
      isInAddressBlock = true
      continue
    }

    if (isInAddressBlock) {
      if (addressBlockEnd.test(line) || /^(\d+)\s+of:\s*(.+)$/.test(line)) {
        isInAddressBlock = false
      } else {
        continue
      }
    }

    // Check for shipment boundary
    const shippedOnMatch = line.match(/Shipped on\s+(.+)/i)
    if (shippedOnMatch) {
      finalizeCurrentItem()
      currentShippedOn = shippedOnMatch[1] ? parseDateToIso(shippedOnMatch[1]) : undefined
      continue
    }

    // Check for item start pattern: "1 of: Description..."
    const itemStartMatch = line.match(/^(\d+)\s+of:\s*(.+)$/)
    if (itemStartMatch) {
      finalizeCurrentItem()

      // Start new item
      currentQty = Number.parseInt(itemStartMatch[1], 10)
      let descriptionPart = itemStartMatch[2].trim()
      currentUnitPrice = undefined

      // Check if description ends with a price (e.g. "... Product Name $12.34")
      const priceAtEndMatch = descriptionPart.match(/(\$?\d{1,3}(?:,\d{3})*\.\d{2})\s*$/)
      if (priceAtEndMatch) {
        currentUnitPrice = normalizeMoneyToTwoDecimalString(priceAtEndMatch[1])
        // Remove the price from the description
        descriptionPart = descriptionPart.substring(0, priceAtEndMatch.index).trim()
      }

      currentDescriptionParts = [descriptionPart]
      currentItemStart = i
      currentDescriptionLocked = false
      continue
    }

    // Accumulate description lines (skip ignored lines)
    if (currentItemStart !== undefined && !shouldIgnoreLine(line) && !currentDescriptionLocked) {
      // Check if this line has ONLY a money token (likely the unit price)
      const moneyTokens = extractMoneyTokens(line)
      const lineWithoutMoney = line.replace(/\$?\d{1,3}(?:,\d{3})*\.\d{2}/g, '').trim()
      
      // If line contains only a price (or price + minimal text), it's the price line
      if (!currentUnitPrice && moneyTokens.length > 0 && lineWithoutMoney.length < 15) {
        currentUnitPrice = moneyTokens[0]
        currentDescriptionLocked = true
        continue
      }

      // Add to description if it looks like text
      if (line.length > 0 && !/^\d+$/.test(line)) {
        currentDescriptionParts.push(line)
      }
    }
  }

  // Finalize last item
  finalizeCurrentItem()

  if (lineItems.length === 0) {
    warnings.push('No line items were detected. The PDF may be image-based or the template changed.')
  }

  // Validate totals
  if (grandTotal) {
    const sumLineTotals = lineItems.reduce((sum, li) => sum + (parseMoneyToNumber(li.total) || 0), 0)
    const taxNum = tax ? (parseMoneyToNumber(tax) || 0) : 0
    const shippingNum = shipping ? (parseMoneyToNumber(shipping) || 0) : 0
    const calculatedTotal = sumLineTotals + taxNum + shippingNum
    
    const grandTotalNum = parseMoneyToNumber(grandTotal) || 0
    const diff = Math.abs(calculatedTotal - grandTotalNum)
    if (diff > 0.05) {
      warnings.push(`Calculated total ($${calculatedTotal.toFixed(2)}) does not match order total ($${grandTotalNum.toFixed(2)}) (diff $${diff.toFixed(2)})`)
    }
  }

  return {
    orderNumber,
    orderPlacedDate,
    grandTotal,
    projectCode,
    paymentMethod,
    tax,
    shipping,
    lineItems,
    warnings,
  }
}
