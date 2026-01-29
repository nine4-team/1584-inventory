# Budget + Accounting (project rollups) — Feature spec (Firebase mobile migration)

## Intent
Provide fast, trustworthy **budget progress** and **accounting rollups** inside a project that:

- render from **local SQLite only**
- update deterministically as transactions/items change (via outbox + delta sync)
- do **not** require users to learn “canonical categories” for inventory mechanics

This spec explicitly **deviates** from the current web implementation for canonical attribution; see “Canonical attribution” below.

## Definitions

- **Budget category preset**: account-scoped category entity the user manages in Settings.
- **Project category budgets**: `project.budgetCategories: Record<budgetCategoryId, number>` (sparse map; presence implies “enabled”).
- **Design fee**: `project.designFee` with special semantics (“received”, not “spent”).
- **Non-canonical transaction**: user-facing transaction where category attribution is transaction-driven via `transaction.categoryId` (Firestore) / `transaction.category_id` (legacy web naming).
- **Canonical inventory transaction**: system row whose id begins with `INV_PURCHASE_`, `INV_SALE_`, `INV_TRANSFER_`.

Canonical working doc (source of truth):
- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

## Core model decisions (required)

### 1) Design fee stays special
- **Budget source**: `project.designFee`
- **Progress semantics**: “received”, not “spent”
- **Exclusion rule**: design fee is excluded from:
  - category budget sums
  - “spent overall” totals
- **Stable identifier**: “design fee specialness” must be keyed by a stable identifier (slug/metadata), not a mutable display name.
  - Intentional delta vs web: web uses `categoryName.includes('design') && includes('fee')` heuristics in `src/components/ui/BudgetProgress.tsx`.

### 2) Canonical inventory transactions must not require a user-facing budget category
Canonical rows exist for inventory correctness (allocation / sale / deallocation), not for user budgeting.

Recommendation (preferred):
- Canonical inventory transactions keep `categoryId = null` (uncategorized).

Schema-compatibility fallback:
- A hidden/internal “canonical system” category may exist, but **rollups must ignore it** for attribution.

### 3) Canonical vs non-canonical attribution (the core deviation)

#### Non-canonical attribution (transaction-driven)
- Category attribution comes from `transaction.categoryId`.

#### Canonical inventory attribution (item-driven) — required
- Canonical inventory transactions are attributed by **items linked to the canonical transaction**, grouped by:
  - `item.inheritedBudgetCategoryId`

Source of truth:
- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- `40_features/project-items/flows/inherited_budget_category_rules.md`

Intentional delta (vs web):
- Web budget rollups group canonical transactions by transaction category, not item categories (`src/components/ui/BudgetProgress.tsx`).

## Owned UI surface (project context)

### Project shell budget section
The project shell exposes a “Budget section” with two sub-tabs:

- **Budget**: budget progress
- **Accounting**: rollups + report entrypoints

Web parity evidence:
- `src/pages/ProjectLayout.tsx` (`budgetTabs`, `activeBudgetTab`, BudgetProgress render, accounting cards and report buttons)

### Project list preview
Projects list shows a compact “budget progress preview” for each project.

Web parity evidence:
- `src/pages/Projects.tsx` (uses `BudgetProgress` in preview mode)

## Budget rollups (Budget tab)

### Inputs (local DB)
- Project:
  - `project.designFee`
  - `project.budgetCategories` (map of categoryId → budget amount)
- Budget categories (account-scoped list, cached locally): `budget_categories`
- Transactions (project-scoped): `transactions`
- Items (project-scoped): `items` with `item.inheritedBudgetCategoryId`

### Money normalization
All amounts are treated as numbers with two-decimal currency semantics; rounding strategy should be consistent across UI and exports.

### Transaction inclusion rules
- Exclude `status === 'canceled'`.
- Design fee transactions are excluded from “spent” totals and category budgets (they contribute only to Design Fee received; see below).

### Overall “spent” (excluding design fee)
Overall spent is computed as:

- Sum over all **non-canceled** transactions **excluding design fee**:
  - Purchases add
  - Returns subtract
  - Canonical sales subtract (inventory sale reduces “spent”)

Web parity note:
- Web currently uses:
  - `transactionType === 'Return'` as subtract
  - `transactionId.startsWith('INV_SALE_')` as subtract
  - and excludes design fee by category-name heuristic (`BudgetProgress.calculateSpent`)

Firebase migration requirement:
- Identify design fee by stable identifier, not name matching.

### Category breakdown (budget category spend)

#### Enabled category set
- Categories are “enabled” for budgeting in a project when:
  - `project.budgetCategories[categoryId] > 0`, OR
  - the category has non-zero attributed spend (so users can see where money went even if budget not set).

#### Spend per category (non-canonical transactions)
For each non-canonical transaction with `categoryId`:
- Add `amount` with sign:
  - `+1` for purchases
  - `-1` for returns

#### Spend per category (canonical inventory transactions) — required
For each canonical inventory transaction:

1) Determine the set of linked items (local join by `item.transactionId === transaction.transactionId`).
2) For each linked item, compute its “canonical value”:
   - `item.projectPrice ?? item.purchasePrice ?? item.marketValue ?? 0`
   - (matches existing canonical totals logic in `src/services/inventoryService.ts`)
3) Group items by `item.inheritedBudgetCategoryId` and sum values per group.
4) Apply canonical sign:
   - `INV_PURCHASE_*`: `+1`
   - `INV_SALE_*`: `-1`
   - `INV_TRANSFER_*`: `0` impact on budget rollups unless/until transfer semantics are defined elsewhere.

Important:
- Canonical attribution must **not** consult `transaction.categoryId` even if populated (schema-compatibility fallback).

### Overall budget (budget denominator)
Overall budget is computed as:
- `sum(project.budgetCategories[*])` excluding design fee.

Note:
- The legacy `project.budget` field (if present) must not be treated as authoritative if category budgets exist; overall rollups should be category-sum-driven.
  - Parity evidence: web computes overall as sum of category budgets in `BudgetProgress` (`overallFromCategories`).

### Budget tab UI behavior (high-level)
- Default collapsed view focuses on “Furnishings” if present; “Show all budget categories” expands the full list and reveals “Overall Budget”.
- When expanded, show per-category rows, Design Fee, then Overall Budget at the bottom.

Parity evidence:
- `src/components/ui/BudgetProgress.tsx` (toggle behavior, furnishings default, overall budget row placement)

## Design fee rollups (Budget tab)

### Design fee received
Design fee “received” is computed from a designated “Design Fee” tracker identity:

- **Budget**: `project.designFee`
- **Received**: sum of non-canceled “design fee” transactions:
  - purchases add
  - returns subtract
- **Remaining**: `designFeeBudget - received`

Stable identifier requirement:
- The design fee tracker must be keyed by stable metadata (e.g., `budgetCategory.systemTag === 'design_fee'`) not by the category name string.

## Accounting rollups (Accounting tab)

### Owed rollups
Accounting shows two rollups computed from local transactions:

- **Owed to Design Business**: sum of non-canceled transactions where `reimbursementType === CLIENT_OWES_COMPANY`
- **Owed to Client**: sum of non-canceled transactions where `reimbursementType === COMPANY_OWES_CLIENT`

Parity evidence:
- `src/pages/ProjectLayout.tsx` (`owedTo1584`, `owedToClient`)
- Constants:
  - `src/constants/company.ts`

### Report entrypoints
Accounting includes buttons/links to:
- Invoice
- Client Summary
- Property Management Summary

This feature owns only the **entrypoints**; report generation behavior is owned by `reports-and-printing`.

Parity evidence:
- `src/pages/ProjectLayout.tsx` (report buttons + routes)

## Offline-first + collaboration constraints (Firebase target)
- Rollups must always be computed from SQLite (no network required).
- While a project is foregrounded, data freshness comes from `meta/sync` change-signal + delta sync (no listeners on large collections).

Canonical source:
- `sync_engine_spec.plan.md`
