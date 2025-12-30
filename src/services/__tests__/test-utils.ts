import { vi } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'

// Use the constant directly instead of importing to avoid path issues
const CLIENT_OWES_COMPANY = 'Client Owes Company'

/**
 * Test utilities for mocking Supabase client
 */

export interface MockSupabaseResponse<T = any> {
  data: T | null
  error: PostgrestError | null
}

/**
 * Creates a mock Supabase query builder chain
 */
export const createMockQueryBuilder = <T = any>(
  mockData: T | null = null,
  mockError: PostgrestError | null = null
) => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockData, error: mockError }),
    maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error: mockError })
  }

  // Make chain thenable (Promise-like)
  chain.then = (onResolve?: (value: MockSupabaseResponse<T>) => any) => {
    return Promise.resolve({ data: mockData, error: mockError }).then(onResolve)
  }
  chain.catch = (onReject?: (error: any) => any) => {
    return Promise.resolve({ data: mockData, error: mockError }).catch(onReject)
  }

  return chain
}

/**
 * Creates a mock Supabase client
 */
export const createMockSupabaseClient = () => {
  const mockFrom = vi.fn(() => createMockQueryBuilder())
  const mockStorage = {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ data: { path: 'test-path' }, error: null }),
      download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.jpg' } }),
      list: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: null }, unsubscribe: vi.fn() }))
  }
  const mockChannel = vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    unsubscribe: vi.fn()
  }))

  return {
    from: mockFrom,
    storage: mockStorage,
    auth: mockAuth,
    channel: mockChannel
  }
}

/**
 * Common error codes for testing
 */
export const createNotFoundError = (): PostgrestError => ({
  code: 'PGRST116',
  message: 'The result contains 0 rows',
  details: null,
  hint: null
})

export const createPermissionError = (): PostgrestError => ({
  code: '42501',
  message: 'permission denied for table',
  details: null,
  hint: null
})

export const createForeignKeyError = (): PostgrestError => ({
  code: '23503',
  message: 'foreign key violation',
  details: null,
  hint: null
})

export const createUniqueConstraintError = (): PostgrestError => ({
  code: '23505',
  message: 'duplicate key value violates unique constraint',
  details: null,
  hint: null
})

/**
 * Mock user data for testing
 */
export const createMockUser = (overrides?: Partial<any>) => ({
  id: 'test-user-id',
  email: 'test@example.com',
  fullName: 'Test User',
  role: null,
  createdAt: new Date().toISOString(),
  lastLogin: new Date().toISOString(),
  ...overrides
})

/**
 * Mock account data for testing
 */
export const createMockAccount = (overrides?: Partial<any>) => ({
  id: 'test-account-id',
  name: 'Test Account',
  createdBy: 'test-user-id',
  createdAt: new Date().toISOString(),
  ...overrides
})

/**
 * Mock project data for testing
 */
export const createMockProject = (overrides?: Partial<any>) => ({
  id: 'test-project-id',
  accountId: 'test-account-id',
  name: 'Test Project',
  description: 'Test Description',
  clientName: 'Test Client',
  budget: 10000,
  designFee: 1000,
  budgetCategories: {
    designFee: 1000,
    furnishings: 5000,
    propertyManagement: 1000,
    kitchen: 2000,
    install: 500,
    storageReceiving: 300,
    fuel: 200
  },
  createdBy: 'test-user-id',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
})

/**
 * Mock item data for testing
 */
export const createMockItem = (overrides?: Partial<any>) => ({
  itemId: 'test-item-id',
  accountId: 'test-account-id',
  projectId: null,
  description: 'Test Item',
  source: 'Test Source',
  sku: 'TEST-SKU-001',
  purchasePrice: '100.00',
  projectPrice: '150.00',
  marketValue: '120.00',
  paymentMethod: 'Credit Card',
  disposition: 'purchased',
  notes: 'Test notes',
  space: 'Living Room',
  qrKey: 'test-qr-key',
  bookmark: false,
  transactionId: null,
  dateCreated: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  images: [],
  taxRatePct: 8.375,
  ...overrides
})

/**
 * Mock transaction data for testing
 */
export const createMockTransaction = (overrides?: Partial<any>) => ({
  transactionId: 'test-transaction-id',
  accountId: 'test-account-id',
  projectId: 'test-project-id',
  transactionDate: new Date().toISOString().split('T')[0],
  source: 'Test Source',
  transactionType: 'Purchase',
  paymentMethod: 'Credit Card',
  amount: '100.00',
  budgetCategory: 'Furnishings',
  taxState: 'NV',
  subtotal: '92.38',
  taxRatePct: 8.25,
  reimbursementType: CLIENT_OWES_COMPANY,
  status: 'pending',
  notes: 'Test transaction',
  receiptImages: [],
  otherImages: [],
  createdBy: 'test-user-id',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
})

