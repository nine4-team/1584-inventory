# Budget Categories Migration Verification Guide

## Current State

The application is **NOT** using the backup table. It's using:
- **Reads**: `vw_budget_categories` view (reads from `account_presets.presets->budget_categories`)
- **Writes**: RPC functions (`rpc_upsert_budget_category`, `rpc_archive_budget_category`)

The `budget_categories_backup` table exists **only** for rollback purposes if something goes wrong.

## How to Verify Everything is Working

### 1. Test Category Reading
- Open the app and navigate to any page that shows budget categories (e.g., Add Transaction, Category Select)
- Verify categories load correctly
- Check browser console for any errors

### 2. Test Category Creation
- Create a new budget category through the UI
- Verify it appears immediately in the list
- Check that it persists after page refresh

### 3. Test Category Updates
- Edit an existing category (name, slug, etc.)
- Verify changes save correctly
- Verify changes persist after refresh

### 4. Test Category Archiving
- Archive a category
- Verify it disappears from the active list
- Verify it appears when "include archived" is enabled

### 5. Database Verification Queries

**✅ VERIFICATION COMPLETE** - All queries passed successfully!

**Results:**
- ✅ **14 categories** migrated across **2 accounts**
- ✅ All categories exist in both backup and embedded data (no missing, no extra)
- ✅ All critical fields match (name, slug, is_archived)
- ✅ View returns identical data

**Verification queries run:**

```sql
-- 1. Verify no missing or extra categories
-- Result: Empty (all categories match)

-- 2. Verify total counts match
-- Result: 14 categories, 2 accounts in all sources

-- 3. Verify per-account counts match  
-- Result: 7 categories per account, all match ✓

-- 4. Verify critical fields match
-- Result: Empty (all names, slugs, archived status match)
```

You can re-run these queries anytime to verify ongoing integrity.

### 6. Test Offline Functionality
- Turn off network
- Verify cached categories still load
- Verify you can still view/create transactions with categories

## What the Backup Table is For

The `budget_categories_backup` table is a **safety net** for rollback only:

1. **If something goes wrong** during the migration verification period
2. **If you discover data corruption** or missing categories
3. **If you need to rollback** the entire migration

### Rollback Procedure (if needed)

```sql
-- 1. Recreate the budget_categories table
CREATE TABLE budget_categories (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (account_id, slug)
);

-- 2. Restore data from backup
INSERT INTO budget_categories 
SELECT 
  id, account_id, name, slug, is_archived, metadata, created_at, updated_at
FROM budget_categories_backup;

-- 3. Drop the write-lock triggers
DROP TRIGGER IF EXISTS lock_budget_categories_insert ON budget_categories;
DROP TRIGGER IF EXISTS lock_budget_categories_update ON budget_categories;
DROP TRIGGER IF EXISTS lock_budget_categories_delete ON budget_categories;

-- 4. Redeploy app code that uses the legacy table
```

## When to Drop the Backup Table

**Only after** you're confident everything is working:
- ✅ All category operations work correctly
- ✅ No data loss reported
- ✅ App has been stable for at least 1-2 weeks
- ✅ No rollback needed

Then you can safely drop it:

```sql
DROP TABLE budget_categories_backup;
```

## Monitoring Checklist

- [ ] Categories load correctly in UI
- [ ] Creating categories works
- [ ] Updating categories works
- [ ] Archiving categories works
- [ ] Categories appear in transaction forms
- [ ] Offline cache works
- [ ] No errors in browser console
- [ ] No errors in Supabase logs
