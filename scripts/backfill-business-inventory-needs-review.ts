#!/usr/bin/env tsx
/**
 * Backfill `transactions.needs_review` for Business Inventory transactions (project_id IS NULL).
 *
 * This script is intentionally "application-driven": it recomputes the same derived boolean
 * the app uses (canonical completeness bands + itemization-disabled rules) and persists it.
 *
 * Usage:
 *   npx tsx scripts/backfill-business-inventory-needs-review.ts --account <ACCOUNT_UUID> [--dry-run]
 *
 * Env:
 *   - VITE_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        args.set(key, 'true')
      } else {
        args.set(key, next)
        i++
      }
    } else {
      positional.push(a)
    }
  }

  const account = args.get('--account') ?? args.get('-a') ?? positional[0] ?? ''
  const dryRun = (args.get('--dry-run') ?? 'false') === 'true' || args.get('--dry-run') === 'true'
  const pageSize = Number(args.get('--page-size') ?? '500')
  const limit = args.get('--limit') ? Number(args.get('--limit')) : undefined

  return { account, dryRun, pageSize, limit }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

const CANONICAL_TRANSACTION_PREFIXES = ['INV_PURCHASE_', 'INV_SALE_', 'INV_TRANSFER_'] as const
function isCanonicalTransactionId(transactionId: string | null | undefined): boolean {
  if (!transactionId) return false
  return CANONICAL_TRANSACTION_PREFIXES.some(prefix => transactionId.startsWith(prefix))
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function parseMoney(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

type CompletenessStatus = 'complete' | 'near' | 'incomplete' | 'over'
function calculateCompletenessStatus(completenessRatio: number, variancePercent: number): CompletenessStatus {
  if (completenessRatio > 1.2) return 'over'
  if (Math.abs(variancePercent) > 20) return 'incomplete'
  if (Math.abs(variancePercent) > 1) return 'near'
  return 'complete'
}

type TxRow = {
  account_id: string
  transaction_id: string
  project_id: string | null
  amount: any
  subtotal: any
  tax_rate_pct: any
  tax_rate_preset: any
  category_id: string | null
  needs_review: boolean | null
}

async function main() {
  const { account, dryRun, pageSize, limit } = parseArgs(process.argv.slice(2))

  if (account && !isUuid(account)) {
    throw new Error(`--account must be a UUID (got ${JSON.stringify(account)})`)
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing env VITE_SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing env SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const categoryCache = new Map<string, { itemizationEnabled: boolean }>()
  const taxPresetCache = new Map<string, number | null>()

  const getItemizationEnabled = async (accountId: string, categoryId: string | null) => {
    if (!categoryId) return true
    const key = `${accountId}:${categoryId}`
    const cached = categoryCache.get(key)
    if (cached) return cached.itemizationEnabled

    const { data, error } = await supabase
      .from('budget_categories')
      .select('metadata')
      .eq('account_id', accountId)
      .eq('id', categoryId)
      .maybeSingle()

    if (error) {
      // Backward compatible: default to enabled if we can't read metadata
      categoryCache.set(key, { itemizationEnabled: true })
      return true
    }

    const enabled = data?.metadata?.itemizationEnabled === undefined ? true : data?.metadata?.itemizationEnabled === true
    categoryCache.set(key, { itemizationEnabled: enabled })
    return enabled
  }

  const getTaxPresetRatePct = async (accountId: string, presetId: string | null) => {
    if (!presetId) return null
    const key = `${accountId}:${presetId}`
    if (taxPresetCache.has(key)) return taxPresetCache.get(key) ?? null

    const { data, error } = await supabase
      .from('tax_presets')
      .select('rate')
      .eq('account_id', accountId)
      .eq('id', presetId)
      .maybeSingle()

    if (error || !data) {
      taxPresetCache.set(key, null)
      return null
    }

    const ratePct = Number(data.rate)
    const resolved = Number.isFinite(ratePct) ? ratePct : null
    taxPresetCache.set(key, resolved)
    return resolved
  }

  const computeTransactionSubtotal = async (tx: TxRow) => {
    const amount = parseMoney(tx.amount)

    if (tx.subtotal !== null && tx.subtotal !== undefined && String(tx.subtotal).trim() !== '') {
      return round2(parseMoney(tx.subtotal))
    }

    if (tx.tax_rate_pct !== null && tx.tax_rate_pct !== undefined && String(tx.tax_rate_pct).trim() !== '') {
      const ratePct = Number(tx.tax_rate_pct)
      if (Number.isFinite(ratePct)) {
        const rate = ratePct / 100
        return round2(amount / (1 + rate))
      }
    }

    const presetId = tx.tax_rate_preset ? String(tx.tax_rate_preset) : null
    if (presetId) {
      const ratePct = await getTaxPresetRatePct(tx.account_id, presetId)
      if (ratePct !== null) {
        const rate = ratePct / 100
        return round2(amount / (1 + rate))
      }
    }

    // Fall back to gross total when tax data is missing
    return round2(amount)
  }

  const computeNeedsReview = async (tx: TxRow): Promise<boolean> => {
    const txId = tx.transaction_id

    // Canonical/system transactions are never flagged for review.
    if (isCanonicalTransactionId(txId)) return false

    const itemizationEnabled = await getItemizationEnabled(tx.account_id, tx.category_id)
    if (!itemizationEnabled) return false

    const subtotal = await computeTransactionSubtotal(tx)

    // Fetch in-transaction items (truth)
    const { data: baseItems, error: itemsErr } = await supabase
      .from('items')
      .select('item_id,purchase_price')
      .eq('account_id', tx.account_id)
      .eq('transaction_id', txId)

    if (itemsErr) {
      throw itemsErr
    }

    let itemRows: Array<{ item_id: string; purchase_price: any }> = (baseItems ?? []) as any

    // Add moved-out items (non-correction edges)
    const { data: edges, error: edgesErr } = await supabase
      .from('item_lineage_edges')
      .select('item_id,movement_kind')
      .eq('account_id', tx.account_id)
      .eq('from_transaction_id', txId)

    if (edgesErr) {
      // Non-fatal: continue with base items only
      edges && console.debug(edgesErr)
    } else if (edges && edges.length > 0) {
      const movedOutIds = Array.from(
        new Set(
          edges
            .filter((e: any) => e?.movement_kind !== 'correction')
            .map((e: any) => String(e.item_id))
            .filter(Boolean)
        )
      )

      const existingIds = new Set(itemRows.map(r => String(r.item_id)))
      const missingIds = movedOutIds.filter(id => !existingIds.has(id))
      if (missingIds.length > 0) {
        const { data: movedItems, error: movedErr } = await supabase
          .from('items')
          .select('item_id,purchase_price')
          .eq('account_id', tx.account_id)
          .in('item_id', missingIds)

        if (!movedErr && movedItems && movedItems.length > 0) {
          itemRows = itemRows.concat(movedItems as any)
        }
      }
    }

    // Dedupe by item_id (defensive)
    const seen = new Set<string>()
    const uniqueItems = itemRows.filter(r => {
      const id = String((r as any).item_id)
      if (!id) return false
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    const itemsNetTotal = uniqueItems.reduce((sum, r) => sum + parseMoney((r as any).purchase_price), 0)

    const ratio = subtotal > 0 ? itemsNetTotal / subtotal : 0
    const varianceDollars = itemsNetTotal - subtotal
    const variancePercent = subtotal > 0 ? (varianceDollars / subtotal) * 100 : (uniqueItems.length > 0 ? -100 : 0)
    const status = calculateCompletenessStatus(ratio, variancePercent)

    return status !== 'complete'
  }

  let updated = 0
  let scanned = 0
  let page = 0

  while (true) {
    const from = page * pageSize
    const to = from + pageSize - 1

    let q = supabase
      .from('transactions')
      .select(
        'account_id,transaction_id,project_id,amount,subtotal,tax_rate_pct,tax_rate_preset,category_id,needs_review',
        { count: 'exact' }
      )
      .is('project_id', null)
      .order('transaction_id', { ascending: true })
      .range(from, to)

    if (account) {
      q = q.eq('account_id', account)
    }

    const { data, error } = await q
    if (error) throw error

    const rows = (data ?? []) as TxRow[]
    if (rows.length === 0) break

    for (const tx of rows) {
      scanned++
      if (limit !== undefined && scanned > limit) {
        console.log(`Stopping early at --limit=${limit}`)
        console.log({ scanned, updated, dryRun })
        return
      }

      try {
        const needs = await computeNeedsReview(tx)
        const existing = tx.needs_review === true
        if (existing !== needs) {
          if (!dryRun) {
            const { error: upErr } = await supabase
              .from('transactions')
              .update({ needs_review: needs, updated_at: new Date().toISOString() })
              .eq('account_id', tx.account_id)
              .eq('transaction_id', tx.transaction_id)
            if (upErr) throw upErr
          }
          updated++
        }
      } catch (e) {
        console.warn('Failed to recompute needs_review for transaction', tx.transaction_id, e)
      }
    }

    page++
    if (rows.length < pageSize) break
  }

  console.log({ scanned, updated, dryRun })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

