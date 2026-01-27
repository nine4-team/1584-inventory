## Budget Categories Vision (Firebase Migration Working Doc)

Audience: internal implementation/design discussion for the Firebase migration (not a final spec).

### Goals

- **Simple defaults**: Works out of the gate for interior designers with no “concept learning.”
- **Accurate budget progress**: Category budgets reflect reality even with Business Inventory and canonical system rows.
- **Flexible item categorization**: Teams can budget across multiple item buckets (e.g., Furniture + Accessories).
- **Separation of concerns**: Users budget/categorize work; the system maintains canonical rows for inventory integrity.

---

### Current building blocks (existing app model)

- **Account-scoped budget categories**: managed in Settings; projects reference them by id.
- **Project budgets**:
  - `project.budgetCategories`: `Record<budgetCategoryId, number>` (per-category budgets; sparse map means “enabled”)
  - `project.designFee`: separate field with special UI semantics (received vs spent)
- **Transactions**:
  - `transactions.category_id` (preferred) and legacy `transactions.budget_category` (string)
- **Canonical inventory transactions**:
  - System-generated rows such as `INV_PURCHASE_<projectId>`, `INV_SALE_<projectId>`, `INV_TRANSFER_*`
  - Represent inventory allocation / return / sale mechanics (not user-entered).

---

### Vision decisions

#### 1) Design Fee stays special (user-facing)

- **Budget source**: `project.designFee`
- **Progress semantics**: “received”, not “spent”
- **Overall budget**: Design Fee is excluded from “spent” totals and category budget sums.

Implementation note: the specialness should be bound to a stable identifier (slug/metadata), not a mutable display name.

#### 2) Canonical inventory transactions should not require a user-facing budget category

Canonical rows exist for inventory correctness and reconciliation. Users should not have to understand or set a “canonical category.”

However, budget progress still needs to land in meaningful categories.

#### 3) Canonical vs non-canonical attribution rule (the core decision)

- **Non-canonical transactions**: category attribution comes from `transactions.category_id` (status quo).
- **Canonical transactions** (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`): category attribution comes from **items linked to the canonical transaction**, grouped by each item’s inherited budget category.

This avoids wrong attribution when a canonical transaction contains mixed-category items (Furniture + Accessories).

---

### Data we need on items (for attribution)

Each item must have an **inheritedBudgetCategoryId** that represents the user-facing budget category the item “belongs to” for budgeting/progress.

Where it comes from:
- If an item is linked to a user-facing transaction, it inherits that transaction’s `category_id`.

Where it persists:
- Store on the item as a stable field or metadata (Firebase migration should include it explicitly so it survives cross-scope moves).

---

### Guardrail: Project → Business Inventory (sell/deallocate)

Constraint (required):
- **Do not allow an item to be sold/deallocated to Business Inventory unless it has previously been linked to a transaction** (so it can inherit a budget category).

On successful move to Business Inventory:
- Item keeps its `inheritedBudgetCategoryId`.

Why:
- Later deallocation and budget attribution need a deterministic category without asking the user to learn a new concept.

---

### Business Inventory → Project (sell/allocate) — “mismatch” concern

Concern:
- The Business Inventory “intake” transaction category might not match the destination project’s budgets or the way the project wants to track spend.

Resolution (final):
- The destination project’s canonical purchase transaction remains uncategorized.
- Budget attribution remains item-driven (canonical attribution sums items grouped by their budget category).
- **At BI → Project sell/allocation time, prompt the user to choose a destination-project budget category** for the item (or batch). This removes ambiguity and ensures attribution matches the project’s budgeting intent.

Defaulting behavior for the prompt:
- If the item already has `inheritedBudgetCategoryId` and that category is enabled/available for the destination project, preselect it.
- Otherwise, leave unselected and require a choice.

Persistence:
- On successful allocation, set/update the item’s `inheritedBudgetCategoryId` to the user’s chosen destination category (so future moves and canonical attribution remain deterministic).

Batch behavior (recommended):
- One category choice applies to the whole batch (fast path).
- (Optional later) advanced “split per item” if needed.

---

### UX guidance

- Avoid introducing “roles” as a user-facing concept.
- Use language like:
  - “Used for design fee”
  - “Used for item purchases & sales” (if surfaced at all; keep under “Advanced”)
- Prefer “pinning” budget trackers in collapsed views over a single “primary category” concept.

