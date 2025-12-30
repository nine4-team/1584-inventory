# Disposition Update Audit

## Scope

We are replacing every usage of `"keep"` with `"purchased"`, adding `"to purchase"` as a recognized value (not yet driving any automation), and keeping the existing `"to return"`, `"returned"`, and `"inventory"` flows intact. This document enumerates every code and content touch-point that must change so the new disposition set is consistent end-to-end.

## Status Update (2025-12-28)

- `AddItem` now seeds `'purchased'` via the canonical `DISPOSITION_OPTIONS` list and restricts the form state to `ItemDisposition`.
- Inventory list, item detail, and business inventory dropdown menus pull their labels from `displayDispositionLabel`, eliminating the last bits of hand-crafted casing.
- Supabase migration `20251228_update_item_dispositions` backfills legacy `'keep'` rows to `'purchased'` and enforces a check constraint to keep the column aligned going forward (also applied via the MCP tool).
- Seed SQL in `scripts/create-test-projects/project-*.sql` writes only canonical values (with a representative `'to purchase'` row), preventing reintroduction of `'keep'` during local setup.
- Test fixtures in `src/services/__tests__/test-utils.ts` now default to `'purchased'` so unit tests exercise supported values only.

## Canonical Values

| Stored value    | Display label | Notes |
|-----------------|---------------|-------|
| `to purchase`   | To Purchase   | New. Placeholder for future workflows; must be selectable/visible but has no downstream automation yet. |
| `purchased`     | Purchased     | Replaces legacy `keep`. Default selection in create-item UI, but missing DB values should remain `null`. |
| `to return`     | To Return     | Existing behavior. |
| `returned`      | Returned      | Existing behavior. |
| `inventory`     | Inventory     | Existing behavior that still triggers deallocation logic. |

All helpers, menus, badges, and defaults should source this ordered list so UI copy never drifts again. **Important:** do not silently coerce `null`/missing dispositions to `"purchased"` (or anything else) in services or display helpers. Only the item creation experiences (forms, duplication flows, quick-add) should seed `"purchased"` as their initial value.

## Code Changes By Layer

### Core utilities & shared types
- `src/utils/dispositionUtils.ts`
  - Update `normalizeDisposition` so it trims/lowercases values and leaves `null`/`undefined` untouched (no auto-default). Guard against casing/spacing errors for `to purchase`.
  - Extend `displayDispositionLabel` so `"to purchase"` and `"purchased"` render with the correct capitalization, preferably by centralizing the label map instead of branching inline in every caller.
- `src/types/index.ts`
  - Introduce an `ItemDisposition` union (`'to purchase' | 'purchased' | 'to return' | 'returned' | 'inventory'`) and use it anywhere `disposition?: string` currently appears (items, transactions, forms). This immediately pushes compile-time coverage across the repo.

### React surfaces (badges, menus, indicators)
- `src/pages/InventoryList.tsx`, `src/pages/ItemDetail.tsx`, `src/pages/BusinessInventory.tsx`
  - `getDispositionBadgeClasses` currently has `case 'keep'`. Swap to `'purchased'` and add a branch for `'to purchase'` (consider a neutral/amber palette so it reads as “pending”).
  - Dropdown arrays (`['keep', 'to return', ...]`) must become `['to purchase', 'purchased', 'to return', 'returned', 'inventory']`.
  - Anywhere the label is derived manually (e.g., `disposition === 'to return' ? 'To Return' : ...`) should delegate to `displayDispositionLabel` to avoid duplicating the new values.
- `src/pages/TransactionDetail.tsx`
  - The disposition badge uses hard-coded ternaries for `"keep"`, `"to return"`, etc. Update the conditionals/colors for the new palette and change the default text to `displayDispositionLabel(item.disposition)`.

### Data-entry flows and defaults
- `src/pages/AddItem.tsx`
  - Initial `formData.disposition`, select option list, and the submit fallback (`formData.disposition || 'keep'`) all need to prefer `'purchased'` and expose the full five-option list. This is one of the only places we intentionally set the default.
- `src/pages/EditTransaction.tsx`
  - Newly created in-flight items (inside the `newItems.map`) still hard-code `'keep'`; set them to `'purchased'` explicitly since these are user-driven creates.
- `src/pages/TransactionDetail.tsx`
  - `handleSaveItem` uses `'keep'` when creating items from an existing transaction; set `'purchased'` there as well.
- `src/pages/BusinessInventoryItemDetail.tsx`
  - Duplicating an item defaults back to `'keep'`; update to `'purchased'`.
- `src/pages/EditBusinessInventoryItem.tsx`
  - The loader maps `"keep"` to `"inventory"` before showing the form. Replace that guard with `"purchased"` (and consider whether items ever need that translation now that `purchased` is distinct from `inventory`).
- `src/pages/AddBusinessInventoryItem.tsx`
  - The dropdown only lists return/inventory states. Decide whether `To Purchase`/`Purchased` should be selectable for business inventory items (likely yes for parity) even if automation ignores them for now.

### Service layer (item creation/allocation)
Every helper that manufactures or mutates items still writes `'keep'`:
- `src/services/inventoryService.ts`
  - `handleSaleToPurchaseMove`, `handleSaleToDifferentProjectMove`, `_restoreItemAfterSaleRemoval`, `handleInventoryToPurchaseMove`, batch allocation branches inside `allocateItemsToProject` (multiple occurrences), and `_batchAllocateItems` all set `disposition: 'keep'`.
  - `duplicateItem`, `createTransactionItems`, and the generic `createItem` helpers default to `'keep'`.
  - Replace each default with `'purchased'`, ensure any comparisons treat `'purchased'` as the neutral state, and confirm that deallocation logic only special-cases `'inventory'` and `'to return'` as before.
- `src/services/__tests__/test-utils.ts`
  - Update fixture data so it uses valid dispositions (prefer the new union).

### Database & data migration (Supabase)
- Run a Supabase migration that:
  1. Updates existing rows: `update items set disposition = 'purchased' where disposition = 'keep';` (do **not** touch `null` so we preserve “unset” history)
  2. (Optional) Adds a check constraint or enum to lock values to the five-item set going forward.
  3. Documents that the default for new rows (if left null at the DB level) should be applied in UI create flows, not enforced by the database.
- Remember to use the Supabase MCP tool for any DDL/DML when you implement this.

### Seed/test SQL scripts
- `scripts/create-test-projects/project-*.sql` and `scripts/create-correct-test-data.sql` insert `'keep'` for almost every row. Replace with `'purchased'` so developers’ local datasets mirror production expectations.
- If mock data should demonstrate `to purchase`, sprinkle a few rows accordingly.

### Documentation & reference material
The following documents still describe the old disposition set and need updates once the code changes land:
- `docs/create-6-test-projects-plan.md` (default text).
- `dev_docs/ARCHITECTURE.md`, `dev_docs/DATA_SCHEMA.md`, `dev_docs/old/ITEM_ALLOCATION_REQUIREMENTS.md`, and similar references that list `"keep"` as a valid value.
- Any troubleshooting/how-to docs that teach users to click “Keep”.

## Testing Checklist
- Create/duplicate items via:
  - Add Item form
  - Edit Transaction new line items
  - TransactionDetail quick-add
  - Item duplication (project + business inventory)
- Toggle dispositions across all five values in:
  - `InventoryList`
  - `ItemDetail`
  - `BusinessInventory`
- Deallocate to inventory to ensure only the `'inventory'` path triggers integrations.
- Run the Supabase migration against staging data and verify counts of each disposition value before/after.
- Re-run any screenshot/visual regression suite to confirm badge colors look intentional.

## Open Questions / Follow-ups
1. **Color palette:** What colors do we want for “To Purchase” vs “Purchased”? Right now only “keep/return/inventory” have defined colors.
2. **Business inventory UX:** Should users be able to mark items as “To Purchase” even though those items already live in business inventory? (If not, document the reason and hide the option on those screens.)
3. **Future automation:** When we eventually wire `to purchase`, where does that workflow live (e.g., should saving that state enqueue a purchase task)?
4. **Central constant:** Consider adding a shared `DISPOSITION_OPTIONS` array exported from `dispositionUtils` so menus/badges cannot diverge again.

Answer these before/while implementing to avoid churn.
