import fs from 'node:fs/promises'
import path from 'node:path'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

function getItemXY(item) {
  const t = item?.transform
  if (Array.isArray(t) && t.length >= 6) {
    const x = Number(t[4])
    const y = Number(t[5])
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    }
  }
  return { x: 0, y: 0 }
}

function buildTextLinesFromPdfTextItems(items) {
  const tokens = (items || [])
    .map((it) => ({ str: String(it?.str || '').trim(), ...getItemXY(it) }))
    .filter(t => t.str.length > 0)

  if (tokens.length === 0) return ''

  // Sort top-to-bottom (higher y first), then left-to-right.
  tokens.sort((a, b) => (b.y - a.y) || (a.x - b.x))

  const yTolerance = 2
  const lines = []

  for (const t of tokens) {
    const last = lines[lines.length - 1]
    if (!last || Math.abs(last.y - t.y) > yTolerance) {
      lines.push({ y: t.y, parts: [{ x: t.x, str: t.str }] })
    } else {
      last.parts.push({ x: t.x, str: t.str })
    }
  }

  return lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x)
      return line.parts.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
    .join('\n')
}

function extractMoneyTokens(line) {
  // Similar to src/utils/wayfairInvoiceParser.ts
  return (line.match(/(?:\(\s*\$?\s*[\d,]+\.\d{2}\s*\)|-?\$?\s*[\d,]+\.\d{2})/g) || [])
}

function isLikelyWayfairSkuToken(token) {
  const t = token.trim()
  if (!t) return false
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9-]{6,20}$/.test(t)
}

function isLikelyWayfairTableHeaderLine(line) {
  const s = line.trim()
  if (!s) return false

  if (/^(?:Item|Unit Price|Qty|Subtotal|Adjustment|Tax|Total)$/i.test(s)) return true
  if (/^Shipping\s*&\s*Delivery$/i.test(s)) return true
  if (/^Shipping\s*(?:and|&)\s*Delivery$/i.test(s)) return true
  if (/^Delivery$/i.test(s)) return true

  if (/\bUnit Price\b/i.test(s) && /\bQty\b/i.test(s) && /\bSubtotal\b/i.test(s) && /\bTotal\b/i.test(s)) return true
  if (/\bShipping\b/i.test(s) && /\bDelivery\b/i.test(s) && /\bAdjustment\b/i.test(s) && /\bTax\b/i.test(s)) return true

  return false
}

async function main() {
  const repoRoot = path.resolve(process.cwd())
  const pdfPath = path.resolve(repoRoot, 'dev_docs', 'Invoice_4386128736.pdf')
  const pdfBuffer = await fs.readFile(pdfPath)
  const pdfBytes = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)

  const pdf = await getDocument({ data: pdfBytes, disableWorker: true }).promise
  const findings = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = buildTextLinesFromPdfTextItems(content.items)
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!isLikelyWayfairTableHeaderLine(line)) continue

      const moneyCount = extractMoneyTokens(line).length
      const maybeSku = line.split(/\s+/g).find(tok => isLikelyWayfairSkuToken(tok))
      const hasPayload = moneyCount > 0 || Boolean(maybeSku) || /\bColor\s*:\b/i.test(line) || /\bFabric\s*:\b/i.test(line)
      if (!hasPayload) continue

      findings.push({ pageNumber, lineIndex: i, line, moneyCount, maybeSku })
    }
  }

  console.log(JSON.stringify({ pages: pdf.numPages, mergedHeaderCandidates: findings.length }, null, 2))
  for (const f of findings.slice(0, 25)) {
    console.log('\n---')
    console.log(`page ${f.pageNumber}, line ${f.lineIndex}, moneyTokens=${f.moneyCount}, sku=${f.maybeSku || ''}`)
    console.log(f.line)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})


