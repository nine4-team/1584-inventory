import { describe, expect, it } from 'vitest'
import { buildTextLinesFromPdfTextItems } from '@/utils/pdfTextExtraction'

describe('buildTextLinesFromPdfTextItems', () => {
  it('groups tokens by y and sorts by x to reconstruct human-readable lines', () => {
    const items = [
      // Line 1: "Accent Chair - Blue Velvet"
      { str: 'Accent', transform: [1, 0, 0, 1, 10, 700] },
      { str: 'Chair', transform: [1, 0, 0, 1, 55, 700] },
      { str: '-', transform: [1, 0, 0, 1, 95, 700] },
      { str: 'Blue', transform: [1, 0, 0, 1, 110, 700] },
      { str: 'Velvet', transform: [1, 0, 0, 1, 150, 700] },

      // Line 2: "1 $399.99 $399.99"
      { str: '1', transform: [1, 0, 0, 1, 10, 680] },
      { str: '$399.99', transform: [1, 0, 0, 1, 60, 680] },
      { str: '$399.99', transform: [1, 0, 0, 1, 140, 680] },
    ]

    const text = buildTextLinesFromPdfTextItems(items)
    const lines = text.split('\n')

    expect(lines[0]).toBe('Accent Chair - Blue Velvet')
    expect(lines[1]).toBe('1 $399.99 $399.99')
  })

  it('returns empty string when no tokens are present', () => {
    expect(buildTextLinesFromPdfTextItems([])).toBe('')
  })
})


