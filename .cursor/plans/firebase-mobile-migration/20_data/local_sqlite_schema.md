# Local SQLite Schema (Source of Truth on Device)

This doc defines the local SQLite schema used by the React Native (Expo) client.

Goals:

- **SQLite is the UI source of truth** (screens read from SQLite only)
- durable outbox, sync cursors, and conflicts
- fast list/filter/search at 1,000–10,000 items

Canonical sync constraints:

- [`sync_engine_spec.plan.md`](../sync_engine_spec.plan.md)

---

## Storage strategy (Expo-friendly)

### SQLite driver

Start with Expo’s SQLite. Validate early:

- transaction performance
- WAL mode support
- FTS / prefix search support

If FTS/prefix search is insufficient, move to an Expo Dev Build with a higher-performance native SQLite driver. Keep the schema the same so the migration is mechanical.

### Schema versioning

Maintain:

- `PRAGMA user_version = <int>` for schema migrations
- a migrations table (optional) for detailed tracking:
  - `schema_migrations(version, applied_at)`

Rule:

- never ship a client that cannot migrate from the prior released version.

---

## Core entity tables

The local DB mirrors Firestore entities and adds local-only bookkeeping fields.

### Common columns (apply to all entity tables)

Recommended common fields:

- `id TEXT PRIMARY KEY`
- `account_id TEXT NOT NULL`
- `project_id TEXT` (nullable for account-scoped tables)

Remote sync fields (mirrored from Firestore):

- `updated_at_server INTEGER` (ms since epoch, from Firestore `updatedAt`)
- `deleted_at_server INTEGER` (ms since epoch, nullable; from `deletedAt`)
- `version INTEGER NOT NULL DEFAULT 0`
- `updated_by TEXT`
- `last_mutation_id TEXT`
- `schema_version INTEGER`

Local-only fields:

- `local_pending INTEGER NOT NULL DEFAULT 0` (0/1; indicates unsynced local changes)
- `local_updated_at INTEGER NOT NULL` (ms since epoch; when local write happened)

---

## Suggested tables (minimal set)

### `accounts`

Account-scoped metadata cached locally.

Columns (example):

- `id`, `name`
- common sync + local fields (account_id = id; project_id null)

### `projects`

- `id`, `account_id`
- `name`, `description`, `client_name`
- `budget`, `design_fee`
- `main_image_attachment_id`
- sync + local fields

Indexes:

- `projects(account_id, deleted_at_server, name)`
- `projects(account_id, updated_at_server, id)` (supports delta apply ordering locally)

### `items`

Key fields (example):

- `id`, `account_id`, `project_id`
- `item_id TEXT` (optional, only if Firestore doc id is not the business id)
- `name`, `description`, `sku`, `source`
- Price fields as strings (match current app + DB approach):
  - `purchase_price TEXT NULL`
  - `project_price TEXT NULL`
  - `market_value TEXT NULL`
- `payment_method TEXT NULL`
- `disposition TEXT NULL` (enum; matches app `ItemDisposition`)
- `bookmark INTEGER`
- Relationship FKs:
  - `transaction_id TEXT NULL`
  - `space_id TEXT NULL`

Indexes (examples):

- `items(project_id, deleted_at_server, name)`
- `items(project_id, transaction_id)`
- `items(project_id, space_id)`
- `items(project_id, disposition)`
- `items(project_id, bookmark)`
- `items(project_id, updated_at_server, id)` (fast “recently changed” ordering)

Search:

- Prefer SQLite FTS if available (`items_fts`) or a dedicated `search_text` column + prefix index strategy.
- Because the product requirement allows **prefix search**, an FTS table is ideal but not strictly required if performance is acceptable.

### `transactions`

Key fields (example):

- `id`, `account_id`, `project_id`
- `transaction_id TEXT NOT NULL` (business id; often also used as Firestore doc id)
- `transaction_date TEXT NOT NULL` (ISO date string; match current app)
- `source TEXT`
- `transaction_type TEXT`
- `payment_method TEXT`
- `amount TEXT NOT NULL` (numeric string; match current app)
- `category_id TEXT NULL` (FK to `budget_categories.id`; legacy `budget_category` can exist if needed)
- `notes TEXT NULL`
- Optional workflow fields (match current app):
  - `status TEXT NULL` (`pending`/`completed`/`canceled`)
  - `reimbursement_type TEXT NULL`
  - `trigger_event TEXT NULL`
  - `receipt_emailed INTEGER NOT NULL DEFAULT 0`

Indexes:

- `transactions(project_id, deleted_at_server, transaction_date)`
- `transactions(project_id, updated_at_server, id)`

### `spaces`

Key fields (example):

- `id`, `account_id`, `project_id`
- `name`, `type`, `notes`

Indexes:

- `spaces(project_id, deleted_at_server, name)`
- `spaces(project_id, updated_at_server, id)`

### `attachments`

Represents local and remote attachment metadata.

Key fields (example):

- `id`, `account_id`, `project_id`
- `parent_type TEXT`, `parent_id TEXT`
- `storage_path TEXT NULL` (set after upload)
- `mime_type TEXT`, `size INTEGER`, `sha256 TEXT NULL`
- `local_uri TEXT NULL` (on-device file path/uri)
- `upload_state TEXT NOT NULL` (e.g. `local_only`, `uploading`, `uploaded`, `failed`)
- `upload_error TEXT NULL`
- sync + local fields

Indexes:

- `attachments(project_id, parent_type, parent_id)`
- `attachments(project_id, upload_state)`
- `attachments(project_id, updated_at_server, id)`

---

## System tables (sync engine)

### `outbox_ops`

Durable queue of remote mutations generated by local writes.

Columns (example):

- `op_id TEXT PRIMARY KEY`
- `account_id TEXT NOT NULL`
- `scope_type TEXT NOT NULL` (`project` or `inventory`)
- `scope_id TEXT NULL` (`projectId` when `scope_type=project`, else NULL)
- `entity_type TEXT NOT NULL` (items/transactions/spaces/projects/attachments/...)
- `entity_id TEXT NOT NULL`
- `op_type TEXT NOT NULL` (create/update/delete/callable/...)
- `payload_json TEXT NOT NULL`
- `created_at_local INTEGER NOT NULL`
- `state TEXT NOT NULL` (`pending`, `in_flight`, `succeeded`, `failed`, `blocked`)
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `last_error TEXT NULL`
- `last_attempt_at INTEGER NULL`

Indexes:

- `outbox_ops(state, created_at_local)`
- `outbox_ops(scope_type, scope_id, state, created_at_local)`

### `sync_state`

Delta cursor state per collection per active scope (project or inventory).

Columns:

- `account_id TEXT NOT NULL`
- `scope_type TEXT NOT NULL` (`project` or `inventory`)
- `scope_id TEXT NULL` (`projectId` when `scope_type=project`, else NULL)
- `collection TEXT NOT NULL` (items/transactions/spaces/attachments/projects)
- `cursor_updated_at_server INTEGER NOT NULL DEFAULT 0`
- `cursor_doc_id TEXT NOT NULL DEFAULT ''`
- `last_seen_seq INTEGER NOT NULL DEFAULT 0`
- `updated_at_local INTEGER NOT NULL`

Primary key:

- `(account_id, scope_type, scope_id, collection)`

### `conflicts`

Persisted conflicts to resolve later.

Columns (example):

- `conflict_id TEXT PRIMARY KEY`
- `account_id TEXT NOT NULL`
- `scope_type TEXT NOT NULL` (`project` or `inventory`)
- `scope_id TEXT NULL` (`projectId` when `scope_type=project`, else NULL)
- `entity_type TEXT NOT NULL`
- `entity_id TEXT NOT NULL`
- `field TEXT NOT NULL`
- `local_json TEXT NOT NULL`
- `server_json TEXT NOT NULL`
- `created_at_local INTEGER NOT NULL`
- `resolved_at_local INTEGER NULL`
- `resolution TEXT NULL` (`use_local`, `use_server`, `merged`)

Indexes:

- `conflicts(scope_type, scope_id, resolved_at_local)`

---

## Apply-from-remote (idempotent upsert rules)

When applying deltas from Firestore:

- Upsert by `id`.
- If `deletedAt != null`, delete the local row (or mark as deleted locally).
- Set the server fields (`updated_at_server`, `deleted_at_server`, `version`, `last_mutation_id`, etc.).
- Clear `local_pending` only when it is safe to do so (e.g., lastMutationId matches a completed outbox op).

All applies should be done inside SQLite transactions and batched per delta page.

---

## Local migrations strategy (practical)

- Additive changes are preferred (add columns/tables; backfill lazily).
- When changing constraints/indexes, do it in a migration step keyed by `user_version`.
- Keep schema evolution simple; features should not invent per-feature DB schemas without updating this doc.

