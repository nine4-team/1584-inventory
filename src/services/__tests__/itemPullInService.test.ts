import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Item } from '@/types'

const integrationServiceMocks = vi.hoisted(() => ({
  allocateBusinessInventoryToProject: vi.fn(),
  sellItemToProject: vi.fn()
}))

vi.mock('@/services/inventoryService', () => ({
  integrationService: {
    allocateBusinessInventoryToProject: integrationServiceMocks.allocateBusinessInventoryToProject,
    sellItemToProject: integrationServiceMocks.sellItemToProject
  }
}))

import { ensureItemInProjectForSpace } from '../itemPullInService'

const buildItem = (overrides: Partial<Item> = {}): Item => ({
  itemId: 'item-1',
  description: 'Item',
  source: 'Vendor',
  sku: 'SKU-1',
  paymentMethod: 'Card',
  qrKey: 'qr-1',
  bookmark: false,
  dateCreated: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  ...overrides
})

describe('ensureItemInProjectForSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when item is already in target project', async () => {
    const item = buildItem({ projectId: 'project-1' })

    await ensureItemInProjectForSpace('acct-1', item, 'project-1', { spaceName: 'Kitchen' })

    expect(integrationServiceMocks.allocateBusinessInventoryToProject).not.toHaveBeenCalled()
    expect(integrationServiceMocks.sellItemToProject).not.toHaveBeenCalled()
  })

  it('allocates business inventory items to the target project', async () => {
    const item = buildItem({ projectId: null })

    await ensureItemInProjectForSpace('acct-1', item, 'project-1', { spaceName: 'Kitchen' })

    expect(integrationServiceMocks.allocateBusinessInventoryToProject).toHaveBeenCalledWith(
      'acct-1',
      'item-1',
      'project-1',
      undefined,
      'Pulled into space "Kitchen" in project project-1'
    )
    expect(integrationServiceMocks.sellItemToProject).not.toHaveBeenCalled()
  })

  it('sells items from another project into the target project', async () => {
    const item = buildItem({ projectId: 'project-2' })

    await ensureItemInProjectForSpace('acct-1', item, 'project-1', { spaceName: 'Kitchen' })

    expect(integrationServiceMocks.sellItemToProject).toHaveBeenCalledWith(
      'acct-1',
      'item-1',
      'project-2',
      'project-1',
      { notes: 'Pulled into space "Kitchen" in project project-1', space: 'Kitchen' }
    )
    expect(integrationServiceMocks.allocateBusinessInventoryToProject).not.toHaveBeenCalled()
  })
})
