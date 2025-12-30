## Top‑Level Transactions Refactor Plan

Purpose: Move transactions from `projects/<projectId>/transactions` subcollections to a single top‑level `transactions` collection so transactions can exist with or without a project, and so inventory allocation/deallocation flows (INV_SALE / INV_BUY) are reliable and visible in the UI.

Audience: Junior dev. Follow steps in order. All code paths and files listed are in this repo unless noted.


### Goals
- Enable transactions that are not tied to a project (business inventory purchases/sales, vendor, etc.).
- Keep project‑related transactions first‑class (filterable by `project_id`).
- Make inventory allocation (INV_SALE) and deallocation (INV_BUY) canonical, always visible in UI.
- Maintain backward compatibility during migration window.


### Definitions (ID handling)
- Preserve legacy IDs: Copy existing document IDs exactly as they are when migrating from `projects/<id>/transactions/*` to top‑level `transactions/*` to avoid breaking links.
- Re‑key: Create a different document ID (e.g., deterministic `INV_SALE_<projectId>`) instead of the original legacy ID.

Decision: During migration, copy all existing transactions as‑is and keep their current document IDs (no renaming). After cutover, when creating canonical inventory transactions, always use deterministic IDs (`INV_SALE_<projectId>`, `INV_BUY_<projectId>`). We will not rename or re‑key any historical documents (including any past inventory transactions).


### New Firestore Data Model
- New collection: `transactions` (top‑level)
  - Document ID: string (use generated IDs for normal transactions; use deterministic IDs for canonical inventory flow)
  - Fields:
    - `transaction_id`: string (mirror of doc ID for convenience)
    - `project_id`: string | null (null => business inventory transaction)
    - `project_name`: string | null (optional, for UI; null when not a project)
    - `transaction_date`: ISO string
    - `source`: string (e.g., 'Inventory Allocation', 'Inventory Return', 'Vendor')
    - `transaction_type`: string (e.g., 'Reimbursement', 'Purchase', 'Sale')
    - `payment_method`: string
    - `amount`: string (to 2dp string; keep existing type)
    - `budget_category?`: string
    - `notes?`: string
    - `receipt_emailed`: boolean
    - `created_at`: ISO string
    - `created_by`: string
    - `status?`: 'pending' | 'completed' | 'canceled'
    - `reimbursement_type?`: 'Client Owes' | 'We Owe' | null | ''
    - `trigger_event?`: 'Inventory allocation' | 'Inventory return' | 'Purchase from client' | 'Manual'
    - `item_ids?`: string[] (IDs from top‑level `items`)
    - `last_updated?`: ISO string

- Canonical inventory transactions (deterministic IDs):
  - Allocation (client owes): `INV_SALE_<projectId>`
  - Return/buy‑from‑client (we owe): `INV_BUY_<projectId>`

- Legacy remains temporarily read‑only: `projects/<projectId>/transactions` (no new writes after migration step 1).


### Security Rules Changes (Firestore)
Add a top‑level `transactions` rule block mirroring the legacy subcollection policy and allowing controlled updates to allocation fields.

```javascript
// firestore.rules (add near existing items/projects blocks)
match /transactions/{transactionId} {
  allow read: if isAuthenticatedUser();
  allow write: if isAuthenticatedUser() && (isDesigner() || !hasRole());
  allow delete: if isAuthenticatedUser() && (isAdmin() || !hasRole());

  // Allow inventory allocation maintenance without full overwrite
  allow update: if isAuthenticatedUser() && (isDesigner() || !hasRole()) &&
    request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'item_ids','last_updated','amount','status','payment_method','transaction_date','notes'
    ]);
}
```

Keep the existing legacy block for `projects/{projectId}/transactions/{transactionId}` until migration is complete.


### Indexes (firestore.indexes.json)
Add indexes to support new queries.

- For project transaction lists:
  - Collection: `transactions`
  - Composite: `project_id` (ASC), `created_at` (DESC)

- For inventory tabs (filtering by trigger/reimbursement and date):
  - `reimbursement_type` (ASC), `created_at` (DESC)
  - `trigger_event` (ASC), `created_at` (DESC)

- Optional: `status` (ASC), `created_at` (DESC) for pending/complete views.


### Type Updates (src/types/index.ts)
- Change `Transaction.project_id` to allow null:
  - `project_id?: string | null;`
- Keep `item_ids?: string[]` (already present)
- No change needed to `Item.project_id` (already `string | null`).


### Service Layer Changes (src/services/inventoryService.ts)
Refactor `transactionService` to target top‑level `transactions`.

1) Replace legacy reads with top‑level queries

```ts
// transactionService.getTransactions(projectId)
// from: collection(db, 'projects', projectId, 'transactions')
// to:   collection(db, 'transactions'), where('project_id', '==', projectId), orderBy('created_at','desc')
```

```ts
// transactionService.subscribeToTransactions(projectId)
// from: subcollection query
// to:   onSnapshot(query(collection(db, 'transactions'), where('project_id','==', projectId), orderBy('created_at','desc')))
```

```ts
// transactionService.getTransactionById(id)
// to: doc(db, 'transactions', id) (fallback to legacy scan only if not found)
```

2) Writes go to top‑level only

```ts
// transactionService.createTransaction(projectId, data, items?)
// to: addDoc(collection(db, 'transactions'), { ...data, project_id: projectId ?? null, created_at: now })
// then create items (unified, already top‑level) and link via item_ids if desired
```

3) Utility queries for Business Inventory and reporting

```ts
// getInventoryRelatedTransactions()
// query(collection(db,'transactions'), where('reimbursement_type','in',['Client Owes','We Owe']))
// or where('trigger_event','in',[ 'Inventory allocation','Inventory return','Purchase from client'])
// For BI view, also query where('project_id','==', null) and union results in memory (two queries).
```

4) Backward compatibility window

- For a limited period, if top‑level fetch returns empty and feature flag `READ_LEGACY_TXNS=true`, read legacy subcollections and union results (mark with `source: 'legacy'`).


### Allocation/Deallocation Changes (src/services/inventoryService.ts)
Update the inventory flows to write to top‑level canonical docs.

1) Allocation to project (Client Owes)

```ts
// unifiedItemsService.allocateItemToProject()
const id = `INV_SALE_${projectId}`
const ref = doc(db, 'transactions', id)
// setDoc(ref, { project_id, reimbursement_type:'Client Owes', trigger_event:'Inventory allocation', item_ids: arrayUnion(itemId), ... })
// update item: { project_id, inventory_status:'pending', transaction_id:id }
```

2) Deallocation to business inventory (We Owe)

```ts
// deallocationService.ensurePurchaseTransaction()
const id = `INV_BUY_${projectId}`
const ref = doc(db, 'transactions', id)
// Merge item into item_ids; recompute amount by summing item.purchase_price || item.market_value
```

3) Amount recomputation and concurrency

- When adding/removing items to a canonical transaction:
  - Use `arrayUnion/arrayRemove` on `item_ids`.
  - After update, read linked items and recompute `amount`.
  - Wrap in Firestore `runTransaction` for correctness under contention.


### UI Changes

1) Project transactions list (`src/pages/TransactionsList.tsx`)
- Switch data source to `transactionService.getTransactions(projectId)` using top‑level query.
- Subscription likewise.

2) Business Inventory transactions tab (`src/pages/BusinessInventory.tsx`)
- Replace project‑by‑project scan with top‑level queries and merge in memory:
  - Show union of:
    - Top‑level transactions with `project_id == null` (pure BI)
    - Top‑level canonical inventory transactions for projects (INV_SALE/INV_BUY; identified by `trigger_event`/`reimbursement_type` or ID prefix).
- Sort by `created_at` desc.
- Add an "inventory‑only" filter toggle that shows only `project_id == null` transactions. No extra filters needed now. No placeholder `project_name` for BI; leave null.

3) Add transaction forms
- `AddTransaction.tsx` remains project‑scoped (passes `projectId` => stored on top‑level with that `project_id`).
- `AddBusinessInventoryTransaction.tsx` becomes the creator for BI transactions (sets `project_id = null`).

4) Transaction details page (`src/pages/TransactionDetail.tsx`)
- Fetch by ID from top‑level first; optionally display `project_name` if present.
- Fallback to legacy lookup only if not found (temporary).

5) Image uploads (`src/services/imageService.ts`)
- Current APIs expect a `projectName` string for storage paths. For BI transactions, pass a sentinel like `'BusinessInventory'` so files live under `BusinessInventory/receipt_images/...`.


### Migration Plan

Phased approach with a short compatibility window.

1) Introduce top‑level reads/writes
- Implement all service/UI changes above to read from top‑level when available.
- Keep legacy reads as fallback.

2) One‑time data migration (script)

```js
// migration/migrate-transactions-to-top-level.cjs (outline)
// For each project:
//   read projects/<id>/transactions/*
//   for each doc D:
//     write to transactions/<newId or D.id>
//       { ...D.data(), project_id: <id>, transaction_id: <docId>, created_at: D.created_at || now }
//   optional: write a marker on legacy docs (e.g., migrated: true)
```

ID policy for migration:
- Preserve document IDs verbatim for all migrated legacy transactions to top‑level.
- Do not re‑key historical transactions.
- Create deterministic canonical docs (`INV_SALE_<projectId>`, `INV_BUY_<projectId>`) at top‑level for inventory flows going forward only.

3) Cutover
- Flip feature flag `READ_LEGACY_TXNS=false` after verifying lists and details show correctly.
- Optionally delete/lock legacy subcollections later.


### Acceptance Criteria & QA

- Project transactions list shows both normal and inventory canonical txns, sorted by `created_at`.
- BI transactions tab shows:
  - Pure BI transactions (`project_id == null`)
  - Plus canonical project inventory transactions (INV_SALE/INV_BUY)
- Allocation of an item creates/updates `transactions/INV_SALE_<projectId>` and sets item to `pending` with `transaction_id` link.
- Deallocation moves item to BI, creates/updates `transactions/INV_BUY_<projectId>`, recomputes `amount`, and links item.
- Security rules allow controlled updates to `item_ids`, `amount`, `status`, `last_updated`.
- Images for BI txns upload under `BusinessInventory/...` path and render in details.
- BI tab includes an "inventory‑only" filter that returns only `project_id == null` transactions.

Manual test checklist:
1. Create a normal project transaction (form) → appears in project list.
2. Allocate a BI item to a project → INV_SALE appears, item marked pending, amount equals project_price.
3. Deallocate item back to BI → INV_BUY appears, item moved, amount equals purchase_price/market_value.
4. Create a BI‑only transaction (no project) → appears in BI tab, not in any project list.
5. Verify TransactionDetail renders top‑level txns by ID.


### Risks & Mitigations
- UI still reading legacy subcollections → Keep fallback during rollout; remove after migration.
- Missing indexes → Deploy indexes before cutting over.
- Concurrency on canonical txns → Use Firestore transactions for amount recompute.
- Image path expectations → Use sentinel `BusinessInventory` projectName for BI txns.


### Implementation Checklist (assignable tasks)
1. Add Firestore rules for top‑level `transactions`.
2. Add Firestore indexes for queries listed above.
3. Update `Transaction` type: `project_id?: string | null`.
4. Refactor `transactionService` to top‑level (get/list/subscribe/create/update/delete).
5. Update `unifiedItemsService.allocateItemToProject` to write to `transactions/INV_SALE_<projectId>`.
6. Update `deallocationService.ensurePurchaseTransaction` to write to `transactions/INV_BUY_<projectId>`.
7. Update `TransactionsList.tsx` to use new service methods.
8. Update `BusinessInventory.tsx` to query top‑level inventory‑related txns directly and add an "inventory‑only" filter (project_id == null).
9. Ensure `AddBusinessInventoryTransaction.tsx` creates top‑level BI transactions.
10. Update `TransactionDetail.tsx` to fetch top‑level first; legacy fallback.
11. Verify `imageService` usage for BI txns (pass 'BusinessInventory' as projectName).
12. Implement migration script `migration/migrate-transactions-to-top-level.cjs`.
13. Cutover: disable legacy reads and verify all ACs.


### Open Questions (for product/owner)
- None at this time. Future: if we add more BI categories/sources, confirm any additional filters.


### Notes
- The unified `items` collection already supports `project_id: null` for BI items and normal linking via `transaction_id`. This refactor only changes where transactions live and how they are queried.


