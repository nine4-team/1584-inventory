import 'fake-indexeddb/auto'
import { expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import * as matchers from '@testing-library/jest-dom/matchers'

// Register jest-dom matchers with Vitest's expect
expect.extend(matchers)

vi.mock('heic2any', () => ({
  default: vi.fn(async () => new Blob())
}))

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => ({
      canvas: document.createElement('canvas'),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: [] })),
      putImageData: vi.fn(),
      createImageData: vi.fn(() => ({ data: [] })),
      measureText: vi.fn(() => ({ width: 0 }))
    }))
  })
}

if (typeof URL !== 'undefined') {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock') as any
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn() as any
  }
}


