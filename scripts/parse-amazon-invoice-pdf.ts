import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { buildTextLinesFromPdfTextItems } from '@/utils/pdfTextExtraction'
import { parseAmazonInvoiceText } from '@/utils/amazonInvoiceParser'
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
    path.resolve(repoRoot, 'dev_docs', 'invoices', 'amazon', 'example_amazon_invoice.pdf'),
    path.resolve(repoRoot, 'example_amazon_invoice.pdf'),
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

  return candidates[0] || path.resolve(repoRoot, 'dev_docs', 'invoices', 'amazon', 'example_amazon_invoice.pdf')
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
  const result = parseAmazonInvoiceText(fullText)

  const debugLines = normalizeLinesForDebug(fullText)

  const sumLineTotals = result.lineItems.reduce((sum, li) => sum + (parseMoneyToNumber(li.total) || 0), 0)
  const grandTotalNum = result.grandTotal ? (parseMoneyToNumber(result.grandTotal) || 0) : 0

  const topItems = result.lineItems.slice(0, 10).map(li => ({
    shippedOn: li.shippedOn,
    qty: li.qty,
    unitPrice: li.unitPrice,
    total: li.total,
    description: li.description.length > 80 ? `${li.description.slice(0, 77)}...` : li.description,
  }))

  const summary = {
    orderNumber: result.orderNumber,
    orderPlacedDate: result.orderPlacedDate,
    grandTotal: result.grandTotal,
    projectCode: result.projectCode,
    paymentMethod: result.paymentMethod,
    lineItemsDetected: result.lineItems.length,
    totals: {
      sumLineTotals: Number(sumLineTotals.toFixed(2)),
      grandTotal: Number(grandTotalNum.toFixed(2)),
      diff: Number(Math.abs(sumLineTotals - grandTotalNum).toFixed(2)),
    },
    warnings: result.warnings,
    debug: {
      pdfPath,
    },
    sampleLineItems: topItems,
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2))
}

void main()
