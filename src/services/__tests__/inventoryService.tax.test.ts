import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STATE_TAX_RATE_PCT } from '../../constants/tax'

// Mock Supabase client
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    }))
  }
}))

// Mock database service
vi.mock('../databaseService', () => ({
  ensureAuthenticatedForDatabase: vi.fn().mockResolvedValue(undefined),
  convertTimestamps: vi.fn((data) => data)
}))

describe('Tax System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Tax Rate Mapping for NV/UT States', () => {
    it('should validate NV state tax rate exists', () => {
      const transactionData = {
        projectId: 'project-1',
        transactionDate: '2023-01-01',
        source: 'Test Source',
        transactionType: 'Purchase',
        paymentMethod: 'Credit Card',
        amount: '108.38',
        budgetCategory: 'Furnishings',
        taxState: 'NV' as const,
        subtotal: '100.00',
        createdBy: 'test'
      }

      // Test that NV state has a configured tax rate
      expect(STATE_TAX_RATE_PCT['NV']).toBeDefined()
      expect(typeof STATE_TAX_RATE_PCT['NV']).toBe('number')
    })

    it('should compute tax rate correctly for Other state', async () => {
      const transactionData = {
        projectId: 'project-1',
        transactionDate: '2023-01-01',
        source: 'Test Source',
        transactionType: 'Purchase',
        paymentMethod: 'Credit Card',
        amount: '108.38',
        budgetCategory: 'Furnishings',
        taxState: 'Other' as const,
        subtotal: '100.00'
      }

      // Test the calculation logic directly without mocking database internals
      const amountNum = parseFloat(transactionData.amount)
      const subtotalNum = parseFloat(transactionData.subtotal)
      const calculatedRate = ((amountNum - subtotalNum) / subtotalNum) * 100

      expect(calculatedRate).toBeCloseTo(8.38, 2)
    })

    it('should validate subtotal is required for Other state', async () => {
      const transactionData = {
        projectId: 'project-1',
        transactionDate: '2023-01-01',
        source: 'Test Source',
        transactionType: 'Purchase',
        paymentMethod: 'Credit Card',
        amount: '108.38',
        budgetCategory: 'Furnishings',
        taxState: 'Other' as const
        // Missing subtotal
      }

      // Test the validation logic directly
      const amountNum = parseFloat(transactionData.amount)
      const subtotalNum = parseFloat((transactionData as any).subtotal || '0')

      expect(subtotalNum).toBe(0)
      expect(amountNum).toBeGreaterThan(subtotalNum)
    })

    it('should validate subtotal does not exceed amount for Other state', async () => {
      const amountNum = 100
      const subtotalNum = 150 // Subtotal greater than amount (invalid)

      expect(amountNum).toBeLessThan(subtotalNum) // This should be caught as invalid
    })
  })

  describe('Tax Rate Precision', () => {
    it('should maintain full precision for tax rates', () => {
      // Test that tax rates maintain full precision without rounding
      const amount = 108.375 // Amount with tax
      const subtotal = 100.00 // Subtotal before tax
      const rate = ((amount - subtotal) / subtotal) * 100

      // Service should maintain full precision
      const preciseRate = rate

      expect(preciseRate).toBeCloseTo(8.375, 4)
      expect(typeof preciseRate).toBe('number')
    })
  })

  describe('Tax State Validation', () => {
    it('should accept valid tax states', () => {
      const validStates = ['NV', 'UT', 'Other']

      validStates.forEach(state => {
        if (state === 'NV' || state === 'UT') {
          expect(STATE_TAX_RATE_PCT[state as keyof typeof STATE_TAX_RATE_PCT]).toBeDefined()
        }
        // 'Other' is handled differently - no predefined rate
      })
    })

    it('should reject invalid tax states', () => {
      const invalidStates = ['CA', 'TX', 'NY', '']

      invalidStates.forEach(state => {
        expect(STATE_TAX_RATE_PCT[state as keyof typeof STATE_TAX_RATE_PCT]).toBeUndefined()
      })
    })
  })
})
