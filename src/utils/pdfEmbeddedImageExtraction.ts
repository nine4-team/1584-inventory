import { getDocument, GlobalWorkerOptions, OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type PdfEmbeddedImagePlacement = {
  pageNumber: number
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number }
  pixelWidth: number
  pixelHeight: number
  pageHeight: number
  file: File
}

let pdfJsWorkerConfigured = false

async function configurePdfJsWorkerOnce() {
  if (pdfJsWorkerConfigured) return
  // eslint-disable-next-line import/no-unresolved
  const { default: pdfWorkerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker?url')
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  pdfJsWorkerConfigured = true
}

function multiplyMatrices(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function bboxFromMatrix(m: number[]): { xMin: number; yMin: number; xMax: number; yMax: number } {
  const [a, b, c, d, e, f] = m
  const p0 = { x: e, y: f }
  const p1 = { x: a + e, y: b + f }
  const p2 = { x: c + e, y: d + f }
  const p3 = { x: a + c + e, y: b + d + f }

  const xMin = Math.min(p0.x, p1.x, p2.x, p3.x)
  const xMax = Math.max(p0.x, p1.x, p2.x, p3.x)
  const yMin = Math.min(p0.y, p1.y, p2.y, p3.y)
  const yMax = Math.max(p0.y, p1.y, p2.y, p3.y)
  return { xMin, xMax, yMin, yMax }
}

async function getPdfJsObject(page: PDFPageProxy, objId: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    try {
      // PDFObjects.get supports a callback that fires once the object is resolved.
      page.objs.get(objId, (data: any) => resolve(data))
    } catch (e) {
      reject(e)
    }
  })
}

function coerceToFinitePositiveInt(n: unknown): number | null {
  const num = Number(n)
  if (!Number.isFinite(num)) return null
  const int = Math.floor(num)
  if (int <= 0) return null
  return int
}

function rgbaClampedFromRawBuffer(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  kind?: number
): Uint8ClampedArray | null {
  const expectedRgba = w * h * 4
  const expectedRgb = w * h * 3
  const expectedGray = w * h

  // pdf.js ImageKind values (from pdfjs-dist): 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP
  const IMAGE_KIND_GRAYSCALE_1BPP = 1
  const IMAGE_KIND_RGB_24BPP = 2
  const IMAGE_KIND_RGBA_32BPP = 3

  if (data.length === expectedRgba) {
    return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data)
  }

  // Row-padded RGBA is unlikely, but accept it if present.
  if (kind === IMAGE_KIND_RGBA_32BPP) {
    const rowLen = w * 4
    const rowSize = (rowLen + 3) & ~3
    if (data.length === rowSize * h && rowSize !== rowLen) {
      const out = new Uint8ClampedArray(expectedRgba)
      for (let y = 0; y < h; y++) {
        const srcStart = y * rowSize
        const src = data.subarray(srcStart, srcStart + rowLen)
        out.set(src as any, y * rowLen)
      }
      return out
    }
  }

  // GRAYSCALE_1BPP (bit-packed), often with 4-byte row padding.
  // Data length is: rowSize * h where rowSize = ceil(w/8) padded to multiple of 4.
  if (kind === IMAGE_KIND_GRAYSCALE_1BPP) {
    const rowLen = (w + 7) >> 3
    const rowSize = (rowLen + 3) & ~3
    if (data.length === rowLen * h || data.length === rowSize * h) {
      const stride = data.length === rowSize * h ? rowSize : rowLen
      const out = new Uint8ClampedArray(expectedRgba)
      for (let y = 0; y < h; y++) {
        const rowBase = y * stride
        for (let x = 0; x < w; x++) {
          const byte = data[rowBase + (x >> 3)]
          const bit = (byte >> (7 - (x & 7))) & 1
          const v = bit ? 255 : 0
          const j = (y * w + x) * 4
          out[j] = v
          out[j + 1] = v
          out[j + 2] = v
          out[j + 3] = 255
        }
      }
      return out
    }
  }

  // RGB24 -> RGBA32
  if (data.length === expectedRgb) {
    const out = new Uint8ClampedArray(expectedRgba)
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i]
      out[j + 1] = data[i + 1]
      out[j + 2] = data[i + 2]
      out[j + 3] = 255
    }
    return out
  }

  // Row-padded RGB24 (pdf.js sometimes pads rows to a 4-byte boundary).
  if (kind === IMAGE_KIND_RGB_24BPP) {
    const rowLen = w * 3
    const rowSize = (rowLen + 3) & ~3
    if (data.length === rowSize * h) {
      const out = new Uint8ClampedArray(expectedRgba)
      for (let y = 0; y < h; y++) {
        const srcRowStart = y * rowSize
        let src = srcRowStart
        let dst = y * w * 4
        for (let x = 0; x < w; x++) {
          out[dst++] = data[src++]
          out[dst++] = data[src++]
          out[dst++] = data[src++]
          out[dst++] = 255
        }
      }
      return out
    }
  }

  // Grayscale -> RGBA32
  if (data.length === expectedGray) {
    const out = new Uint8ClampedArray(expectedRgba)
    for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
      const v = data[i]
      out[j] = v
      out[j + 1] = v
      out[j + 2] = v
      out[j + 3] = 255
    }
    return out
  }

  // Row-padded grayscale 8bpp (defensive; some pipelines pad to 4 bytes per row).
  const grayRowLen = w
  const grayRowSize = (grayRowLen + 3) & ~3
  if (data.length === grayRowSize * h && grayRowSize !== grayRowLen) {
    const out = new Uint8ClampedArray(expectedRgba)
    for (let y = 0; y < h; y++) {
      const srcRowStart = y * grayRowSize
      let src = srcRowStart
      let dst = y * w * 4
      for (let x = 0; x < w; x++) {
        const v = data[src++]
        out[dst++] = v
        out[dst++] = v
        out[dst++] = v
        out[dst++] = 255
      }
    }
    return out
  }

  return null
}

async function blobFromPdfJsImageObject(imageObj: any): Promise<{ blob: Blob; pixelWidth: number; pixelHeight: number }> {
  // Common cases in pdfjs:
  // - ImageBitmap / HTMLCanvasElement / HTMLImageElement
  // - { data: Uint8ClampedArray, width: number, height: number } (raw RGBA)
  // - { bitmap: ImageBitmap, width, height } (varies)
  const canvas = document.createElement('canvas')

  // Case: raw RGBA
  if (imageObj && typeof imageObj === 'object' && 'data' in imageObj && 'width' in imageObj && 'height' in imageObj) {
    const w = coerceToFinitePositiveInt((imageObj as any).width)
    const h = coerceToFinitePositiveInt((imageObj as any).height)
    const data = (imageObj as any).data as Uint8ClampedArray | Uint8Array | null | undefined
    const kind = Number((imageObj as any).kind)
    if (!w || !h || !data) {
      throw new Error('Unsupported PDF image object (invalid data/width/height)')
    }

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas 2d context')

    const rgba = rgbaClampedFromRawBuffer(data, w, h, Number.isFinite(kind) ? kind : undefined)
    if (!rgba) {
      throw new Error('Unsupported PDF image object (unexpected raw buffer length)')
    }
    const imgData = new ImageData(rgba, w, h)
    ctx.putImageData(imgData, 0, 0)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG blob'))), 'image/png')
    })

    return { blob, pixelWidth: w, pixelHeight: h }
  }

  // Case: bitmap-like
  const bitmapCandidate = (imageObj && typeof imageObj === 'object' && 'bitmap' in imageObj) ? (imageObj as any).bitmap : imageObj
  const w = coerceToFinitePositiveInt((imageObj as any)?.width ?? (bitmapCandidate as any)?.width)
  const h = coerceToFinitePositiveInt((imageObj as any)?.height ?? (bitmapCandidate as any)?.height)
  if (!w || !h) {
    // Fall back: try drawing without explicit dims
    canvas.width = 200
    canvas.height = 200
  } else {
    canvas.width = w
    canvas.height = h
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas 2d context')

  try {
    ctx.drawImage(bitmapCandidate as any, 0, 0, canvas.width, canvas.height)
  } catch (e) {
    throw new Error('Unsupported PDF image object (cannot draw to canvas)')
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG blob'))), 'image/png')
  })

  return { blob, pixelWidth: canvas.width, pixelHeight: canvas.height }
}

export type PdfEmbeddedImageExtractionOptions = {
  /** Keep only images whose PDF-space bounding-box fits within this size window. */
  pdfBoxSizeFilter?: { min: number; max: number }
  /** Keep only images whose left edge (xMin) is left of this threshold (PDF points). */
  xMinMax?: number
  /**
   * Reject images that are too wide or tall compared to their height/width.
   * Helps drop wordmarks/logos (e.g., the Wayfair logo) that otherwise match the size filter.
   */
  maxAspectRatio?: number
  /** Scale used when rendering pages for cropping thumbnails. Higher = sharper but slower. */
  renderScale?: number
}

const DEFAULT_MAX_THUMBNAIL_ASPECT_RATIO = 2.3

export async function extractPdfEmbeddedImages(
  file: File,
  options: PdfEmbeddedImageExtractionOptions = {}
): Promise<PdfEmbeddedImagePlacement[]> {
  await configurePdfJsWorkerOnce()

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const pdfBoxSizeFilter = options.pdfBoxSizeFilter ?? { min: 15, max: 180 }
  const xMinMax = options.xMinMax ?? 220
  const renderScale = options.renderScale ?? 2
  const maxAspectRatio = options.maxAspectRatio ?? DEFAULT_MAX_THUMBNAIL_ASPECT_RATIO

  const placements: PdfEmbeddedImagePlacement[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const operatorList = await page.getOperatorList()
    const { fnArray, argsArray } = operatorList

    const candidateBboxes: Array<{ bbox: { xMin: number; yMin: number; xMax: number; yMax: number } }> = []

    const matrixStack: number[][] = []
    let ctm: number[] = [1, 0, 0, 1, 0, 0]

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i]
      const args = argsArray[i]

      if (fn === OPS.save) {
        matrixStack.push(ctm.slice())
        continue
      }
      if (fn === OPS.restore) {
        const prev = matrixStack.pop()
        if (prev) ctm = prev
        continue
      }
      if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        const m2 = args.slice(0, 6).map((n: any) => Number(n))
        if (m2.every((n: number) => Number.isFinite(n))) {
          ctm = multiplyMatrices(ctm, m2)
        }
        continue
      }

      // paintImageXObject / inline / repeat
      if (fn === OPS.paintImageXObject && Array.isArray(args) && typeof args[0] === 'string') {
        const bbox = bboxFromMatrix(ctm)
        const wPts = Math.abs(bbox.xMax - bbox.xMin)
        const hPts = Math.abs(bbox.yMax - bbox.yMin)

        // Thumbnail-ish heuristics (Wayfair invoice thumbnails are small and sit on the left of the line item row)
        const aspectRatio = Math.max(wPts, hPts) / Math.max(1, Math.min(wPts, hPts))
        if (
          wPts >= pdfBoxSizeFilter.min &&
          wPts <= pdfBoxSizeFilter.max &&
          hPts >= pdfBoxSizeFilter.min &&
          hPts <= pdfBoxSizeFilter.max &&
          bbox.xMin <= xMinMax &&
          aspectRatio <= maxAspectRatio
        ) {
          candidateBboxes.push({ bbox })
        }
      }
    }

    if (candidateBboxes.length > 0) {
      // Robust extraction: render the page and crop the rectangles where images were painted.
      // This avoids relying on pdf.js internal image object shapes (which can vary for masks, 1bpp, etc).
      try {
        const viewport = page.getViewport({ scale: renderScale })
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = Math.max(1, Math.floor(viewport.width))
        pageCanvas.height = Math.max(1, Math.floor(viewport.height))
        const pageCtx = pageCanvas.getContext('2d')
        if (!pageCtx) throw new Error('Failed to get canvas 2d context for page render')

        await page.render({ canvasContext: pageCtx, viewport }).promise

        for (const { bbox } of candidateBboxes) {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([bbox.xMin, bbox.yMin, bbox.xMax, bbox.yMax])
          const left = Math.max(0, Math.floor(Math.min(x1, x2)))
          const top = Math.max(0, Math.floor(Math.min(y1, y2)))
          const right = Math.min(pageCanvas.width, Math.ceil(Math.max(x1, x2)))
          const bottom = Math.min(pageCanvas.height, Math.ceil(Math.max(y1, y2)))
          const cropW = right - left
          const cropH = bottom - top
          if (cropW <= 0 || cropH <= 0) continue

          const cropCanvas = document.createElement('canvas')
          cropCanvas.width = cropW
          cropCanvas.height = cropH
          const cropCtx = cropCanvas.getContext('2d')
          if (!cropCtx) continue

          cropCtx.drawImage(pageCanvas, left, top, cropW, cropH, 0, 0, cropW, cropH)

          const blob = await new Promise<Blob>((resolve, reject) => {
            cropCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG blob'))), 'image/png')
          })

          const fileName = `wayfair_invoice_p${pageNumber}_${placements.length + 1}.png`
          const imageFile = new File([blob], fileName, { type: 'image/png', lastModified: Date.now() })

          placements.push({
            pageNumber,
            bbox,
            pixelWidth: cropW,
            pixelHeight: cropH,
            pageHeight: viewport.height,
            file: imageFile,
          })
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to render/crop embedded images for page; falling back to object extraction.', {
          pageNumber,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        })
        // Fallback: attempt object extraction per image (legacy path)
        // eslint-disable-next-line no-console
        console.warn('Object extraction fallback currently disabled for this page due to inconsistent pdf.js image objects.', { pageNumber })
      }
    }
  }

  // Stable reading order: page asc, y desc, x asc
  placements.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber
    const ay = a.bbox.yMax
    const by = b.bbox.yMax
    if (ay !== by) return by - ay
    return a.bbox.xMin - b.bbox.xMin
  })

  return placements
}


