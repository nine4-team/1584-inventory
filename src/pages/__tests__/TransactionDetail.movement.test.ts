import { describe, it, expect } from 'vitest'
import { splitItemsByMovement, type DisplayTransactionItem } from '@/utils/transactionMovement'

const buildItem = (overrides: Partial<DisplayTransactionItem> = {}): DisplayTransactionItem => ({
  id: overrides.id ?? 'item-1',
  transactionId: overrides.transactionId,
  description: overrides.description ?? 'Item description',
  sku: overrides.sku,
  price: overrides.price,
  purchasePrice: overrides.purchasePrice,
  projectPrice: overrides.projectPrice,
  marketValue: overrides.marketValue,
  space: overrides.space,
  notes: overrides.notes,
  disposition: overrides.disposition ?? null,
  taxAmountPurchasePrice: overrides.taxAmountPurchasePrice,
  taxAmountProjectPrice: overrides.taxAmountProjectPrice,
  images: overrides.images ?? [],
  imageFiles: overrides.imageFiles ?? [],
  uiGroupKey: overrides.uiGroupKey,
  _latestTransactionId: '_latestTransactionId' in overrides ? overrides._latestTransactionId : 'tx-1',
  _transactionId: '_transactionId' in overrides ? overrides._transactionId : 'tx-1',
  _projectId: '_projectId' in overrides ? overrides._projectId : 'project-1',
  _previousProjectTransactionId: overrides._previousProjectTransactionId ?? null,
  _hasMovedOut: overrides._hasMovedOut ?? false
})

describe('splitItemsByMovement', () => {
  it('keeps items whose latest transaction matches as active', () => {
    const result = splitItemsByMovement([buildItem()], 'tx-1')

    expect(result.inTransaction).toHaveLength(1)
    expect(result.movedOut).toHaveLength(0)
  })

  it('treats explicit moved items as moved even if ids match', () => {
    const moved = buildItem({ _hasMovedOut: true })
    const result = splitItemsByMovement([moved], 'tx-1')

    expect(result.inTransaction).toHaveLength(0)
    expect(result.movedOut).toHaveLength(1)
  })

  it('falls back to active when only legacy transactionId differs', () => {
    const legacy = buildItem({
      _latestTransactionId: undefined,
      _transactionId: 'legacy-other'
    })

    const result = splitItemsByMovement([legacy], 'tx-1')

    expect(result.inTransaction).toHaveLength(1)
    expect(result.movedOut).toHaveLength(0)
  })

  it('classifies transitional inventory returns as moved', () => {
    const transitional = buildItem({
      _latestTransactionId: null,
      _projectId: null,
      _previousProjectTransactionId: 'tx-1',
      _transactionId: undefined  // Override default
    })

    const result = splitItemsByMovement([transitional], 'tx-1')

    expect(result.inTransaction).toHaveLength(0)
    expect(result.movedOut).toHaveLength(1)
  })

  it('shows moved items section when transaction has moved items', () => {
    // Simulate the scenario from the bug: transaction has one active item and one moved item
    const activeItem = buildItem({
      id: 'active-item',
      _latestTransactionId: 'tx-1',
      _hasMovedOut: false
    })

    const movedItem = buildItem({
      id: 'moved-item',
      _latestTransactionId: 'tx-2', // Different transaction
      _hasMovedOut: true
    })

    const result = splitItemsByMovement([activeItem, movedItem], 'tx-1')

    expect(result.inTransaction).toHaveLength(1)
    expect(result.inTransaction[0].id).toBe('active-item')
    expect(result.movedOut).toHaveLength(1)
    expect(result.movedOut[0].id).toBe('moved-item')
  })

  it('shows moved items section when transaction only has moved items', () => {
    // Edge case: transaction has no active items, only moved ones
    const movedItem = buildItem({
      id: 'moved-item',
      _latestTransactionId: 'tx-2', // Different transaction
      _hasMovedOut: true
    })

    const result = splitItemsByMovement([movedItem], 'tx-1')

    expect(result.inTransaction).toHaveLength(0)
    expect(result.movedOut).toHaveLength(1)
    expect(result.movedOut[0].id).toBe('moved-item')
  })
})
