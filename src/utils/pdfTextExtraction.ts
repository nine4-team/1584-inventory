import { getDocument, GlobalWorkerOptions, type TextItem } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type PdfTextExtractionResult = {
  pages: string[]
  fullText: string
}

let pdfJsWorkerConfigured = false

async function configurePdfJsWorkerOnce() {
  if (pdfJsWorkerConfigured) return
  // Only load the worker in the browser bundle; Node scripts/tests can use disableWorker.
  // Vite will bundle the worker and return a URL string.
  // eslint-disable-next-line import/no-unresolved
  const { default: pdfWorkerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker?url')
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  pdfJsWorkerConfigured = true
}

function isTextItem(item: unknown): item is TextItem {
  return item != null && typeof item === 'object' && 'str' in item
}

type MinimalTextItem = {
  str: string
  transform?: number[]
}

function getItemXY(item: MinimalTextItem): { x: number; y: number } {
  // pdfjs TextItem.transform: [a, b, c, d, e, f] where e=x and f=y in PDF space.
  const t = item.transform
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

/**
 * pdfjs text items are usually “tokens” (words/numbers). If we join them with '\n',
 * we destroy tabular rows (qty + prices end up on separate lines) and the invoice
 * parser can't detect line items.
 *
 * This reconstructs human-readable lines by grouping tokens by Y coordinate and
 * sorting within each line by X coordinate.
 */
export function buildTextLinesFromPdfTextItems(items: MinimalTextItem[]): string {
  const tokens = items
    .map((it) => ({ str: (it.str || '').trim(), ...getItemXY(it) }))
    .filter(t => t.str.length > 0)

  if (tokens.length === 0) return ''

  // Sort top-to-bottom (higher y first), then left-to-right.
  tokens.sort((a, b) => (b.y - a.y) || (a.x - b.x))

  const yTolerance = 2 // PDF coordinate fuzz; keeps same visual row together.
  const lines: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []

  for (const t of tokens) {
    const last = lines[lines.length - 1]
    if (!last || Math.abs(last.y - t.y) > yTolerance) {
      lines.push({ y: t.y, parts: [{ x: t.x, str: t.str }] })
    } else {
      last.parts.push({ x: t.x, str: t.str })
    }
  }

  return lines
    .map(line => {
      line.parts.sort((a, b) => a.x - b.x)
      // Join tokens with a space; parser later normalizes whitespace anyway.
      return line.parts.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
    .join('\n')
}

export async function extractPdfText(file: File): Promise<PdfTextExtractionResult> {
  await configurePdfJsWorkerOnce()

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageItems = content.items.filter((item: unknown): item is TextItem => isTextItem(item))
    const pageText = buildTextLinesFromPdfTextItems(pageItems)
    pages.push(pageText)
  }

  const fullText = pages.join('\n\n')
  return { pages, fullText }
}


