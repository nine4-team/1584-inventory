# Budget Categories Defaults & Overall Budget Fallback Plan

## Problem Statement

Budget progress bars are not showing because:
1. Accounts may not have default budget categories embedded in `account_presets.presets->budget_categories`
3. After migration to `account_presets`, accounts may have empty category arrays
4. Overall budget fallback logic exists but depends on categories existing

## Requirements

### Minimum Default Categories
Every account MUST have at least these categories:
- **Furnishings** (slug: `furnishings`)
- **Install** (slug: `install`)
- **Design Fee** (slug: `design-fee`)
- **Storage & Receiving** (slug: `storage-receiving`)

### Overall Budget Fallback
- When no category budgets are set, show overall budget progress bar
- Overall budget should use the `project.budget` prop if available
- Fallback should work even when categories don't exist or are empty

## Implementation Plan

### Phase 1: Database Migration – Seed Default Categories

**File**: `supabase/migrations/YYYYMMDD_seed_default_budget_categories_account_presets.sql`

**Purpose**: Ensure every existing account has at least the four default categories embedded in `account_presets.presets->budget_categories`.

**Approach**:
1. Iterate through all accounts.
2. Ensure an `account_presets` row exists for each account (create an empty row when missing).
3. If `budget_categories` is null or empty, call `rpc_upsert_budget_category` once per required slug:
   - Furnishings (`furnishings`)
   - Install (`install`)
   - Design Fee (`design-fee`)
   - Storage & Receiving (`storage-receiving`)
4. Skip categories that already exist by slug so the migration remains idempotent.

**Key Notes**:
- Always use the RPC so writes flow through the supported Supabase interface.
- Wrap the loop in a DO block with exception handling so one bad account does not abort the migration.
- With only three accounts, a simple sequential loop is sufficient; no batching needed.

### Phase 2: Service Layer – Seed Defaults for New Accounts

**Files**: `src/services/accountPresetsService.ts`, `src/services/budgetCategoriesService.ts`

**Purpose**: Make sure any newly created account immediately receives the four default categories so UI selectors and progress bars never see an empty list.

**Approach**:
1. Add `ensureDefaultBudgetCategories(accountId: string)` that:
   - Reads non-archived categories (from cache when offline, from Supabase when online).
   - If none exist, creates the four defaults via `budgetCategoriesService.createCategory`.
2. Call this helper:
   - Right after `accountPresetsService.upsertAccountPresets()` creates a row.
   - In any onboarding flow that provisions a brand-new account.
3. Keep the helper idempotent so repeated calls are harmless.
4. Log when defaults are created to simplify troubleshooting.

### Phase 3: Verification & Testing

**Database Verification Queries**:

```sql
-- 1. Check accounts missing default categories
SELECT 
  ap.account_id,
  a.name as account_name,
  jsonb_array_length(COALESCE(ap.presets->'budget_categories', '[]'::jsonb)) as category_count,
  CASE 
    WHEN ap.presets->'budget_categories' IS NULL THEN 'NULL'
    WHEN jsonb_array_length(ap.presets->'budget_categories') = 0 THEN 'EMPTY'
    ELSE 'HAS_CATEGORIES'
  END as status
FROM account_presets ap
JOIN accounts a ON a.id = ap.account_id
WHERE 
  ap.presets->'budget_categories' IS NULL 
  OR jsonb_array_length(COALESCE(ap.presets->'budget_categories', '[]'::jsonb)) = 0;

-- 2. Verify all accounts have required default categories
SELECT 
  ap.account_id,
  a.name as account_name,
  jsonb_agg(cat->>'name' ORDER BY cat->>'name') as category_names,
  jsonb_agg(cat->>'slug' ORDER BY cat->>'slug') as category_slugs
FROM account_presets ap
JOIN accounts a ON a.id = ap.account_id,
     jsonb_array_elements(ap.presets->'budget_categories') AS cat
WHERE (cat->>'is_archived')::boolean = false
GROUP BY ap.account_id, a.name
HAVING 
  NOT ('furnishings' = ANY(jsonb_agg(cat->>'slug'::text)))
  OR NOT ('install' = ANY(jsonb_agg(cat->>'slug'::text)))
  OR NOT ('design-fee' = ANY(jsonb_agg(cat->>'slug'::text)))
  OR NOT ('storage-receiving' = ANY(jsonb_agg(cat->>'slug'::text)));

-- 3. Test view returns data
SELECT 
  account_id,
  COUNT(*) as category_count,
  jsonb_agg(name ORDER BY name) as category_names
FROM vw_budget_categories
WHERE is_archived = false
GROUP BY account_id
ORDER BY account_id;
```

**Frontend Testing Checklist**:
- [ ] Existing account with no categories → defaults seeded after migration
- [ ] New account creation flow → defaults immediately available in selectors/progress bars
- [ ] Offline device that provisions a new account → helper does not thrash or fail

## Migration Execution Order

1. **Run Phase 1 migration** (seed defaults in account_presets)
2. **Verify with SQL queries** (all accounts have defaults)
3. **Deploy Phase 2 service changes** (ensure defaults on new accounts)
4. **Deploy Phase 3 frontend changes** (overall budget fallback)
5. **Test end-to-end** (create new account, verify defaults, verify progress bars)

## Rollback Plan

If issues arise:
1. **Phase 1**: Migration is idempotent, can re-run safely
2. **Phase 2**: Service changes are additive, can revert without data loss
3. **Phase 3**: Frontend changes are backward compatible, can revert easily

## Success Criteria

✅ All accounts have at least 4 default categories (Furnishings, Install, Design Fee, Storage & Receiving)
✅ New accounts automatically get default categories
✅ Budget progress bars show overall budget even when no category budgets are set
✅ Existing functionality (category budgets, design fee) continues to work
✅ No data loss or corruption

## Open Questions

1. Should we also seed the other categories from the old migration (Property Management, Kitchen, Fuel)?
   - **Recommendation**: No, stick to minimum 4. Users can add more via UI.

2. Should default categories be marked somehow (e.g., `metadata->is_default: true`)?
   - **Recommendation**: Yes, add metadata flag so we can identify system-created defaults vs user-created.

3. What happens if a user deletes all categories? Should we re-seed defaults?
   - **Recommendation**: No, respect user choice. Only seed on account creation or if completely empty during migration.

4. Should we set a default category (`account_presets.default_category_id`) to Furnishings?
   - **Recommendation**: Yes, set Furnishings as the default category for new accounts.

## Related Files

- `supabase/migrations/019_seed_budget_category_defaults.sql` (old seeding logic)
- `supabase/migrations/20250104_embed_budget_categories.sql` (embedding migration)
- `supabase/migrations/20250104_create_budget_category_rpc_functions.sql` (RPC functions)
- `src/services/budgetCategoriesService.ts` (service layer)
- `src/services/accountPresetsService.ts` (account presets service)
- `src/components/ui/BudgetProgress.tsx` (progress bar component)
- `src/components/CategorySelect.tsx` (category selection)
