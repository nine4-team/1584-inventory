#!/usr/bin/env tsx
/**
 * Export a single app "account" (public.accounts.id) for migration work.
 *
 * What it exports (scoped to account_id where applicable):
 * - Core tables: accounts, users, projects, spaces, space_templates, items, transactions
 * - Supporting tables: invitations, account_presets, item_lineage_edges, item_audit_logs,
 *   transaction_audit_logs, highlevel_onboarding_events
 * - Storage metadata: storage.buckets + storage.objects (optional)
 *
 * It writes JSONL (one row per line) so large tables can be streamed safely.
 *
 * Usage:
 *   npx tsx scripts/export-account-for-migration.ts --account <ACCOUNT_UUID>
 *
 * Env:
 *   - VITE_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Notes:
 * - This exports storage *metadata* (object paths), not the actual file bytes.
 * - For file bytes, use Supabase Storage tooling (CLI) with the bucket/path list this produces.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

type ExportFormat = 'jsonl'

type TableSpec = {
  schema: 'public' | 'storage' | 'auth'
  name: string
  // Where to order results for deterministic exports.
  orderBy?: { column: string; ascending?: boolean; nullsFirst?: boolean }
  // If set, filters records by account_id = <accountId>
  filterByAccountId?: boolean
  // If set, filters records by account_id = <accountId>, but using a different column name.
  filterByColumnEq?: { column: string; value: (accountId: string) => string }
}

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

  const account =
    args.get('--account') ??
    args.get('-a') ??
    positional[0] ??
    ''

  const outDir = args.get('--out') ?? ''
  const pageSize = Number(args.get('--page-size') ?? '1000')
  const includeStorage = (args.get('--include-storage') ?? 'true') !== 'false'
  const includeAuth = (args.get('--include-auth') ?? 'false') === 'true'

  return { account, outDir, pageSize, includeStorage, includeAuth }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function safeTimestampForPath(d: Date) {
  // 2026-02-04T02-27-09.873Z (no ':' to keep paths easy)
  return d.toISOString().replace(/:/g, '-')
}

function sha256File(filePath: string) {
  const hash = crypto.createHash('sha256')
  const buf = fs.readFileSync(filePath)
  hash.update(buf)
  return hash.digest('hex')
}

function parsePublicStorageUrl(supabaseUrl: string, url: unknown) {
  if (!url) return null
  const raw = String(url)
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/`
  if (!raw.startsWith(prefix)) return null
  const rest = raw.slice(prefix.length)
  const firstSlash = rest.indexOf('/')
  if (firstSlash <= 0) return null
  const bucket = rest.slice(0, firstSlash)
  const objectPath = rest.slice(firstSlash + 1)
  if (!bucket || !objectPath) return null
  return { bucket, path: objectPath, url: raw }
}

function extractStorageRefsFromRow(supabaseUrl: string, row: any) {
  const refs: Array<{ bucket: string; path: string; url: string }> = []

  const maybeAdd = (u: unknown) => {
    const parsed = parsePublicStorageUrl(supabaseUrl, u)
    if (parsed) refs.push(parsed)
  }

  // Common direct URL fields
  maybeAdd(row?.main_image_url)
  maybeAdd(row?.business_logo_url)

  // Common JSONB arrays
  const jsonArrays = [
    row?.images,
    row?.transaction_images,
    row?.receipt_images,
    row?.other_images,
  ]

  for (const arr of jsonArrays) {
    if (!Array.isArray(arr)) continue
    for (const img of arr) {
      maybeAdd(img?.url)
    }
  }

  return refs
}

async function main() {
  const { account, outDir, pageSize, includeStorage, includeAuth } = parseArgs(
    process.argv.slice(2)
  )

  if (!account || !isUuid(account)) {
    console.error('Error: --account must be a valid UUID (public.accounts.id)')
    process.exit(1)
  }

  // Load environment variables
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  } else {
    dotenv.config()
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const startedAt = new Date()
  const baseOutDir =
    outDir ||
    path.join(
      process.cwd(),
      'tmp',
      'migration_exports',
      account,
      safeTimestampForPath(startedAt)
    )

  fs.mkdirSync(baseOutDir, { recursive: true })

  const format: ExportFormat = 'jsonl'

  const exportedFiles: Array<{
    table: string
    format: ExportFormat
    file: string
    rows: number
    sha256: string
  }> = []

  const storageRefSet = new Map<string, { bucket: string; path: string; url: string }>()
  const addStorageRefs = (refs: Array<{ bucket: string; path: string; url: string }>) => {
    for (const r of refs) {
      const key = `${r.bucket}/${r.path}`
      if (!storageRefSet.has(key)) storageRefSet.set(key, r)
    }
  }

  const writeJsonlRow = (filePath: string, row: any) => {
    fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8')
  }

  async function exportTable(spec: TableSpec) {
    const tableId = `${spec.schema}.${spec.name}`
    const fileName = `${spec.schema}.${spec.name}.${format}`
    const filePath = path.join(baseOutDir, fileName)
    fs.writeFileSync(filePath, '', 'utf8')

    let totalRows = 0
    let from = 0
    const ascending = spec.orderBy?.ascending ?? true

    for (;;) {
      const to = from + pageSize - 1
      let q: any = supabase.schema(spec.schema).from(spec.name).select('*').range(from, to)

      if (spec.filterByAccountId) {
        q = q.eq('account_id', account)
      }
      if (spec.filterByColumnEq) {
        q = q.eq(spec.filterByColumnEq.column, spec.filterByColumnEq.value(account))
      }

      if (spec.orderBy?.column) {
        q = q.order(spec.orderBy.column, {
          ascending,
          nullsFirst: spec.orderBy.nullsFirst ?? false,
        })
      }

      const { data, error } = await q

      if (error) {
        throw new Error(`Failed exporting ${tableId}: ${error.message}`)
      }

      const rows: any[] = Array.isArray(data) ? data : []
      for (const row of rows) {
        writeJsonlRow(filePath, row)
        addStorageRefs(extractStorageRefsFromRow(supabaseUrl, row))
      }

      totalRows += rows.length

      if (rows.length < pageSize) break
      from += pageSize
    }

    const digest = sha256File(filePath)
    exportedFiles.push({
      table: tableId,
      format,
      file: fileName,
      rows: totalRows,
      sha256: digest,
    })

    return { filePath, rows: totalRows }
  }

  // Core: verify account exists and enumerate projects (included in exports too)
  const { data: accountRow, error: accountErr } = await supabase
    .schema('public')
    .from('accounts')
    .select('*')
    .eq('id', account)
    .maybeSingle()

  if (accountErr) {
    console.error('Error reading public.accounts:', accountErr)
    process.exit(1)
  }

  if (!accountRow) {
    console.error(`Error: account not found in public.accounts: ${account}`)
    process.exit(1)
  }

  const { data: projectsRows, error: projectsErr } = await supabase
    .schema('public')
    .from('projects')
    .select('id,name,created_at,updated_at')
    .eq('account_id', account)
    .order('created_at', { ascending: true })

  if (projectsErr) {
    console.error('Error reading public.projects:', projectsErr)
    process.exit(1)
  }

  // Export plan (tables we know exist in this repo)
  const tables: TableSpec[] = [
    { schema: 'public', name: 'accounts', orderBy: { column: 'id' }, filterByColumnEq: { column: 'id', value: (a) => a } },
    { schema: 'public', name: 'users', orderBy: { column: 'id' }, filterByAccountId: true },
    { schema: 'public', name: 'projects', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'spaces', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'space_templates', orderBy: { column: 'sort_order', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'items', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'transactions', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'invitations', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'account_presets', orderBy: { column: 'account_id' }, filterByColumnEq: { column: 'account_id', value: (a) => a } },
    { schema: 'public', name: 'item_lineage_edges', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'item_audit_logs', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'transaction_audit_logs', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
    { schema: 'public', name: 'highlevel_onboarding_events', orderBy: { column: 'created_at', ascending: true, nullsFirst: true }, filterByAccountId: true },
  ]

  if (includeStorage) {
    tables.push(
      { schema: 'storage', name: 'buckets', orderBy: { column: 'id' } },
      { schema: 'storage', name: 'objects', orderBy: { column: 'created_at', ascending: true, nullsFirst: true } }
    )
  }

  if (includeAuth) {
    // Very sensitive; off by default.
    tables.push(
      { schema: 'auth', name: 'users', orderBy: { column: 'created_at', ascending: true, nullsFirst: true } }
    )
  }

  // Run exports
  for (const t of tables) {
    await exportTable(t)
  }

  // Storage references (helps download only needed objects)
  const storageReferences = [...storageRefSet.values()].sort((a, b) =>
    (a.bucket + '/' + a.path).localeCompare(b.bucket + '/' + b.path)
  )

  const storageRefsFile = 'storage.references.json'
  fs.writeFileSync(
    path.join(baseOutDir, storageRefsFile),
    JSON.stringify(storageReferences, null, 2) + '\n',
    'utf8'
  )

  // Manifest
  const manifest = {
    exportedAt: startedAt.toISOString(),
    supabaseUrl,
    account: {
      id: account,
      name: (accountRow as any)?.name ?? null,
    },
    projects: (projectsRows ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at ?? null,
      updated_at: p.updated_at ?? null,
    })),
    options: {
      includeStorage,
      includeAuth,
      pageSize,
      format,
    },
    outputs: exportedFiles,
    storageReferences: {
      file: storageRefsFile,
      count: storageReferences.length,
    },
    repoSchemaHint: {
      note: 'Attach supabase/migrations (and any SQL in supabase/) alongside this export for full schema/constraints history.',
      paths: ['supabase/migrations', 'supabase/functions', 'supabase/seed.sql'],
    },
  }

  fs.writeFileSync(
    path.join(baseOutDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  )

  // Human notes
  const readme = [
    '# Account export for migration',
    '',
    `Account: ${account}`,
    `Exported at: ${manifest.exportedAt}`,
    '',
    '## Files',
    '- `manifest.json`: summary and checksums',
    '- `public.*.jsonl`: account-scoped rows (one JSON object per line)',
    '- `storage.*.jsonl`: storage metadata (if enabled)',
    '- `storage.references.json`: bucket/path list extracted from URLs inside exported rows',
    '',
    '## Important notes',
    '- These exports include user emails and other sensitive fields. Treat as confidential.',
    '- Storage exports here are metadata only. To move file bytes, use `storage.references.json` as a download list.',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(baseOutDir, 'README.md'), readme, 'utf8')

  console.log(`Wrote export to: ${path.relative(process.cwd(), baseOutDir)}`)
  console.log(`Projects found: ${(projectsRows ?? []).length}`)
  console.log(`Tables exported: ${exportedFiles.length}`)
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})

