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
    accountId: string
    projectId: string
    name: string
    description?: string
    quantity: number
    unitCost: number
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
      quantity: number
      unitCost: number
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