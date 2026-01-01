export type OperationType =
  | 'CREATE_ITEM'
  | 'UPDATE_ITEM'
  | 'DELETE_ITEM'
  | 'CREATE_TRANSACTION'
  | 'UPDATE_TRANSACTION'
  | 'DELETE_TRANSACTION'

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

export type Operation =
  | CreateItemOperation
  | UpdateItemOperation
  | DeleteItemOperation