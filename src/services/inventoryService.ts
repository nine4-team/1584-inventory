import { supabase, getCurrentUser } from './supabase'
import { convertTimestamps, ensureAuthenticatedForDatabase } from './databaseService'
import { toDateOnlyString } from '@/utils/dateUtils'
import { getTaxPresetById } from './taxPresetsService'
import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { lineageService } from './lineageService'
import { offlineStore, type DBItem, type DBTransaction, type DBProject } from './offlineStore'
import { isNetworkOnline, withNetworkTimeout, NetworkTimeoutError } from './networkStatusService'
import { OfflineQueueUnavailableError } from './offlineItemService'
import { operationQueue, OfflineContextError } from './operationQueue'
import type { Item, Project, FilterOptions, PaginationOptions, Transaction, TransactionItemFormData, TransactionCompleteness, CompletenessStatus, ItemImage } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Lazy import to avoid circular dependencies
let getGlobalQueryClient: (() => any) | null = null
function tryGetQueryClient() {
  try {
    if (!getGlobalQueryClient) {
      const queryClientModule = require('@/utils/queryClient')
      getGlobalQueryClient = queryClientModule?.getGlobalQueryClient || null
    }
    if (!getGlobalQueryClient) {
      return null
    }
    return getGlobalQueryClient()
  } catch {
    return null
  }
}

type SharedRealtimeEntry<T> = {
  channel: RealtimeChannel
  callbacks: Set<(payload: T[]) => void>
  data: T[]
}

export type CreateItemResult =
  | { mode: 'online'; itemId: string }
  | { mode: 'offline'; itemId: string; operationId: string }

const CANONICAL_TRANSACTION_PREFIXES = ['INV_PURCHASE_', 'INV_SALE_', 'INV_TRANSFER_'] as const

export const isCanonicalTransactionId = (transactionId: string | null | undefined): boolean => {
  if (!transactionId) return false
  return CANONICAL_TRANSACTION_PREFIXES.some(prefix => transactionId.startsWith(prefix))
}

const transactionRealtimeEntries = new Map<string, SharedRealtimeEntry<Transaction>>()
let transactionChannelCounter = 0
const projectItemsRealtimeEntries = new Map<string, SharedRealtimeEntry<Item>>()
let projectItemsChannelCounter = 0

function syncProjectItemsRealtimeSnapshot(accountId: string, projectId: string, nextItems: Item[]) {
  const key = `${accountId}:${projectId}`
  const entry = projectItemsRealtimeEntries.get(key)
  if (!entry) return
  // Keep realtime cache aligned with server-truth so future events diff correctly.
  entry.data = [...nextItems]
}

async function cacheItemsOffline(rows: any[]) {
  if (!rows || rows.length === 0) return
  try {
    const filteredRows = await filterRowsWithPendingWrites(rows, 'item', row => row?.item_id ?? row?.id ?? null)
    if (filteredRows.length === 0) {
      return
    }
    await offlineStore.init()
    const dbItems: DBItem[] = filteredRows.map(mapSupabaseItemToOfflineRecord)
    await offlineStore.saveItems(dbItems)
  } catch (error) {
    console.warn('Failed to cache items offline:', error)
  }
}

async function cacheTransactionsOffline(rows: any[]) {
  if (!rows || rows.length === 0) return
  try {
    const filteredRows = await filterRowsWithPendingWrites(
      rows,
      'transaction',
      row => row?.transaction_id ?? row?.id ?? null
    )
    if (filteredRows.length === 0) {
      return
    }
    await offlineStore.init()
    const dbTransactions: DBTransaction[] = filteredRows.map(mapSupabaseTransactionToOfflineRecord)
    await offlineStore.saveTransactions(dbTransactions)
  } catch (error) {
    console.warn('Failed to cache transactions offline:', error)
  }
}

async function cacheProjectsOffline(rows: any[]) {
  if (!rows || rows.length === 0) return
  try {
    const filteredRows = await filterRowsWithPendingWrites(rows, 'project', row => row?.id ?? null)
    if (filteredRows.length === 0) {
      return
    }
    await offlineStore.init()
    const dbProjects: DBProject[] = filteredRows.map(mapSupabaseProjectToOfflineRecord)
    await offlineStore.saveProjects(dbProjects)
  } catch (error) {
    console.warn('Failed to cache projects offline:', error)
  }
}

async function filterRowsWithPendingWrites<T>(
  rows: T[],
  entityType: 'item' | 'transaction' | 'project',
  getId: (row: T) => string | null | undefined
): Promise<T[]> {
  try {
    const pendingIds = await operationQueue.getEntityIdsWithPendingWrites(entityType)
    if (pendingIds.size === 0) {
      return rows
    }

    return rows.filter(row => {
      const entityId = getId(row)
      if (!entityId) {
        return true
      }
      if (pendingIds.has(entityId)) {
        if (import.meta.env.DEV) {
          console.info('[cache] skipping offline persistence to preserve pending writes', {
            entityType,
            entityId
          })
        }
        return false
      }
      return true
    })
  } catch (error) {
    console.debug(`Unable to inspect pending ${entityType} writes before caching`, error)
    return rows
  }
}

function mapSupabaseItemToOfflineRecord(row: any): DBItem {
  const converted = convertTimestamps(row)
  const nowIso = new Date().toISOString()

  return {
    itemId: converted.item_id ?? converted.id,
    accountId: converted.account_id,
    projectId: converted.project_id ?? null,
    transactionId: converted.transaction_id ?? null,
    previousProjectTransactionId: converted.previous_project_transaction_id ?? null,
    previousProjectId: converted.previous_project_id ?? null,
    name: converted.name ?? undefined,
    description: converted.description ?? '',
    source: converted.source ?? '',
    sku: converted.sku ?? '',
    price: converted.price ?? undefined,
    purchasePrice: converted.purchase_price ?? undefined,
    projectPrice: converted.project_price ?? undefined,
    marketValue: converted.market_value ?? undefined,
    paymentMethod: converted.payment_method ?? '',
    disposition: converted.disposition ?? undefined,
    notes: converted.notes ?? undefined,
    space: converted.space ?? undefined,
    qrKey: converted.qr_key ?? '',
    bookmark: converted.bookmark ?? false,
    dateCreated: converted.date_created ?? converted.created_at ?? nowIso,
    lastUpdated: converted.last_updated ?? converted.updated_at ?? nowIso,
    createdAt: converted.created_at ?? converted.date_created ?? nowIso,
    images: Array.isArray(converted.images) ? converted.images : [],
    taxRatePct: converted.tax_rate_pct != null ? Number(converted.tax_rate_pct) : undefined,
    taxAmountPurchasePrice: converted.tax_amount_purchase_price ?? undefined,
    taxAmountProjectPrice: converted.tax_amount_project_price ?? undefined,
    createdBy: converted.created_by ?? undefined,
    inventoryStatus: converted.inventory_status ?? undefined,
    businessInventoryLocation: converted.business_inventory_location ?? undefined,
    originTransactionId: converted.origin_transaction_id ?? null,
    latestTransactionId: converted.latest_transaction_id ?? null,
    version: converted.version ?? 1,
    last_synced_at: nowIso
  }
}

function mapOfflineItemToSupabaseShape(item: DBItem) {
  return {
    item_id: item.itemId,
    account_id: item.accountId,
    project_id: item.projectId ?? null,
    transaction_id: item.transactionId ?? null,
    previous_project_transaction_id: item.previousProjectTransactionId ?? null,
    previous_project_id: item.previousProjectId ?? null,
    name: item.name ?? '',
    description: item.description ?? '',
    source: item.source ?? '',
    sku: item.sku ?? '',
    purchase_price: item.purchasePrice ?? null,
    project_price: item.projectPrice ?? null,
    market_value: item.marketValue ?? null,
    payment_method: item.paymentMethod ?? '',
    disposition: item.disposition ?? null,
    notes: item.notes ?? null,
    space: item.space ?? null,
    qr_key: item.qrKey ?? '',
    bookmark: item.bookmark ?? false,
    date_created: item.dateCreated,
    created_at: item.createdAt ?? item.dateCreated,
    last_updated: item.lastUpdated,
    updated_at: item.lastUpdated,
    images: item.images ?? [],
    tax_rate_pct: item.taxRatePct ?? null,
    tax_amount_purchase_price: item.taxAmountPurchasePrice ?? null,
    tax_amount_project_price: item.taxAmountProjectPrice ?? null,
    created_by: item.createdBy ?? null,
    inventory_status: item.inventoryStatus ?? null,
    business_inventory_location: item.businessInventoryLocation ?? null,
    origin_transaction_id: item.originTransactionId ?? null,
    latest_transaction_id: item.latestTransactionId ?? null,
    version: item.version ?? 1
  }
}

function mapSupabaseTransactionToOfflineRecord(row: any): DBTransaction {
  const converted = convertTimestamps(row)
  return {
    transactionId: converted.transaction_id,
    accountId: converted.account_id,
    projectId: converted.project_id ?? null,
    transactionDate: converted.transaction_date,
    source: converted.source || '',
    transactionType: converted.transaction_type || '',
    paymentMethod: converted.payment_method || '',
    amount: converted.amount || '0.00',
    budgetCategory: converted.budget_category || undefined,
    categoryId: converted.category_id || undefined,
    notes: converted.notes || undefined,
    receiptEmailed: converted.receipt_emailed ?? false,
    createdAt: converted.created_at,
    createdBy: converted.created_by || '',
    status: converted.status || undefined,
    reimbursementType: converted.reimbursement_type || undefined,
    triggerEvent: converted.trigger_event || undefined,
    taxRatePreset: converted.tax_rate_preset || undefined,
    taxRatePct: converted.tax_rate_pct ? Number(converted.tax_rate_pct) : undefined,
    subtotal: converted.subtotal || undefined,
    needsReview: converted.needs_review ?? undefined,
    sumItemPurchasePrices: converted.sum_item_purchase_prices !== undefined ? String(converted.sum_item_purchase_prices) : undefined,
    itemIds: Array.isArray(converted.item_ids) ? converted.item_ids : [],
    version: converted.version ?? 1,
    last_synced_at: new Date().toISOString()
  }
}

function mapSupabaseProjectToOfflineRecord(row: any): DBProject {
  const converted = convertTimestamps(row)
  return {
    id: converted.id,
    accountId: converted.account_id,
    name: converted.name || '',
    description: converted.description || '',
    clientName: converted.client_name || '',
    budget: converted.budget !== undefined && converted.budget !== null ? Number(converted.budget) : undefined,
    designFee: converted.design_fee !== undefined && converted.design_fee !== null ? Number(converted.design_fee) : undefined,
    budgetCategories: converted.budget_categories || undefined,
    defaultCategoryId: converted.default_category_id ?? null,
    mainImageUrl: converted.main_image_url || undefined,
    createdAt: converted.created_at,
    updatedAt: converted.updated_at,
    createdBy: converted.created_by || '',
    settings: converted.settings || undefined,
    metadata: converted.metadata || undefined,
    itemCount: converted.item_count ?? 0,
    transactionCount: converted.transaction_count ?? 0,
    totalValue: converted.total_value !== undefined && converted.total_value !== null ? Number(converted.total_value) : undefined,
    version: converted.version ?? 1,
    last_synced_at: new Date().toISOString()
  }
}

function mapOfflineProjectToProject(project: DBProject): Project {
  return {
    id: project.id,
    accountId: project.accountId,
    name: project.name,
    description: project.description || '',
    clientName: project.clientName || '',
    budget: project.budget,
    designFee: project.designFee,
    budgetCategories: project.budgetCategories,
    defaultCategoryId: project.defaultCategoryId ?? undefined,
    mainImageUrl: project.mainImageUrl,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    createdBy: project.createdBy || '',
    settings: (project.settings ?? undefined) as Project['settings'],
    metadata: (project.metadata ?? undefined) as Project['metadata'],
    itemCount: project.itemCount ?? 0,
    transactionCount: project.transactionCount ?? 0,
    totalValue: project.totalValue ?? 0
  }
}

async function getProjectFromOfflineCache(accountId: string, projectId: string): Promise<Project | null> {
  try {
    await offlineStore.init()
    const cached = await offlineStore.getProjectById(projectId)
    if (!cached) return null
    if (cached.accountId && cached.accountId !== accountId) {
      return null
    }
    return mapOfflineProjectToProject(cached)
  } catch (error) {
    console.debug('Failed to read project from offline cache:', error)
    return null
  }
}

function mapOfflineTransactionToSupabaseShape(tx: DBTransaction) {
  return {
    transaction_id: tx.transactionId,
    account_id: tx.accountId,
    project_id: tx.projectId ?? null,
    transaction_date: tx.transactionDate,
    source: tx.source ?? '',
    transaction_type: tx.transactionType ?? '',
    payment_method: tx.paymentMethod ?? '',
    amount: tx.amount ?? '0.00',
    budget_category: tx.budgetCategory ?? null,
    category_id: tx.categoryId ?? null,
    notes: tx.notes ?? null,
    receipt_emailed: tx.receiptEmailed ?? false,
    created_at: tx.createdAt,
    created_by: tx.createdBy ?? '',
    status: tx.status ?? null,
    reimbursement_type: tx.reimbursementType ?? null,
    trigger_event: tx.triggerEvent ?? null,
    tax_rate_preset: tx.taxRatePreset ?? null,
    tax_rate_pct: tx.taxRatePct ?? null,
    subtotal: tx.subtotal ?? null,
    needs_review: tx.needsReview ?? null,
    sum_item_purchase_prices: tx.sumItemPurchasePrices ?? null,
    item_ids: tx.itemIds ?? [],
    version: tx.version ?? 1
  }
}

function applyItemFiltersOffline(items: Item[], filters?: FilterOptions) {
  if (!filters) return items
  let result = [...items]

  if (filters.status) {
    result = result.filter(item => item.disposition === filters.status)
  }

  if (filters.category) {
    result = result.filter(item => (item.source || '').toLowerCase() === filters.category?.toLowerCase())
  }

  if (filters.priceRange) {
    result = result.filter(item => {
      const value = parseFloat(item.projectPrice || item.purchasePrice || '0')
      return value >= filters.priceRange!.min && value <= filters.priceRange!.max
    })
  }

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase()
    result = result.filter(item => {
      return (
        (item.description || '').toLowerCase().includes(query) ||
        (item.source || '').toLowerCase().includes(query) ||
        (item.sku || '').toLowerCase().includes(query) ||
        (item.paymentMethod || '').toLowerCase().includes(query)
      )
    })
  }

  return result
}

function applyPagination<T>(items: T[], pagination?: PaginationOptions) {
  if (!pagination) return items
  const page = Math.max(1, pagination.page)
  const start = (page - 1) * pagination.limit
  return items.slice(start, start + pagination.limit)
}

function sortItemsOffline(items: Item[]) {
  return [...items].sort((a, b) => {
    const aDate = new Date(a.dateCreated || a.lastUpdated || 0).getTime()
    const bDate = new Date(b.dateCreated || b.lastUpdated || 0).getTime()
    return bDate - aDate
  })
}

function sortTransactionsOffline(transactions: Transaction[]) {
  return [...transactions].sort((a, b) => {
    const aDate = new Date(a.createdAt || a.transactionDate || 0).getTime()
    const bDate = new Date(b.createdAt || b.transactionDate || 0).getTime()
    return bDate - aDate
  })
}

async function detachItemsFromTransaction(accountId: string, transactionId: string): Promise<string[]> {
  await ensureAuthenticatedForDatabase()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('items')
    .update({
      transaction_id: null,
      latest_transaction_id: null,
      previous_project_transaction_id: transactionId,
      last_updated: nowIso,
    })
    .eq('account_id', accountId)
    .eq('transaction_id', transactionId)
    .select('item_id')

  if (error) {
    console.error('detachItemsFromTransaction - failed to clear transaction references', {
      accountId,
      transactionId,
      error,
    })
    throw error
  }

  return (data ?? []).map(row => row.item_id as string)
}

type ChannelSubscriptionOptions = {
  onStatusChange?: (status: string, error?: unknown) => void
}

// Audit Logging Service for allocation/de-allocation events
export const auditService = {
  // Log allocation/de-allocation events
  async logAllocationEvent(
    accountId: string,
    eventType: 'allocation' | 'deallocation' | 'to return',
    itemId: string,
    projectId: string | null,
    transactionIdOrDetails: any,
    detailsOrUndefined?: Record<string, any>
  ): Promise<void> {
    try {
      // Handle different calling patterns
      let transactionId: string | null | undefined = null
      let details: Record<string, any> = {}

      if (typeof transactionIdOrDetails === 'string') {
        transactionId = transactionIdOrDetails
        details = detailsOrUndefined || {}
      } else {
        transactionId = null
        details = transactionIdOrDetails || {}
      }

      const { error } = await supabase
        .from('item_audit_logs')
        .insert({
          account_id: accountId,
          event_type: eventType,
          item_id: itemId,
          project_id: projectId,
          transaction_id: transactionId,
          details: details,
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString()
        })

      if (error) {
        console.warn('⚠️ Failed to log audit event (non-critical):', error)
      } else {
        console.log(`📋 Audit logged: ${eventType} for item ${itemId}`)
      }
    } catch (error) {
      console.warn('⚠️ Failed to log audit event (non-critical):', error)
      // Don't throw - audit logging failures shouldn't break the main flow
    }
  },

  // Log transaction state changes
  async logTransactionStateChange(
    accountId: string,
    transactionId: string,
    changeType: 'created' | 'updated' | 'deleted',
    oldState?: any,
    newState?: any
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('transaction_audit_logs')
        .insert({
          account_id: accountId,
          transaction_id: transactionId,
          change_type: changeType,
          old_state: oldState || null,
          new_state: newState || null,
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString()
        })

      if (error) {
        console.warn('⚠️ Failed to log transaction audit (non-critical):', error)
      } else {
        console.log(`📋 Transaction audit logged: ${changeType} for ${transactionId}`)
      }
    } catch (error) {
      console.warn('⚠️ Failed to log transaction audit (non-critical):', error)
      // Don't throw - audit logging failures shouldn't break the main flow
    }
  }
}

// Project Services
export const projectService = {
  // Get all projects for current account
  async getProjects(accountId: string): Promise<Project[]> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })

    if (error) throw error

    // Cache projects offline for offline access
    if (data && data.length > 0) {
      void cacheProjectsOffline(data)
    }

    return (data || []).map(project => {
      const converted = convertTimestamps(project)
      return {
        id: converted.id,
        accountId: converted.account_id,
        name: converted.name,
        description: converted.description || '',
        clientName: converted.client_name || '',
        budget: converted.budget ? parseFloat(converted.budget) : undefined,
        designFee: converted.design_fee ? parseFloat(converted.design_fee) : undefined,
        budgetCategories: converted.budget_categories || undefined,
        mainImageUrl: converted.main_image_url || undefined,
        createdAt: converted.created_at,
        updatedAt: converted.updated_at,
        createdBy: converted.created_by,
        settings: converted.settings || undefined,
        metadata: converted.metadata || undefined,
        itemCount: converted.item_count || 0,
        transactionCount: converted.transaction_count || 0,
        totalValue: converted.total_value ? parseFloat(converted.total_value) : 0
      } as Project
    })
  },

  // Get single project
  async getProject(accountId: string, projectId: string): Promise<Project | null> {
    // Check React Query cache first (for optimistic projects created offline)
    try {
      const queryClient = tryGetQueryClient()
      if (queryClient) {
        const cachedProject = queryClient.getQueryData<Project>(['project', accountId, projectId])
        if (cachedProject) {
          return cachedProject
        }
      }
    } catch (error) {
      // Non-fatal - continue to network fetch
      console.debug('Failed to check React Query cache for project:', error)
    }

    const offlineProject = await getProjectFromOfflineCache(accountId, projectId)
    if (offlineProject) {
      try {
        const queryClient = tryGetQueryClient()
        if (queryClient) {
          queryClient.setQueryData(['project', accountId, projectId], offlineProject)
        }
      } catch (cacheError) {
        console.debug('Failed to prime React Query with offline project:', cacheError)
      }
    }

    if (!isNetworkOnline()) {
      return offlineProject
    }

    try {
      await ensureAuthenticatedForDatabase()

      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('account_id', accountId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        throw error
      }

      if (!data) return null

      void cacheProjectsOffline([data])

      const project = this._convertProjectFromDb(data)

      // Update React Query cache with fetched project
      try {
        const queryClient = tryGetQueryClient()
        if (queryClient) {
          queryClient.setQueryData(['project', accountId, projectId], project)
        }
      } catch (cacheError) {
        // Non-fatal - cache update failed
        console.debug('Failed to update React Query cache for project:', cacheError)
      }

      return project
    } catch (error) {
      console.warn('Failed to fetch project online, using offline cache when available:', error)
      if (offlineProject) {
        return offlineProject
      }
      throw error
    }
  },

  // Create new project
  async createProject(accountId: string, projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    // Generate optimistic ID upfront so we always have one, even if operations fail
    const optimisticProjectId = `P-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    
    const queueOfflineCreate = async (reason: 'offline' | 'fallback' | 'timeout'): Promise<string> => {
      try {
        const { offlineProjectService } = await import('./offlineProjectService')
        const result = await offlineProjectService.createProject(accountId, projectData)
        if (import.meta.env.DEV) {
          console.info('[projectService] createProject queued for offline processing', {
            accountId,
            projectId: result.projectId,
            operationId: result.operationId,
            reason
          })
        }
        return result.projectId ?? optimisticProjectId
      } catch (error) {
        // Propagate typed errors that the UI should handle
        if (error instanceof OfflineQueueUnavailableError || error instanceof OfflineContextError) {
          console.error('[projectService] typed error during offline queue, propagating', {
            accountId,
            projectId: optimisticProjectId,
            reason,
            errorType: error.constructor.name,
            errorMessage: error.message
          })
          throw error
        }
        
        // For unexpected errors, return optimistic ID so UI can still show feedback
        console.error('[projectService] unexpected error during offline queue, returning optimistic ID', {
          accountId,
          projectId: optimisticProjectId,
          reason,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error
        })
        return optimisticProjectId
      }
    }

    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      await offlineStore.getProjects().catch(() => [])
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    if (!isNetworkOnline()) {
      return queueOfflineCreate('offline')
    }

    try {
      await ensureAuthenticatedForDatabase()

      const { data, error } = await withNetworkTimeout(async () => {
        return await supabase
          .from('projects')
          .insert({
            account_id: accountId,
            name: projectData.name,
            description: projectData.description || null,
            client_name: projectData.clientName || null,
            budget: projectData.budget || null,
            design_fee: projectData.designFee || null,
            budget_categories: projectData.budgetCategories || {},
            main_image_url: projectData.mainImageUrl || null,
            // default_category_id removed - default category is now account-wide preset
            settings: projectData.settings || {},
            metadata: projectData.metadata || {},
            created_by: projectData.createdBy,
            item_count: 0,
            transaction_count: 0,
            total_value: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single()
      })

      if (error) throw error
      return data.id
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase insert timed out, queuing project for offline sync.')
        return queueOfflineCreate('timeout')
      }
      console.warn('Failed to create project online, falling back to offline queue:', error)
      return queueOfflineCreate('fallback')
    }
  },

  // Update project
  async updateProject(accountId: string, projectId: string, updates: Partial<Project>): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineProject = await offlineStore.getProjectById(projectId).catch(() => null)
      if (existingOfflineProject) {
        // Pre-hydrate React Query cache if needed
        // This prevents empty state flashes
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineProjectService
    if (!online) {
      const { offlineProjectService } = await import('./offlineProjectService')
      await offlineProjectService.updateProject(accountId, projectId, updates)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()

      const updateData: any = {
        updated_at: new Date().toISOString()
      }

      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.description !== undefined) updateData.description = updates.description
      if (updates.clientName !== undefined) updateData.client_name = updates.clientName
      if (updates.budget !== undefined) updateData.budget = updates.budget
      if (updates.designFee !== undefined) updateData.design_fee = updates.designFee
      if (updates.budgetCategories !== undefined) updateData.budget_categories = updates.budgetCategories
      if (updates.mainImageUrl !== undefined) updateData.main_image_url = updates.mainImageUrl || null
      // defaultCategoryId updates removed - default category is now account-wide preset
      if (updates.settings !== undefined) updateData.settings = updates.settings
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('projects')
          .update(updateData)
          .eq('id', projectId)
          .eq('account_id', accountId)

        if (error) throw error
      })
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase update timed out, queuing project update for offline sync.')
        const { offlineProjectService } = await import('./offlineProjectService')
        await offlineProjectService.updateProject(accountId, projectId, updates)
        return
      }
      console.warn('Failed to update project online, falling back to offline queue:', error)
      const { offlineProjectService } = await import('./offlineProjectService')
      await offlineProjectService.updateProject(accountId, projectId, updates)
    }
  },

  // Delete project
  async deleteProject(accountId: string, projectId: string): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineProject = await offlineStore.getProjectById(projectId).catch(() => null)
      if (existingOfflineProject) {
        // Pre-hydrate React Query cache if needed
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineProjectService
    if (!online) {
      const { offlineProjectService } = await import('./offlineProjectService')
      await offlineProjectService.deleteProject(accountId, projectId)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('projects')
          .delete()
          .eq('id', projectId)
          .eq('account_id', accountId)

        if (error) throw error
      })
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase delete timed out, queuing project delete for offline sync.')
        const { offlineProjectService } = await import('./offlineProjectService')
        await offlineProjectService.deleteProject(accountId, projectId)
        return
      }
      console.warn('Failed to delete project online, falling back to offline queue:', error)
      const { offlineProjectService } = await import('./offlineProjectService')
      await offlineProjectService.deleteProject(accountId, projectId)
    }
  },

  // Subscribe to projects with real-time updates
  subscribeToProjects(
    accountId: string,
    callback: (projects: Project[]) => void,
    initialProjects?: Project[]
  ) {
    let projects = [...(initialProjects || [])]

    const channel = supabase
      .channel(`projects:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects'
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload
          const recordAccountId = (eventType === 'DELETE' ? oldRecord?.account_id : newRecord?.account_id) ?? null
          if (recordAccountId && recordAccountId !== accountId) {
            return
          }

          console.log('Projects change received!', payload)

          if (eventType === 'INSERT') {
            const newProject = projectService._convertProjectFromDb(newRecord)
            projects = [newProject, ...projects]
          } else if (eventType === 'UPDATE') {
            const updatedProject = projectService._convertProjectFromDb(newRecord)
            projects = projects.map(p => p.id === updatedProject.id ? updatedProject : p)
          } else if (eventType === 'DELETE') {
            const oldId = oldRecord.id
            projects = projects.filter(p => p.id !== oldId)
          }
          
          callback([...projects])
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to projects channel')
        }
        if (err) {
          console.error('Error subscribing to projects channel:', err)
        }
      })

    return () => {
      channel.unsubscribe()
    }
  },

  // Helper function to convert database project to Project type
  _convertProjectFromDb(dbProject: any): Project {
    const converted = convertTimestamps(dbProject)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      description: converted.description || '',
      clientName: converted.client_name || '',
      budget: converted.budget ? parseFloat(converted.budget) : undefined,
      designFee: converted.design_fee ? parseFloat(converted.design_fee) : undefined,
      budgetCategories: converted.budget_categories || undefined,
      mainImageUrl: converted.main_image_url || undefined,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at,
      createdBy: converted.created_by,
      settings: converted.settings || undefined,
      metadata: converted.metadata || undefined,
      itemCount: converted.item_count || 0,
      transactionCount: converted.transaction_count || 0,
      totalValue: converted.total_value ? parseFloat(converted.total_value) : 0
    } as Project
  }
}

// Item Services (REMOVED - migrated to unifiedItemsService)
// This service was completely removed after successful migration to unified collection

// Transaction conversion functions
function _convertTransactionFromDb(dbTransaction: any): Transaction {
  const converted = convertTimestamps(dbTransaction)
  return {
    rowId: converted.id,
    transactionId: converted.transaction_id,
    projectId: converted.project_id || undefined,
    projectName: converted.project_name || undefined, // May be populated by enrichment function
    transactionDate: converted.transaction_date,
    source: converted.source || '',
    transactionType: converted.transaction_type || '',
    paymentMethod: converted.payment_method || '',
    amount: converted.amount || '0.00',
    budgetCategory: converted.budget_category || undefined, // Legacy field
    categoryId: converted.category_id || undefined, // New field
    notes: converted.notes || undefined,
    transactionImages: Array.isArray(converted.transaction_images) ? converted.transaction_images : [],
    receiptImages: Array.isArray(converted.receipt_images) ? converted.receipt_images : [],
    otherImages: Array.isArray(converted.other_images) ? converted.other_images : [],
    receiptEmailed: converted.receipt_emailed || false,
    createdAt: converted.created_at,
    createdBy: converted.created_by || '',
    status: converted.status || 'completed',
    reimbursementType: converted.reimbursement_type || undefined,
    triggerEvent: converted.trigger_event || undefined,
    itemIds: Array.isArray(converted.item_ids) ? converted.item_ids : [],
    taxRatePreset: converted.tax_rate_preset || undefined,
    taxRatePct: converted.tax_rate_pct ? parseFloat(converted.tax_rate_pct) : undefined,
    subtotal: converted.subtotal || undefined,
    // Map DB snake_case needs_review -> camelCase needsReview for the client
    needsReview: converted.needs_review === true,
    // Map persisted derived sum of item purchase prices (numeric stored as string/number in DB)
    sumItemPurchasePrices: converted.sum_item_purchase_prices !== undefined ? String(converted.sum_item_purchase_prices) : '0.00'
  } as Transaction
}

/**
 * Enriches transactions with project names by looking them up from project_id
 * This ensures projectName is always available for display without storing it in the database
 */
async function _enrichTransactionsWithProjectNames(
  accountId: string,
  transactions: Transaction[],
  projects?: Project[]
): Promise<Transaction[]> {
  // Extract unique project IDs (excluding null/undefined)
  const projectIds = [...new Set(transactions
    .map(tx => tx.projectId)
    .filter((id): id is string => !!id)
  )]

  if (projectIds.length === 0) {
    // No projects to look up, return as-is
    return transactions
  }

  // Batch fetch all projects
  const projectMap = new Map<string, string>()
  
  // Use provided projects if available
  if (projects && projects.length > 0) {
    projects.forEach(project => {
      projectMap.set(project.id, project.name)
    })
  } else {
    // Only fetch from network if online
    if (isNetworkOnline()) {
      try {
        const fetchedProjects = await projectService.getProjects(accountId)
        fetchedProjects.forEach(project => {
          projectMap.set(project.id, project.name)
        })
      } catch (error) {
        console.warn('Failed to fetch projects for transaction enrichment:', error)
        // Continue without enrichment rather than failing
      }
    } else {
      // Offline: try to use cached projects from offlineStore
      try {
        await offlineStore.init()
        const cachedProjects = await offlineStore.getProjects()
        cachedProjects.forEach(project => {
          // Convert DBProject to Project format for name lookup
          projectMap.set(project.id, project.name)
        })
      } catch (error) {
        console.warn('Failed to load cached projects for transaction enrichment:', error)
        // Continue without enrichment rather than failing
      }
    }
  }

  // Enrich transactions with project names
  return transactions.map(tx => {
    if (tx.projectId && !tx.projectName) {
      const projectName = projectMap.get(tx.projectId)
      if (projectName) {
        return { ...tx, projectName }
      }
    }
    return tx
  })
}

function _convertTransactionToDb(transaction: Partial<Transaction>): any {
  const dbTransaction: any = {}
  
  if (transaction.transactionId !== undefined) dbTransaction.transaction_id = transaction.transactionId
  if (transaction.projectId !== undefined) dbTransaction.project_id = transaction.projectId ?? null
  if (transaction.transactionDate !== undefined) dbTransaction.transaction_date = transaction.transactionDate
  if (transaction.source !== undefined) dbTransaction.source = transaction.source
  if (transaction.transactionType !== undefined) dbTransaction.transaction_type = transaction.transactionType
  if (transaction.paymentMethod !== undefined) dbTransaction.payment_method = transaction.paymentMethod
  if (transaction.amount !== undefined) dbTransaction.amount = transaction.amount
  if (transaction.budgetCategory !== undefined) dbTransaction.budget_category = transaction.budgetCategory // Legacy field
  if (transaction.categoryId !== undefined) dbTransaction.category_id = transaction.categoryId ?? null // New field
  if (transaction.notes !== undefined) dbTransaction.notes = transaction.notes
  if (transaction.transactionImages !== undefined) dbTransaction.transaction_images = transaction.transactionImages
  if (transaction.receiptImages !== undefined) dbTransaction.receipt_images = transaction.receiptImages
  if (transaction.otherImages !== undefined) dbTransaction.other_images = transaction.otherImages
  if (transaction.receiptEmailed !== undefined) dbTransaction.receipt_emailed = transaction.receiptEmailed
  if (transaction.createdAt !== undefined) dbTransaction.created_at = transaction.createdAt
  if (transaction.createdBy !== undefined) dbTransaction.created_by = transaction.createdBy
  if (transaction.status !== undefined) dbTransaction.status = transaction.status
  if (transaction.reimbursementType !== undefined) dbTransaction.reimbursement_type = transaction.reimbursementType
  if (transaction.triggerEvent !== undefined) dbTransaction.trigger_event = transaction.triggerEvent
  if (transaction.itemIds !== undefined) dbTransaction.item_ids = transaction.itemIds
  if (transaction.taxRatePreset !== undefined) dbTransaction.tax_rate_preset = transaction.taxRatePreset
  if (transaction.taxRatePct !== undefined) dbTransaction.tax_rate_pct = transaction.taxRatePct
  if (transaction.subtotal !== undefined) dbTransaction.subtotal = transaction.subtotal
  if (transaction.needsReview !== undefined) dbTransaction.needs_review = transaction.needsReview
  if (transaction.sumItemPurchasePrices !== undefined) dbTransaction.sum_item_purchase_prices = transaction.sumItemPurchasePrices
  
  return dbTransaction
}

/**
 * Adjust the persisted sum_item_purchase_prices for a transaction.
 * Note: This implementation reads the current value then writes the adjusted value.
 * For strict atomicity prefer a DB-side RPC or function (left as an improvement).
 */
async function _adjustSumItemPurchasePrices(accountId: string, transactionId: string, delta: number | string): Promise<string> {
  await ensureAuthenticatedForDatabase()

  // Read current value
  const { data, error } = await supabase
    .from('transactions')
    .select('sum_item_purchase_prices')
    .eq('account_id', accountId)
    .eq('transaction_id', transactionId)
    .single()

  if (error) throw error

  const currentRaw: any = (data && (data as any).sum_item_purchase_prices) || '0'
  const current = parseFloat(String(currentRaw) || '0')
  const deltaNum = parseFloat(String(delta) || '0')
  const newSum = current + deltaNum
  const newSumStr = newSum.toFixed(2)

  const { error: updateError } = await supabase
    .from('transactions')
    .update({ sum_item_purchase_prices: newSumStr })
    .eq('account_id', accountId)
    .eq('transaction_id', transactionId)

  if (updateError) throw updateError
  return newSumStr
}

// NOTE: Database trigger `trg_items_after_delete_sync_item_ids` (see
// `supabase/migrations/20251231_sync_transaction_item_ids_on_delete.sql`) also
// removes orphaned IDs when an item row is deleted outside the app. This
// helper remains necessary for app-driven reallocations/mutations so the UI
// can observe changes without waiting for the trigger to run.
async function _updateTransactionItemIds(
  accountId: string,
  transactionId: string | null | undefined,
  itemIdsInput: string | string[],
  action: 'add' | 'remove'
): Promise<void> {
  if (!transactionId) return

  const pendingItemIds = (Array.isArray(itemIdsInput) ? itemIdsInput : [itemIdsInput])
    .filter((id): id is string => Boolean(id && id.trim()))
  if (pendingItemIds.length === 0) return

  await ensureAuthenticatedForDatabase()

  const { data, error } = await supabase
    .from('transactions')
    .select('item_ids')
    .eq('account_id', accountId)
    .eq('transaction_id', transactionId)
    .single()

  if (error || !data) {
    console.warn('⚠️ Failed to load transaction for item_ids sync:', transactionId, error)
    return
  }

  const currentItemIds: string[] = Array.isArray(data.item_ids) ? data.item_ids : []
  let updatedItemIds: string[] = currentItemIds

  if (action === 'add') {
    let mutated = false
    updatedItemIds = [...currentItemIds]
    for (const id of pendingItemIds) {
      if (!updatedItemIds.includes(id)) {
        updatedItemIds.push(id)
        mutated = true
      }
    }
    if (!mutated) return
  } else {
    const removalSet = new Set(pendingItemIds)
    updatedItemIds = currentItemIds.filter(id => !removalSet.has(id))
    if (updatedItemIds.length === currentItemIds.length) return
  }

  const { error: updateError } = await supabase
    .from('transactions')
    .update({
      item_ids: updatedItemIds,
      updated_at: new Date().toISOString()
    })
    .eq('account_id', accountId)
    .eq('transaction_id', transactionId)

  if (updateError) {
    console.warn('⚠️ Failed to update transaction item_ids during sync:', transactionId, updateError)
  }
}

// Transaction Services
export const transactionService = {
  async adjustSumItemPurchasePrices(accountId: string, transactionId: string, delta: number | string): Promise<string> {
    return await _adjustSumItemPurchasePrices(accountId, transactionId, delta)
  },
  async notifyTransactionChanged(accountId: string, transactionId: string, opts?: { deltaSum?: number | string; flushImmediately?: boolean }): Promise<void> {
    // If a delta for the derived sum was provided, adjust the persisted sum first
    if (opts && opts.deltaSum !== undefined) {
      try {
        await _adjustSumItemPurchasePrices(accountId, transactionId, opts.deltaSum)
      } catch (e) {
        console.warn('notifyTransactionChanged - failed to adjust sum_item_purchase_prices:', e)
      }
    }

    // Enqueue recompute; if flushImmediately requested, set debounceMs = 0
    const debounceMs = opts && opts.flushImmediately ? 0 : undefined
    try {
      // projectId unknown here; pass null so recompute reads transaction directly
      if (debounceMs === 0) {
        this._enqueueRecomputeNeedsReview(accountId, null, transactionId, 0).catch((e: any) => {
          console.warn('Failed to recompute needs_review in notifyTransactionChanged (immediate):', e)
        })
      } else {
        this._enqueueRecomputeNeedsReview(accountId, null, transactionId).catch((e: any) => {
          console.warn('Failed to recompute needs_review in notifyTransactionChanged:', e)
        })
      }
    } catch (e) {
      console.warn('notifyTransactionChanged - enqueue failed:', e)
    }
  },
  // Get transactions for a project (account-scoped)
  async getTransactions(accountId: string, projectId: string): Promise<Transaction[]> {
    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })

        if (error) throw error
        void cacheTransactionsOffline(data || [])

        const transactions = (data || []).map(tx => _convertTransactionFromDb(tx))
        return await _enrichTransactionsWithProjectNames(accountId, transactions)
      } catch (error) {
        console.warn('Failed to fetch project transactions from network, using offline cache:', error)
      }
    }

    return await this._getTransactionsOffline(accountId, projectId)
  },

  // Get transactions for multiple projects (account-scoped)
  async getTransactionsForProjects(accountId: string, projectIds: string[], projects?: Project[]): Promise<Transaction[]> {
    if (projectIds.length === 0) {
      return []
    }

    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })

        if (error) throw error
        void cacheTransactionsOffline(data || [])

        const transactions = (data || []).map(tx => _convertTransactionFromDb(tx))
        return await _enrichTransactionsWithProjectNames(accountId, transactions, projects)
      } catch (error) {
        console.warn('Failed to fetch multi-project transactions, using offline cache:', error)
      }
    }

    return await this._getTransactionsForProjectsOffline(accountId, projectIds, projects)
  },

  // Get single transaction (account-scoped)
  async getTransaction(accountId: string, _projectId: string, transactionId: string): Promise<Transaction | null> {
    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            return null
          }
          throw error
        }

        if (!data) return null
        void cacheTransactionsOffline([data])

        const transaction = _convertTransactionFromDb(data)
        const enriched = await _enrichTransactionsWithProjectNames(accountId, [transaction])
        return enriched[0] || null
      } catch (error) {
        console.warn('Failed to fetch transaction from network, falling back to offline cache:', error)
      }
    }

    const offline = await this._getTransactionByIdOffline(accountId, transactionId)
    return offline.transaction
  },

  // Get transaction by ID across all projects (for business inventory) - account-scoped
  async getTransactionById(accountId: string, transactionId: string): Promise<{ transaction: Transaction | null; projectId: string | null }> {
    // Check React Query cache first (for optimistic transactions created offline)
    try {
      const { tryGetQueryClient } = await import('../utils/queryClient')
      const queryClient = tryGetQueryClient()
      if (queryClient) {
        const cachedTransaction = queryClient.getQueryData<Transaction>(['transaction', accountId, transactionId])
        if (cachedTransaction) {
          return {
            transaction: cachedTransaction,
            projectId: cachedTransaction.projectId ?? null
          }
        }
      }
    } catch (error) {
      // Non-fatal - continue to offline/network fetch
      console.debug('Failed to check React Query cache for transaction:', error)
    }

    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)
          .single()

        if (error || !data) {
          return { transaction: null, projectId: null }
        }

        void cacheTransactionsOffline([data])

        const converted = convertTimestamps(data)
        const transaction = _convertTransactionFromDb(data)
        const enriched = await _enrichTransactionsWithProjectNames(accountId, [transaction])

        // Update React Query cache with fetched transaction
        try {
          const { tryGetQueryClient } = await import('../utils/queryClient')
          const queryClient = tryGetQueryClient()
          if (queryClient) {
            queryClient.setQueryData(['transaction', accountId, transactionId], enriched[0] || transaction)
          }
        } catch (cacheError) {
          // Non-fatal - cache update failed
          console.debug('Failed to update React Query cache for transaction:', cacheError)
        }

        return {
          transaction: enriched[0] || transaction,
          projectId: converted.project_id || null
        }
      } catch (error) {
        console.warn('Failed to fetch transaction by ID, using offline cache:', error)
      }
    }

    return await this._getTransactionByIdOffline(accountId, transactionId)
  },

  // Calculate transaction completeness metrics
  async getTransactionCompleteness(
    accountId: string,
    projectId: string,
    transactionId: string
  ): Promise<TransactionCompleteness> {
    await ensureAuthenticatedForDatabase()

    // Get transaction and associated items. Prefer the itemIds stored on the
    // transaction record so we include deallocated/moved items that no longer
    // have this transaction_id—mirrors TransactionDetail logic. Fall back to
    // a direct items query when itemIds is empty.
    const transaction = await this.getTransaction(accountId, projectId, transactionId)

    if (!transaction) {
      throw new Error('Transaction not found')
    }

    const itemIdsFromTransaction = Array.isArray((transaction as any).itemIds)
      ? ((transaction as any).itemIds as string[])
      : []

    let items: Item[]
    if (itemIdsFromTransaction.length > 0) {
      const itemPromises = itemIdsFromTransaction.map(itemId =>
        unifiedItemsService.getItemById(accountId, itemId)
      )
      const fetched = await Promise.all(itemPromises)
      items = fetched.filter((item): item is Item => item !== null)
    } else {
      items = await unifiedItemsService.getItemsForTransaction(accountId, projectId, transactionId)
    }

    // Include items that were moved out of this transaction by consulting lineage edges.
    // The UI displays both "in transaction" and "moved out" items; completeness should
    // count both sets when the item has this transaction in its lineage.
    let combinedItems = items.slice()
    try {
      const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, accountId)
      const movedOutItemIds = Array.from(new Set(edgesFromTransaction.map(edge => edge.itemId)))

      // Fetch any moved item records that aren't already in the items list
      const missingMovedItemIds = movedOutItemIds.filter(id => !combinedItems.some(it => it.itemId === id))
      if (missingMovedItemIds.length > 0) {
        const movedItemsPromises = missingMovedItemIds.map(id => unifiedItemsService.getItemById(accountId, id))
        const movedItems = await Promise.all(movedItemsPromises)
        const validMovedItems = movedItems.filter(mi => mi !== null) as Item[]
        combinedItems = combinedItems.concat(validMovedItems)
      }
    } catch (edgeErr) {
      // Non-fatal: if lineage lookup fails, fall back to items returned by getItemsForTransaction
      console.debug('getTransactionCompleteness - failed to fetch lineage edges:', edgeErr)
    }

    // Calculate items net total using the same logic as the UI's calculated subtotal:
    // prefer projectPrice (if set) and fall back to purchasePrice.
    const resolveItemPrice = (item: Item) => {
      const candidate = item.projectPrice && item.projectPrice.trim() !== ''
        ? item.projectPrice
        : item.purchasePrice
      const parsed = parseFloat(candidate || '0')
      return isNaN(parsed) ? 0 : parsed
    }

    const itemsNetTotal = combinedItems.reduce((sum, item) => {
      return sum + resolveItemPrice(item)
    }, 0)

    const itemsCount = combinedItems.length
    const itemsMissingPriceCount = combinedItems.filter(item => {
      const candidate = item.projectPrice && item.projectPrice.trim() !== ''
        ? item.projectPrice
        : item.purchasePrice
      if (!candidate || candidate.trim() === '') return true
      const parsed = parseFloat(candidate)
      return isNaN(parsed) || parsed === 0
    }).length

    // Calculate transaction subtotal (pre-tax amount)
    const transactionAmount = parseFloat(transaction.amount || '0')
    let transactionSubtotal = 0
    let inferredTax: number | undefined
    let taxAmount: number | undefined
    let missingTaxData = false

    // If subtotal is stored, use it
    if (transaction.subtotal) {
      transactionSubtotal = parseFloat(transaction.subtotal)
    } else if (transaction.taxRatePct !== undefined && transaction.taxRatePct !== null) {
      // Infer subtotal from tax rate: subtotal = total / (1 + taxRate/100)
      const taxRate = transaction.taxRatePct / 100
      transactionSubtotal = transactionAmount / (1 + taxRate)
      inferredTax = transactionAmount - transactionSubtotal
      // Round to cents
      transactionSubtotal = Math.round(transactionSubtotal * 100) / 100
      inferredTax = Math.round(inferredTax * 100) / 100
    } else {
      // Fall back to gross total when tax data is missing
      transactionSubtotal = transactionAmount
      missingTaxData = true
    }

    // Calculate completeness ratio
    // If no items, ratio is 0; if no subtotal but items exist, treat as incomplete (100% variance)
    const completenessRatio = transactionSubtotal > 0 
      ? itemsNetTotal / transactionSubtotal 
      : (itemsCount > 0 ? 0 : 0) // 0 when no items, 0 when no subtotal (will show as incomplete)

    // Calculate variance
    const varianceDollars = itemsNetTotal - transactionSubtotal
    const variancePercent = transactionSubtotal > 0 
      ? (varianceDollars / transactionSubtotal) * 100 
      : (itemsCount > 0 ? -100 : 0) // -100% when items exist but no subtotal, 0 when no items

    // Determine completeness status based on tolerance bands
    const completenessStatus = this._calculateCompletenessStatus(completenessRatio, variancePercent)

    return {
      itemsNetTotal: Math.round(itemsNetTotal * 100) / 100,
      itemsCount,
      itemsMissingPriceCount,
      transactionSubtotal: Math.round(transactionSubtotal * 100) / 100,
      completenessRatio,
      completenessStatus,
      missingTaxData,
      inferredTax,
      taxAmount,
      varianceDollars: Math.round(varianceDollars * 100) / 100,
      variancePercent: Math.round(variancePercent * 100) / 100
    }
  },

  // Helper: Calculate completeness status from ratio and variance
  _calculateCompletenessStatus(ratio: number, variancePercent: number): CompletenessStatus {
    // Red (over) when totals exceed 120%
    if (ratio > 1.2) {
      return 'over'
    }
    // Red (incomplete) beyond 20% variance
    if (Math.abs(variancePercent) > 20) {
      return 'incomplete'
    }
    // Yellow (near) between 1% and 20% variance (complete is now ±1%)
    if (Math.abs(variancePercent) > 1) {
      return 'near'
    }
    // Green (complete) when variance is within ±1%
    return 'complete'
  },
  /**
   * Recompute canonical completeness for a transaction and persist the boolean needs_review flag.
   * This writes directly to the database to avoid recursive service calls.
   */
  async _recomputeNeedsReview(accountId: string, projectId: string | null | undefined, transactionId: string): Promise<void> {
    try {
      // Canonical transactions are system-generated and represent internal inventory movements,
      // so they should never require review.
      const canonical = isCanonicalTransactionId(transactionId)

      let needs: boolean
      if (canonical) {
        // Canonical transactions are never flagged for review
        needs = false
      } else {
        // Use canonical completeness computation for regular transactions
        const completeness = await this.getTransactionCompleteness(accountId, projectId || '', transactionId)
        needs = completeness.completenessStatus !== 'complete'
      }

      // When offline, queue the needsReview update so it syncs later instead of hitting Supabase.
      if (!isNetworkOnline()) {
        try {
          const { offlineTransactionService } = await import('./offlineTransactionService')
          await offlineTransactionService.updateTransaction(accountId, transactionId, { needsReview: needs })
          return
        } catch (offlineError) {
          console.warn('Failed to queue offline needs_review update:', offlineError)
          throw offlineError
        }
      }

      // Persist the boolean directly to the transactions table to avoid calling updateTransaction
      await ensureAuthenticatedForDatabase()
      const dbUpdates: any = {
        needs_review: needs,
        updated_at: new Date().toISOString()
      }
      const { error } = await supabase
        .from('transactions')
        .update(dbUpdates)
        .eq('account_id', accountId)
        .eq('transaction_id', transactionId)

      if (error) {
        console.warn('Failed to persist needs_review for transaction', transactionId, error)
      } else {
        console.log(`Recomputed needs_review=${needs} for transaction ${transactionId}`)
      }
    } catch (err) {
      console.warn('Failed to recompute needs_review for transaction', transactionId, err)
    }
  },
  /**
   * Debounced/coalesced enqueue for recomputing needs_review per-transaction.
   * Coalesces rapid calls and deduplicates concurrent work to avoid N runs when many item updates occur.
   */
  _needsReviewTimers: {} as Record<string, any>,
  _ongoingNeedsReviewPromises: {} as Record<string, Promise<void> | null>,
  _enqueueCounts: {} as Record<string, number>,
  // Dirty flag for trailing-edge single-flight behavior. If an enqueue arrives while a run
  // is in-flight, we set dirty[key]=true and schedule a single trailing run after the
  // in-flight run finishes.
  _needsReviewDirty: {} as Record<string, boolean>,
  // Per-transaction reentrant batch counters to allow top-level flows to group multiple
  // low-level mutations into a single recompute.
  _batchCounters: {} as Record<string, number>,

  beginNeedsReviewBatch(accountId: string, transactionId: string): void {
    const key = `${accountId}:${transactionId}`
    this._batchCounters[key] = (this._batchCounters[key] || 0) + 1
  },

  _isBatchActive(accountId: string, transactionId: string): boolean {
    const key = `${accountId}:${transactionId}`
    return (this._batchCounters[key] || 0) > 0
  },

  async flushNeedsReviewBatch(accountId: string, transactionId: string, opts?: { flushImmediately?: boolean }): Promise<void> {
    const key = `${accountId}:${transactionId}`
    const remaining = (this._batchCounters[key] || 0) - 1
    if (remaining <= 0) {
      delete this._batchCounters[key]
      try {
        // Try to resolve projectId for the transaction so enqueue has correct context.
        let projectId: string | null = null
        try {
          await ensureAuthenticatedForDatabase()
          const { data } = await supabase
            .from('transactions')
            .select('project_id')
            .eq('account_id', accountId)
            .eq('transaction_id', transactionId)
            .single()
          projectId = data?.project_id ?? null
        } catch (e) {
          // best-effort - allow null projectId
        }

        if (opts?.flushImmediately) {
          // Bypass debounce by using debounceMs = 0
          this._enqueueRecomputeNeedsReview(accountId, projectId, transactionId, 0).catch((e: any) => {
            console.warn('Failed to recompute needs_review in flushNeedsReviewBatch:', e)
          })
        } else {
          this._enqueueRecomputeNeedsReview(accountId, projectId, transactionId).catch((e: any) => {
            console.warn('Failed to recompute needs_review in flushNeedsReviewBatch:', e)
          })
        }
      } catch (e) {
        console.warn('Failed during flushNeedsReviewBatch:', e)
      }
    } else {
      this._batchCounters[key] = remaining
    }
  },

  _enqueueRecomputeNeedsReview(accountId: string, projectId: string | null | undefined, transactionId: string, debounceMs: number = 1000): Promise<void> {
    const key = `${accountId}:${transactionId}`

    // If a computation is already in-flight for this tx, mark dirty so we schedule
    // a single trailing run when the in-flight run finishes, then return the in-flight promise.
    if (this._ongoingNeedsReviewPromises[key]) {
      try { this._needsReviewDirty[key] = true } catch (e) {}
      return this._ongoingNeedsReviewPromises[key] as Promise<void>
    }

    // If a timer is already set, return a promise that will resolve when that timer's work completes.
    if (this._needsReviewTimers[key]) {
      // Create proxy promise that resolves when the existing ongoing promise finishes (if any).
      const proxy = new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this._needsReviewTimers[key] && !this._ongoingNeedsReviewPromises[key]) {
            clearInterval(checkInterval)
            resolve()
          }
        }, 50)
      })
      this._ongoingNeedsReviewPromises[key] = proxy
      return proxy
    }

    // Instrumentation: count and log enqueue requests with timestamp and short stacktrace
    try {
      this._enqueueCounts[key] = (this._enqueueCounts[key] || 0) + 1
      const count = this._enqueueCounts[key]
      // Capture a small stack trace to find the caller (skip first two frames)
      const stack = new Error().stack || ''
      const shortStack = stack.split('\n').slice(2, 6).join(' | ')
      console.debug(`[needs_review] enqueue requested for ${transactionId} count=${count} ts=${new Date().toISOString()} caller=${shortStack}`)
    } catch (e) {
      // non-fatal instrumentation failure
    }

    // No existing work scheduled: create a promise and timer, store both immediately
    let resolveFn: (() => void) | null = null
    let rejectFn: ((e: any) => void) | null = null
    const p = new Promise<void>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })
    this._ongoingNeedsReviewPromises[key] = p

    this._needsReviewTimers[key] = setTimeout(async () => {
      try {
        await this._recomputeNeedsReview(accountId, projectId, transactionId)
        resolveFn && resolveFn()
      } catch (e) {
        rejectFn && rejectFn(e)
      } finally {
        // cleanup
        if (this._needsReviewTimers[key]) {
          clearTimeout(this._needsReviewTimers[key])
        }
        delete this._needsReviewTimers[key]
        delete this._ongoingNeedsReviewPromises[key]
        // reset counter after work finishes
        try { delete this._enqueueCounts[key] } catch (e) {}
        // If a caller requested a recompute while this run was in-flight, schedule
        // a single trailing run (short delay) and clear the dirty flag.
        try {
          if (this._needsReviewDirty[key]) {
            // clear flag now to avoid duplicate trailing schedules
            delete this._needsReviewDirty[key]
            setTimeout(() => {
              try {
                this._enqueueRecomputeNeedsReview(accountId, projectId, transactionId, 25).catch((e: any) => {
                  console.warn('Failed trailing recompute needs_review:', e)
                })
              } catch (e) {
                console.warn('Failed scheduling trailing recompute:', e)
              }
            }, 25)
          }
        } catch (e) {
          // non-fatal
        }
      }
    }, debounceMs)

    return p
  },

  _convertOfflineTransaction(dbTransaction: DBTransaction): Transaction {
    return _convertTransactionFromDb(mapOfflineTransactionToSupabaseShape(dbTransaction))
  },

  async _getTransactionsOffline(accountId: string, projectId: string): Promise<Transaction[]> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getTransactions(projectId)
      const filtered = cached.filter(tx => tx.accountId === accountId)
      const transactions = filtered.map(tx => this._convertOfflineTransaction(tx))
      const sorted = sortTransactionsOffline(transactions)
      return await _enrichTransactionsWithProjectNames(accountId, sorted)
    } catch (error) {
      console.warn('Failed to read offline transactions for project:', error)
      return []
    }
  },

  async _getTransactionsForProjectsOffline(accountId: string, projectIds: string[], projects?: Project[]): Promise<Transaction[]> {
    try {
      await offlineStore.init()
      const aggregated: Transaction[] = []
      for (const projectId of projectIds) {
        const cached = await offlineStore.getTransactions(projectId)
        cached
          .filter(tx => tx.accountId === accountId)
          .forEach(tx => aggregated.push(this._convertOfflineTransaction(tx)))
      }
      const sorted = sortTransactionsOffline(aggregated)
      return await _enrichTransactionsWithProjectNames(accountId, sorted, projects)
    } catch (error) {
      console.warn('Failed to read offline transactions for projects:', error)
      return []
    }
  },

  async _getTransactionByIdOffline(accountId: string, transactionId: string): Promise<{ transaction: Transaction | null; projectId: string | null }> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getTransactionById(transactionId)
      if (!cached || cached.accountId !== accountId) {
        return { transaction: null, projectId: null }
      }

      const transaction = this._convertOfflineTransaction(cached)
      const enriched = await _enrichTransactionsWithProjectNames(accountId, [transaction])
      return {
        transaction: enriched[0] || transaction,
        projectId: cached.projectId ?? null
      }
    } catch (error) {
      console.warn('Failed to read offline transaction:', error)
      return { transaction: null, projectId: null }
    }
  },

  async _getSuggestedItemsOffline(
    accountId: string,
    transactionSource: string,
    limit: number
  ): Promise<Item[]> {
    try {
      await offlineStore.init()
      const sourceKey = (transactionSource || '').toLowerCase()
      const cached = await offlineStore.getAllItems()
      const filtered = cached
        .filter(item => !item.accountId || item.accountId === accountId)
        .filter(item => !item.transactionId)
        .filter(item => (item.source || '').toLowerCase() === sourceKey)
        .sort((a, b) => {
          const aTime = new Date(a.dateCreated || a.createdAt || a.lastUpdated || 0).getTime()
          const bTime = new Date(b.dateCreated || b.createdAt || b.lastUpdated || 0).getTime()
          return bTime - aTime
        })
        .slice(0, limit)
        .map(item => this._convertOfflineItem(item))
      return filtered
    } catch (error) {
      console.warn('Failed to read offline suggested items:', error)
      return []
    }
  },

  // Find suggested items to add to transaction (unassociated items with same vendor)
  async getSuggestedItemsForTransaction(
    accountId: string,
    transactionSource: string,
    limit: number = 5
  ): Promise<Item[]> {
    if (!isNetworkOnline()) {
      return this._getSuggestedItemsOffline(accountId, transactionSource, limit)
    }

    try {
      await ensureAuthenticatedForDatabase()

      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('account_id', accountId)
        .eq('source', transactionSource)
        .is('transaction_id', null)
        .order('date_created', { ascending: false })
        .limit(limit)

      if (error) throw error

      if (data && data.length) {
        void cacheItemsOffline(data)
      }

      return (data || []).map(item => unifiedItemsService._convertItemFromDb(item))
    } catch (error) {
      console.warn('Failed to fetch suggested items online, falling back to offline cache:', error)
      return this._getSuggestedItemsOffline(accountId, transactionSource, limit)
    }
  },

  // Create new transaction (account-scoped)
  async createTransaction(
    accountId: string,
    projectId: string | null | undefined,
    transactionData: Omit<Transaction, 'transactionId' | 'createdAt'>,
    items?: TransactionItemFormData[]
  ): Promise<string> {
    // Generate optimistic ID upfront so we always have one, even if operations fail
    const optimisticTransactionId = `T-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    
    const queueOfflineCreate = async (reason: 'offline' | 'fallback' | 'timeout'): Promise<string> => {
      try {
        const { offlineTransactionService } = await import('./offlineTransactionService')
        const result = await offlineTransactionService.createTransaction(
          accountId,
          projectId,
          transactionData,
          items
        )
        if (import.meta.env.DEV) {
          console.info('[transactionService] createTransaction queued for offline processing', {
            accountId,
            transactionId: result.transactionId,
            operationId: result.operationId,
            reason
          })
        }
        return result.transactionId ?? optimisticTransactionId
      } catch (error) {
        // Propagate typed errors that the UI should handle
        if (error instanceof OfflineQueueUnavailableError || error instanceof OfflineContextError) {
          console.error('[transactionService] typed error during offline queue, propagating', {
            accountId,
            transactionId: optimisticTransactionId,
            reason,
            errorType: error.constructor.name,
            errorMessage: error.message
          })
          throw error
        }
        
        // For unexpected errors, return optimistic ID so UI can still show feedback
        console.error('[transactionService] unexpected error during offline queue, returning optimistic ID', {
          accountId,
          transactionId: optimisticTransactionId,
          reason,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error
        })
        return optimisticTransactionId
      }
    }

    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      await offlineStore.getAllTransactions().catch(() => [])
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    if (!isNetworkOnline()) {
      return queueOfflineCreate('offline')
    }

    try {
      await ensureAuthenticatedForDatabase()

      // Get current user ID for created_by field
      const currentUser = await getCurrentUser()
      const userId = transactionData.createdBy || currentUser?.id || null
      
      if (!userId) {
        throw new Error('User must be authenticated to create transactions')
      }

      const now = new Date()
      // Use the pre-generated optimistic ID for consistency
      const transactionId = optimisticTransactionId

      // Convert camelCase transactionData to database format
      const dbTransaction = _convertTransactionToDb({
        ...transactionData,
        transactionId,
        createdAt: now.toISOString()
      })

      // Set account_id and timestamps
      dbTransaction.account_id = accountId
      dbTransaction.created_at = now.toISOString()
      dbTransaction.updated_at = now.toISOString()
      if (!dbTransaction.status) dbTransaction.status = 'completed'

      // Validate category_id belongs to account if provided
      if (dbTransaction.category_id) {
        const { data: category, error: categoryError } = await supabase
          .from('vw_budget_categories')
          .select('id, account_id')
          .eq('id', dbTransaction.category_id)
          .eq('account_id', accountId)
          .single()

        if (categoryError || !category) {
          throw new Error(`Category ID '${dbTransaction.category_id}' not found or does not belong to this account.`)
        }
      }

      console.log('Creating transaction:', dbTransaction)
      console.log('Transaction items:', items)

      // Apply tax calculation from presets or compute from subtotal when Other
      if (dbTransaction.tax_rate_preset) {
        if (dbTransaction.tax_rate_preset === 'Other') {
          // Validate subtotal presence and calculate rate
          const amountNum = parseFloat(dbTransaction.amount || '0')
          const subtotalNum = parseFloat(dbTransaction.subtotal || '0')
          if (isNaN(subtotalNum) || subtotalNum <= 0) {
            throw new Error('Subtotal must be greater than 0 when Tax Rate Preset is Other.')
          }
          if (isNaN(amountNum) || amountNum < subtotalNum) {
            throw new Error('Subtotal cannot exceed the total amount.')
          }
          const rate = ((amountNum - subtotalNum) / subtotalNum) * 100
          dbTransaction.tax_rate_pct = rate
        } else {
          // Look up preset by ID
          const preset = await getTaxPresetById(accountId, dbTransaction.tax_rate_preset)
          if (!preset) {
            throw new Error(`Tax preset with ID '${dbTransaction.tax_rate_preset}' not found.`)
          }
          dbTransaction.tax_rate_pct = preset.rate
          // Remove subtotal for preset selections
          dbTransaction.subtotal = null
        }
      }

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('transactions')
          .insert(dbTransaction)

        if (error) throw error
      })

      console.log('Transaction created successfully:', transactionId)

      // Create items linked to this transaction if provided
      if (items && items.length > 0) {
        console.log('Creating items for transaction:', transactionId)
        // Propagate tax_rate_pct to created items if present on transaction
        const itemsToCreate = items.map(i => ({ ...i }))
        
        // Check if we're still online before creating items
        if (!isNetworkOnline()) {
          // If we went offline during transaction creation, queue the whole thing offline
          console.warn('Network went offline during transaction creation, queuing for offline sync')
          return queueOfflineCreate('fallback')
        }
        
        const createdItemIds = await unifiedItemsService.createTransactionItems(
          accountId,
          projectId || '',
          transactionId,
          transactionData.transactionDate,
          transactionData.source, // Pass transaction source to items
          itemsToCreate,
          dbTransaction.tax_rate_pct
        )
        console.log('Created items:', createdItemIds)

        // Update the transaction's itemIds field to include the newly created items
        if (createdItemIds.length > 0) {
          const { error: updateError } = await supabase
            .from('transactions')
            .update({ item_ids: createdItemIds })
            .eq('account_id', accountId)
            .eq('transaction_id', transactionId)

          if (updateError) {
            console.warn('Failed to update transaction itemIds:', updateError)
            // Don't fail the transaction creation if this update fails
          }
        }
      }
      // Ensure the denormalized needs_review flag is computed and persisted
      try {
        // Fire-and-forget: schedule recompute but don't block the mutation flow
        this._enqueueRecomputeNeedsReview(accountId, projectId, transactionId).catch((e: any) => {
          console.warn('Failed to set needs_review after transaction creation:', e)
        })
      } catch (e) {
        console.warn('Failed to set needs_review after transaction creation:', e)
      }

      return transactionId
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase insert timed out, queuing transaction for offline sync.')
        return queueOfflineCreate('timeout')
      }
      console.warn('Failed to create transaction online, falling back to offline queue:', error)
      return queueOfflineCreate('fallback')
    }
  },

  // Update transaction (account-scoped)
  async updateTransaction(accountId: string, _projectId: string, transactionId: string, updates: Partial<Transaction>): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
      if (existingOfflineTransaction) {
        // Pre-hydrate React Query cache if needed
        // This prevents empty state flashes
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineTransactionService
    if (!online) {
      const { offlineTransactionService } = await import('./offlineTransactionService')
      await offlineTransactionService.updateTransaction(accountId, transactionId, updates)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()

      // Apply business rules for reimbursement type and status (using camelCase)
      const finalUpdates: Partial<Transaction> = { ...updates }

      // If status is being set to 'completed', clear reimbursementType
      if (finalUpdates.status === 'completed' && finalUpdates.reimbursementType !== undefined) {
        finalUpdates.reimbursementType = null
      }

      // If reimbursementType is being set to empty string, also clear it
      if (finalUpdates.reimbursementType === '') {
        finalUpdates.reimbursementType = null
      }

      // If reimbursementType is being set to a non-empty value, ensure status is not 'completed'
      if (finalUpdates.reimbursementType && finalUpdates.status === 'completed') {
        // Set status to 'pending' if reimbursementType is being set to a non-empty value and status is 'completed'
        finalUpdates.status = 'pending'
      }

      // Apply tax mapping / computation before save (using camelCase)
      if (finalUpdates.taxRatePreset !== undefined) {
        if (finalUpdates.taxRatePreset === 'Other') {
          // Compute from provided subtotal and amount if present in updates or existing doc
          const { data: existing } = await supabase
            .from('transactions')
            .select('amount, subtotal')
            .eq('account_id', accountId)
            .eq('transaction_id', transactionId)
            .single()

          const existingData = existing as { amount?: string; subtotal?: string } | null
          const amountVal = finalUpdates.amount !== undefined ? parseFloat(finalUpdates.amount) : parseFloat(existingData?.amount || '0')
          const subtotalVal = finalUpdates.subtotal !== undefined ? parseFloat(finalUpdates.subtotal) : parseFloat(existingData?.subtotal || '0')
          if (!isNaN(amountVal) && !isNaN(subtotalVal) && subtotalVal > 0 && amountVal >= subtotalVal) {
            const rate = ((amountVal - subtotalVal) / subtotalVal) * 100
            finalUpdates.taxRatePct = rate
          }
        } else {
          // Look up preset by ID
          try {
            const preset = await getTaxPresetById(accountId, finalUpdates.taxRatePreset)
            if (preset) {
              finalUpdates.taxRatePct = preset.rate
              // Remove subtotal when using presets
              finalUpdates.subtotal = undefined
            } else {
              console.warn(`Tax preset with ID '${finalUpdates.taxRatePreset}' not found during update`)
            }
          } catch (e) {
            console.warn('Tax preset lookup failed during update:', e)
          }
        }
      }

      // Convert camelCase updates to database format
      const dbUpdates = _convertTransactionToDb(finalUpdates)
      
      // Validate category_id belongs to account if provided
      if (dbUpdates.category_id !== undefined && dbUpdates.category_id !== null) {
        const { data: category, error: categoryError } = await supabase
          .from('vw_budget_categories')
          .select('id, account_id')
          .eq('id', dbUpdates.category_id)
          .eq('account_id', accountId)
          .single()

        if (categoryError || !category) {
          throw new Error(`Category ID '${dbUpdates.category_id}' not found or does not belong to this account.`)
        }
      }
      
      // Add updated_at timestamp for database
      dbUpdates.updated_at = new Date().toISOString()

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('transactions')
          .update(dbUpdates)
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)

        if (error) throw error
      })

      // If taxRatePct is set in updates, propagate to items
      if (finalUpdates.taxRatePct !== undefined) {
        try {
          const items = await unifiedItemsService.getItemsForTransaction(accountId, _projectId, transactionId)
          if (items && items.length > 0) {
            // Update each item individually (Supabase batch operations)
            for (const item of items) {
              await unifiedItemsService.updateItem(accountId, item.itemId, {
                taxRatePct: finalUpdates.taxRatePct
              })
            }
          }
        } catch (e) {
          console.warn('Failed to propagate tax_rate_pct to items:', e)
        }
      }
      // Recompute and persist needs_review unless caller explicitly provided it
      if (finalUpdates.needsReview === undefined) {
      // Schedule recompute asynchronously; do not await to keep updates fast
      this._enqueueRecomputeNeedsReview(accountId, _projectId, transactionId).catch((e: any) => {
        console.warn('Failed to recompute needs_review after transaction update:', e)
      })
      }

      // Invalidate transaction display info cache so UI updates immediately
      try {
        const { invalidateTransactionDisplayInfo } = await import('@/hooks/useTransactionDisplayInfo')
        invalidateTransactionDisplayInfo(accountId, transactionId)
      } catch (e) {
        console.warn('Failed to invalidate transaction display info cache:', e)
      }
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase update timed out, queuing transaction update for offline sync.')
        const { offlineTransactionService } = await import('./offlineTransactionService')
        await offlineTransactionService.updateTransaction(accountId, transactionId, updates)
        return
      }
      console.warn('Failed to update transaction online, falling back to offline queue:', error)
      const { offlineTransactionService } = await import('./offlineTransactionService')
      await offlineTransactionService.updateTransaction(accountId, transactionId, updates)
    }
  },

  // Delete transaction (account-scoped)
  async deleteTransaction(accountId: string, _projectId: string, transactionId: string): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
      if (existingOfflineTransaction) {
        // Pre-hydrate React Query cache if needed
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineTransactionService
    if (!online) {
      const { offlineTransactionService } = await import('./offlineTransactionService')
      await offlineTransactionService.deleteTransaction(accountId, transactionId)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()

      try {
        await detachItemsFromTransaction(accountId, transactionId)
      } catch (error) {
        console.warn('deleteTransaction - failed to detach items before delete', error)
        // Continue with delete so the transaction does not linger, but surface the warning.
      }

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('transactions')
          .delete()
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)

        if (error) throw error
      })
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase delete timed out, queuing transaction delete for offline sync.')
        const { offlineTransactionService } = await import('./offlineTransactionService')
        await offlineTransactionService.deleteTransaction(accountId, transactionId)
        return
      }
      console.warn('Failed to delete transaction online, falling back to offline queue:', error)
      const { offlineTransactionService } = await import('./offlineTransactionService')
      await offlineTransactionService.deleteTransaction(accountId, transactionId)
    }
  },

  // Subscribe to transactions with real-time updates
  subscribeToTransactions(
    accountId: string,
    projectId: string,
    callback: (transactions: Transaction[]) => void,
    initialTransactions?: Transaction[],
    options?: ChannelSubscriptionOptions
  ) {
    const key = `${accountId}:${projectId}`
    let entry = transactionRealtimeEntries.get(key)

    if (!entry) {
      entry = {
        channel: null as unknown as RealtimeChannel,
        callbacks: new Set(),
        data: [...(initialTransactions || [])]
      }

      const channelName = `transactions:${accountId}:${projectId}:${++transactionChannelCounter}`
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'transactions'
          },
          async (payload) => {
            const { eventType, new: newRecord, old: oldRecord } = payload
            const recordAccountId = (eventType === 'DELETE' ? oldRecord?.account_id : newRecord?.account_id) ?? null
            if (recordAccountId && recordAccountId !== accountId) {
              return
            }

            const newProjectId = (newRecord as any)?.project_id ?? null
            const oldProjectId = (oldRecord as any)?.project_id ?? null

            const matchesProject = (candidate: string | null | undefined) => candidate === projectId
            let nextTransactions = entry?.data ?? []

            if (eventType === 'INSERT') {
              if (matchesProject(newProjectId)) {
                const newTransaction = _convertTransactionFromDb(newRecord)
                const [enrichedTransaction] = await _enrichTransactionsWithProjectNames(accountId, [newTransaction])
                nextTransactions = [enrichedTransaction, ...nextTransactions.filter(t => t.transactionId !== enrichedTransaction.transactionId)]
              }
            } else if (eventType === 'UPDATE') {
              const updatedTransaction = _convertTransactionFromDb(newRecord)
              const [enrichedTransaction] = await _enrichTransactionsWithProjectNames(accountId, [updatedTransaction])

              const wasInProject = nextTransactions.some(t => t.transactionId === enrichedTransaction.transactionId)
              const isInProject = matchesProject(newProjectId)

              if (isInProject && !wasInProject) {
                nextTransactions = [enrichedTransaction, ...nextTransactions]
              } else if (!isInProject && wasInProject) {
                nextTransactions = nextTransactions.filter(t => t.transactionId !== enrichedTransaction.transactionId)
              } else if (isInProject && wasInProject) {
                nextTransactions = nextTransactions.map(t => t.transactionId === enrichedTransaction.transactionId ? enrichedTransaction : t)
              }
            } else if (eventType === 'DELETE') {
              if (matchesProject(oldProjectId)) {
                const oldTransactionId: string | null = oldRecord?.transaction_id ?? null
                const oldRowId: string | null = oldRecord?.id ?? null
                nextTransactions = nextTransactions.filter(t => {
                  if (oldTransactionId && t.transactionId === oldTransactionId) {
                    return false
                  }
                  if (!oldTransactionId && oldRowId && t.rowId === oldRowId) {
                    return false
                  }
                  return true
                })
              }
            }

            if (entry) {
              entry.data = nextTransactions
              const sortedTransactions = [...nextTransactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              entry.callbacks.forEach(cb => {
                try {
                  cb(sortedTransactions)
                } catch (err) {
                  console.error('subscribeToTransactions callback failed', err)
                }
              })
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('Subscribed to transactions channel')
          }
          if (err) {
            console.error('Error subscribing to transactions channel:', err)
          }
          options?.onStatusChange?.(status, err ?? undefined)
        })

      entry.channel = channel
      transactionRealtimeEntries.set(key, entry)
    } else if (initialTransactions && initialTransactions.length && entry.data.length === 0) {
      entry.data = [...initialTransactions]
    }

    const subscriberCallback = (transactionsSnapshot: Transaction[]) => {
      try {
        callback(transactionsSnapshot)
      } catch (err) {
        console.error('subscribeToTransactions callback failed', err)
      }
    }

    entry.callbacks.add(subscriberCallback)

    if (entry.data.length > 0) {
      subscriberCallback([...entry.data])
    }

    return () => {
      const existing = transactionRealtimeEntries.get(key)
      if (!existing) return

      existing.callbacks.delete(subscriberCallback)
      if (existing.callbacks.size === 0) {
        try {
          existing.channel.unsubscribe()
        } catch (err) {
          console.warn('Failed to unsubscribe transactions channel', err)
        }
        transactionRealtimeEntries.delete(key)
      }
    }
  },

  subscribeToAllTransactions(
    accountId: string,
    callback: (transactions: Transaction[]) => void,
    initialTransactions?: Transaction[]
  ) {
    let transactions = [...(initialTransactions || [])]

    const channel = supabase
      .channel(`transactions:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        async (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload
          const recordAccountId = (eventType === 'DELETE' ? oldRecord?.account_id : newRecord?.account_id) ?? null
          if (recordAccountId && recordAccountId !== accountId) {
            return
          }

          console.log('All transactions change received!', payload)

          if (eventType === 'INSERT') {
            const newTransaction = _convertTransactionFromDb(newRecord)
            const [enrichedTransaction] = await _enrichTransactionsWithProjectNames(accountId, [newTransaction])
            transactions = [enrichedTransaction, ...transactions.filter(t => t.transactionId !== enrichedTransaction.transactionId)]
          } else if (eventType === 'UPDATE') {
            const updatedTransaction = _convertTransactionFromDb(newRecord)
            const [enrichedTransaction] = await _enrichTransactionsWithProjectNames(accountId, [updatedTransaction])
            transactions = transactions.map(t => t.transactionId === enrichedTransaction.transactionId ? enrichedTransaction : t)
          } else if (eventType === 'DELETE') {
            const oldId = oldRecord.transaction_id
            transactions = transactions.filter(t => t.transactionId !== oldId)
          }
          
          const sortedTransactions = [...transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          callback(sortedTransactions)
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to all transactions channel')
        }
        if (err) {
          console.error('Error subscribing to all transactions channel:', err)
        }
      })

    return () => {
      channel.unsubscribe()
    }
  },

  // Subscribe to single transaction for real-time updates
  subscribeToTransaction(
    accountId: string,
    _projectId: string,
    transactionId: string,
    callback: (transaction: Transaction | null) => void
  ) {
    const hydrateFromOffline = async () => {
      try {
        const { transaction } = await this._getTransactionByIdOffline(accountId, transactionId)
        if (transaction) {
          callback(transaction)
          return true
        }
      } catch (error) {
        console.warn('Failed to hydrate transaction from offline store:', error)
      }
      return false
    }

    const channel = supabase
      .channel(`transaction:${accountId}:${transactionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        async (payload) => {
          const newRow = payload.new as Record<string, any> | null
          const oldRow = payload.old as Record<string, any> | null
          const recordAccountId = (newRow?.account_id ?? oldRow?.account_id) ?? null
          if (recordAccountId && recordAccountId !== accountId) {
            return
          }
          const recordTransactionId = (newRow?.transaction_id ?? oldRow?.transaction_id) ?? null
          if (recordTransactionId && recordTransactionId !== transactionId) {
            return
          }

          // Refetch transaction on any change (but skip network calls when offline)
          try {
            if (!isNetworkOnline()) {
              await hydrateFromOffline()
              return
            }

            const { data, error } = await supabase
              .from('transactions')
              .select('*')
              .eq('account_id', accountId)
              .eq('transaction_id', transactionId)
              .single()
            
            if (error) {
              if (error.code === 'PGRST116') {
                // Not found - transaction was deleted
                callback(null)
                return
              }
              console.error('Error fetching transaction in subscription:', error)
              return
            }
            
            if (data) {
              const transaction = _convertTransactionFromDb(data)
              const enriched = await _enrichTransactionsWithProjectNames(accountId, [transaction])
              callback(enriched[0] || null)
            } else {
              callback(null)
            }
          } catch (error) {
            console.error('Error in transaction subscription callback:', error)
          }
        }
      )
      .subscribe()

    // Initial fetch
    const fetchTransaction = async () => {
      try {
        if (!isNetworkOnline()) {
          const hydrated = await hydrateFromOffline()
          if (!hydrated) {
            callback(null)
          }
          return
        }

        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)
          .single()
        
        if (error) {
          if (error.code === 'PGRST116') {
            callback(null)
            return
          }
          console.error('Error fetching initial transaction:', error)
          return
        }
        
        if (data) {
          const transaction = _convertTransactionFromDb(data)
          const enriched = await _enrichTransactionsWithProjectNames(accountId, [transaction])
          callback(enriched[0] || null)
        } else {
          callback(null)
        }
      } catch (error) {
        console.error('Error in initial transaction fetch:', error)
      }
    }
    
    fetchTransaction()

    return () => {
      channel.unsubscribe()
    }
  },

  // Get pending transactions for a project (account-scoped)
  async getPendingTransactions(accountId: string, projectId: string): Promise<Transaction[]> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw error

    const transactions = (data || []).map(tx => _convertTransactionFromDb(tx))
    return await _enrichTransactionsWithProjectNames(accountId, transactions)
  },

  // Update transaction status (for completing/cancelling pending transactions) (account-scoped)
  async updateTransactionStatus(
    accountId: string,
    _projectId: string,
    transactionId: string,
    status: 'pending' | 'completed' | 'canceled',
    updates?: Partial<Transaction>
  ): Promise<void> {
    await ensureAuthenticatedForDatabase()

    const updateData: any = {
      status: status,
      updated_at: new Date().toISOString()
    }

    if (updates) {
      if (updates.transactionDate !== undefined) updateData.transaction_date = updates.transactionDate
      if (updates.paymentMethod !== undefined) updateData.payment_method = updates.paymentMethod
      if (updates.amount !== undefined) updateData.amount = updates.amount
      if (updates.notes !== undefined) updateData.notes = updates.notes
      // Add other fields as needed
    }

    // Set transaction_date to current time if completing
    if (status === 'completed' && !updates?.transactionDate) {
      updateData.transaction_date = toDateOnlyString(new Date())
    }

    const { error } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('account_id', accountId)
      .eq('transaction_id', transactionId)

    if (error) throw error
  },

  // Utility queries for Business Inventory and reporting (account-scoped)
  async getInventoryRelatedTransactions(accountId: string): Promise<Transaction[]> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .in('reimbursement_type', [CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT])
      .order('created_at', { ascending: false })

    if (error) throw error

    const transactions = (data || []).map(tx => _convertTransactionFromDb(tx))
    return await _enrichTransactionsWithProjectNames(accountId, transactions)
  },

  // Get business inventory transactions (project_id == null) (account-scoped)
  async getBusinessInventoryTransactions(accountId: string): Promise<Transaction[]> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .is('project_id', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    const transactions = (data || []).map(tx => _convertTransactionFromDb(tx))
    return await _enrichTransactionsWithProjectNames(accountId, transactions)
  }
}

// Unified Items Collection Services (NEW)
export const unifiedItemsService = {
  // Helper function to convert database item (snake_case) to app format (camelCase)
  _convertItemFromDb(dbItem: any): Item {
    const converted = convertTimestamps(dbItem)
    return {
      itemId: converted.item_id,
      accountId: converted.account_id,
      projectId: converted.project_id || undefined,
      transactionId: converted.transaction_id || undefined,
      previousProjectTransactionId: converted.previous_project_transaction_id ?? null,
      previousProjectId: converted.previous_project_id ?? null,
      name: converted.name || undefined,
      description: converted.description || '',
      sku: converted.sku || '',
      source: converted.source || '',
      purchasePrice: converted.purchase_price || undefined,
      projectPrice: converted.project_price || undefined,
      marketValue: converted.market_value || undefined,
      paymentMethod: converted.payment_method || '',
      disposition: converted.disposition || undefined,
      notes: converted.notes || undefined,
      space: converted.space || undefined,
      qrKey: converted.qr_key || '',
      bookmark: converted.bookmark || false,
      dateCreated: converted.date_created || '',
      lastUpdated: converted.last_updated ? (typeof converted.last_updated === 'string' ? converted.last_updated : converted.last_updated.toISOString()) : '',
      images: Array.isArray(converted.images) ? converted.images : [],
      inventoryStatus: converted.inventory_status || undefined,
      businessInventoryLocation: converted.business_inventory_location || undefined,
      taxRatePct: converted.tax_rate_pct ? parseFloat(converted.tax_rate_pct) : undefined,
      taxAmountPurchasePrice: converted.tax_amount_purchase_price || undefined,
      taxAmountProjectPrice: converted.tax_amount_project_price || undefined,
      createdBy: converted.created_by || undefined,
      createdAt: converted.created_at,
      originTransactionId: converted.origin_transaction_id ?? null,
      latestTransactionId: converted.latest_transaction_id ?? null
    } as Item
  },

  // Helper function to convert app format (camelCase) to database format (snake_case)
  _convertItemToDb(item: Partial<Item>): any {
    const dbItem: any = {}
    
    if (item.itemId !== undefined) dbItem.item_id = item.itemId
    if (item.accountId !== undefined) dbItem.account_id = item.accountId
    if (item.projectId !== undefined) dbItem.project_id = item.projectId ?? null
    if (item.transactionId !== undefined) dbItem.transaction_id = item.transactionId ?? null
    if (item.previousProjectTransactionId !== undefined) dbItem.previous_project_transaction_id = item.previousProjectTransactionId ?? null
    if (item.previousProjectId !== undefined) dbItem.previous_project_id = item.previousProjectId ?? null
    if (item.name !== undefined) dbItem.name = item.name
    if (item.description !== undefined) dbItem.description = item.description
    if (item.sku !== undefined) dbItem.sku = item.sku
    if (item.source !== undefined) dbItem.source = item.source
    if (item.purchasePrice !== undefined) dbItem.purchase_price = item.purchasePrice
    if (item.projectPrice !== undefined) dbItem.project_price = item.projectPrice
    if (item.marketValue !== undefined) dbItem.market_value = item.marketValue
    if (item.paymentMethod !== undefined) dbItem.payment_method = item.paymentMethod
    if (item.disposition !== undefined) dbItem.disposition = item.disposition
    if (item.notes !== undefined) dbItem.notes = item.notes
    if (item.space !== undefined) dbItem.space = item.space
    if (item.qrKey !== undefined) dbItem.qr_key = item.qrKey
    if (item.bookmark !== undefined) dbItem.bookmark = item.bookmark
    if (item.dateCreated !== undefined) dbItem.date_created = item.dateCreated
    if (item.lastUpdated !== undefined) dbItem.last_updated = item.lastUpdated
    if (item.images !== undefined) dbItem.images = item.images
    if (item.inventoryStatus !== undefined) dbItem.inventory_status = item.inventoryStatus
    if (item.businessInventoryLocation !== undefined) dbItem.business_inventory_location = item.businessInventoryLocation
    if (item.taxRatePct !== undefined) dbItem.tax_rate_pct = item.taxRatePct
    if (item.taxAmountPurchasePrice !== undefined) dbItem.tax_amount_purchase_price = item.taxAmountPurchasePrice
    if (item.taxAmountProjectPrice !== undefined) dbItem.tax_amount_project_price = item.taxAmountProjectPrice
    if (item.createdBy !== undefined) dbItem.created_by = item.createdBy
    if (item.createdAt !== undefined) dbItem.created_at = item.createdAt
    if (item.originTransactionId !== undefined) dbItem.origin_transaction_id = item.originTransactionId ?? null
    if (item.latestTransactionId !== undefined) dbItem.latest_transaction_id = item.latestTransactionId ?? null
    
    return dbItem
  },

  _convertOfflineItem(dbItem: DBItem): Item {
    return this._convertItemFromDb(mapOfflineItemToSupabaseShape(dbItem))
  },

  async _getProjectItemsOffline(
    accountId: string,
    projectId: string,
    filters?: FilterOptions,
    pagination?: PaginationOptions
  ): Promise<Item[]> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getItems(projectId)
      const items = cached
        .filter(item => !item.accountId || item.accountId === accountId)
        .map(item => this._convertOfflineItem(item))
      const filtered = applyItemFiltersOffline(items, filters)
      const sorted = sortItemsOffline(filtered)
      return applyPagination(sorted, pagination)
    } catch (error) {
      console.warn('Failed to read offline items for project:', error)
      return []
    }
  },

  async _getBusinessInventoryOffline(
    accountId: string,
    filters?: { status?: string; searchQuery?: string },
    pagination?: PaginationOptions
  ): Promise<Item[]> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getAllItems()
      let items = cached
        .filter(item => !item.projectId)
        .filter(item => !item.accountId || item.accountId === accountId)
        .map(item => this._convertOfflineItem(item))

      if (filters?.status) {
        items = items.filter(item => item.inventoryStatus === filters.status)
      }
      if (filters?.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        items = items.filter(item =>
          (item.description || '').toLowerCase().includes(query) ||
          (item.source || '').toLowerCase().includes(query) ||
          (item.sku || '').toLowerCase().includes(query) ||
          (item.businessInventoryLocation || '').toLowerCase().includes(query)
        )
      }

      const sorted = sortItemsOffline(items)
      return applyPagination(sorted, pagination)
    } catch (error) {
      console.warn('Failed to read offline business inventory:', error)
      return []
    }
  },

  async _getTransactionItemsOffline(
    accountId: string,
    transactionId: string
  ): Promise<Item[]> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getAllItems()
      const items = cached
        .filter(item => item.transactionId === transactionId)
        .filter(item => !item.accountId || item.accountId === accountId)
        .map(item => this._convertOfflineItem(item))
      return sortItemsOffline(items)
    } catch (error) {
      console.warn('Failed to read offline transaction items:', error)
      return []
    }
  },

  async _getItemByIdOffline(accountId: string, itemId: string): Promise<Item | null> {
    try {
      await offlineStore.init()
      const cached = await offlineStore.getItemById(itemId)
      if (!cached) {
        console.debug('[getItemById] Item not found in offlineStore:', itemId)
        return null
      }
      if (cached.accountId && cached.accountId !== accountId) {
        console.debug('[getItemById] Item accountId mismatch:', { itemId, cachedAccountId: cached.accountId, requestedAccountId: accountId })
        return null
      }
      console.debug('[getItemById] Found item in offlineStore:', itemId)
      return this._convertOfflineItem(cached)
    } catch (error) {
      console.warn('[getItemById] Failed to read offline item:', error)
      return null
    }
  },

  async bulkUpdateItemImages(
    accountId: string,
    updates: Array<{ itemId: string; images: ItemImage[] }>
  ): Promise<void> {
    await ensureAuthenticatedForDatabase()
    if (!updates || updates.length === 0) return

    await Promise.all(
      updates.map(async update => {
        const { error } = await supabase
          .from('items')
          .update({
            images: update.images,
            last_updated: new Date().toISOString()
          })
          .eq('account_id', accountId)
          .eq('item_id', update.itemId)

        if (error) {
          throw error
        }
      })
    )
  },

  // Get items for a project (project_id == projectId) (account-scoped)
  async getItemsByProject(
    accountId: string,
    projectId: string,
    filters?: FilterOptions,
    pagination?: PaginationOptions
  ): Promise<Item[]> {
    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        let query = supabase
          .from('items')
          .select('*')
          .eq('account_id', accountId)
          .eq('project_id', projectId)

        if (filters?.status) {
          query = query.eq('disposition', filters.status)
        }

        if (filters?.category) {
          query = query.eq('source', filters.category)
        }

        if (filters?.priceRange) {
          query = query.gte('project_price', filters.priceRange.min.toString())
          query = query.lte('project_price', filters.priceRange.max.toString())
        }

        if (filters?.searchQuery) {
          query = query.or(`description.ilike.%${filters.searchQuery}%,source.ilike.%${filters.searchQuery}%,sku.ilike.%${filters.searchQuery}%,payment_method.ilike.%${filters.searchQuery}%`)
        }

        query = query
          .order('created_at', { ascending: false, nullsFirst: false })
          .order('date_created', { ascending: false, nullsFirst: false })

        if (pagination) {
          const offset = pagination.page > 0 ? (pagination.page - 1) * pagination.limit : 0
          query = query.range(offset, offset + pagination.limit - 1)
        }

        const { data, error } = await query
        if (error) throw error

        void cacheItemsOffline(data || [])
        return (data || []).map(item => this._convertItemFromDb(item))
      } catch (error) {
        console.warn('Failed to fetch project items from network, falling back to offline cache:', error)
      }
    }

    return await this._getProjectItemsOffline(accountId, projectId, filters, pagination)
  },

  // Subscribe to items for a project with real-time updates
  subscribeToProjectItems(
    accountId: string,
    projectId: string,
    callback: (items: Item[]) => void,
    initialItems?: Item[],
    options?: ChannelSubscriptionOptions
  ) {
    const key = `${accountId}:${projectId}`
    let entry = projectItemsRealtimeEntries.get(key)

    if (!entry) {
      entry = {
        channel: null as unknown as RealtimeChannel,
        callbacks: new Set(),
        data: [...(initialItems || [])]
      }

      const channelName = `project-items:${accountId}:${projectId}:${++projectItemsChannelCounter}`
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'items'
          },
          (payload) => {
            const { eventType, new: newRecord, old: oldRecord } = payload
            const recordAccountId = (eventType === 'DELETE' ? oldRecord?.account_id : newRecord?.account_id) ?? null
            if (recordAccountId && recordAccountId !== accountId) {
              return
            }

            let nextItems = entry?.data ?? []

            if (eventType === 'INSERT') {
              if (newRecord.project_id === projectId) {
                const newItem = this._convertItemFromDb(newRecord)
                nextItems = [newItem, ...nextItems.filter(i => i.itemId !== newItem.itemId)]
              }
            } else if (eventType === 'UPDATE') {
              const updatedItem = this._convertItemFromDb(newRecord)
              const wasInProject = nextItems.some(i => i.itemId === updatedItem.itemId)
              const isInProject = updatedItem.projectId === projectId

              if (isInProject && !wasInProject) {
                nextItems = [updatedItem, ...nextItems]
              } else if (!isInProject && wasInProject) {
                nextItems = nextItems.filter(i => i.itemId !== updatedItem.itemId)
              } else if (isInProject && wasInProject) {
                nextItems = nextItems.map(i => i.itemId === updatedItem.itemId ? updatedItem : i)
              }
            } else if (eventType === 'DELETE') {
              if (oldRecord.item_id && oldRecord.account_id === accountId) {
                nextItems = nextItems.filter(i => i.itemId !== oldRecord.item_id)
              }
            }

            if (entry) {
              entry.data = nextItems
              const snapshot = [...nextItems]
              entry.callbacks.forEach(cb => {
                try {
                  cb(snapshot)
                } catch (err) {
                  console.error('subscribeToProjectItems callback failed', err)
                }
              })
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('Subscribed to project items channel')
          }
          if (err) {
            console.error('Error subscribing to project items channel:', err)
          }
          options?.onStatusChange?.(status, err ?? undefined)
        })

      entry.channel = channel
      projectItemsRealtimeEntries.set(key, entry)
    } else if (initialItems && initialItems.length && entry.data.length === 0) {
      entry.data = [...initialItems]
    }

    const subscriberCallback = (itemsSnapshot: Item[]) => {
      try {
        callback(itemsSnapshot)
      } catch (err) {
        console.error('subscribeToProjectItems callback failed', err)
      }
    }

    entry.callbacks.add(subscriberCallback)

    if (entry.data.length > 0) {
      subscriberCallback([...entry.data])
    }

    return () => {
      const existing = projectItemsRealtimeEntries.get(key)
      if (!existing) return

      existing.callbacks.delete(subscriberCallback)
      if (existing.callbacks.size === 0) {
        try {
          existing.channel.unsubscribe()
        } catch (err) {
          console.warn('Failed to unsubscribe project items channel', err)
        }
        projectItemsRealtimeEntries.delete(key)
      }
    }
  },

  syncProjectItemsRealtimeCache(accountId: string, projectId: string, items: Item[]) {
    syncProjectItemsRealtimeSnapshot(accountId, projectId, items)
  },


  // Get business inventory items (project_id == null) (account-scoped)
  async getBusinessInventoryItems(
    accountId: string,
    filters?: { status?: string; searchQuery?: string },
    pagination?: PaginationOptions
  ): Promise<Item[]> {
    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        let query = supabase
          .from('items')
          .select('*')
          .eq('account_id', accountId)
          .is('project_id', null)

        if (filters?.status) {
          query = query.eq('inventory_status', filters.status)
        }

        if (filters?.searchQuery) {
          query = query.or(`description.ilike.%${filters.searchQuery}%,source.ilike.%${filters.searchQuery}%,sku.ilike.%${filters.searchQuery}%,business_inventory_location.ilike.%${filters.searchQuery}%`)
        }

        query = query
          .order('created_at', { ascending: false, nullsFirst: false })
          .order('date_created', { ascending: false, nullsFirst: false })

        if (pagination) {
          const offset = pagination.page > 0 ? (pagination.page - 1) * pagination.limit : 0
          query = query.range(offset, offset + pagination.limit - 1)
        }

        const { data, error } = await query

        if (error) throw error
        void cacheItemsOffline(data || [])
        return (data || []).map(item => this._convertItemFromDb(item))
      } catch (error) {
        console.warn('Failed to fetch business inventory from network, using offline cache:', error)
      }
    }

    return await this._getBusinessInventoryOffline(accountId, filters, pagination)
  },

  subscribeToBusinessInventory(
    accountId: string,
    callback: (items: Item[]) => void,
    _filters: any,
    initialItems?: Item[]
  ) {
    let items = [...(initialItems || [])]

    const channel = supabase
      .channel(`business-inventory:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'items'
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload
          const recordAccountId = (eventType === 'DELETE' ? oldRecord?.account_id : newRecord?.account_id) ?? null
          if (recordAccountId && recordAccountId !== accountId) {
            return
          }

          console.log('Business inventory change received!', payload)

          if (eventType === 'INSERT') {
            if (!newRecord.project_id) {
              const newItem = this._convertItemFromDb(newRecord)
              items = [newItem, ...items]
            }
          } else if (eventType === 'UPDATE') {
            const updatedItem = this._convertItemFromDb(newRecord)
            if (!updatedItem.projectId) {
              items = items.map(i => i.itemId === updatedItem.itemId ? updatedItem : i)
            } else {
              items = items.filter(i => i.itemId !== updatedItem.itemId)
            }
          } else if (eventType === 'DELETE') {
            const oldId = oldRecord.item_id
            items = items.filter(i => i.itemId !== oldId)
          }
          
          callback([...items])
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to business inventory channel')
        }
        if (err) {
          console.error('Error subscribing to business inventory channel:', err)
        }
      })

    return () => {
      channel.unsubscribe()
    }
  },

  // Create new item (account-scoped) - offline-aware orchestrator
  async createItem(accountId: string, itemData: Omit<Item, 'itemId' | 'dateCreated' | 'lastUpdated'>): Promise<CreateItemResult> {
    // Generate optimistic ID upfront so we always have one, even if operations fail
    const optimisticItemId = `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    
    const queueOfflineCreate = async (reason: 'offline' | 'fallback' | 'timeout'): Promise<CreateItemResult> => {
      try {
        const { offlineItemService } = await import('./offlineItemService')
        const result = await offlineItemService.createItem(accountId, itemData)
        if (import.meta.env.DEV) {
          console.info('[unifiedItemsService] createItem queued for offline processing', {
            accountId,
            itemId: result.itemId,
            operationId: result.operationId,
            reason
          })
        }
        return {
          mode: 'offline',
          itemId: result.itemId ?? optimisticItemId,
          operationId: result.operationId
        }
      } catch (error) {
        // Propagate typed errors that the UI should handle (user needs to sign in, storage unavailable, etc.)
        if (error instanceof OfflineQueueUnavailableError || error instanceof OfflineContextError) {
          // Still include optimistic ID in error for UI reference, but throw the error
          console.error('[unifiedItemsService] typed error during offline queue, propagating', {
            accountId,
            itemId: optimisticItemId,
            reason,
            errorType: error.constructor.name,
            errorMessage: error.message
          })
          throw error
        }
        
        // For unexpected errors, return optimistic result so UI can still show feedback
        // This ensures deterministic UI messaging even when unexpected errors occur
        const fallbackOperationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        console.error('[unifiedItemsService] unexpected error during offline queue, returning optimistic result', {
          accountId,
          itemId: optimisticItemId,
          reason,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error
        })
        return {
          mode: 'offline',
          itemId: optimisticItemId,
          operationId: fallbackOperationId
        }
      }
    }

    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      await offlineStore.getAllItems().catch(() => [])
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    if (!isNetworkOnline()) {
      return queueOfflineCreate('offline')
    }

    try {
      await ensureAuthenticatedForDatabase()

      const now = new Date()
      // Use the pre-generated optimistic ID for consistency
      const itemId = optimisticItemId
      const qrKey = `QR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

      const dbItem = this._convertItemToDb({
        ...itemData,
        itemId,
        qrKey: itemData.qrKey || qrKey
      } as Item)

      dbItem.date_created = toDateOnlyString(now)
      dbItem.last_updated = now.toISOString()
      dbItem.account_id = accountId
      dbItem.created_at = now.toISOString()
      if (!dbItem.date_created) dbItem.date_created = toDateOnlyString(now)
      if (!dbItem.last_updated) dbItem.last_updated = now.toISOString()
      if (!dbItem.inventory_status) dbItem.inventory_status = 'available'

      try {
        if (dbItem.transaction_id && dbItem.tax_rate_pct === null) {
          await withNetworkTimeout(async () => {
            const { data: txData } = await supabase
              .from('transactions')
              .select('tax_rate_pct')
              .eq('account_id', accountId)
              .eq('transaction_id', dbItem.transaction_id)
              .single()

            if (txData && txData.tax_rate_pct !== undefined && txData.tax_rate_pct !== null) {
              dbItem.tax_rate_pct = txData.tax_rate_pct
            }
          })
        }
      } catch (e) {
        console.warn('Failed to inherit tax_rate_pct when creating item:', e)
      }

      const computeTaxString = (priceStr: string | null | undefined, ratePct: number | undefined | null) => {
        const priceNum = parseFloat(priceStr || '0')
        const rate = (ratePct !== undefined && ratePct !== null) ? (Number(ratePct) / 100) : 0
        const tax = Math.round((priceNum * rate) * 10000) / 10000
        return tax.toFixed(4)
      }

      dbItem.tax_amount_purchase_price = computeTaxString(dbItem.purchase_price, dbItem.tax_rate_pct)
      dbItem.tax_amount_project_price = computeTaxString(dbItem.project_price, dbItem.tax_rate_pct)

      await withNetworkTimeout(async () => {
        const { error } = await supabase
          .from('items')
          .insert(dbItem)
        if (error) throw error
      })

      try {
        if (dbItem.transaction_id) {
          await _updateTransactionItemIds(accountId, dbItem.transaction_id, itemId, 'add')
        }
      } catch (e) {
        console.warn('Failed to sync transaction item_ids after createItem:', e)
      }

      try {
        if (dbItem.transaction_id) {
          const txId = dbItem.transaction_id
          if (!transactionService._isBatchActive(accountId, txId)) {
            try {
              const purchasePriceRaw = dbItem.purchase_price ?? dbItem.price ?? '0'
              const delta = parseFloat(String(purchasePriceRaw) || '0')
              transactionService.notifyTransactionChanged(accountId, txId, { deltaSum: delta }).catch((e: any) => {
                console.warn('Failed to notifyTransactionChanged after creating item:', e)
              })
            } catch (e) {
              console.warn('Failed computing delta for created item:', e)
            }
          }
        }
      } catch (e) {
        console.warn('Failed to notifyTransactionChanged after creating item (sync path):', e)
      }

      return { mode: 'online', itemId }
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        console.warn('Supabase insert timed out, queuing item for offline sync.')
        return queueOfflineCreate('timeout')
      }
      console.warn('Failed to create item online, falling back to offline queue:', error)
      return queueOfflineCreate('fallback')
    }
  },

  // Update item (account-scoped) - offline-aware orchestrator
  async updateItem(accountId: string, itemId: string, updates: Partial<Item>): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineItem = await offlineStore.getItemById(itemId).catch(() => null)
      if (existingOfflineItem) {
        // Pre-hydrate React Query cache if needed
        // This prevents empty state flashes
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineItemService
    if (!online) {
      const { offlineItemService } = await import('./offlineItemService')
      await offlineItemService.updateItem(accountId, itemId, updates)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()
      // Read existing item so we can recompute any affected transactions after the update
      let existingItem: Item | null = null
      try {
        existingItem = await this.getItemById(accountId, itemId)
      } catch (e) {
        console.warn('Failed to fetch existing item before update:', e)
      }

    const previousTransactionId = existingItem?.transactionId ?? null
    const explicitTransactionUpdate = updates.transactionId !== undefined
    const nextTransactionId = explicitTransactionUpdate
      ? (updates.transactionId as string | null | undefined) ?? null
      : previousTransactionId

    // Convert camelCase updates to database format
    const dbUpdates = this._convertItemToDb({
      ...updates,
      lastUpdated: new Date().toISOString()
    })

    // If transaction_id is being set/changed and caller did not provide tax_rate_pct,
    // attempt to inherit the transaction's tax_rate_pct and include it in the update.
    try {
      const willSetTransaction = updates.transactionId !== undefined && updates.transactionId !== null
      const missingTax = updates.taxRatePct === undefined || updates.taxRatePct === null
      if (willSetTransaction && missingTax) {
        const txId = updates.transactionId as string
        if (txId) {
          const { data: txData } = await supabase
            .from('transactions')
            .select('tax_rate_pct')
            .eq('account_id', accountId)
            .eq('transaction_id', txId)
            .single()

          if (txData && txData.tax_rate_pct !== undefined && txData.tax_rate_pct !== null) {
            dbUpdates.tax_rate_pct = txData.tax_rate_pct
          }
        }
      }
    } catch (e) {
      console.warn('Failed to inherit tax_rate_pct when updating item:', e)
    }

    // If transaction_id is being set and the item currently has a 'to return'
    // disposition, and the target transaction is a Return, automatically mark
    // the item as 'returned' so it reflects the transaction assignment.
    try {
      const willSetTransaction = updates.transactionId !== undefined && updates.transactionId !== null
      if (willSetTransaction && existingItem?.disposition === 'to return') {
        const txId = updates.transactionId as string
        if (txId) {
          const { data: txData } = await supabase
            .from('transactions')
            .select('transaction_type')
            .eq('account_id', accountId)
            .eq('transaction_id', txId)
            .single()

          if (txData && txData.transaction_type === 'Return') {
            // Only set disposition if caller didn't explicitly provide one in updates
            if (dbUpdates.disposition === undefined) {
              dbUpdates.disposition = 'returned'
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to auto-update disposition when assigning return transaction:', e)
    }

    // Recompute derived tax amounts when relevant fields change (purchase/project price or tax rate).
    const shouldRecomputeTax = updates.purchasePrice !== undefined || updates.projectPrice !== undefined || updates.taxRatePct !== undefined
    if (shouldRecomputeTax) {
      const computeTaxString = (priceStr: string | null | undefined, ratePct: number | undefined | null) => {
        const priceNum = parseFloat(priceStr || '0')
        const rate = (ratePct !== undefined && ratePct !== null) ? (Number(ratePct) / 100) : 0
        const tax = Math.round((priceNum * rate) * 10000) / 10000
        return tax.toFixed(4)
      }

      const effectiveRate = updates.taxRatePct !== undefined
        ? updates.taxRatePct
        : (dbUpdates.tax_rate_pct !== undefined ? dbUpdates.tax_rate_pct : existingItem?.taxRatePct)
      const effectivePurchase = updates.purchasePrice !== undefined ? String(updates.purchasePrice) : existingItem?.purchasePrice
      const effectiveProject = updates.projectPrice !== undefined ? String(updates.projectPrice) : existingItem?.projectPrice

      dbUpdates.tax_amount_purchase_price = computeTaxString(effectivePurchase, effectiveRate)
      dbUpdates.tax_amount_project_price = computeTaxString(effectiveProject, effectiveRate)
    }

    const { error } = await supabase
      .from('items')
      .update(dbUpdates)
      .eq('account_id', accountId)
      .eq('item_id', itemId)

    if (error) throw error

    if (previousTransactionId !== nextTransactionId) {
      try {
        // NOTE: We no longer remove items from source transaction's item_ids when they move
        // This preserves historical completeness. Items stay in item_ids forever once added.
        // if (previousTransactionId) {
        //   await _updateTransactionItemIds(accountId, previousTransactionId, itemId, 'remove')
        // }
        if (nextTransactionId) {
          await _updateTransactionItemIds(accountId, nextTransactionId, itemId, 'add')
        }
      } catch (e) {
        console.warn('Failed to sync transaction item_ids after updateItem:', e)
      }
    }

    // Adjust persisted derived sums and recompute needs_review for affected transactions (old and new)
    try {
      const projectForTx = (updates.projectId !== undefined ? updates.projectId : existingItem?.projectId) ?? null
      const affected = Array.from(new Set([previousTransactionId, nextTransactionId]).values()).filter(Boolean) as string[]
      const prevPrice = parseFloat(existingItem?.purchasePrice || '0')
      const newPrice = updates.purchasePrice !== undefined ? parseFloat(String(updates.purchasePrice || '0')) : prevPrice

      for (const txId of affected) {
        try {
          if (!transactionService._isBatchActive(accountId, txId)) {
            // Same transaction updated: send delta (new - prev)
            if (previousTransactionId && nextTransactionId && previousTransactionId === nextTransactionId && txId === previousTransactionId) {
              const delta = newPrice - prevPrice
              if (delta !== 0) {
                transactionService.notifyTransactionChanged(accountId, txId, { deltaSum: delta }).catch((e: any) => {
                  console.warn('Failed to notifyTransactionChanged after updating item for tx', txId, e)
                })
              }
            } else {
              // Moved between transactions: subtract from old and add to new
              if (txId === previousTransactionId) {
                const delta = -prevPrice
                transactionService.notifyTransactionChanged(accountId, txId, { deltaSum: delta }).catch((e: any) => {
                  console.warn('Failed to notifyTransactionChanged for old tx after moving item', txId, e)
                })
              }
              if (txId === nextTransactionId) {
                const delta = newPrice
                transactionService.notifyTransactionChanged(accountId, txId, { deltaSum: delta }).catch((e: any) => {
                  console.warn('Failed to notifyTransactionChanged for new tx after moving item', txId, e)
                })
              }
            }
          }
        } catch (e) {
          console.warn('Failed to schedule notifyTransactionChanged after updating item for tx', txId, e)
        }
      }
    } catch (e) {
      console.warn('Failed to schedule notifyTransactionChanged after updateItem:', e)
    }
    } catch (error) {
      // Network request failed - fall back to offline queue
      console.warn('Failed to update item online, falling back to offline queue:', error)
      const { offlineItemService } = await import('./offlineItemService')
      await offlineItemService.updateItem(accountId, itemId, updates)
    }
  },

  // Delete item (account-scoped) - offline-aware orchestrator
  async deleteItem(accountId: string, itemId: string): Promise<void> {
    // Check network state and hydrate from offlineStore first
    const online = isNetworkOnline()
    
    // Hydrate from offlineStore before attempting Supabase operations
    try {
      await offlineStore.init()
      const existingOfflineItem = await offlineStore.getItemById(itemId).catch(() => null)
      if (existingOfflineItem) {
        // Pre-hydrate React Query cache if needed
      }
    } catch (e) {
      console.warn('Failed to hydrate from offlineStore:', e)
    }

    // If offline, delegate to offlineItemService
    if (!online) {
      const { offlineItemService } = await import('./offlineItemService')
      await offlineItemService.deleteItem(accountId, itemId)
      return
    }

    // Online: try Supabase first, fall back to offline if it fails
    try {
      await ensureAuthenticatedForDatabase()
      // Read existing item to determine associated transaction (if any) so we can recompute after deletion
      let existingItem: Item | null = null
      try {
        existingItem = await this.getItemById(accountId, itemId)
      } catch (e) {
        console.warn('Failed to fetch item before deletion:', e)
      }

      const { error } = await supabase
        .from('items')
        .delete()
        .eq('account_id', accountId)
        .eq('item_id', itemId)

      if (error) throw error

      if (existingItem?.transactionId) {
        // The Postgres trigger handles hard deletes performed outside the app, but we
        // still clean up eagerly here so TransactionDetail stays in sync immediately.
        _updateTransactionItemIds(accountId, existingItem.transactionId, itemId, 'remove').catch(e => {
          console.warn('Failed to sync transaction item_ids after deleteItem:', e)
        })
      }

      // Adjust persisted sum and recompute for the transaction the item belonged to (if any)
      try {
        const txId = existingItem?.transactionId ?? null
        if (txId) {
          if (!transactionService._isBatchActive(accountId, txId)) {
            const prevPrice = parseFloat(existingItem?.purchasePrice || '0')
            const delta = -prevPrice
            transactionService.notifyTransactionChanged(accountId, txId, { deltaSum: delta }).catch((e: any) => {
              console.warn('Failed to notifyTransactionChanged after deleting item:', e)
            })
          }
        }
      } catch (e) {
        console.warn('Failed to notifyTransactionChanged after deleting item:', e)
      }
    } catch (error) {
      // Network request failed - fall back to offline queue
      console.warn('Failed to delete item online, falling back to offline queue:', error)
      const { offlineItemService } = await import('./offlineItemService')
      await offlineItemService.deleteItem(accountId, itemId)
    }
  },

  // Get items for a transaction (by transaction_id) (account-scoped)
  async getItemsForTransaction(accountId: string, _projectId: string, transactionId: string): Promise<Item[]> {
    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()
        const { data, error } = await supabase
          .from('items')
          .select('*')
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)
          .order('date_created', { ascending: true })

        if (error) throw error
        void cacheItemsOffline(data || [])
        return (data || []).map(item => this._convertItemFromDb(item))
      } catch (error) {
        console.warn('Failed to fetch transaction items from network, using offline cache:', error)
      }
    }

    return await this._getTransactionItemsOffline(accountId, transactionId)
  },

  // Allocate single item to project (follows ALLOCATION_TRANSACTION_LOGIC.md deterministic flows) (account-scoped)
  async allocateItemToProject(
    accountId: string,
    itemId: string,
    projectId: string,
    amount?: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    await ensureAuthenticatedForDatabase()

    // Get the item to determine current state and calculate amount
    const item = await this.getItemById(accountId, itemId)
    if (!item) {
      throw new Error('Item not found')
    }

    const finalAmount = amount || item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
    const currentTransactionId: string | null = item.transactionId || null

    console.log('🔄 Starting allocation process:', {
      itemId,
      projectId,
      currentTransactionId,
      itemProjectId: item.projectId,
      finalAmount
    })

    // Log allocation start (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'allocation', itemId, item.projectId ?? null, currentTransactionId ?? null, {
        action: 'allocation_started',
        target_project_id: projectId,
        current_transaction_id: currentTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation start:', auditError)
    }

    // DETERMINISTIC FLOW LOGIC from ALLOCATION_TRANSACTION_LOGIC.md

    // Scenario A: Item currently in a Sale (Project X)
    if (currentTransactionId?.startsWith('INV_SALE_')) {
      const currentProjectId = currentTransactionId.replace('INV_SALE_', '')

      if (currentProjectId === projectId) {
        // A.1: Remove item from Sale and move to Inventory (delete Sale if empty)
        console.log('📋 Scenario A.1: Item in Sale, allocating to same project → move to inventory')
        return await this.handleSaleToInventoryMove(accountId, item, currentTransactionId, projectId, finalAmount, notes, space)
      } else {
        // A.2: Allocate to different project - remove from Sale, add to Purchase (Project Y)
        console.log('📋 Scenario A.2: Item in Sale, allocating to different project')
        return await this.handleSaleToDifferentProjectMove(accountId, itemId, currentTransactionId, projectId, finalAmount, notes, space)
      }
    }

    // Scenario B: Item currently in a Purchase (Project X)
    if (currentTransactionId?.startsWith('INV_PURCHASE_')) {
      const currentProjectId = currentTransactionId.replace('INV_PURCHASE_', '')

      if (currentProjectId === projectId) {
        // B.1: Allocate to same project - remove from Purchase, update amount, delete if empty
        console.log('📋 Scenario B.1: Item in Purchase, allocating to same project')
        return await this.handlePurchaseToInventoryMove(accountId, itemId, currentTransactionId, projectId, finalAmount, notes, space)
      } else {
        // B.2: Allocate to different project - remove from Purchase, add to Sale (Project Y)
        console.log('📋 Scenario B.2: Item in Purchase, allocating to different project')
        return await this.handlePurchaseToDifferentProjectMove(accountId, itemId, currentTransactionId, projectId, finalAmount, notes, space)
      }
    }

    // Scenario C: Item in Inventory (no transaction)
    // Only treat as inventory when there is no transaction_id. Previously this
    // branch also treated items with a null project_id as inventory which
    // incorrectly bypassed removal from existing INV_SALE_/INV_PURCHASE_
    // transactions. Require absence of currentTransactionId to follow the
    // inventory -> purchase flow.
    if (!currentTransactionId) {
      console.log('📋 Scenario C: Item in inventory, allocating to project')
      return await this.handleInventoryToPurchaseMove(accountId, itemId, projectId, finalAmount, notes, space)
    }

    // Fallback: Unknown scenario, treat as new allocation
    console.log('📋 Fallback: Unknown scenario, treating as new allocation')
    return await this.handleInventoryToPurchaseMove(accountId, itemId, projectId, finalAmount, notes, space)
  },

  // Helper: Handle A.1 - Remove item from Sale (same project)
  async handleSaleToPurchaseMove(
    accountId: string,
    itemId: string,
    currentTransactionId: string,
    projectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    const purchaseTransactionId = `INV_PURCHASE_${projectId}`

    // Remove item from existing Sale transaction
    await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)

    // Add item to Purchase transaction (create if none)
    await this.addItemToTransaction(accountId, itemId, purchaseTransactionId, finalAmount, 'Purchase', 'Inventory allocation', notes)

    // Update item status
    await this.updateItem(accountId, itemId, {
      projectId: projectId,
      inventoryStatus: 'allocated',
      transactionId: purchaseTransactionId,
      disposition: 'purchased',
      space: space,
      previousProjectTransactionId: null,
      previousProjectId: null
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, purchaseTransactionId, notes)
      await lineageService.updateItemLineagePointers(accountId, itemId, purchaseTransactionId)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ A.1 completed: Sale → Purchase (same project)')

    // Log successful allocation (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'allocation', itemId, projectId, purchaseTransactionId, {
        action: 'allocation_completed',
        scenario: 'A.1',
        from_transaction: currentTransactionId,
        to_transaction: purchaseTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation completion:', auditError)
    }

    return purchaseTransactionId
  },

  async _restoreItemAfterSaleRemoval(
    accountId: string,
    item: Item,
    projectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<{
    restoredTransactionId: string | null;
    restorationStatus: 'restored' | 'missing_previous_link' | 'previous_project_mismatch' | 'transaction_missing';
  }> {
    let restoredTransactionId: string | null = null
    let restorationStatus: 'restored' | 'missing_previous_link' | 'previous_project_mismatch' | 'transaction_missing' = 'missing_previous_link'

    const previousTransactionId = item.previousProjectTransactionId
    const previousProjectId = item.previousProjectId

    const baseUpdate = {
      projectId: projectId,
      inventoryStatus: 'allocated' as const,
      transactionId: null as string | null,
      disposition: 'purchased' as const,
      notes: notes,
      space: space ?? '',
      previousProjectTransactionId: null as string | null,
      previousProjectId: null as string | null
    }

    if (previousTransactionId && previousProjectId) {
      if (previousProjectId === projectId) {
        const { data: previousTransaction, error: previousTransactionError } = await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', accountId)
          .eq('transaction_id', previousTransactionId)
          .single()

        if (!previousTransactionError && previousTransaction) {
          await this.addItemToTransaction(
            accountId,
            item.itemId,
            previousTransactionId,
            finalAmount,
            'Purchase',
            'Inventory allocation',
            notes
          )

          await this.updateItem(accountId, item.itemId, {
            ...baseUpdate,
            transactionId: previousTransactionId
          })

          restoredTransactionId = previousTransactionId
          restorationStatus = 'restored'
        } else {
          console.warn('⚠️ Stored previous project transaction not found; falling back to allocation without restoration', {
            itemId: item.itemId,
            previousTransactionId
          })
          restorationStatus = 'transaction_missing'

          await this.updateItem(accountId, item.itemId, baseUpdate)
        }
      } else {
        restorationStatus = 'previous_project_mismatch'
        await this.updateItem(accountId, item.itemId, baseUpdate)
      }
    } else {
      await this.updateItem(accountId, item.itemId, baseUpdate)
    }

    return { restoredTransactionId, restorationStatus }
  },

  // Helper: Handle A.1 (authoritative) - Remove item from Sale and move to Inventory (same project)
  async handleSaleToInventoryMove(
    accountId: string,
    item: Item,
    currentTransactionId: string,
    projectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    // Remove item from existing Sale transaction
    await this.removeItemFromTransaction(accountId, item.itemId, currentTransactionId, finalAmount)

    const { restoredTransactionId, restorationStatus } = await this._restoreItemAfterSaleRemoval(
      accountId,
      item,
      projectId,
      finalAmount,
      notes,
      space
    )

    // Append lineage edge and update pointers
    try {
      if (restoredTransactionId) {
        // Sale → Purchase (restored)
        await lineageService.appendItemLineageEdge(accountId, item.itemId, currentTransactionId, restoredTransactionId, notes)
        await lineageService.updateItemLineagePointers(accountId, item.itemId, restoredTransactionId)
      } else {
        // Sale → Inventory (null)
        await lineageService.appendItemLineageEdge(accountId, item.itemId, currentTransactionId, null, notes)
        await lineageService.updateItemLineagePointers(accountId, item.itemId, null)
      }
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ A.1 completed: Sale → Inventory (same project)', {
      restorationStatus,
      restoredTransactionId
    })

    // Log successful move (catch errors to prevent cascading failures)
    try {
      const auditDetails: Record<string, any> = {
        action: 'allocation_completed',
        scenario: 'A.1',
        from_transaction: currentTransactionId,
        amount: finalAmount,
        restoration_status: restorationStatus,
        to_status: restoredTransactionId ? 'allocated_with_purchase' : 'allocated'
      }

      if (restoredTransactionId) {
        auditDetails.restored_transaction_id = restoredTransactionId
      }

      await auditService.logAllocationEvent(accountId, 'allocation', item.itemId, projectId, restoredTransactionId ?? null, auditDetails)
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation completion (A.1):', auditError)
    }

    // Return restored transaction id when available; fall back to the sale id (for compatibility)
    return restoredTransactionId ?? currentTransactionId
  },

  // Helper: Handle A.2 - Remove item from Sale, add to Purchase (different project)
  async handleSaleToDifferentProjectMove(
    accountId: string,
    itemId: string,
    currentTransactionId: string,
    newProjectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    const purchaseTransactionId = `INV_PURCHASE_${newProjectId}`

    // Remove item from existing Sale transaction
    await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)

    // Add item to Purchase transaction for new project (create if none)
    await this.addItemToTransaction(accountId, itemId, purchaseTransactionId, finalAmount, 'Purchase', 'Inventory allocation', notes)

    // Update item status
    await this.updateItem(accountId, itemId, {
      projectId: newProjectId,
      inventoryStatus: 'allocated',
      transactionId: purchaseTransactionId,
      disposition: 'purchased',
      space: space,
      previousProjectTransactionId: null,
      previousProjectId: null
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, purchaseTransactionId, notes)
      await lineageService.updateItemLineagePointers(accountId, itemId, purchaseTransactionId)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ A.2 completed: Sale → Purchase (different project)')

    // Log successful allocation (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'allocation', itemId, newProjectId, purchaseTransactionId, {
        action: 'allocation_completed',
        scenario: 'A.2',
        from_transaction: currentTransactionId,
        to_transaction: purchaseTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation completion:', auditError)
    }

    return purchaseTransactionId
  },

  // Helper: Handle B.1 - Remove item from Purchase (same project)
  async handlePurchaseToInventoryMove(
    accountId: string,
    itemId: string,
    currentTransactionId: string,
    _projectId: string,
    finalAmount: string,
    _notes?: string,
    space?: string
  ): Promise<string> {
    // Remove item from existing Purchase transaction
    await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)

    // Update item status to inventory
    await this.updateItem(accountId, itemId, {
      projectId: null,
      inventoryStatus: 'available',
      transactionId: null,
      disposition: 'inventory',
      notes: _notes,
      space: space ?? '',
      previousProjectTransactionId: currentTransactionId,
      previousProjectId: _projectId
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, null, _notes)
      await lineageService.updateItemLineagePointers(accountId, itemId, null)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ B.1 completed: Purchase → Inventory (same project)')

    // Log successful deallocation (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'deallocation', itemId, null, 'inventory', {
        action: 'deallocation_completed',
        scenario: 'B.1',
        from_transaction: currentTransactionId,
        to_status: 'inventory',
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log deallocation completion:', auditError)
    }

    return currentTransactionId // Return the original transaction ID since item is now in inventory
  },

  // Helper: Handle B.2 - Remove item from Purchase, add to Sale (different project)
  async handlePurchaseToDifferentProjectMove(
    accountId: string,
    itemId: string,
    currentTransactionId: string,
    newProjectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    const saleTransactionId = `INV_SALE_${newProjectId}`

    // Remove item from existing Purchase transaction
    await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)

    // Add item to Sale transaction for new project (create if none)
    await this.addItemToTransaction(accountId, itemId, saleTransactionId, finalAmount, 'To Inventory', 'Inventory sale', notes)

    // Update item status
    await this.updateItem(accountId, itemId, {
      projectId: null,
      inventoryStatus: 'available',
      transactionId: saleTransactionId,
      disposition: 'inventory',
      space: space ?? '',
      previousProjectTransactionId: null,
      previousProjectId: null
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, saleTransactionId, notes)
      await lineageService.updateItemLineagePointers(accountId, itemId, saleTransactionId)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ B.2 completed: Purchase → Sale (different project)')

    // Log successful allocation (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'allocation', itemId, null, saleTransactionId, {
        action: 'allocation_completed',
        scenario: 'B.2',
        from_transaction: currentTransactionId,
        to_transaction: saleTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation completion:', auditError)
    }

    return saleTransactionId
  },

  // Helper: Handle C - Add item to Purchase (new allocation)
  async handleInventoryToPurchaseMove(
    accountId: string,
    itemId: string,
    projectId: string,
    finalAmount: string,
    notes?: string,
    space?: string
  ): Promise<string> {
    const purchaseTransactionId = `INV_PURCHASE_${projectId}`

    // Add item to Purchase transaction (create if none)
    await this.addItemToTransaction(accountId, itemId, purchaseTransactionId, finalAmount, 'Purchase', 'Inventory allocation', notes)

    // Update item status
    await this.updateItem(accountId, itemId, {
      projectId: projectId,
      inventoryStatus: 'allocated',
      transactionId: purchaseTransactionId,
      disposition: 'purchased',
      space: space,
      previousProjectTransactionId: null,
      previousProjectId: null
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, itemId, null, purchaseTransactionId, notes)
      await lineageService.updateItemLineagePointers(accountId, itemId, purchaseTransactionId, purchaseTransactionId)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ C completed: Inventory → Purchase (new allocation)')

    // Log successful allocation (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'allocation', itemId, projectId, purchaseTransactionId, {
        action: 'allocation_completed',
        scenario: 'C',
        from_status: 'inventory',
        to_transaction: purchaseTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log allocation completion:', auditError)
    }

    return purchaseTransactionId
  },

  // Helper: Remove item from transaction and update amounts
  async removeItemFromTransaction(accountId: string, itemId: string, transactionId: string, _itemAmount: string): Promise<void> {
    await ensureAuthenticatedForDatabase()

    // Get the transaction
    const { data: transactionData, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('transaction_id', transactionId)
      .single()

    if (fetchError || !transactionData) {
      console.warn('⚠️ Transaction not found for removal:', transactionId)
      return
    }

    const existingItemIds = transactionData.item_ids || []
    const updatedItemIds = existingItemIds.filter((id: string) => id !== itemId)
    const shouldRecalculateAmount = isCanonicalTransactionId(transactionId)

    if (updatedItemIds.length === 0) {
      // No items left - delete transaction
      try {
        const { error: deleteError } = await supabase
          .from('transactions')
          .delete()
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)

        if (deleteError) throw deleteError

        console.log('🗑️ Deleted empty transaction:', transactionId)

        // Log transaction deletion (catch errors to prevent cascading failures)
        try {
          await auditService.logTransactionStateChange(accountId, transactionId, 'deleted', transactionData, null)
        } catch (auditError) {
          console.warn('⚠️ Failed to log transaction deletion:', auditError)
        }
      } catch (error) {
        console.error('❌ Failed to delete empty transaction:', transactionId, error)
        // Don't throw - allow the allocation to continue even if deletion fails
      }
    } else {
      if (!shouldRecalculateAmount) {
        console.info('ℹ️ Skipping amount recalculation for non-canonical transaction removal', {
          transactionId,
          itemId
        })

        const updateData = {
          item_ids: updatedItemIds,
          updated_at: new Date().toISOString()
        }

        try {
          const { error: updateError } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('account_id', accountId)
            .eq('transaction_id', transactionId)

          if (updateError) throw updateError

          console.log('🔗 Updated transaction items without touching amount:', transactionId)

          try {
            await auditService.logTransactionStateChange(accountId, transactionId, 'updated', transactionData, updateData)
          } catch (auditError) {
            console.warn('⚠️ Failed to log transaction update:', auditError)
          }
        } catch (error) {
          console.error('❌ Failed to update transaction items after removal:', transactionId, error)
        }
        return
      }

      // Canonical transactions continue to derive their amount from linked items
      try {
        const { data: itemsData, error: itemsError } = await supabase
          .from('items')
          .select('project_price, purchase_price, market_value')
          .eq('account_id', accountId)
          .in('item_id', updatedItemIds)

        if (itemsError) throw itemsError

        const totalAmount = (itemsData || [])
          .map(item => item.project_price || item.purchase_price || item.market_value || '0.00')
          .reduce((sum: number, price: string) => sum + parseFloat(price || '0'), 0)
          .toFixed(2)
        const safeAmount = parseFloat(totalAmount) < 0 ? '0.00' : totalAmount

        const updateData = {
          item_ids: updatedItemIds,
          amount: safeAmount,
          updated_at: new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('transactions')
          .update(updateData)
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)

        if (updateError) throw updateError

        console.log('🔄 Updated transaction after removal:', transactionId, 'new amount:', safeAmount)

        try {
          await auditService.logTransactionStateChange(accountId, transactionId, 'updated', transactionData, updateData)
        } catch (auditError) {
          console.warn('⚠️ Failed to log transaction update:', auditError)
        }
      } catch (error) {
        console.error('❌ Failed to update transaction after removal:', transactionId, error)
      }
    }
  },

  // Helper: Add item to transaction (create if none exists).
  // NOTE: transactions.amount is only recalculated for canonical transaction IDs.
  async addItemToTransaction(
    accountId: string,
    itemId: string,
    transactionId: string,
    amount: string,
    transactionType: 'Purchase' | 'Sale' | 'To Inventory',
    triggerEvent: string,
    notes?: string
  ): Promise<void> {
    await ensureAuthenticatedForDatabase()

    // Check if transaction exists
    const { data: existingTransaction, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('transaction_id', transactionId)
      .single()

    if (existingTransaction && !fetchError) {
      // Transaction exists - add item and update associations
      try {
        const existingItemIds = existingTransaction.item_ids || []
        const updatedItemIds = [...new Set([...existingItemIds, itemId])] // Avoid duplicates
        const shouldRecalculateAmount = isCanonicalTransactionId(transactionId)
        type TransactionUpdatePayload = { item_ids: string[]; updated_at: string; amount?: string }
        const baseUpdateData: TransactionUpdatePayload = {
          item_ids: updatedItemIds,
          updated_at: new Date().toISOString()
        }
        let updateData: TransactionUpdatePayload = baseUpdateData

        if (shouldRecalculateAmount) {
          const { data: itemsData, error: itemsError } = await supabase
            .from('items')
            .select('project_price, purchase_price, market_value')
            .eq('account_id', accountId)
            .in('item_id', updatedItemIds)

          if (itemsError) throw itemsError

          const totalAmount = (itemsData || [])
            .map(item => item.project_price || item.purchase_price || item.market_value || '0.00')
            .reduce((sum: number, price: string) => sum + parseFloat(price || '0'), 0)
            .toFixed(2)
          const safeAmount = parseFloat(totalAmount) < 0 ? '0.00' : totalAmount
          updateData = {
            ...baseUpdateData,
            amount: safeAmount
          }
        } else {
          console.info('ℹ️ Skipping amount recalculation for non-canonical transaction add', {
            transactionId,
            itemId
          })
        }

        const { error: updateError } = await supabase
          .from('transactions')
          .update(updateData)
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)

        if (updateError) throw updateError

        if (shouldRecalculateAmount) {
          console.log('🔄 Added item to existing transaction:', transactionId, 'new amount:', updateData.amount)
        } else {
          console.log('🔗 Added item to non-canonical transaction without changing amount:', transactionId)
        }

        // Log transaction update (catch errors to prevent cascading failures)
        try {
          await auditService.logTransactionStateChange(accountId, transactionId, 'updated', existingTransaction, updateData)
        } catch (auditError) {
          console.warn('⚠️ Failed to log transaction update:', auditError)
        }

        // If the transaction has a tax rate, propagate it to the added item
          try {
          const txTax = existingTransaction.tax_rate_pct
          if (txTax !== undefined && txTax !== null) {
            await this.updateItem(accountId, itemId, {
              taxRatePct: txTax
            })
          }
        } catch (e) {
          console.warn('Failed to set tax_rate_pct on added item:', itemId, e)
        }
        // Ensure the item record is linked to the transaction so the UI sees the association
        try {
          await this.updateItem(accountId, itemId, {
            transactionId: transactionId
          })
        } catch (linkErr) {
          console.warn('Failed to link item to transaction after adding to existing transaction:', itemId, linkErr)
        }
      } catch (error) {
        console.error('❌ Failed to update existing transaction:', transactionId, error)
        // Don't throw - allow the allocation to continue
      }
    } else {
      // Create new transaction
      try {
        // Get current user ID for created_by field
        const currentUser = await getCurrentUser()
        if (!currentUser?.id) {
          throw new Error('User must be authenticated to create transactions')
        }

        const projectId = transactionId.replace(transactionType === 'Purchase' ? 'INV_PURCHASE_' : 'INV_SALE_', '')
        const project = await projectService.getProject(accountId, projectId)
        const projectName = project?.name || 'Other'

        const now = new Date()
        const transactionData = {
          account_id: accountId,
          transaction_id: transactionId,
          project_id: projectId,
          transaction_date: toDateOnlyString(now),
          source: transactionType === 'Purchase' ? 'Inventory' : projectName,
          transaction_type: transactionType,
          payment_method: 'Pending',
          amount: amount,
          budget_category: 'Furnishings',
          notes: notes || `Transaction for items ${transactionType === 'Purchase' ? 'purchased from' : 'sold to'} ${transactionType === 'Purchase' ? 'inventory' : 'project'}`,
          status: 'pending' as const,
          reimbursement_type: transactionType === 'Purchase' ? CLIENT_OWES_COMPANY : COMPANY_OWES_CLIENT,
          trigger_event: triggerEvent,
          item_ids: [itemId],
          created_by: currentUser.id,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }

        const { error: insertError } = await supabase
          .from('transactions')
          .insert(transactionData)

        if (insertError) throw insertError

        console.log('🆕 Created new transaction:', transactionId, 'amount:', amount)

        // Log transaction creation (catch errors to prevent cascading failures)
        try {
          await auditService.logTransactionStateChange(accountId, transactionId, 'created', null, transactionData)
        } catch (auditError) {
          console.warn('⚠️ Failed to log transaction creation:', auditError)
        }
        // Link the newly-created transaction to the item record as well
        try {
          await this.updateItem(accountId, itemId, {
            transactionId: transactionId
          })
        } catch (linkErr) {
          console.warn('Failed to link item to transaction after creating new transaction:', itemId, linkErr)
        }
      } catch (error) {
        console.error('❌ Failed to create new transaction:', transactionId, error)
        // Don't throw - allow the allocation to continue
      }
    }
  },

  // Batch allocate multiple items to project (updates INV_PURCHASE_<projectId> transaction)
  async batchAllocateItemsToProject(
    accountId: string,
    itemIds: string[],
    projectId: string,
    allocationData: {
      amount?: string;
      notes?: string;
      space?: string;
    } = {}
  ): Promise<string> {
    await ensureAuthenticatedForDatabase()

    // Fetch the requested items by id (inspect transaction_id per-item to
    // implement A.1 vs A.2 decisions). Do NOT rely solely on project_id.
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select('*')
      .eq('account_id', accountId)
      .in('item_id', itemIds)

    if (itemsError || !itemsData || itemsData.length === 0) {
      throw new Error('No items found for allocation')
    }

    const canonicalTransactionId = `INV_PURCHASE_${projectId}`

    // Process each item individually so we can apply A.1/A.2 rules per item.
    for (const itemData of itemsData) {
      const item = this._convertItemFromDb(itemData)
      const itemId = item.itemId
      const finalAmount =
        allocationData.amount || itemData.project_price || itemData.purchase_price || itemData.market_value || '0.00'
      const currentTransactionId: string | null = itemData.transaction_id || null

      // Scenario A: Item currently in a Sale (Project X)
      if (currentTransactionId?.startsWith('INV_SALE_')) {
        const saleProjectId = currentTransactionId.replace('INV_SALE_', '')

        if (saleProjectId === projectId) {
          // A.1: Remove item from Sale and DO NOT add to Purchase. Assign back to
          // the same project (mark allocated) but do not create an INV_PURCHASE.
          console.log('📋 Batch A.1: Item in sale for target project — removing from sale and assigning to project', itemId)
          await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)
          const { restoredTransactionId } = await this._restoreItemAfterSaleRemoval(
            accountId,
            item,
            projectId,
            finalAmount,
            allocationData.notes,
            allocationData.space
          )
          // Append lineage edge
          try {
            if (restoredTransactionId) {
              await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, restoredTransactionId, allocationData.notes)
              await lineageService.updateItemLineagePointers(accountId, itemId, restoredTransactionId)
            } else {
              await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, null, allocationData.notes)
              await lineageService.updateItemLineagePointers(accountId, itemId, null)
            }
          } catch (lineageError) {
            console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
          }
          continue
        } else {
          // A.2: Remove from Sale then add to Purchase for target project
          console.log('📋 Batch A.2: Item in sale for different project — moving to purchase for target project', itemId)
          await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)
          await this.addItemToTransaction(accountId, itemId, canonicalTransactionId, finalAmount, 'Purchase', 'Inventory allocation', allocationData.notes)
          await this.updateItem(accountId, itemId, {
            projectId: projectId,
            inventoryStatus: 'allocated',
            transactionId: canonicalTransactionId,
            disposition: 'purchased',
            space: allocationData.space || '',
            previousProjectTransactionId: null,
            previousProjectId: null
          })
          // Append lineage edge
          try {
            await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, canonicalTransactionId, allocationData.notes)
            await lineageService.updateItemLineagePointers(accountId, itemId, canonicalTransactionId)
          } catch (lineageError) {
            console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
          }
          continue
        }
      }

      // Scenario C: Item in Inventory (no transaction_id) — add to Purchase
      if (!currentTransactionId) {
        console.log('📋 Batch C: Item in inventory — adding to purchase', itemId)
        await this.addItemToTransaction(accountId, itemId, canonicalTransactionId, finalAmount, 'Purchase', 'Inventory allocation', allocationData.notes)
        await this.updateItem(accountId, itemId, {
          projectId: projectId,
          inventoryStatus: 'allocated',
          transactionId: canonicalTransactionId,
          disposition: 'purchased',
          space: allocationData.space || '',
          previousProjectTransactionId: null,
          previousProjectId: null
        })
        // Append lineage edge
        try {
          await lineageService.appendItemLineageEdge(accountId, itemId, null, canonicalTransactionId, allocationData.notes)
          await lineageService.updateItemLineagePointers(accountId, itemId, canonicalTransactionId, canonicalTransactionId)
        } catch (lineageError) {
          console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
        }
        continue
      }

      // Fallback: other transaction types — add to purchase and update item
      console.log('📋 Batch Fallback: Item in other transaction — adding to purchase', itemId, currentTransactionId)
      await this.addItemToTransaction(accountId, itemId, canonicalTransactionId, finalAmount, 'Purchase', 'Inventory allocation', allocationData.notes)
      await this.updateItem(accountId, itemId, {
        projectId: projectId,
        inventoryStatus: 'allocated',
        transactionId: canonicalTransactionId,
        disposition: 'purchased',
        space: allocationData.space || '',
        previousProjectTransactionId: null,
        previousProjectId: null
      })
      // Append lineage edge
      try {
        await lineageService.appendItemLineageEdge(accountId, itemId, currentTransactionId, canonicalTransactionId, allocationData.notes)
        await lineageService.updateItemLineagePointers(accountId, itemId, canonicalTransactionId)
      } catch (lineageError) {
        console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
      }
    }

    return canonicalTransactionId
  },

  // Return item from project (follows ALLOCATION_TRANSACTION_LOGIC.md deterministic flows)
  async returnItemFromProject(
    accountId: string,
    itemId: string,
    projectId: string,
    amount?: string,
    notes?: string
  ): Promise<string> {
    await ensureAuthenticatedForDatabase()

    // Get the item to determine current state
    const item = await this.getItemById(accountId, itemId)
    if (!item) {
      throw new Error('Item not found')
    }

    const finalAmount = amount || item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
    const currentTransactionId: string | null = item.transactionId || null

    console.log('🔄 Starting return process:', {
      itemId,
      projectId,
      currentTransactionId,
      itemProjectId: item.projectId,
      finalAmount
    })

    // Log return start (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'to return', itemId, item.projectId ?? null, currentTransactionId ?? null, {
        action: 'return_started',
        target_project_id: projectId,
        current_transaction_id: currentTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log return start:', auditError)
    }

    // DETERMINISTIC FLOW LOGIC for returns (reverse of allocation)

    // If item is in a Purchase transaction, this is a return (Scenario B reverse)
    if (currentTransactionId?.startsWith('INV_PURCHASE_')) {
      const currentProjectId = currentTransactionId.replace('INV_PURCHASE_', '')

      if (currentProjectId === projectId) {
        // Returning from same project - remove from Purchase, move to inventory
        console.log('📋 Return Scenario: Item in Purchase, returning from same project')
        return await this.handleReturnFromPurchase(accountId, item, currentTransactionId, projectId, finalAmount, notes)
      }
    }

    // If item is not in any transaction or is in inventory, this is a new return
    console.log('📋 Return Scenario: Item not in transaction or new return')
    return await this.handleNewReturn(accountId, item, projectId, finalAmount, notes)
  },

  // Helper: Handle return from Purchase transaction (same project)
  async handleReturnFromPurchase(
    accountId: string,
    item: Item,
    currentTransactionId: string,
    _projectId: string,
    finalAmount: string,
    notes?: string
  ): Promise<string> {
    // Remove item from existing Purchase transaction and return it to inventory.
    // Per allocation rules, do NOT create an INV_SALE when the item was part of
    // an INV_PURCHASE for the same project. Simply remove the item from the
    // purchase (the helper will delete the purchase if empty), then update the
    // item to reflect that it's back in business inventory.
    await this.removeItemFromTransaction(accountId, item.itemId, currentTransactionId, finalAmount)

    // Update item status to inventory and clear transaction linkage for canonical state
    await this.updateItem(accountId, item.itemId, {
      projectId: null,
      inventoryStatus: 'available',
      transactionId: null,
      disposition: 'inventory',
      notes: notes,
      previousProjectTransactionId: currentTransactionId,
      previousProjectId: item.projectId ?? _projectId
    })

    // Append lineage edge and update pointers
    try {
      await lineageService.appendItemLineageEdge(accountId, item.itemId, currentTransactionId, null, notes)
      await lineageService.updateItemLineagePointers(accountId, item.itemId, null)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ Return completed: Purchase → Inventory (same project)')

    // Log successful return (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'to return', item.itemId, null, currentTransactionId, {
        action: 'return_completed',
        scenario: 'return_from_purchase',
        from_transaction: currentTransactionId,
        to_status: 'inventory',
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log return completion:', auditError)
    }

    // Return the original purchase transaction id (may have been deleted)
    return currentTransactionId
  },

  // Helper: Handle new return (item was already in inventory or no transaction)
  async handleNewReturn(
    accountId: string,
    item: Item,
    projectId: string,
    finalAmount: string,
    notes?: string
  ): Promise<string> {
    await ensureAuthenticatedForDatabase()

    // Get current user ID for created_by field
    const currentUser = await getCurrentUser()
    if (!currentUser?.id) {
      throw new Error('User must be authenticated to create transactions')
    }

    // Get project name for source field
    let projectName = 'Other'
    try {
      const project = await projectService.getProject(accountId, projectId)
      projectName = project?.name || 'Other'
    } catch (error) {
      console.warn('Could not fetch project name for transaction source:', error)
    }

    // Create Sale transaction (project selling TO us)
    const saleTransactionId = `INV_SALE_${projectId}`

    // Check if the canonical transaction already exists (account-scoped)
    const { data: existingTransaction, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('transaction_id', saleTransactionId)
      .single()

    const now = new Date()

    if (existingTransaction && !fetchError) {
      // Transaction exists - merge the new item and recalculate amount
      console.log('📋 Existing INV_SALE transaction found, updating with new item')
      const existingItemIds = existingTransaction.item_ids || []
      const updatedItemIds = [...new Set([...existingItemIds, item.itemId])] // Avoid duplicates

      // Get all items to recalculate amount
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('project_price, purchase_price, market_value')
        .eq('account_id', accountId)
        .in('item_id', updatedItemIds)

      if (itemsError) throw itemsError

      const totalAmount = (itemsData || [])
        .map(current => current.project_price || current.purchase_price || current.market_value || '0.00')
        .reduce((sum: number, price: string) => sum + parseFloat(price || '0'), 0)
        .toFixed(2)

      const updatedTransactionData = {
        item_ids: updatedItemIds,
        amount: totalAmount,
        notes: notes || 'Transaction for items purchased from project and moved to business inventory',
        updated_at: now.toISOString()
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(updatedTransactionData)
        .eq('account_id', accountId)
        .eq('transaction_id', saleTransactionId)

      if (updateError) throw updateError

      console.log('🔄 Updated INV_SALE transaction with', updatedItemIds.length, 'items, amount:', totalAmount)
    } else {
      // Transaction doesn't exist - create new one
      const transactionData = {
        account_id: accountId,
        transaction_id: saleTransactionId,
        project_id: projectId,
        transaction_date: toDateOnlyString(now),
        source: projectName,
        transaction_type: 'To Inventory',  // Project is moving item TO inventory
        payment_method: 'Pending',
        amount: finalAmount,
        budget_category: 'Furnishings',
        notes: notes || 'Transaction for items purchased from project and moved to business inventory',
        status: 'pending' as const,
        reimbursement_type: COMPANY_OWES_CLIENT,  // We owe the client for this purchase
        trigger_event: 'Inventory sale' as const,
        item_ids: [item.itemId],
        created_by: currentUser.id,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }

      console.log('🆕 Creating new INV_SALE transaction with amount:', transactionData.amount)

      // Insert the transaction (we've already checked it doesn't exist above)
      const { error: insertError } = await supabase
        .from('transactions')
        .insert(transactionData)

      if (insertError) throw insertError
    }

    // Update item status to inventory while preserving original purchase metadata when available
    const previousProjectTransactionId = item.transactionId?.startsWith('INV_PURCHASE_')
      ? item.transactionId
      : item.previousProjectTransactionId ?? null
    const previousProjectId = item.transactionId?.startsWith('INV_PURCHASE_')
      ? (item.projectId ?? projectId)
      : item.previousProjectId ?? null

    await this.updateItem(accountId, item.itemId, {
      projectId: null,
      inventoryStatus: 'available',
      transactionId: saleTransactionId,
      disposition: 'inventory',
      previousProjectTransactionId,
      previousProjectId
    })

    // Append lineage edge and update pointers
    try {
      const fromTransactionId = item.transactionId || null
      await lineageService.appendItemLineageEdge(accountId, item.itemId, fromTransactionId, saleTransactionId, notes)
      await lineageService.updateItemLineagePointers(accountId, item.itemId, saleTransactionId)
    } catch (lineageError) {
      console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
    }

    console.log('✅ New return completed: Inventory → Sale')

    // Log successful return (catch errors to prevent cascading failures)
    try {
      await auditService.logAllocationEvent(accountId, 'to return', item.itemId, null, saleTransactionId, {
        action: 'return_completed',
        scenario: 'new_return',
        from_status: 'inventory',
        to_transaction: saleTransactionId,
        amount: finalAmount
      })
    } catch (auditError) {
      console.warn('⚠️ Failed to log return completion:', auditError)
    }

    return saleTransactionId
  },

  // Complete pending transaction (marks as completed and clears transaction_id)
  async completePendingTransaction(
    accountId: string,
    transactionType: 'sale' | 'buy',
    projectId: string,
    paymentMethod: string
  ): Promise<void> {
    await ensureAuthenticatedForDatabase()

    // Determine canonical transaction ID
    const canonicalTransactionId = transactionType === 'sale'
      ? `INV_SALE_${projectId}`
      : `INV_PURCHASE_${projectId}`

    // Get the transaction
    const { data: transactionData, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('transaction_id', canonicalTransactionId)
      .single()

    if (fetchError || !transactionData) {
      throw new Error('Transaction not found')
    }

    const itemIds = transactionData.item_ids || []

    // Complete the transaction
    const now = new Date()
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        payment_method: paymentMethod,
        transaction_date: toDateOnlyString(now),
        updated_at: now.toISOString()
      })
      .eq('account_id', accountId)
      .eq('transaction_id', canonicalTransactionId)

    if (updateError) throw updateError

    // Clear transaction_id from all linked items (update sequentially since Supabase doesn't have batch updates)
    for (const itemId of itemIds) {
      if (transactionType === 'sale') {
        // For sales (INV_SALE), items move to business inventory (not sold)
        // Per plan: when completing INV_SALE, items should become available in business inventory
        // and have a lineage edge INV_SALE → null
        await this.updateItem(accountId, itemId, {
          transactionId: null,
          inventoryStatus: 'available'  // Changed from 'sold' to 'available' per plan
        })
        
        // Append lineage edge: sale → inventory (null)
        try {
          await lineageService.appendItemLineageEdge(accountId, itemId, canonicalTransactionId, null)
          await lineageService.updateItemLineagePointers(accountId, itemId, null)
        } catch (lineageError) {
          console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
        }
      } else {
        // For buys, clear project_id and transaction_id and set status to available
        await this.updateItem(accountId, itemId, {
          projectId: null,
          transactionId: null,
          inventoryStatus: 'available'
        })
        
        // Append lineage edge: purchase → inventory (null)
        try {
          await lineageService.appendItemLineageEdge(accountId, itemId, canonicalTransactionId, null)
          await lineageService.updateItemLineagePointers(accountId, itemId, null)
        } catch (lineageError) {
          console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
        }
      }
    }
  },

  // Helper function to get item by ID (account-scoped)
  async getItemById(accountId: string, itemId: string): Promise<Item | null> {
    // First, check React Query cache (for optimistic items created offline)
    try {
      const queryClient = tryGetQueryClient()
      if (queryClient) {
        const cachedItem = queryClient.getQueryData<Item>(['item', accountId, itemId])
        if (cachedItem) {
          console.debug('[getItemById] Found item in React Query cache:', itemId)
          return cachedItem
        }
      }
    } catch (error) {
      // QueryClient might not be initialized yet, continue to other sources
      console.debug('[getItemById] React Query cache check failed (non-fatal):', error)
    }

    const online = isNetworkOnline()
    if (online) {
      try {
        await ensureAuthenticatedForDatabase()

        const { data, error } = await supabase
          .from('items')
          .select('*')
          .eq('account_id', accountId)
          .eq('item_id', itemId)
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            return null
          }
          throw error
        }

        if (!data) return null
        void cacheItemsOffline([data])
        return this._convertItemFromDb(data)
      } catch (error) {
        console.warn('Failed to fetch item by ID from network, using offline cache:', error)
      }
    }

    return await this._getItemByIdOffline(accountId, itemId)
  },

  // Duplicate an existing item (unified collection version) (account-scoped)
  async duplicateItem(accountId: string, projectId: string, originalItemId: string): Promise<string> {
    await ensureAuthenticatedForDatabase()

    // Get the original item first
    const originalItem = await this.getItemById(accountId, originalItemId)
    if (!originalItem) {
      throw new Error('Original item not found')
    }

    const now = new Date()
    const newItemId = `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    const newQrKey = `QR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

    // Create duplicate item with new IDs and timestamps
    const duplicatedItem: any = {
      account_id: accountId,
      item_id: newItemId,
      description: originalItem.description || '',
      source: originalItem.source || '',
      sku: originalItem.sku || '',
      purchase_price: originalItem.purchasePrice || null,
      project_price: originalItem.projectPrice || null,
      market_value: originalItem.marketValue || null,
      payment_method: originalItem.paymentMethod || '',
      disposition: 'purchased', // Default disposition for duplicates
      notes: originalItem.notes || null,
      space: originalItem.space || null,
      qr_key: newQrKey,
      bookmark: false, // Default bookmark to false for duplicates
      transaction_id: originalItem.transactionId || null,
      project_id: projectId,
      inventory_status: originalItem.inventoryStatus || 'available',
      business_inventory_location: originalItem.businessInventoryLocation || null,
      date_created: originalItem.dateCreated || toDateOnlyString(now),
      last_updated: now.toISOString(),
      images: originalItem.images || [], // Copy images from original item
      tax_rate_pct: originalItem.taxRatePct || null,
      tax_amount_purchase_price: originalItem.taxAmountPurchasePrice || null,
      tax_amount_project_price: originalItem.taxAmountProjectPrice || null,
      created_by: originalItem.createdBy || null,
      created_at: now.toISOString()
    }

    // Remove any undefined values that might still exist
    Object.keys(duplicatedItem).forEach(key => {
      if (duplicatedItem[key] === undefined) {
        delete duplicatedItem[key]
      }
    })

    // Create the duplicated item
    const { error } = await supabase
      .from('items')
      .insert(duplicatedItem)

    if (error) throw error

    try {
      if (duplicatedItem.transaction_id) {
        await _updateTransactionItemIds(accountId, duplicatedItem.transaction_id, newItemId, 'add')
      }
    } catch (e) {
      console.warn('Failed to sync transaction item_ids after duplicateItem:', e)
    }

    return newItemId
  },

  // Create multiple items linked to a transaction (unified collection version) (account-scoped)
  async createTransactionItems(
    accountId: string,
    projectId: string,
    transactionId: string,
    transaction_date: string,
    transactionSource: string,
    items: TransactionItemFormData[],
    taxRatePct?: number
  ): Promise<string[]> {
    await ensureAuthenticatedForDatabase()

    const createdItemIds: string[] = []
    const now = new Date()

    // Attempt to read the transaction's tax rate once (avoid per-item reads)
    let inheritedTax: number | undefined = undefined
    try {
      if ((taxRatePct === undefined || taxRatePct === null) && transactionId) {
        const { data: txData, error: txError } = await supabase
          .from('transactions')
          .select('tax_rate_pct')
          .eq('account_id', accountId)
          .eq('transaction_id', transactionId)
          .single()

        if (!txError && txData && txData.tax_rate_pct !== undefined && txData.tax_rate_pct !== null) {
          inheritedTax = txData.tax_rate_pct
        }
      }
    } catch (e) {
      // non-fatal - continue without inherited tax
    }

    // Prepare all items for batch insert
    const itemsToInsert: any[] = []

    // Helper: compute tax amount string (two-decimal) given price string and rate pct
    const computeTaxString = (priceStr: string | null | undefined, ratePct: number | undefined | null) => {
      const priceNum = parseFloat(priceStr || '0')
      const rate = (ratePct !== undefined && ratePct !== null) ? (Number(ratePct) / 100) : 0
      const tax = Math.round((priceNum * rate) * 10000) / 10000
      return tax.toFixed(4)
    }

    const normalizeMoneyStringToFourDecimals = (input: string | null | undefined): string | null => {
      if (!input) return null
      const n = Number.parseFloat(String(input))
      if (!Number.isFinite(n)) return null
      return n.toFixed(4)
    }

    for (const itemData of items) {
      const itemId = `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
      createdItemIds.push(itemId)

      const qrKey = `QR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

      const item: any = {
        account_id: accountId,
        item_id: itemId,
        description: itemData.description ?? null,
        source: transactionSource, // Use transaction source for all items
        sku: itemData.sku ?? null,
        purchase_price: itemData.purchasePrice ?? null,
        project_price: itemData.projectPrice ?? null,
        market_value: itemData.marketValue ?? null,
        payment_method: null, // No default - should come from transaction or item data
        disposition: 'purchased',
        notes: itemData.notes ?? null,
        qr_key: qrKey,
        bookmark: false,
        transaction_id: transactionId,
        project_id: projectId,
        inventory_status: 'allocated',
        date_created: transaction_date,
        last_updated: now.toISOString(),
        images: [], // Start with empty images array, will be populated after upload
        created_at: now.toISOString()
      }

      // Attach tax rate from explicit arg, otherwise inherited transaction value
      if (taxRatePct !== undefined && taxRatePct !== null) {
        item.tax_rate_pct = taxRatePct
      } else if (inheritedTax !== undefined) {
        item.tax_rate_pct = inheritedTax
      }
      // Attach item-level tax amounts. If provided explicitly (e.g. importer parsed line-item tax),
      // prefer those; otherwise compute from the tax rate.
      const explicitPurchaseTax = normalizeMoneyStringToFourDecimals(itemData.taxAmountPurchasePrice)
      const explicitProjectTax = normalizeMoneyStringToFourDecimals(itemData.taxAmountProjectPrice)
      item.tax_amount_purchase_price = explicitPurchaseTax ?? computeTaxString(item.purchase_price, item.tax_rate_pct)
      item.tax_amount_project_price = explicitProjectTax ?? computeTaxString(item.project_price, item.tax_rate_pct)

      itemsToInsert.push(item)
    }

    // Insert all items in a single batch operation
    if (itemsToInsert.length > 0) {
      const { error } = await supabase
        .from('items')
        .insert(itemsToInsert)

      if (error) throw error

      if (transactionId && createdItemIds.length > 0) {
        try {
          await _updateTransactionItemIds(accountId, transactionId, createdItemIds, 'add')
        } catch (e) {
          console.warn('Failed to sync transaction item_ids after createTransactionItems:', e)
        }
      }
    }
    // Recompute and persist needs_review for the transaction we just mutated (fire-and-forget,
    // but skip if a top-level batch is active for this transaction).
    try {
      if (!transactionService._isBatchActive(accountId, transactionId)) {
        try {
          const deltaSum = itemsToInsert.reduce((sum, it) => {
            const p = parseFloat(String(it.purchase_price ?? it.price ?? '0') || '0')
            return sum + (isNaN(p) ? 0 : p)
          }, 0)
          if (deltaSum !== 0) {
            transactionService.notifyTransactionChanged(accountId, transactionId, { deltaSum }).catch((e: any) => {
              console.warn('Failed to notifyTransactionChanged after creating transaction items:', e)
            })
          } else {
            // No price delta to apply, still enqueue a recompute (no delta)
            transactionService.notifyTransactionChanged(accountId, transactionId).catch((e: any) => {
              console.warn('Failed to notifyTransactionChanged after creating transaction items (no delta):', e)
            })
          }
        } catch (e) {
          console.warn('Failed computing deltaSum for created transaction items:', e)
        }
      }
    } catch (e) {
      console.warn('Failed to notifyTransactionChanged after creating transaction items (sync path):', e)
    }

    return createdItemIds
  }
}

// Deallocation Service - Handles inventory designation automation
export const deallocationService = {
  async _resolvePreviousProjectLink(
    accountId: string,
    item: Item,
    projectId: string
  ): Promise<{
    previousProjectTransactionId: string | null;
    previousProjectId: string | null;
  }> {
    const currentTransactionId = item.transactionId
    const currentProjectId = item.projectId ?? projectId
    const isCanonicalSale = currentTransactionId ? currentTransactionId.startsWith('INV_SALE_') : false

    if (currentTransactionId && !isCanonicalSale) {
      return {
        previousProjectTransactionId: currentTransactionId,
        previousProjectId: currentProjectId
      }
    }

    return {
      previousProjectTransactionId: item.previousProjectTransactionId ?? null,
      previousProjectId: item.previousProjectId ?? null
    }
  },

  // Main entry point for handling inventory designation - simplified unified approach
  async handleInventoryDesignation(
    accountId: string,
    itemId: string,
    projectId: string,
    disposition: string
  ): Promise<void> {
    console.log('🔄 handleInventoryDesignation called:', { itemId, projectId, disposition })

    if (disposition !== 'inventory') {
      console.log('⏭️ Skipping - disposition is not inventory:', disposition)
      return // Only handle 'inventory' disposition
    }

    try {
      console.log('🔍 Getting item details for:', itemId)
      // Get the item details
      const item = await unifiedItemsService.getItemById(accountId, itemId)
      if (!item) {
        throw new Error('Item not found')
      }
      console.log('✅ Item found:', item.itemId, 'disposition:', item.disposition, 'projectId:', item.projectId)

      const {
        previousProjectTransactionId,
        previousProjectId
      } = await this._resolvePreviousProjectLink(accountId, item, projectId)

      // If the item is currently linked to an INV_PURCHASE for the same project,
      // this is a purchase-reversion: remove it from the purchase and return it
      // to inventory instead of creating an INV_SALE. This prevents creating
      // both INV_PURCHASE and INV_SALE canonical transactions for the same
      // item/project.
      if (item.transactionId && item.transactionId.startsWith('INV_PURCHASE_')) {
        const purchaseProjectId = item.transactionId.replace('INV_PURCHASE_', '')
        if (purchaseProjectId === projectId) {
          console.log('🔁 Detected purchase-reversion: removing from INV_PURCHASE and returning to inventory')

          // Remove item from the existing purchase (will delete if empty)
          await unifiedItemsService.removeItemFromTransaction(
            accountId,
            item.itemId,
            item.transactionId,
            item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
          )

          // Update the item to reflect it's back in business inventory
          await unifiedItemsService.updateItem(accountId, item.itemId, {
            projectId: null,
            inventoryStatus: 'available',
            transactionId: null,
            previousProjectTransactionId,
            previousProjectId,
            lastUpdated: new Date().toISOString()
          })

          try {
            await auditService.logAllocationEvent(accountId, 'deallocation', itemId, null, item.transactionId, {
              action: 'deallocation_completed',
              scenario: 'purchase_reversion',
              from_transaction: item.transactionId,
              to_status: 'inventory',
              amount: item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
            })
          } catch (auditError) {
            console.warn('⚠️ Failed to log deallocation completion for purchase-reversion:', auditError)
          }

          console.log('✅ Purchase-reversion handled: item returned to inventory without creating INV_SALE')
          return
        }
      }

      // Unified approach: Always create/update a "Sale" transaction for inventory designation (project selling TO us)
      console.log('🏦 Creating/updating Sale transaction for inventory designation')

      // Log deallocation start (catch errors to prevent cascading failures)
      try {
        await auditService.logAllocationEvent(accountId, 'deallocation', itemId, item.projectId ?? null, item.transactionId ?? null, {
          action: 'deallocation_started',
          target_status: 'inventory',
          current_transaction_id: item.transactionId
        })
      } catch (auditError) {
        console.warn('⚠️ Failed to log deallocation start:', auditError)
      }

      const transactionId = await this.ensureSaleTransaction(
        accountId,
        item,
        projectId,
        'Transaction for items purchased from project and moved to business inventory',
        {
          previousProjectTransactionId,
          previousProjectId
        }
      )

      console.log('📦 Moving item to business inventory...')
      // Update item to move to business inventory and link to transaction
      await unifiedItemsService.updateItem(accountId, item.itemId, {
        projectId: null,
        inventoryStatus: 'available',
        transactionId: transactionId,
        space: '', // Clear space field when moving to business inventory
        previousProjectTransactionId,
        previousProjectId,
        lastUpdated: new Date().toISOString()
      })

      // Append lineage edge and update pointers
      try {
        const fromTransactionId = item.transactionId || null
        await lineageService.appendItemLineageEdge(accountId, item.itemId, fromTransactionId, transactionId)
        await lineageService.updateItemLineagePointers(accountId, item.itemId, transactionId)
      } catch (lineageError) {
        console.warn('⚠️ Failed to append lineage edge (non-critical):', lineageError)
      }

      // Log successful deallocation (catch errors to prevent cascading failures)
      try {
        await auditService.logAllocationEvent(accountId, 'deallocation', itemId, null, transactionId, {
          action: 'deallocation_completed',
          from_project_id: item.projectId,
          to_transaction: transactionId,
          amount: item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
        })
      } catch (auditError) {
        console.warn('⚠️ Failed to log deallocation completion:', auditError)
      }

      console.log('✅ Item moved to business inventory successfully')

      console.log('✅ Deallocation completed successfully')
    } catch (error) {
      console.error('❌ Error handling inventory designation:', error)
      throw error
    }
  },

  // Unified function to ensure a sale transaction exists for inventory designation (follows ALLOCATION_TRANSACTION_LOGIC.md)
  async ensureSaleTransaction(
    accountId: string,
    item: Item,
    projectId: string,
    additionalNotes?: string,
    previousLink?: {
      previousProjectTransactionId: string | null;
      previousProjectId: string | null;
    }
  ): Promise<string | null> {
    await ensureAuthenticatedForDatabase()

    // Get current user ID for created_by field
    const currentUser = await getCurrentUser()
    if (!currentUser?.id) {
      throw new Error('User must be authenticated to create transactions')
    }

    console.log('🏦 Creating/updating sale transaction for item:', item.itemId)

    // Get project name for source field
    let projectName = 'Other'
    try {
      const project = await projectService.getProject(accountId, projectId)
      projectName = project?.name || 'Other'
    } catch (error) {
      console.warn('Could not fetch project name for transaction source:', error)
    }

    // Defensive check: if the item is still linked to a purchase for this
    // project, treat as purchase-reversion and do not create an INV_SALE.
    if (item.transactionId && item.transactionId.startsWith('INV_PURCHASE_')) {
      const purchaseProjectId = item.transactionId.replace('INV_PURCHASE_', '')
      if (purchaseProjectId === projectId) {
        console.log('ℹ️ ensureSaleTransaction detected existing INV_PURCHASE for same project; performing purchase-reversion instead of creating INV_SALE')

        // Remove the item from the purchase and return to inventory
        await unifiedItemsService.removeItemFromTransaction(
          accountId,
          item.itemId,
          item.transactionId,
          item.projectPrice || item.purchasePrice || item.marketValue || '0.00'
        )
        await unifiedItemsService.updateItem(accountId, item.itemId, {
          projectId: null,
          inventoryStatus: 'available',
          transactionId: null,
          previousProjectTransactionId: previousLink?.previousProjectTransactionId ?? item.transactionId,
          previousProjectId: previousLink?.previousProjectId ?? item.projectId ?? projectId
        })

        // Return null to indicate no INV_SALE was created
        return null
      }
    }

    const canonicalTransactionId = `INV_SALE_${projectId}`
    console.log('🔑 Canonical transaction ID:', canonicalTransactionId)

    // Check if the canonical transaction already exists (account-scoped)
    const { data: existingTransaction, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('transaction_id', canonicalTransactionId)
      .single()

    if (existingTransaction && !fetchError) {
      // Transaction exists - merge the new item and recalculate amount
      console.log('📋 Existing INV_SALE transaction found, updating with new item')
      const existingItemIds = existingTransaction.item_ids || []
      const updatedItemIds = [...new Set([...existingItemIds, item.itemId])] // Avoid duplicates

      // Get all items to recalculate amount
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('project_price, purchase_price, market_value')
        .eq('account_id', accountId)
        .in('item_id', updatedItemIds)

      if (itemsError) throw itemsError

      const totalAmount = (itemsData || [])
        .map(item => item.project_price || item.purchase_price || item.market_value || '0.00')
        .reduce((sum: number, price: string) => sum + parseFloat(price || '0'), 0)
        .toFixed(2)

      const now = new Date()
      const updatedTransactionData = {
        item_ids: updatedItemIds,
        amount: totalAmount,
        notes: additionalNotes || 'Transaction for items purchased from project and moved to business inventory',
        updated_at: now.toISOString()
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(updatedTransactionData)
        .eq('account_id', accountId)
        .eq('transaction_id', canonicalTransactionId)

      if (updateError) throw updateError

      console.log('🔄 Updated INV_SALE transaction with', updatedItemIds.length, 'items, amount:', totalAmount)
    } else {
      // Calculate amount from item for new transaction
      const calculatedAmount = item.projectPrice || item.purchasePrice || item.marketValue || '0.00'

      // New transaction - create Sale transaction (project moving item TO inventory)
      const now = new Date()
      const transactionData = {
        account_id: accountId,
        transaction_id: canonicalTransactionId,
        project_id: projectId,
        transaction_date: toDateOnlyString(now),
        source: projectName,  // Project name as source (project moving to inventory)
        transaction_type: 'Sale',  // Project is moving item TO inventory
        payment_method: 'Pending',
        amount: parseFloat(calculatedAmount || '0').toFixed(2),
        budget_category: 'Furnishings',
        notes: additionalNotes || 'Transaction for items purchased from project and moved to business inventory',
        status: 'pending' as const,
        reimbursement_type: COMPANY_OWES_CLIENT,  // We owe the client for this purchase
        trigger_event: 'Inventory sale' as const,
        item_ids: [item.itemId],
        created_by: currentUser.id,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }

      console.log('🆕 Creating new INV_SALE transaction with amount:', transactionData.amount)

      // Insert the transaction (we've already checked it doesn't exist above)
      const { error: insertError } = await supabase
        .from('transactions')
        .insert(transactionData)

      if (insertError) throw insertError
    }

    console.log('✅ Sale transaction created/updated successfully')
    return canonicalTransactionId
  }
}

// Integration Service for Business Inventory and Transactions
export const integrationService = {
  // Allocate business inventory item to project (unified collection)
  async allocateBusinessInventoryToProject(
    accountId: string,
    itemId: string,
    projectId: string,
    amount?: string,
    notes?: string
  ): Promise<string> {
    return await unifiedItemsService.allocateItemToProject(accountId, itemId, projectId, amount, notes)
  },

  // Return item from project to business inventory (unified collection)
  async returnItemToBusinessInventory(
    accountId: string,
    itemId: string,
    _transactionId: string,
    projectId: string
  ): Promise<void> {
    // Use the canonical return method which creates/updates INV_BUY_<projectId> transaction
    await unifiedItemsService.returnItemFromProject(accountId, itemId, projectId)
  },

  // Complete pending transaction and mark item as sold (unified collection)
  async completePendingTransaction(
    accountId: string,
    _itemId: string,
    _transactionId: string,
    projectId: string,
    paymentMethod: string
  ): Promise<void> {
    // For sales, we need to complete the INV_SALE transaction
    return await unifiedItemsService.completePendingTransaction(accountId, 'sale', projectId, paymentMethod)
  },

  // Handle item deallocation (new method)
  async handleItemDeallocation(
    accountId: string,
    itemId: string,
    projectId: string,
    disposition: string
  ): Promise<void> {
    return await deallocationService.handleInventoryDesignation(accountId, itemId, projectId, disposition)
  }
}
