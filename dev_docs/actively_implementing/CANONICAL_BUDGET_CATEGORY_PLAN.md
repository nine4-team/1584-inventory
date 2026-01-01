## Canonical Inventory Budget Category Plan

### Background
- Canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`) are system-generated rows that reflect inventory allocation and returns.
- These rows currently populate the legacy `budget_category` text column with the literal string `Furnishings`, but **do not** set `category_id`.
- Budget reporting (`BudgetProgress`) only uses `categoryId` to associate spend with the project’s configured budgets. As a result, canonical sales count toward the overall “spent” number but are invisible in the Furnishings category (or whichever category the account intends to use for inventory flows).
- Projects can already specify a default budget category via the account-level presets (`account_presets.default_category_id`). Most teams configure this to their Furnishings-equivalent bucket.

### Goals
1. Ensure canonical transactions automatically map to a deterministic budget category so category-level spend stays accurate.
2. Avoid adding new user-facing configuration steps whenever possible.
3. Keep the budget UI consistent: the collapsed/preview views should highlight the single most relevant category (likely the default) or fall back to the overall budget when no category exists.

### Proposed Changes

#### 1. Service Layer: Assign `category_id` on canonical rows
- When `inventoryService` creates or updates canonical transactions:
  - Lookup the account’s default budget category ID via `accountPresetsService.getDefaultBudgetCategory(accountId)`.
  - If present, set `category_id` on the transaction payload (`supabase.from('transactions').insert/update`).
  - Keep the legacy `budget_category` string for backward compatibility, but treat `category_id` as source of truth.
- Fallback order if no default is configured:
  1. Use the project’s `defaultCategoryId` if set.
  2. Leave `category_id` null (current behavior) and let the UI treat the row as uncategorized.
- When canonical transactions are recomputed (e.g., items added/removed), make sure the same lookup logic runs so `category_id` is retained.

#### 2. UI: Budget progress defaults
- `BudgetProgress` already toggles between “show Furnishings only” vs “show all categories.” Update the “collapsed” view logic to:
  - Prefer the account default category ID (if provided by the project data) when picking the single category to display.
  - If no default is available or the default’s budget is zero, fall back to the first category that has a budget or any spend.
  - If no categories qualify, display the “Overall Budget” aggregate instead of leaving the section empty.
- This keeps the UI aligned with whatever category the account owner picked over time, even if the label is no longer literally “Furnishings.”

#### 3. Optional alternative: Dedicated canonical category
- If we later decide the default category approach is too implicit, we can introduce a dedicated account-level preset (e.g., `canonicalInventoryCategoryId`).
  - Pros: Eliminates ambiguity if teams want canonical flows separated from Furnishings.
  - Cons: Adds another configuration step and migration path (need to prompt users to select/confirm a category).
  - Recommendation: start with the default category approach and only add a dedicated field if feedback shows it is necessary.

### Migration & Backfill
1. **Forward writes:** Implement the service-layer change so all new canonical transactions populate `category_id`.
2. **Backfill script (optional but recommended):**
   - For each account, fetch canonical transactions missing `category_id`.
   - Assign the default budget category if available; otherwise leave null.
   - Record metrics on how many rows remained null to inform future decisions.

### Open Questions / Decisions Needed
- Should the default budget category be required during onboarding for accounts that use inventory flows? (Currently optional.)
- Do we need an admin UI affordance to highlight which category is acting as the canonical default?
- Should BudgetProgress visibly label the highlighted category as “Default Category” or keep the existing naming?

### Next Steps
1. Implement the service-layer updates (`inventoryService` canonical creation/update helpers).
2. Adjust `BudgetProgress` (and any preview components) to prefer the default category when selecting the collapsed view row.
3. (Optional) Write a one-off migration/backfill to populate `category_id` for existing canonical transactions.
4. Monitor user feedback; if teams request more explicit control, revisit the dedicated-category configuration idea.
