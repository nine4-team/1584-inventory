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
  | 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY'
  | 'ALLOCATE_ITEM_TO_PROJECT'
  | 'SELL_ITEM_TO_PROJECT'

export type OperationSyncStatus = 'pending' | 'requires_intervention'

export type OperationInterventionReason = 'missing_item_on_server'

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: string
  retryCount: number
  lastError?: string
  /**
   * Sync processing state.
   * - pending: normal queue processing
   * - requires_intervention: paused until user resolves it in the UI
   */
  syncStatus?: OperationSyncStatus
  /**
   * Narrow reason code for UI + handling.
   */
  interventionReason?: OperationInterventionReason
  /**
   * When the operation was paused for manual resolution.
   */
  pausedAt?: string
  /**
   * Optional machine-readable error code (e.g. PGRST116).
   */
  errorCode?: string
  /**
   * Optional extra error details (best-effort).
   */
  errorDetails?: string
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
      taxRatePct: number | null
      subtotal: string | null
      taxRatePreset: string | null
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

export interface DeallocateItemToBusinessInventoryOperation extends BaseOperation {
  type: 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY'
  data: {
    itemId: string
    projectId: string
    disposition: string
  }
}

export interface AllocateItemToProjectOperation extends BaseOperation {
  type: 'ALLOCATE_ITEM_TO_PROJECT'
  data: {
    itemId: string
    projectId: string
    amount?: string
    notes?: string
    space?: string
  }
}

export interface SellItemToProjectOperation extends BaseOperation {
  type: 'SELL_ITEM_TO_PROJECT'
  data: {
    itemId: string
    sourceProjectId: string
    targetProjectId: string
    amount?: string
    notes?: string
    space?: string
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
  | DeallocateItemToBusinessInventoryOperation
  | AllocateItemToProjectOperation
  | SellItemToProjectOperation