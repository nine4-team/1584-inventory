import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTaxPresets, updateTaxPresets, getTaxPresetById } from '../taxPresetsService'
import { DEFAULT_TAX_PRESETS } from '../../constants/taxPresets'
import * as accountPresetsModule from '../accountPresetsService'
import * as offlineMetadataModule from '../offlineMetadataService'
import * as networkStatusModule from '../networkStatusService'

vi.mock('../accountPresetsService', () => ({
  getAccountPresets: vi.fn(),
  mergeAccountPresetsSection: vi.fn()
}))

vi.mock('../offlineMetadataService', () => ({
  cacheTaxPresetsOffline: vi.fn(),
  getCachedTaxPresets: vi.fn()
}))

vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn()
}))

describe('taxPresetsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)
    vi.mocked(offlineMetadataModule.getCachedTaxPresets).mockResolvedValue([])
    vi.mocked(offlineMetadataModule.cacheTaxPresetsOffline).mockResolvedValue(undefined)
  })

  describe('getTaxPresets', () => {
    it('should return presets from database', async () => {
      const mockPresets = [
        { id: 'preset-1', name: 'NV Tax', rate: 8.25 },
        { id: 'preset-2', name: 'UT Tax', rate: 6.85 }
      ]
      vi.mocked(accountPresetsModule.getAccountPresets).mockResolvedValue({
        presets: { tax_presets: mockPresets }
      } as any)

      const presets = await getTaxPresets('test-account-id')
      expect(presets).toEqual(mockPresets)
    })

    it('should initialize with defaults when not found', async () => {
      vi.mocked(accountPresetsModule.getAccountPresets).mockResolvedValue(null as any)

      const presets = await getTaxPresets('test-account-id')
      expect(presets).toEqual(DEFAULT_TAX_PRESETS)
      expect(accountPresetsModule.mergeAccountPresetsSection).not.toHaveBeenCalled()
    })

    it('should initialize with defaults when presets array is empty', async () => {
      vi.mocked(accountPresetsModule.getAccountPresets).mockResolvedValue({
        presets: { tax_presets: [] }
      } as any)

      const presets = await getTaxPresets('test-account-id')
      expect(presets).toEqual(DEFAULT_TAX_PRESETS)
      expect(accountPresetsModule.mergeAccountPresetsSection).not.toHaveBeenCalled()
    })

    it('should fallback to defaults on error', async () => {
      vi.mocked(accountPresetsModule.getAccountPresets).mockRejectedValue(new Error('boom'))

      const presets = await getTaxPresets('test-account-id')
      expect(presets).toEqual(DEFAULT_TAX_PRESETS)
    })
  })

  describe('updateTaxPresets', () => {
    it('should update existing presets', async () => {
      const newPresets = [
        { id: 'preset-1', name: 'NV Tax', rate: 8.25 },
        { id: 'preset-2', name: 'UT Tax', rate: 6.85 }
      ]
      vi.mocked(accountPresetsModule.mergeAccountPresetsSection).mockResolvedValue(undefined as any)

      await updateTaxPresets('test-account-id', newPresets)
      expect(accountPresetsModule.mergeAccountPresetsSection).toHaveBeenCalledWith(
        'test-account-id',
        'tax_presets',
        newPresets
      )
    })

    it('should validate presets array is not empty', async () => {
      await expect(
        updateTaxPresets('test-account-id', [])
      ).rejects.toThrow('Presets must be a non-empty array')
    })

    it('should validate maximum of 5 presets', async () => {
      const tooManyPresets = Array.from({ length: 6 }, (_, i) => ({
        id: `preset-${i}`,
        name: `Preset ${i}`,
        rate: 5.0
      }))

      await expect(
        updateTaxPresets('test-account-id', tooManyPresets)
      ).rejects.toThrow('Cannot have more than 5 tax presets')
    })

    it('should validate preset structure', async () => {
      const invalidPresets = [
        { id: 'preset-1', name: 'Test' } // Missing rate
      ]

      await expect(
        updateTaxPresets('test-account-id', invalidPresets as any)
      ).rejects.toThrow('Each preset must have id, name, and rate fields')
    })

    it('should validate tax rate range', async () => {
      const invalidPresets = [
        { id: 'preset-1', name: 'Test', rate: 150 } // Rate > 100
      ]

      await expect(
        updateTaxPresets('test-account-id', invalidPresets)
      ).rejects.toThrow('Tax rate must be between 0 and 100')
    })

    it('should validate unique preset IDs', async () => {
      const duplicatePresets = [
        { id: 'preset-1', name: 'Test 1', rate: 5.0 },
        { id: 'preset-1', name: 'Test 2', rate: 6.0 } // Duplicate ID
      ]

      await expect(
        updateTaxPresets('test-account-id', duplicatePresets)
      ).rejects.toThrow('Preset IDs must be unique')
    })
  })

  describe('getTaxPresetById', () => {
    it('should return preset by ID', async () => {
      const mockPresets = [
        { id: 'preset-1', name: 'NV Tax', rate: 8.25 },
        { id: 'preset-2', name: 'UT Tax', rate: 6.85 }
      ]
      vi.mocked(accountPresetsModule.getAccountPresets).mockResolvedValue({
        presets: { tax_presets: mockPresets }
      } as any)

      const preset = await getTaxPresetById('test-account-id', 'preset-1')
      expect(preset).toBeTruthy()
      expect(preset?.id).toBe('preset-1')
      expect(preset?.name).toBe('NV Tax')
    })

    it('should return null when preset not found', async () => {
      const mockPresets = [
        { id: 'preset-1', name: 'NV Tax', rate: 8.25 }
      ]
      vi.mocked(accountPresetsModule.getAccountPresets).mockResolvedValue({
        presets: { tax_presets: mockPresets }
      } as any)

      const preset = await getTaxPresetById('test-account-id', 'non-existent-id')
      expect(preset).toBeNull()
    })
  })
})

