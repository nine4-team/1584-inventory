import { supabase, getCurrentUser } from './supabase'
import { ensureAuthenticatedForDatabase } from './databaseService'
import { isNetworkOnline } from './networkStatusService'
import type { ItemLineageEdge, ItemLineageMovementKind, ItemLineageSource } from '@/types'

type LineageEdgeListener = (edge: ItemLineageEdge) => void
const ALL_ITEMS_KEY = '__all__'

type AccountChannelEntry = {
  channel: ReturnType<typeof supabase.channel>
  itemListeners: Map<string, Set<LineageEdgeListener>>
  transactionListeners: Map<string, Set<LineageEdgeListener>>
}

const accountChannelRegistry = new Map<string, AccountChannelEntry>()

const convertEdgeFromDb = (dbEdge: any): ItemLineageEdge => ({
  id: dbEdge.id,
  accountId: dbEdge.account_id,
  itemId: dbEdge.item_id,
  fromTransactionId: dbEdge.from_transaction_id ?? null,
  toTransactionId: dbEdge.to_transaction_id ?? null,
  movementKind: dbEdge.movement_kind ?? null,
  source: dbEdge.source ?? null,
  createdAt: dbEdge.created_at,
  createdBy: dbEdge.created_by ?? null,
  note: dbEdge.note ?? null,
})

const getOrCreateAccountChannel = (accountId: string): AccountChannelEntry => {
  let entry = accountChannelRegistry.get(accountId)
  if (entry) {
    return entry
  }

  const itemListeners = new Map<string, Set<LineageEdgeListener>>()
  const transactionListeners = new Map<string, Set<LineageEdgeListener>>()

  const dispatchItemListeners = (edge: ItemLineageEdge) => {
    const invokeCallbacks = (callbacks?: Set<LineageEdgeListener>) => {
      if (!callbacks || callbacks.size === 0) return
      callbacks.forEach(callback => {
        try {
          callback(edge)
        } catch (error) {
          console.debug('lineageService: item listener callback failed', error)
        }
      })
    }

    invokeCallbacks(edge.itemId ? itemListeners.get(edge.itemId) : undefined)
    invokeCallbacks(itemListeners.get(ALL_ITEMS_KEY))
  }

  const dispatchTransactionListeners = (edge: ItemLineageEdge) => {
    if (!edge.fromTransactionId) return
    const callbacks = transactionListeners.get(edge.fromTransactionId)
    if (!callbacks) return
    callbacks.forEach(callback => {
      try {
        callback(edge)
      } catch (error) {
        console.debug('lineageService: transaction listener callback failed', error)
      }
    })
  }

  const channel = supabase
    .channel(`item_lineage:account:${accountId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'item_lineage_edges'
      },
      payload => {
        try {
          if ((payload.new?.account_id ?? payload.old?.account_id) !== accountId) {
            return
          }
          const edge = convertEdgeFromDb(payload.new)
          dispatchItemListeners(edge)
          dispatchTransactionListeners(edge)
        } catch (error) {
          console.debug('lineageService: failed to dispatch lineage edge', error)
        }
      }
    )
    .subscribe((status, err) => {
      if (err) {
        console.error('Error subscribing to account lineage channel', err)
      } else if (status === 'SUBSCRIBED') {
        console.debug(`Subscribed to account lineage channel for ${accountId}`)
      }
    })

  entry = { channel, itemListeners, transactionListeners }
  accountChannelRegistry.set(accountId, entry)
  return entry
}

const releaseAccountChannelIfUnused = (accountId: string) => {
  const entry = accountChannelRegistry.get(accountId)
  if (!entry) return
  if (entry.itemListeners.size === 0 && entry.transactionListeners.size === 0) {
    try {
      entry.channel.unsubscribe()
    } catch (error) {
      console.debug('lineageService: failed to unsubscribe account channel', error)
    }
    accountChannelRegistry.delete(accountId)
  }
}

/**
 * Centralized service for managing item lineage edges.
 * Provides idempotent edge creation and enforces single-path invariants.
 */
export const lineageService = {
  /**
   * Append a lineage edge for an item move.
   * Includes idempotency checks to prevent duplicate edges.
   * 
   * @param accountId - Account ID
   * @param itemId - Item ID
   * @param fromTransactionId - Source transaction (null = from inventory)
   * @param toTransactionId - Destination transaction (null = to inventory)
   * @param note - Optional note about the move
   * @returns The created edge, or null if skipped due to idempotency
   */
  async appendItemLineageEdge(
    accountId: string,
    itemId: string,
    fromTransactionId: string | null,
    toTransactionId: string | null,
    note?: string | null,
    options?: {
      movementKind?: ItemLineageMovementKind | null
      source?: ItemLineageSource
    }
  ): Promise<ItemLineageEdge | null> {
    await ensureAuthenticatedForDatabase()

    // Skip if from === to (no-op move)
    if (fromTransactionId === toTransactionId) {
      console.log('⏭️ Skipping lineage edge: from === to', { itemId, fromTransactionId, toTransactionId })
      return null
    }

    // Get current user for created_by
    const user = await getCurrentUser()
    const createdBy = user?.id || null

    const movementKind = options?.movementKind ?? null
    const source = options?.source ?? 'app'

    // Idempotency check: check if a similar edge was created recently (within last 5 seconds)
    // This prevents duplicate edges from rapid repeated calls
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    let idempotencyQuery = supabase
      .from('item_lineage_edges')
      .select('id, created_at')
      .eq('account_id', accountId)
      .eq('item_id', itemId)
      .eq('from_transaction_id', fromTransactionId ?? null)
      .eq('to_transaction_id', toTransactionId ?? null)
      .eq('source', source)
      .gte('created_at', fiveSecondsAgo)
      .order('created_at', { ascending: false })
      .limit(1)

    if (movementKind === null) {
      idempotencyQuery = idempotencyQuery.is('movement_kind', null)
    } else {
      idempotencyQuery = idempotencyQuery.eq('movement_kind', movementKind)
    }

    const { data: recentEdges } = await idempotencyQuery

    if (recentEdges && recentEdges.length > 0) {
      console.log('⏭️ Skipping duplicate lineage edge (recent match found)', {
        itemId,
        fromTransactionId,
        toTransactionId,
        existingEdgeId: recentEdges[0].id
      })
      // Return the existing edge converted to our type
      const existing = await this.getLineageEdgeById(recentEdges[0].id)
      return existing
    }

    // Insert the new edge
    const { data, error } = await supabase
      .from('item_lineage_edges')
      .insert({
        account_id: accountId,
        item_id: itemId,
        from_transaction_id: fromTransactionId ?? null,
        to_transaction_id: toTransactionId ?? null,
        movement_kind: movementKind,
        source,
        created_by: createdBy,
        note: note ?? null
      })
      .select()
      .single()

    if (error) {
      // Treat missing-table / PostgREST schema-cache errors as non-fatal.
      // These commonly appear as PGRST205 or 404 when the REST layer hasn't
      // reloaded schema after a migration. Surface a clear console message
      // linking to the troubleshooting doc so operators can remediate quickly.
      const isMissingTableError =
        error?.code === 'PGRST205' ||
        error?.status === 404 ||
        (typeof error?.message === 'string' &&
          error.message.includes("Could not find the table"))

      if (isMissingTableError) {
        console.warn(
          '⚠️ Lineage table not found / PostgREST schema cache issue. Lineage writes are non-fatal while the migration is pending.'
        )
        console.warn(
          'Read dev_docs/troubleshooting/transaction-lineage-troubleshooting.md for diagnostic steps and remediation.'
        )
        console.debug('Lineage append error details:', error)
        // Return null to indicate no edge was created, but allow the higher-level
        // flow to proceed (deallocation etc. should still complete).
        return null
      }

      console.error('❌ Failed to append lineage edge:', error)
      throw error
    }

    console.log('✅ Lineage edge appended:', {
      itemId,
      fromTransactionId,
      toTransactionId,
      edgeId: data.id
    })

    return convertEdgeFromDb(data)
  },

  /**
   * Update the latest_transaction_id pointer on an item.
   * Also updates origin_transaction_id if it's not already set.
   * 
   * @param accountId - Account ID
   * @param itemId - Item ID
   * @param latestTransactionId - New latest transaction ID (null = in inventory)
   * @param originTransactionId - Optional origin transaction ID (only set if not already set)
   */
  async updateItemLineagePointers(
    accountId: string,
    itemId: string,
    latestTransactionId: string | null,
    originTransactionId?: string | null
  ): Promise<void> {
    await ensureAuthenticatedForDatabase()

    const updates: any = {
      latest_transaction_id: latestTransactionId ?? null
    }

    // Only set origin_transaction_id if it's not already set and we have a value
    if (originTransactionId !== undefined) {
      // Check current value first
      const { data: currentItem } = await supabase
        .from('items')
        .select('origin_transaction_id')
        .eq('account_id', accountId)
        .eq('item_id', itemId)
        .single()

      if (!currentItem?.origin_transaction_id && originTransactionId) {
        updates.origin_transaction_id = originTransactionId
      }
    }

    const { error } = await supabase
      .from('items')
      .update(updates)
      .eq('account_id', accountId)
      .eq('item_id', itemId)

    if (error) {
      console.error('❌ Failed to update item lineage pointers:', error)
      throw error
    }

    console.log('✅ Updated item lineage pointers:', {
      itemId,
      latestTransactionId,
      originTransactionId: updates.origin_transaction_id
    })
  },

  /**
   * Get all lineage edges for an item (ordered by creation time).
   * Used for reconstructing the full history path.
   */
  async getItemLineageHistory(itemId: string, accountId: string): Promise<ItemLineageEdge[]> {
    if (!isNetworkOnline()) {
      return []
    }

    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('item_lineage_edges')
      .select('*')
      .eq('account_id', accountId)
      .eq('item_id', itemId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('❌ Failed to fetch item lineage history:', error)
      throw error
    }

    return (data || []).map(edge => convertEdgeFromDb(edge))
  },

  /**
   * Get edges that moved FROM a specific transaction.
   * Used to find items that "moved out" of a transaction.
   */
  async getEdgesFromTransaction(transactionId: string, accountId: string): Promise<ItemLineageEdge[]> {
    if (!isNetworkOnline()) {
      return []
    }

    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('item_lineage_edges')
      .select('*')
      .eq('account_id', accountId)
      .eq('from_transaction_id', transactionId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('❌ Failed to fetch edges from transaction:', error)
      throw error
    }

    return (data || []).map(edge => convertEdgeFromDb(edge))
  },

  /**
   * Get edges that moved TO a specific transaction.
   * Used for canonical inventory transactions that receive items (e.g. INV_PURCHASE_/INV_SALE_).
   */
  async getEdgesToTransaction(transactionId: string, accountId: string): Promise<ItemLineageEdge[]> {
    if (!isNetworkOnline()) {
      return []
    }

    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('item_lineage_edges')
      .select('*')
      .eq('account_id', accountId)
      .eq('to_transaction_id', transactionId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('❌ Failed to fetch edges to transaction:', error)
      throw error
    }

    return (data || []).map(edge => convertEdgeFromDb(edge))
  },

  /**
   * Get a single lineage edge by ID.
   */
  async getLineageEdgeById(edgeId: string): Promise<ItemLineageEdge | null> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('item_lineage_edges')
      .select('*')
      .eq('id', edgeId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      console.error('❌ Failed to fetch lineage edge:', error)
      throw error
    }

    return data ? convertEdgeFromDb(data) : null
  },

  /**
   * Subscribe to lineage edge INSERTs for a specific item (or broader filters).
   * Returns an unsubscribe function.
   *
   * @param accountId - Account ID to scope subscription
   * @param itemId - Optional itemId to narrow subscription to a single item
   * @param callback - Receives newly inserted edge (converted to app type)
   */
  subscribeToItemLineageForItem(
    accountId: string,
    itemId: string | undefined,
    callback: (edge: ItemLineageEdge) => void
  ): () => void {
    const entry = getOrCreateAccountChannel(accountId)
    const key = itemId ?? ALL_ITEMS_KEY
    const listenersForItem = entry.itemListeners.get(key) ?? new Set<LineageEdgeListener>()
    listenersForItem.add(callback)
    entry.itemListeners.set(key, listenersForItem)

    return () => {
      const listeners = entry.itemListeners.get(key)
      if (listeners) {
        listeners.delete(callback)
        if (listeners.size === 0) {
          entry.itemListeners.delete(key)
        }
      }
      releaseAccountChannelIfUnused(accountId)
    }
  },
  /**
   * Subscribe to lineage edge INSERTs where from_transaction_id == given transactionId.
   * Useful for transaction-level views that need to know when items moved out.
   * Returns an unsubscribe function.
   */
  subscribeToEdgesFromTransaction(
    accountId: string,
    fromTransactionId: string,
    callback: (edge: ItemLineageEdge) => void
  ): () => void {
    const entry = getOrCreateAccountChannel(accountId)
    const listenersForTransaction = entry.transactionListeners.get(fromTransactionId) ?? new Set<LineageEdgeListener>()
    listenersForTransaction.add(callback)
    entry.transactionListeners.set(fromTransactionId, listenersForTransaction)

    return () => {
      const listeners = entry.transactionListeners.get(fromTransactionId)
      if (listeners) {
        listeners.delete(callback)
        if (listeners.size === 0) {
          entry.transactionListeners.delete(fromTransactionId)
        }
      }
      releaseAccountChannelIfUnused(accountId)
    }
  },

}

