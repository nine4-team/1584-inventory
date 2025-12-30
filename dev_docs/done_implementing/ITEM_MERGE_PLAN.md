# Enabling Merge for Existing Project Inventory Items

## Goal
Surface the recently built “Merge Selected Items” capability (currently only reachable while creating/editing a transaction, including the Wayfair import flow) inside the regular project inventory list so that users can consolidate items that already live in a project.

## Current State
- `TransactionItemsList` owns the merge UI + logic and works on `TransactionItemFormData[]` (temporary, client-side representations used during transaction creation/import).
- The Wayfair import page reuses `TransactionItemsList`, so importing invoices already supports merging.
- The project inventory tab (`InventoryList`) renders persisted `Item` records, not `TransactionItemFormData`, and has no merge affordance; once items are saved there is no way to combine duplicates.

## High-Level Approach
| Layer | Needed work |
| --- | --- |
| UI | Add a “Merge Selected” action to `InventoryList` using existing checkbox selection state. |
| Client logic | Reuse the aggregation helpers from `TransactionItemsList` (sum purchase/project prices, stitch notes, etc.) but adapt them to operate on `Item`. |
| Persistence | Introduce a service function that updates the surviving item, deletes the absorbed items, and updates any transactions referencing those absorbed items (including recalculating amounts). |

## Detailed Tasks

### 1. InventoryList UX updates
- Reuse the existing selection UI (checkboxes + counter) and add a primary button (`GitMerge` icon for consistency) next to the bulk actions header. Disable until ≥2 items are selected.
- Open a modal similar to the current merge dialog:
  - List selected items with description/SKU/price.
  - Allow picking the “master” item (radio buttons).
  - Show warning copy that merged items will be deleted.
- After confirmation, call a new merge handler and show success/error toasts.

### 2. Shared merge helpers
- Extract the aggregation utilities from `TransactionItemsList` to a shared module (e.g. `src/utils/itemMergeHelpers.ts`) so both `TransactionItemsList` and `InventoryList` can import:
  - `aggregateMoneyField`
  - `buildMergedNotes`
  - (Optional) `buildMergedImages` helper to keep surviving thumbnails.
- For `InventoryList`, convert selected `Item`s → a lightweight structure that those helpers accept. (Most fields match already; just normalize field names.)

### 3. Client → service boundary
- Create a function (suggested name): `mergeProjectItems(accountId, projectId, masterItemId, absorbedItemIds)` inside `unifiedItemsService` or a dedicated `itemMergeService`.
- Responsibilities:
  1. Fetch master + absorbed items (ensure they all belong to the same project).
  2. Build the merged payload:
     - Sum money fields (`purchasePrice`, `projectPrice`, `taxAmountPurchasePrice`, `taxAmountProjectPrice`).
     - Concatenate notes using the helper.
     - Preserve/merge images (mark master’s current primary; append absorbed images that are unique).
  3. Update the master item via `updateItem`.
  4. Delete absorbed items.
  5. Update related transactions:
     - For any transaction whose `item_ids` includes an absorbed id, replace it with the master id (dedupe).
     - Recompute `amount` = sum of associated items’ `project_price || purchase_price`.
     - Consider enqueueing `transactionService.beginNeedsReviewBatch` like EditTransaction does.
- Wrap the whole operation in a Supabase `rpc`/multi-step transaction if possible; otherwise, implement compensation logic (if deleting absorbed items succeeds but transaction update fails, re-add ID, etc.).

### 4. State refresh + realtime
- After the merge call resolves, optimistically update local `items` state by removing absorbed items and patching the master item. Realtime subscriptions should eventually deliver the canonical record but optimistic update avoids flicker.

### 5. Edge cases / validations
- Prevent merging items that:
  - Belong to different projects.
  - Have conflicting dispositions (simple rule: merge allowed regardless, but final disposition = master’s).
  - Are linked to different transactions when those transactions should stay separate. Proposed rule: allow merging and keep the master’s transaction linkage; note in description that the absorbed items were merged.
- Ensure the user has edit permissions (InventoryList already assumes `UserRole.USER`; reuse that guard).

## Testing Plan
1. **Unit tests** for the shared helper module (money aggregation + notes merging).
2. **Service tests** (if we have integration tests) that:
   - Create mock items + transaction.
   - Merge and assert master fields, deletion of absorbed items, and transaction `item_ids`/`amount`.
3. **Manual QA**
   - Select 2 existing items in a project → merge → verify inventory count decreases by 1 and master shows updated price/notes.
   - Verify the linked transaction’s amount equals new total and absorbed item rows disappear.
   - Try merging items that already have images to confirm images persist.

## Open Questions
1. Should we automatically archive absorbed items instead of hard deleting (for audit history)?
2. If absorbed items were linked to different transactions, do we need to record that lineage anywhere for compliance?
3. Do we need to emit analytics or activity log events when merges occur?
