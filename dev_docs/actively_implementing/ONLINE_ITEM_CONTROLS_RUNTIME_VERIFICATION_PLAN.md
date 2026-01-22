# Online Item Controls Runtime Verification Plan

## Goal
Provide a **runtime, end-to-end** verification that each item menu control behaves correctly **online** (no offline queue), and that actions persist immediately and consistently across UI surfaces.

## Scope
This plan mirrors the offline verification but focuses on **online execution** and **immediate persistence** without relying on queued operations.

## Key UI Surfaces (where the item menu appears)
- Project inventory list: `src/pages/InventoryList.tsx` → `InventoryItemRow` → `ItemPreviewCard` → `ItemActionsMenu`
- Business inventory list: `src/pages/BusinessInventory.tsx` → `InventoryItemRow` → `ItemPreviewCard` → `ItemActionsMenu`
- Transaction item list: `src/components/TransactionItemsList.tsx` → `ItemPreviewCard` → `ItemActionsMenu`
- Item detail (project + BI routes): `src/pages/ItemDetail.tsx` → `ItemActionsMenu`
- Business inventory item detail: `src/pages/BusinessInventoryItemDetail.tsx` → `ItemActionsMenu`

## Pre-Flight Checklist
- App runs locally with a test account.
- Confirm **online** status (no offline banner).
- Access to a test project and business inventory.
- A project item that is:
  - persisted (real UUID)
  - not tied to a non-canonical transaction
  - has at least one image and some fields filled in (price, SKU) for visibility.
- A business inventory item that is persisted.
- At least one existing transaction in the project and one BI transaction.
- Ensure DevTools Network is **Online** (no offline throttling).

## Test Data Setup (If Missing)
1. Create a project item with a distinctive description.
2. Create a BI item with a different description.
3. Create a project transaction with a known amount.
4. Create a BI transaction with a known amount.
5. Attach one item to a transaction while online to validate later unlink/change behavior.

## Runtime Verification Steps (Online)

### Step A: Confirm Online
- Verify the offline banner is **not** visible.
- Perform a simple refresh to confirm data loads without warnings.

### Step B: Per-Action Tests (Online)
Run each test in **each relevant surface** (project list, BI list, item detail, BI item detail, transaction list if applicable).

#### 1) Add To Transaction…
- Action: assign an item to a transaction.
- Expected online result:
  - Item shows transaction assignment immediately.
  - Transaction item list updates immediately.
  - No offline toast/queue indicators.

#### 2) Make Copies…
- Action: duplicate an item with quantity > 1.
- Expected online result:
  - New items appear immediately (grouped if applicable).
  - If original was tied to a transaction, newly created items appear tied to it.
  - No errors or delayed sync indicators.

#### 3) Sell To Design Business
- Action: move project item to business inventory via Sell submenu.
- Expected online result:
  - Item appears in BI immediately.
  - Lineage updates correctly (no phantom item in project list).

#### 4) Sell To Project…
- Action: sell project item to a different project.
- Expected online result:
  - Item ends up in target project with correct transaction linkage.
  - Origin project item is removed or updated appropriately.

#### 5) Move To Design Business
- Action: move project item to BI without sale.
- Expected online result:
  - Item disappears from project list and appears in BI.
  - Item’s projectId is null.

#### 6) Move To Project…
- BI item: allocate to project.
- Project item: simple move between projects (if applicable).
- Expected online result:
  - Item appears in target project immediately.
  - Allocation transaction is created (if applicable).

#### 7) Change Status
- Action: set each status option (To Purchase / Purchased / To Return / Returned).
- Expected online result:
  - Status reflects immediately across list + detail views.

#### 8) Delete…
- Action: delete item.
- Expected online result:
  - Item disappears from list immediately.
  - Item is not accessible via direct URL.

#### 9) Edit
- Action: navigate to edit screen, update fields, save.
- Expected online result:
  - Edits are reflected immediately in list + detail views.

### Step C: Cross-Surface Consistency
- After each action, confirm the change is reflected in:
  - List view (project or BI)
  - Item detail
  - Transaction item list (if item is linked)

## Observability and Diagnostics
- Monitor console logs for errors.
- Confirm there are no offline queue toasts or sync warnings.

## Reporting Requirements
For each action, record:
- Context (where it was tested)
- Expected vs observed behavior
- Any console errors (copy snippets)
- Any mismatch between list/detail/transaction views

## Deliverable
Update `dev_docs/actively_implementing/OFFLINE_ITEM_CONTROLS_VERIFICATION.md` with:
- A **runtime test matrix** (action × surface)
- Outcomes and any discrepancies
- Notes on known limitations or non-blocking issues
