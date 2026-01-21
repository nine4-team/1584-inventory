# Fixing “wrong project” mistakes + inventory attribution (grounded in current app behavior)

## What’s already in place (relevant to these problems)

### 1) Canonical “Company Inventory” transactions are real and are created/updated by allocation logic

Your code treats certain transaction IDs as **canonical**:

- `INV_PURCHASE_<projectId>`
- `INV_SALE_<projectId>`
- `INV_TRANSFER_*`

See `CANONICAL_TRANSACTION_PREFIXES` and `isCanonicalTransactionId()` in `src/services/inventoryService.ts`.

The key behavior: **allocating/moving an inventory item is not a simple “change project_id”**. It intentionally creates/updates canonical transactions and updates item state + lineage:

- `unifiedItemsService.allocateItemToProject(...)` (in `src/services/inventoryService.ts`)
  - Branches based on the item’s current `transactionId` prefix:
    - Sale → inventory vs Sale → different project (creates/updates `INV_PURCHASE_<newProject>`)
    - Purchase → inventory vs Purchase → different project (creates/updates `INV_SALE_<newProject>`)
    - Inventory (no transaction) → project (creates/updates `INV_PURCHASE_<project>`)
  - Updates item fields like `projectId`, `inventoryStatus`, `transactionId`, `disposition`
  - Writes **lineage edges** via `lineageService.appendItemLineageEdge(...)` and pointer updates

This is great for inventory correctness, and (per your product model) it’s **appropriate** when a project “buys” items from company inventory (i.e., Inventory can be a real vendor/source). The main product risk isn’t “inventory-as-vendor is wrong” — it’s accidentally routing *non-inventory* corrections through this machinery when the user’s intent is simply “wrong project.”

### 2) Project “Items” page is `InventoryList` (it’s not just inventory)

`src/pages/ProjectItemsPage.tsx` renders:

- `InventoryList` with `projectId`, `projectName`, and `items` from `ProjectLayout`

So any “fix mistakes” UX we add for project items will likely live in `InventoryList` / its bulk controls.

Notable: `InventoryList` already has filters that expose data quality problems you care about:

- **no-transaction**: `!item.transactionId`
- **from-inventory**: `item.source === 'Inventory'` (treating Inventory as a vendor/source is intentional in your accounting model)

This is useful because “items added directly to projects from inventory” often show up as **no transaction** today (so you can find them and run the canonical “purchase from inventory” workflow retroactively).

### 3) Items can be created directly in a project, without a transaction

`src/pages/AddItem.tsx` creates project items and sets:

- `projectId: <route projectId>`
- `transactionId: formData.selectedTransactionId || ''` (so “none selected” becomes empty string)
- `disposition` defaults to `'purchased'`

That means you can end up with:

- A project item with **no transaction linkage** (empty/falsey `transactionId`)
- A project item that logically “came from inventory,” but nothing triggers creation of `INV_PURCHASE_<projectId>`

### 4) There is “assign items to a transaction” UI (single + bulk), but it’s project-scoped

You already have:

- `ItemDetail` → “Change transaction” flow
- `BulkItemControls` → “Assign to Transaction”

Both load transactions via `transactionService.getTransactions(accountId, projectId)` (project-scoped).

This is important: **today’s UI can re-link items within a project**, but it doesn’t support cross-project correction, and it doesn’t provide a “move transaction to another project” concept.

### 5) “Set disposition to inventory” triggers deallocation logic (canonical + side effects)

In both `ItemDetail` and `TransactionItemsList`, changing disposition to `'inventory'` calls:

- `integrationService.handleItemDeallocation(...)` → `deallocationService.handleInventoryDesignation(...)`

So “inventory designation” is already treated as a **special workflow** (not a field flip). That’s aligned with the idea that inventory attribution should be explicit and canonical.

---

## The two problems you described, translated into concrete app-level needs

### A) Users put **transactions/items in the wrong project**

You need a correction path that:

- **Moves a normal transaction (and its current items) to another project**
- Does **not** route through `allocateItemToProject()` (to avoid creating canonical inventory transactions)
- Is safe with your existing “moved items” / lineage model (some items may have left the transaction over time)

### B) Users add **items directly to a project** that actually came from **inventory**

You need a fast path that:

- Lets them say “this item came from inventory”
- Ensures a canonical `INV_PURCHASE_<projectId>` transaction is created/updated to include it
- Minimizes duplicate data entry (ideally: “select from inventory, allocate to this project”)

---

## Recommendations (least disruption, reuse existing components)

## 0) Clarify vendor vs “came from inventory” with a new field (recommended)

Right now `Item.source` is used everywhere as the “vendor/source” string (it’s displayed in item cards and also comes from the account’s vendor defaults list). That makes it a bad place to encode *two different meanings*:

- **Original vendor** (e.g. “TJ Maxx” — where the company originally acquired the item)
- **Acquisition channel for the project** (e.g. “came from Business Inventory”)

If you want to preserve the original vendor while still making “from inventory” obvious, add a dedicated field on `items` that represents **whether this item was sourced from business inventory**.

Suggested field (minimal + clear, low confusion):

- **`isFromBusinessInventory`**: `boolean`
  - `true`: this project item came from business inventory (even if `source === 'TJ Maxx'`)
  - `false`: not from business inventory (normal vendor purchase flow)

If you dislike the “Business” wording in code, alternatives that still read clearly:

- `isFromInventory` (short, but ambiguous if you later add other inventory concepts)
- `fromInventory` (shortest, common boolean style)
- `sourcedFromInventory` (a bit longer, but explicit)

UI guidance (intentionally minimal to avoid unintended changes):

- Preserve existing `source` semantics and existing `source` rendering in the UI.
- Add an **additional boolean indicator** in the UI when `isFromBusinessInventory === true`.
  - Suggested indicator text: **“From Inventory”**
  - Exact placement should follow existing UI patterns; do not reinterpret or relabel `source`.

Automation behavior with this field:

- Setting `isFromBusinessInventory = true` should be done via an explicit action (“Mark as from Business Inventory”) that runs the canonical flow (create/update `INV_PURCHASE_<projectId>` and link the item), without overwriting `source`.
- When allocating an existing business inventory item to a project (the normal “Add from Inventory” path), set `isFromBusinessInventory = true` automatically.

This keeps your accounting model intact (inventory purchase/sale automation) while avoiding the confusing implication that “Inventory” replaces the original vendor.

## 1) Add an explicit “Move transaction to another project” workflow (non-canonical only)

### Why this is the lowest-disruption fix for wrong-project mistakes

If a transaction is wrong-project, the cleanest correction is to move the transaction and its **currently-linked** items together. Trying to move items individually can leave you with mismatched `transaction.project_id` vs `item.project_id` semantics.

### Proposed rules

- **Allowed**: moving non-canonical transactions (i.e. transactionId NOT starting with `INV_PURCHASE_`, `INV_SALE_`, `INV_TRANSFER_`)
- **Blocked / special-cased**: canonical inventory transactions
  - If a user tries to move one, the UI should direct them to the inventory allocation/deallocation flows instead.

### Implementation concept (service-level)

Add a new method in `transactionService` (or a small dedicated service) that:

1. Loads the transaction record by `transaction_id` (account-scoped).
2. Updates the transaction’s `project_id` to the new project.
3. Updates items that are **currently** in that transaction:
   - Prefer querying `items` where `transaction_id = <transactionId>` and updating those items’ `project_id`.
   - Do **not** rely solely on `transaction.item_ids` because:
     - `item_ids` can include historical/moved-out items (your UI already handles “moved out” via lineage).
4. Triggers whatever cache invalidation you already use (you already have `removeTransactionFromCaches(...)` and realtime snapshot helpers).

### UI entry points (reuse existing UI patterns)

- **TransactionDetail page**: add an overflow menu action “Move to project…”
  - Reuse your existing `Combobox` patterns (same as allocation modals in BusinessInventory).
- **TransactionsList**: same action in each transaction row’s context menu.

### UX copy that steers users away from canonical inventory side effects

- If `isCanonicalTransactionId(transactionId)`:
  - Show: “This is a Company Inventory transaction. Use inventory allocation/deallocation instead.”

## 2) Add a simple “Move item to another project” workflow, but only for safe cases

### When item-only move is safe

- Item has **no transaction** (`!item.transactionId`): it’s “floating” and can be reassigned safely.

### When item-only move should be disallowed (or should redirect)

- Item has a **non-canonical transaction**:
  - Recommend moving the transaction instead (“Move the transaction to another project”) to avoid splitting.
- Item is tied to **canonical inventory** transactions:
  - Recommend using `allocateItemToProject(...)` so lineage + canonical inventory transactions remain correct.

### UI entry points (reuse existing)

- In `InventoryList` row actions: “Move to project…”
- In `BulkItemControls`: add a “Move to project…” bulk action, but enforce the rules above:
  - If selection includes items tied to non-canonical transactions → suggest “move transaction instead”
  - If selection includes inventory-canonical items → suggest “reallocate inventory items instead”

## 3) Make “add from inventory” the default happy path on project items pages

This addresses the root cause behind problem (B): users are creating new project items instead of allocating existing inventory items.

### Proposed UX on `ProjectItemsPage` / `InventoryList`

Add a prominent action near “Add Item”:

- **“Add from Inventory”**

Flow:

1. Open a modal that shows *available inventory items* (existing inventory list UI can be reused).
2. User selects one or more items.
3. On confirm, call `unifiedItemsService.allocateItemToProject(accountId, itemId, projectId, ..., space?)`.

Why this is low disruption:

- You already have selection + batch UX patterns (BusinessInventory has batch allocation).
- You already have the correct canonical behavior implemented (`allocateItemToProject`).
- You avoid building any new “canonical purchase creation” logic: you reuse the existing one.

## 4) Add a “Mark as from inventory” repair action for items that were created directly in a project

This is the repair path for already-bad data.

### Target cohort (easy win)

Items in a project with:

- `!item.transactionId` (or empty string)
- and/or users explicitly indicate they came from inventory

### Proposed behavior

Provide a bulk action:

- **“Mark as From Inventory (create/update Company Inventory Purchase)”**

Important nuance (aligning with your clarification):

- Treating **Inventory as a vendor/source is correct**, and this repair action is specifically about ensuring the **canonical accounting artifacts** exist (e.g. `INV_PURCHASE_<projectId>`).
- However, you probably still want the canonical flow to be triggered by an **explicit user intent/action** (button/menu), not by silently keying off a `source` string change that might happen as normal vendor editing.

If you add `isFromBusinessInventory` (above), this action should:

- Set `isFromBusinessInventory = true`
- Ensure the item is linked into `INV_PURCHASE_<projectId>` via the canonical flow
- Leave `source` unchanged (so “TJ Maxx” remains visible as original vendor)

Implementation concept:

- For each selected item:
  - Ensure it is treated as an inventory → purchase allocation:
    - Add it to `INV_PURCHASE_<projectId>` and set item fields consistent with inventory allocation.

Important caution:

- Do **not** route items that already have a non-canonical transaction through this repair action without thought, because `allocateItemToProject`’s fallback branch treats “unknown scenario” as inventory allocation and may leave the old transaction’s `item_ids` as historical residue.
  - For those, the UI should instead offer:
    - “Move transaction to project…” (problem A), or
    - “Assign to transaction…” (existing), or
    - a more explicit “Detach from transaction, then mark from inventory” (future enhancement).

### UX placement

- In `InventoryList` filters, “no-transaction” is already a thing.
  - When that filter is active, show a contextual callout:
    - “These items aren’t linked to any transaction. If they came from inventory, mark them as From Inventory to generate the Company Inventory Purchase transaction.”

---

## Phase plan (incremental, low-risk)

### Phase 1 (fastest value)

- Add **Move transaction to project** (non-canonical only).
- Add **Move item to project** for items with **no transaction** only.

This immediately solves “wrong project” mistakes without touching the canonical inventory machinery.

### Phase 2 (prevent recurrence)

- Add **Add from Inventory** entry point on project items pages to encourage correct workflow.

### Phase 3 (repair tooling for inventory attribution mistakes)

- Add bulk **Mark as From Inventory** for “no-transaction” items.
- Optionally add “Mark as From Inventory” on single item detail when `!item.transactionId`.

---

## Edge cases to explicitly handle (based on your current logic)

- **Canonical transaction IDs can’t be moved** by “move transaction” because their IDs encode meaning (`INV_PURCHASE_<projectId>` / `INV_SALE_<projectId>`). Treat them as special workflow objects.
- **Moved-out items**: your TransactionDetail already uses lineage edges to show moved-out items. When moving a transaction, update only items whose `transaction_id` still equals that transaction.
- **Offline behavior**: you already have offline queueing for many writes in `inventoryService`. If you implement move flows, prefer reusing the existing `transactionService.updateTransaction(...)` and `unifiedItemsService.updateItem(...)` pathways so offline behavior is consistent.

Additional guardrail (given “Inventory is a vendor/source”):

- **Reserve the “Inventory” vendor option**: since vendors come from account presets (`vendor_defaults`) and are user-editable, consider making “Inventory” (or your actual canonical label like “Business Inventory”) a *reserved, always-present option* in the UI so it can’t be removed/renamed into inconsistency across accounts.

