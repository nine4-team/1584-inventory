export type OperationType =
  | 'CREATE_ITEM'
  | 'UPDATE_ITEM'
  | 'DELETE_ITEM'
  | 'CREATE_TRANSACTION'
  | 'UPDATE_TRANSACTION'
  | 'DELETE_TRANSACTION'
  | 'CREATE_PROJECT'
  | 'UPDATE_PROJECT'
  | 'DELETE_PROJECT'

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: string
  retryCount: number
  lastError?: string
  // Required metadata for offline sync
  accountId: string
  updatedBy: string
  version: number
}

export interface CreateItemOperation extends BaseOperation {
  type: 'CREATE_ITEM'
  data: {
    id: string // item_id (business identifier)
    accountId: string
    projectId: string
    name: string
    description?: string
    purchasePrice?: string // Actual purchase price from item data
  }
}

export interface UpdateItemOperation extends BaseOperation {
  type: 'UPDATE_ITEM'
  data: {
    id: string
    accountId?: string
    updates: Partial<{
      name: string
      description: string
      purchasePrice: string // Actual purchase price from updates
    }>
  }
}

export interface DeleteItemOperation extends BaseOperation {
  type: 'DELETE_ITEM'
  data: {
    id: string
    accountId?: string
  }
}

export interface CreateTransactionOperation extends BaseOperation {
  type: 'CREATE_TRANSACTION'
  data: {
    id: string // transaction_id (business identifier)
    accountId: string
    projectId?: string | null
  }
}

export interface UpdateTransactionOperation extends BaseOperation {
  type: 'UPDATE_TRANSACTION'
  data: {
    id: string // transaction_id
    accountId?: string
    updates: Partial<{
      amount: string
      categoryId: string
      taxRatePreset: string
      status: string
      receiptImages: any[]
      otherImages: any[]
      transactionImages: any[]
    }>
  }
}

export interface DeleteTransactionOperation extends BaseOperation {
  type: 'DELETE_TRANSACTION'
  data: {
    id: string // transaction_id
    accountId?: string
  }
}

export interface CreateProjectOperation extends BaseOperation {
  type: 'CREATE_PROJECT'
  data: {
    id: string // project id (business identifier)
    accountId: string
  }
}

export interface UpdateProjectOperation extends BaseOperation {
  type: 'UPDATE_PROJECT'
  data: {
    id: string // project id
    accountId?: string
    updates: Partial<{
      name: string
      budget: number
      description: string
      clientName: string
      designFee: number
      budgetCategories: Record<string, number>
      defaultCategoryId: string | null
      mainImageUrl: string | null
      settings: Record<string, any>
      metadata: Record<string, any>
      itemCount: number
      transactionCount: number
      totalValue: number
    }>
  }
}

export interface DeleteProjectOperation extends BaseOperation {
  type: 'DELETE_PROJECT'
  data: {
    id: string // project id
    accountId?: string
  }
}

export type Operation =
  | CreateItemOperation
  | UpdateItemOperation
  | DeleteItemOperation
  | CreateTransactionOperation
  | UpdateTransactionOperation
  | DeleteTransactionOperation
  | CreateProjectOperation
  | UpdateProjectOperation
  | DeleteProjectOperation