import { describe, expect, it } from 'vitest'
import { parseReceiptList } from '@/utils/receiptListParser'

describe('parseReceiptList', () => {
  it('parses a standard receipt line', () => {
    const result = parseReceiptList('53 - ACCENT FURNISH 252972 $129.99 T')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      name: 'ACCENT FURNISH',
      sku: '252972',
      priceCents: 12999,
    })
    expect(result.skippedLines).toHaveLength(0)
  })

  it('parses multiple lines', () => {
    const input = `53 - ACCENT FURNISH 252972 $129.99 T
56 - EVERYDAY Q LIN 092626 $6.99 T
45 - FLORALS 924460 $229.99 T`
    const result = parseReceiptList(input)
    expect(result.items).toHaveLength(3)
    expect(result.items[0].name).toBe('ACCENT FURNISH')
    expect(result.items[1].name).toBe('EVERYDAY Q LIN')
    expect(result.items[2].name).toBe('FLORALS')
  })

  it('skips blank lines between groups', () => {
    const input = `53 - ACCENT FURNISH 252972 $129.99 T

56 - EVERYDAY Q LIN 092626 $6.99 T`
    const result = parseReceiptList(input)
    expect(result.items).toHaveLength(2)
    expect(result.skippedLines).toHaveLength(0)
  })

  it('handles lines without dollar sign', () => {
    const result = parseReceiptList('53 - ACCENT FURNISH 252972 129.99 T')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].priceCents).toBe(12999)
  })

  it('handles lines without trailing T', () => {
    const result = parseReceiptList('53 - ACCENT FURNISH 252972 $129.99')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].priceCents).toBe(12999)
  })

  it('handles prices with commas', () => {
    const result = parseReceiptList('53 - BIG ITEM 252972 $1,299.99 T')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].priceCents).toBe(129999)
  })

  it('reports unparseable lines as skipped', () => {
    const input = `53 - ACCENT FURNISH 252972 $129.99 T
RANDOM JUNK LINE
56 - EVERYDAY Q LIN 092626 $6.99 T`
    const result = parseReceiptList(input)
    expect(result.items).toHaveLength(2)
    expect(result.skippedLines).toEqual(['RANDOM JUNK LINE'])
  })

  it('returns empty result for empty string', () => {
    const result = parseReceiptList('')
    expect(result.items).toHaveLength(0)
    expect(result.skippedLines).toHaveLength(0)
  })

  it('handles whitespace-only input', () => {
    const result = parseReceiptList('   \n  \n   ')
    expect(result.items).toHaveLength(0)
    expect(result.skippedLines).toHaveLength(0)
  })

  it('trims descriptions', () => {
    const result = parseReceiptList('53 -  ACCENT FURNISH  252972 $129.99 T')
    expect(result.items[0].name).toBe('ACCENT FURNISH')
  })

  it('handles no-space around dash', () => {
    const result = parseReceiptList('53-ACCENT FURNISH 252972 $129.99 T')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('ACCENT FURNISH')
  })

  it('handles duplicate lines as separate items', () => {
    const input = `53 - ACCENT FURNISH 252972 $129.99 T
53 - ACCENT FURNISH 252972 $129.99 T`
    const result = parseReceiptList(input)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual(result.items[1])
  })

  it('handles long SKUs', () => {
    const result = parseReceiptList('53 - ITEM 12345678 $9.99 T')
    expect(result.items[0].sku).toBe('12345678')
  })

  it('rejects SKUs shorter than 4 digits', () => {
    const result = parseReceiptList('53 - ITEM 123 $9.99 T')
    expect(result.items).toHaveLength(0)
    expect(result.skippedLines).toHaveLength(1)
  })

  it('handles real receipt with mixed content', () => {
    const input = `53 - ACCENT FURNISH 252972 $129.99 T
56 - EVERYDAY Q LIN 092626 $6.99 T

SUBTOTAL $366.97
TAX $28.54
TOTAL $395.51

45 - FLORALS 924460 $229.99 T`
    const result = parseReceiptList(input)
    expect(result.items).toHaveLength(3)
    expect(result.skippedLines).toContain('SUBTOTAL $366.97')
    expect(result.skippedLines).toContain('TAX $28.54')
    expect(result.skippedLines).toContain('TOTAL $395.51')
  })
})
