export interface ConflictItem {
  id: string
  entityType: 'item' | 'transaction' | 'project'
  local: {
    data: Record<string, unknown>
    timestamp: string
    version: number
  }
  server: {
    data: Record<string, unknown>
    timestamp: string
    version: number
  }
  field: string // Which field conflicts
  type: 'timestamp' | 'version' | 'content'
}

export interface Resolution {
  strategy: 'keep_local' | 'keep_server' | 'merge' | 'manual'
  resolvedData?: Record<string, unknown>
  userChoice?: 'local' | 'server'
}

export interface ConflictResolution {
  itemId: string
  resolution: Resolution
  timestamp: string
}