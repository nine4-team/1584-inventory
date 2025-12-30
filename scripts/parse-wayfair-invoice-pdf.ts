import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { buildTextLinesFromPdfTextItems } from '@/utils/pdfTextExtraction'
import { parseWayfairInvoiceText } from '@/utils/wayfairInvoiceParser'
import { parseMoneyToNumber } from '@/utils/money'

function normalizeLinesForDebug(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function findExistingPdfPath(repoRoot: string, explicitPath?: string): string {
  const candidates = [
    explicitPath,
    path.resolve(repoRoot, 'Invoice_4386128736.pdf'),
    path.resolve(repoRoot, 'dev_docs', 'Invoice_4386128736.pdf'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-sync
      require('node:fs').accessSync(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  return candidates[0] || path.resolve(repoRoot, 'Invoice_4386128736.pdf')
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')

  const cliPdfArg = process.argv.slice(2).find(arg => arg && !arg.startsWith('-'))
  const pdfPath = findExistingPdfPath(repoRoot, cliPdfArg)
  const pdfBuffer = await fs.readFile(pdfPath)
  // pdfjs-dist (Node) requires a plain Uint8Array, not a Buffer.
  const pdfBytes = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)

  const loadingTask = getDocument({
    data: pdfBytes,
    // In Node scripts we avoid configuring the worker; this keeps the script simple/reliable.
    disableWorker: true,
  } as any)

  const pdf = await loadingTask.promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = buildTextLinesFromPdfTextItems(content.items as any)
    pages.push(pageText)
  }

  const fullText = pages.join('\n\n')
  const result = parseWayfairInvoiceText(fullText)

  const debugLines = normalizeLinesForDebug(fullText)
  const debugNeedles = ['W116993316', 'W110704773', 'Items to be Shipped']
  const debugWindows = debugNeedles.map(needle => {
    const idx = debugLines.findIndex(l => l.includes(needle))
    if (idx < 0) return { needle, idx, window: [] as string[] }
    const start = Math.max(0, idx - 8)
    const end = Math.min(debugLines.length, idx + 12)
    return { needle, idx, window: debugLines.slice(start, end) }
  })

  const debugLineMatches = {
    size138Lines: debugLines.filter(l => l.includes('Size: 138')),
    vintageDcxxxivLines: debugLines.filter(l => l.includes('Vintage Landscape - DCXXXIV')),
  }

  const sumLineTotals = result.lineItems.reduce((sum, li) => sum + (parseMoneyToNumber(li.total) || 0), 0)
  const orderTotalNum = result.orderTotal ? (parseMoneyToNumber(result.orderTotal) || 0) : 0

  const shippedCount = result.lineItems.filter(li => li.section === 'shipped').length
  const toBeShippedCount = result.lineItems.filter(li => li.section === 'to_be_shipped').length
  const unknownCount = result.lineItems.filter(li => li.section === 'unknown').length

  const topItems = result.lineItems.slice(0, 10).map(li => ({
    shippedOn: li.shippedOn,
    section: li.section,
    qty: li.qty,
    unitPrice: li.unitPrice,
    total: li.total,
    sku: li.sku,
    description: li.description.length > 80 ? `${li.description.slice(0, 77)}...` : li.description,
  }))

  const debugTargetSkus = ['W116993316', 'W110704773']
  const debugTargetLineItems = debugTargetSkus.map(sku => {
    const match = result.lineItems.find(li => li.sku === sku)
    return {
      sku,
      found: Boolean(match),
      section: match?.section,
      shippedOn: match?.shippedOn,
      description: match?.description,
      attributeLines: match?.attributeLines,
    }
  })

  const skuCount = result.lineItems.filter(li => Boolean(li.sku && li.sku.trim())).length
  const skuSamples = result.lineItems
    .filter(li => Boolean(li.sku && li.sku.trim()))
    .slice(0, 10)
    .map(li => ({
      sku: li.sku,
      description: li.description.length > 80 ? `${li.description.slice(0, 77)}...` : li.description,
    }))

  const summary = {
    invoiceNumber: result.invoiceNumber,
    orderDate: result.orderDate,
    orderTotal: result.orderTotal,
    lineItemsDetected: result.lineItems.length,
    sections: { shipped: shippedCount, to_be_shipped: toBeShippedCount, unknown: unknownCount },
    skuCoverage: { withSku: skuCount, withoutSku: result.lineItems.length - skuCount },
    totals: {
      sumLineTotals: Number(sumLineTotals.toFixed(2)),
      orderTotal: Number(orderTotalNum.toFixed(2)),
      diff: Number(Math.abs(sumLineTotals - orderTotalNum).toFixed(2)),
    },
    warnings: result.warnings,
    debug: {
      pdfPath,
      debugWindows,
      debugTargetLineItems,
      debugLineMatches,
    },
    sampleLineItems: topItems,
    sampleSkus: skuSamples,
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2))
}

void main()


