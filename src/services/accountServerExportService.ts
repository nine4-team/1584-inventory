import { supabase } from '@/services/supabase'
import JSZip from 'jszip'

type OrderBy = { column: string; ascending?: boolean; nullsFirst?: boolean }

type TablePlan = {
  schema?: 'public' | 'storage'
  table: string
  /**
   * If set, export rows where `account_id = accountId`.
   * (Most app tables use this convention.)
   */
  filterByAccountId?: boolean
  /**
   * If set, export rows where `column = accountId`.
   * (Used for tables like `account_presets` keyed by `account_id`.)
   */
  filterByColumnEq?: { column: string }
  orderBy?: OrderBy
}

function getSupabaseUrl() {
  // This env var is already required by `src/services/supabase.ts`.
  return import.meta.env.VITE_SUPABASE_URL as string
}

function parsePublicStorageUrl(url: unknown) {
  if (!url) return null
  const raw = String(url)
  const supabaseUrl = getSupabaseUrl().replace(/\/+$/, '')
  const prefix = `${supabaseUrl}/storage/v1/object/public/`
  if (!raw.startsWith(prefix)) return null
  const rest = raw.slice(prefix.length)
  const firstSlash = rest.indexOf('/')
  if (firstSlash <= 0) return null
  const bucket = rest.slice(0, firstSlash)
  const objectPath = rest.slice(firstSlash + 1)
  if (!bucket || !objectPath) return null
  return { bucket, path: objectPath, url: raw }
}

function extractStorageRefsFromRow(row: any) {
  const refs: Array<{ bucket: string; path: string; url: string }> = []

  const maybeAdd = (u: unknown) => {
    const parsed = parsePublicStorageUrl(u)
    if (parsed) refs.push(parsed)
  }

  // Common direct URL fields
  maybeAdd(row?.main_image_url)
  maybeAdd(row?.business_logo_url)

  // Common JSON arrays containing { url: ... }
  const arrays = [row?.images, row?.transaction_images, row?.receipt_images, row?.other_images]
  for (const a of arrays) {
    if (!Array.isArray(a)) continue
    for (const it of a) {
      maybeAdd(it?.url)
    }
  }

  return refs
}

export type StorageReference = { bucket: string; path: string; url: string }

async function fetchAllRows({
  schema,
  table,
  accountId,
  filterByAccountId,
  filterByColumnEq,
  orderBy,
  pageSize
}: {
  schema: 'public' | 'storage'
  table: string
  accountId: string
  filterByAccountId?: boolean
  filterByColumnEq?: { column: string }
  orderBy?: OrderBy
  pageSize: number
}) {
  const rows: any[] = []
  let from = 0

  for (;;) {
    const to = from + pageSize - 1
    let q: any = supabase.schema(schema).from(table).select('*').range(from, to)

    if (filterByAccountId) q = q.eq('account_id', accountId)
    if (filterByColumnEq) q = q.eq(filterByColumnEq.column, accountId)

    if (orderBy?.column) {
      q = q.order(orderBy.column, {
        ascending: orderBy.ascending ?? true,
        nullsFirst: orderBy.nullsFirst ?? false
      })
    }

    const { data, error } = await q
    if (error) throw new Error(`${schema}.${table}: ${error.message}`)

    const page = Array.isArray(data) ? data : []
    rows.push(...page)

    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

export async function downloadStorageBlobsZip(
  refs: StorageReference[],
  opts?: {
    onProgress?: (info: { completed: number; total: number; currentPath: string }) => void
  }
) {
  const zip = new JSZip()
  const failures: Array<{ bucket: string; path: string; reason: string }> = []
  let completed = 0

  for (const ref of refs) {
    const currentPath = `${ref.bucket}/${ref.path}`
    try {
      const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path)
      if (error || !data) {
        failures.push({ bucket: ref.bucket, path: ref.path, reason: error?.message || 'unknown error' })
      } else {
        zip.file(currentPath, data)
        completed += 1
      }
    } catch (e: any) {
      failures.push({ bucket: ref.bucket, path: ref.path, reason: e?.message || 'unknown error' })
    }

    opts?.onProgress?.({ completed, total: refs.length, currentPath })
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  return { zipBlob, failures, addedCount: completed, totalCount: refs.length }
}

export async function exportAccountServerDataForMigration(accountId: string, opts?: { pageSize?: number }) {
  const exportedAt = new Date().toISOString()
  const pageSize = Math.max(50, Math.min(2000, opts?.pageSize ?? 1000))
  const warnings: string[] = []

  // Keep this list intentionally explicit so “export” is stable and predictable.
  const plan: TablePlan[] = [
    // Core
    { table: 'accounts', filterByColumnEq: { column: 'id' }, orderBy: { column: 'id' } },
    { table: 'users', filterByAccountId: true, orderBy: { column: 'id' } },
    { table: 'projects', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'spaces', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'space_templates', filterByAccountId: true, orderBy: { column: 'sort_order', ascending: true, nullsFirst: true } },
    { table: 'items', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'transactions', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },

    // Supporting
    { table: 'invitations', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'account_presets', filterByColumnEq: { column: 'account_id' }, orderBy: { column: 'account_id' } },
    { table: 'item_lineage_edges', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'item_audit_logs', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'transaction_audit_logs', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } },
    { table: 'highlevel_onboarding_events', filterByAccountId: true, orderBy: { column: 'created_at', ascending: true, nullsFirst: true } }
  ]

  // Storage metadata (no account scoping available at DB level)
  const storagePlan: TablePlan[] = [
    { schema: 'storage', table: 'buckets', orderBy: { column: 'id' } },
    { schema: 'storage', table: 'objects', orderBy: { column: 'created_at', ascending: true, nullsFirst: true } }
  ]

  const outputs: Record<string, any[]> = {}
  const counts: Record<string, number> = {}
  const storageRefSet = new Map<string, { bucket: string; path: string; url: string }>()

  const addRefsFromRows = (rs: any[]) => {
    for (const r of rs) {
      for (const ref of extractStorageRefsFromRow(r)) {
        storageRefSet.set(`${ref.bucket}/${ref.path}`, ref)
      }
    }
  }

  for (const p of plan) {
    const schema = p.schema ?? 'public'
    const rows = await fetchAllRows({
      schema,
      table: p.table,
      accountId,
      filterByAccountId: p.filterByAccountId,
      filterByColumnEq: p.filterByColumnEq,
      orderBy: p.orderBy,
      pageSize
    })
    const key = `${schema}.${p.table}`
    outputs[key] = rows
    counts[key] = rows.length
    addRefsFromRows(rows)
  }

  // Storage metadata is useful, but can be large; include it separately and also provide a “refs-only” list.
  for (const p of storagePlan) {
    try {
      const schema = p.schema ?? 'public'
      const rows = await fetchAllRows({
        schema,
        table: p.table,
        accountId,
        orderBy: p.orderBy,
        pageSize
      })
      const key = `${schema}.${p.table}`
      outputs[key] = rows
      counts[key] = rows.length
    } catch (e: any) {
      warnings.push(
        `Skipping storage export for ${p.schema ?? 'public'}.${p.table}: ${e?.message || 'unknown error'}`
      )
    }
  }

  const storageReferences = [...storageRefSet.values()].sort((a, b) =>
    (a.bucket + '/' + a.path).localeCompare(b.bucket + '/' + b.path)
  )

  const projects = outputs['public.projects']?.map((p: any) => ({ id: p.id, name: p.name })) ?? []

  const payload = {
    exportedAt,
    source: {
      kind: 'server',
      supabaseUrl: getSupabaseUrl()
    },
    scope: {
      accountId,
      projects
    },
    warnings,
    counts,
    tables: outputs,
    storageReferences
  }

  return { payload, counts, storageReferencesCount: storageReferences.length, storageReferences }
}

