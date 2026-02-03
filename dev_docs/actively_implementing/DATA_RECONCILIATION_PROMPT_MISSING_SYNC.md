## Prompt for AI dev: Ledger “missing sync changes” data reconciliation

### Context
- Ledger has an offline cache (IndexedDB `ledger-offline`) plus an `OperationQueue` (also IndexedDB).
- We found/fixed a bug where some code treated a **row UUID** (`public.items.id`) as if it were the **business item id** (`public.items.item_id`, typically `I-...`).
- Impact: queued operations (especially `UPDATE_ITEM`) could store `data.id` as a UUID, while sync/update code used `.eq('item_id', data.id)` → **0 rows updated** → `PGRST116` → “missing on server” false-positive.
- Additional impact: offline cache sometimes used `item.id` (UUID) as the `OfflineStore.items` key, instead of `item.item_id`, creating UUID-keyed duplicates and confusing lookups.

### Your task
Implement a **data reconciliation / repair tool** that can:
1) **Export** the relevant local offline data (items + queue) for a given user/account.
2) **Compare** local vs server state for that account.
3) **Repair** the local cache and re-create any missing queued changes (best-effort), with a **dry-run mode**.

This is intended to recover from “missing ~57 sync changes” where older code may have dropped queued operations; we cannot reconstruct dropped operations directly, so reconciliation must infer needed changes from local state.

---

## What local data you need (IndexedDB)

### Required
- **All offline items** (store: `items`)
  - Key path is `itemId` (should be `items.item_id`, but may contain UUIDs in older/buggy data).
  - Fields of interest for reconciliation:
    - `itemId`, `accountId`, `projectId`, `transactionId`
    - core user-editable fields: `name`, `description`, `source`, `sku`, `paymentMethod`, `qrKey`, `images`, prices
    - `lastUpdated`, `version`, `last_synced_at` (may be noisy, but still useful)
- **Operation queue** (store: `operations`)
  - Needed to identify *current* stuck/paused ops and avoid duplicating them.
  - Fields of interest: `id`, `type`, `timestamp`, `retryCount`, `syncStatus`, `interventionReason`, `errorCode`, `data`
- **Offline context** (store: `context`)
  - Needed to confirm which `accountId` the local DB is scoped to.

### Nice-to-have (helps correctness)
- `conflicts` store: unresolved conflict records for items
- `transactions` store: for item-to-transaction linkage integrity checks
- `projects` store: for project linkage integrity checks

---

## How to pull/export the local data

You need **a browser session** on the affected device/profile (the one that has the IndexedDB data).

### Option A (preferred): add an in-app “Export offline data” debug action
Add a debug-only button / command that:
- calls `offlineStore.getAllItems()`
- reads all queued ops (there should already be a `getAllOperations()`/snapshot function in `operationQueue` or you can add one)
- reads offline context (accountId/userId)
- downloads a single JSON blob:
  - `{ exportedAt, context, items, operations, conflicts? }`

Benefits: easy for support/debug, no manual DevTools work, consistent shape for scripts.

### Option B: DevTools snippet (no UI changes)
Use Chrome DevTools → Application → IndexedDB → `ledger-offline` and export:
- `items`
- `operations`
- `context`

If you implement a snippet, it must:
- open `indexedDB.open('ledger-offline', <any>)` (or just open without specifying version)
- `transaction.objectStore('items').getAll()`, same for `operations` and `context`
- serialize to JSON and download.

---

## Server-side data to query (Supabase)

Scope all reads by `account_id = <accountId>`.

You’ll need to fetch:
- Existence and basic fields for items by `item_id` (business id), batched:
  - `SELECT item_id, id, last_updated, version, ... FROM public.items WHERE account_id = $1 AND item_id = ANY($2)`
- For local records keyed by UUID (suspect), also allow lookup by row `id`:
  - `SELECT id, item_id FROM public.items WHERE account_id = $1 AND id = ANY($2)`

---

## Reconciliation logic (recommended approach)

### 0) Always back up first
- Export local `items` + `operations` to JSON before modifying anything.
- Add “dry run” mode that produces a report without writes.

### 1) Normalize local identifiers
Partition local offline item records into:
- **Canonical-key items**: `itemId` looks like `I-...` (or at least “not a UUID”)
- **UUID-key items**: `itemId` matches UUID regex

For UUID-key items:
- Try to map UUID → canonical `item_id` via server lookup (`WHERE id IN (...)`).
- If found, plan a local rewrite:
  - create/merge a new offline record under the canonical key
  - delete the UUID-key record (or mark for deletion)

### 2) Determine “local-only” items
After normalization (or in parallel):
- For each canonical local `itemId`, check if server has a row with that `item_id`.
- If not found on server → this is **missing-on-server**.

These are the best proxy for “dropped operations”:
- Some should become `CREATE_ITEM` (recreate missing server row from offline data)
- Some might represent truly-deleted items that should be discarded locally (requires product decision / user choice)

### 3) Detect “needs update” items
For items that exist both locally and on server:
- Compare `version` and/or `lastUpdated` vs server `last_updated`.
- If local appears ahead (or fields differ), schedule a new `UPDATE_ITEM` op that targets the **canonical identifier** (`item_id`).

Important: if you cannot trust `version/lastUpdated`, fall back to a field-by-field diff and treat local as source of truth (with caution).

### 4) Repair the queue
- Identify queued `UPDATE_ITEM` ops whose `data.id` is UUID.
  - After the code fix, they should now succeed, but it’s still better to rewrite them to canonical `item_id` where possible (optional).
- Identify paused `missing_item_on_server` ops:
  - If server lookup by row UUID/id shows the item exists, clear the intervention state and retry.
  - If the item truly does not exist, keep paused and include it in the report.

### 5) Output a reconciliation report
Produce a single report JSON/markdown with:
- Counts:
  - local items total
  - uuid-key local items count
  - mapped uuid→item_id count
  - missing-on-server count
  - items needing update count
  - queued operations scanned / rewritten / created
- Lists:
  - local-only items (candidate recreates)
  - uuid-key items (candidate rewrites)
  - paused ops + diagnosis

---

## Code pointers
- Offline cache: `src/services/offlineStore.ts` (`items` store keyPath is `itemId`)
- Queue: `src/services/operationQueue.ts`
- Item API: `src/services/inventoryService.ts`

---

## Deliverables
1) A deterministic export format for local offline data.
2) A reconciliation runner (script or debug UI) with:
   - dry-run mode
   - optional “apply fixes” mode
3) A human-readable report that support/devs can use to explain what was repaired and what still needs manual intervention.

