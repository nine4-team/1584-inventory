# Flow: `inheritedBudgetCategoryId` rules (Items ↔ canonical transactions)

This doc is the shared source for Project Items and Business Inventory specs.

Goal: make it unambiguous **where `inheritedBudgetCategoryId` comes from**, **when it changes**, and **what breaks if it’s missing**.

---

## Definitions

- **User-facing (non-canonical) transaction**: a normal transaction whose budget category is set by the user (`transaction.category_id`).
- **Canonical inventory transaction**: a system-generated transaction whose id begins with `INV_PURCHASE_`, `INV_SALE_`, or `INV_TRANSFER_`.

Canonical working doc (source of truth):

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

---

## 1) Attribution rules (canonical vs non-canonical)

### 1.1 Non-canonical attribution (transaction-driven)

- Category attribution comes from `transaction.category_id`.

### 1.2 Canonical inventory attribution (item-driven)

- Canonical inventory transactions are attributed by **items linked to the canonical transaction**, grouped by `item.inheritedBudgetCategoryId`.
- Canonical inventory transactions should not require a user-facing budget category.

Intentional delta (vs web):

- The current web budget rollups do not group canonical transactions by item categories (`src/components/ui/BudgetProgress.tsx`).

---

## 2) The item field: `inheritedBudgetCategoryId`

### 2.1 Required storage

Every item persists a stable `inheritedBudgetCategoryId` field (nullable but present).

### 2.2 How it is set

**On link to a non-canonical transaction**:

- If transaction has `category_id`, set `item.inheritedBudgetCategoryId = transaction.category_id`.

**On link to a canonical inventory transaction**:

- Do not set or overwrite `item.inheritedBudgetCategoryId`.

### 2.3 When it changes

**Business Inventory → Project allocation/sale**:

- Prompt user for destination project budget category
- Persist it as `item.inheritedBudgetCategoryId = chosenCategoryId`

### 2.4 What breaks if missing

If `item.inheritedBudgetCategoryId` is missing, canonical inventory transactions cannot be deterministically attributed to project budget categories.

Therefore, Project → Business Inventory **sell/deallocate-style** operations must be blocked until the field is known.

---

## 3) UI guardrails (required)

### 3.1 Project → Business Inventory

Block **sell/deallocate-style** moves (canonical-row paths) if `inheritedBudgetCategoryId` is missing.

Required copy:

- Disable reason: `Link this item to a categorized transaction before moving it to Design Business Inventory.`
- Error toast: `Can’t move to Design Business Inventory yet. Link this item to a categorized transaction first.`

Correction path clarification (parity-informed):

- “Move to Design Business” (correction) is a direct item scope update and does not create canonical inventory transactions in current web behavior (`moveItemToBusinessInventory` in `src/services/inventoryService.ts`). It may remain allowed even when `inheritedBudgetCategoryId` is missing.

### 3.2 Business Inventory → Project

Prompt for destination project budget category.

Defaulting:

- Preselect `item.inheritedBudgetCategoryId` only if it exists and is enabled in the destination project.

Batch:

- One selection applies to all items in the batch.

Persistence:

- Always write the chosen category back onto each item.

---

## 4) Canonical transaction category storage (recommendation)

Preferred:

- Canonical inventory transactions keep `category_id = null` and are treated as uncategorized in UI.

Optional (schema compatibility):

- A hidden/internal “Canonical (system)” category may exist, but rollups must ignore canonical transaction category and use item-driven attribution.

Parity context:

- Current web canonical transaction creation may populate `category_id` and legacy `budget_category` fields (`src/services/inventoryService.ts`). This must not be used for attribution going forward.

---

## 5) Migration/backfill (out of scope)

Any one-time migration/backfill logic for existing data is handled separately and is explicitly **out of scope** for this spec pack.

