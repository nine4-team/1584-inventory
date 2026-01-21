# Budget Category “Requires Item Tracking” Attribute Plan

## Goal
Add a **per–budget category attribute** that indicates **“transactions in this category require item tracking”**, and use it to:

- Show/hide the **`TransactionAudit`** section on transaction detail pages
- Enable/disable the **“Needs Review / Missing Items”** badge behavior on transaction list preview cards
- Let admins **toggle this attribute** in `Settings → Presets → Budget Categories`

## Current State (Baseline in this repo)

### Budget categories storage + APIs
- Budget categories are not stored in a dedicated table. They live in:
  - `account_presets.presets->budget_categories` (JSON array)
- They are exposed to the app through:
  - `vw_budget_categories` (`supabase/migrations/20250104_create_budget_categories_view.sql`)
- They are created/updated via:
  - `rpc_upsert_budget_category` (`supabase/migrations/20250104_create_budget_category_rpc_functions.sql`)
  - `budgetCategoriesService.createCategory` / `budgetCategoriesService.updateCategory` (`src/services/budgetCategoriesService.ts`)
- Category metadata already exists as a JSON blob:
  - view column `metadata` → `BudgetCategory.metadata` (`src/types/index.ts`)

### Transaction audit + needs review today
- `TransactionAudit` is mounted in `TransactionDetail` for most transactions, with extra filtering:
  - `TransactionDetail` excludes canonical company inventory transactions (sale/purchase)
  - `TransactionAudit` returns `null` for `Return` and `Internal Transfer` (`src/components/ui/TransactionAudit.tsx`)
- `TransactionsList` shows audit-related badges:
  - If `transaction.needsReview === true` → **Needs Review**
  - Else if completeness fetched client-side is not complete → **Missing Items**
  - Completeness is fetched only when `needsReview === undefined` (`src/pages/TransactionsList.tsx`)
- The derived boolean `needs_review` is recomputed and persisted by the client service:
  - `transactionService._recomputeNeedsReview` (`src/services/inventoryService.ts`)

## Proposed Data Model
Store the attribute inside existing budget category `metadata`:

- `metadata.requires_item_tracking: boolean`

Rationale:
- Fits the existing JSONB-backed category design (no new table needed).
- `rpc_upsert_budget_category` already accepts `p_metadata` and returns the updated JSON blob.
- App already reads/writes category metadata via `BudgetCategory.metadata`.

## Implementation Plan

### 1) Types + helpers
- Update `src/types/index.ts`:
  - Keep `BudgetCategory.metadata` as-is.
  - Optionally add a derived convenience field (either is fine):
    - `requiresItemTracking?: boolean` *(derived from metadata in the service)*, OR
    - a helper function like `categoryRequiresItemTracking(category): boolean`

### 2) Hydrate the attribute from `metadata` in `budgetCategoriesService`
- Update `src/services/budgetCategoriesService.ts` mapping (view → `BudgetCategory`) to expose the flag:
  - `requiresItemTracking = Boolean(converted.metadata?.requires_item_tracking === true)`
- Ensure absent metadata defaults to `false`.

### 3) Settings UI: toggle per category in `BudgetCategoriesManager`
Update `src/components/BudgetCategoriesManager.tsx`:

- Add a new column (or inline control) for **Track items** (checkbox).
- For each category row:
  - **Checked** when `category.metadata?.requires_item_tracking === true` (or derived field).
  - **On toggle**:
    - Call `budgetCategoriesService.updateCategory(currentAccountId, category.id, { metadata })`
    - Use a merged metadata object so existing metadata keys aren’t lost:
      - `metadata: { ...(category.metadata ?? {}), requires_item_tracking: nextValue }`
- UX:
  - Disable toggles while saving (existing `isSaving`), or introduce per-row saving state if needed.
  - Optional: disable/grey the toggle for archived categories.

### 4) Gate `TransactionAudit` in `TransactionDetail` by category attribute
Update `src/pages/TransactionDetail.tsx`:

- Resolve the category for the current transaction:
  - Prefer `transaction.categoryId` → `categories.find(c => c.id === transaction.categoryId)`
  - Optional fallback: attempt a name match using legacy `transaction.budgetCategory`
- Compute:
  - `shouldShowAuditForCategory = resolvedCategory?.metadata?.requires_item_tracking === true`
- Update the existing `TransactionAudit` mount guard:
  - Only render `TransactionAudit` if `shouldShowAuditForCategory` is true.
  - Keep existing “canonical transaction” exclusions and `TransactionAudit`’s internal type filtering as safety rails.

### 5) Gate audit-related badges in `TransactionsList` by category attribute
Update `src/pages/TransactionsList.tsx`:

- Resolve `isTrackedCategory(transaction)` using the loaded budget categories:
  - `transaction.categoryId` → category lookup → metadata flag
- Only show:
  - **Needs Review** and **Missing Items**
  - when `isTrackedCategory(transaction) === true`

### 6) Avoid completeness fetches for untracked categories (perf + correctness)
Update the “load completeness metrics” effect in `src/pages/TransactionsList.tsx`:

- Today:
  - fetch completeness for `transactions.filter(t => t.needsReview === undefined)`
- Change to:
  - fetch completeness only for `needsReview === undefined && isTrackedCategory(t) === true`

This prevents “Missing Items” work and UI from activating for categories where item tracking is intentionally disabled.

### 7) Optional: align persisted `needs_review` with the category attribute
If we want `needs_review` to truly mean “audit-needed” (and avoid churn on untracked categories):

- Update `transactionService._recomputeNeedsReview` (`src/services/inventoryService.ts`) to:
  - Resolve the transaction’s `category_id` and then its category’s `requires_item_tracking`.
  - If category is **not tracked**, persist `needs_review = false` and return early.
  - If category **is tracked**, keep current behavior (compute completeness and persist).

Notes:
- This is optional because the UI gating alone achieves the primary UX goal.
- But it reduces background updates (especially offline queue writes) for non-tracked categories.

## Tests Plan (repo-grounded)

### `BudgetCategoriesManager` toggle behavior
- File: `src/components/__tests__/BudgetCategoriesManager.test.tsx`
- Add/extend tests to cover:
  - Category with `metadata.requires_item_tracking=true` renders checked.
  - Toggle updates call `budgetCategoriesService.updateCategory` with merged metadata.

### `TransactionsList` badge gating + completeness fetch gating
- File: `src/pages/__tests__/TransactionsList.test.tsx`
- Update `budgetCategoriesService.getCategories` mock to return tracked + untracked categories.
- Add tests:
  - **Tracked** category + `needsReview: true` → shows “Needs Review”.
  - **Untracked** category + `needsReview: true` → does not show audit badge.
  - **Untracked** category + `needsReview: undefined` → does not call completeness fetch (if mocked).

### `TransactionAudit` tests
- File: `src/components/ui/__tests__/TransactionAudit.test.tsx`
- No direct changes needed if gating is done in `TransactionDetail`.
- Only update if we introduce a new explicit `enabled`/`shouldShow` prop.

## Rollout / Defaults
- Absent flag defaults to **false** (audit opt-in per category).
- Optional: enable the flag for specific default categories during default seeding if desired (e.g. in `budgetCategoriesService.ensureDefaultBudgetCategories`).

