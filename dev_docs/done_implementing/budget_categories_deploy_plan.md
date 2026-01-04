# Budget Categories Feature - Deploy Plan & Smoke Checklist

## Overview
This document outlines the deployment plan and smoke tests for the budget categories feature (Chunk 8). The feature implements account-scoped budget categories with CRUD operations, transaction categorization, and budget progress tracking.

## Pre-Deployment Checklist

### Code Review
- [ ] All unit tests pass (`npm test`)
- [ ] All integration tests pass
- [ ] Code review completed and approved
- [ ] No linting errors (`npm run lint`)
- [ ] Type checking passes (`npm run type-check`)

### Database Migrations
- [ ] Migration `017_create_budget_categories.sql` reviewed and tested
- [ ] Migration `018_add_transaction_category_id.sql` reviewed and tested
- [ ] Migration `019_seed_budget_category_defaults.sql` reviewed (optional)
- [ ] Migrations tested on staging database
- [ ] Rollback plan documented

### Backend Verification
- [ ] `budgetCategoriesService` implements all CRUD operations
- [ ] Account scoping enforced in all service methods
- [ ] Archive functionality prevents deletion of referenced categories
- [ ] Transaction service validates `category_id` belongs to account
- [ ] Error handling tested and working

### Frontend Verification
- [ ] `BudgetCategoriesManager` component renders and functions correctly
- [ ] `CategorySelect` component loads categories and handles selection
- [ ] `ProjectForm` includes category selection
- [ ] Transaction forms require category selection
- [ ] Budget progress components use category data correctly

## Deployment Steps

### 1. Database Migration (Production)
```bash
# Run migrations in order
supabase migration up --db-url $PRODUCTION_DB_URL
# Or apply via Supabase dashboard:
# 1. Apply 017_create_budget_categories.sql
# 2. Apply 018_add_transaction_category_id.sql
# 3. (Optional) Apply 019_seed_budget_category_defaults.sql
```

**Verification:**
- [ ] `budget_categories` table exists
- [ ] `transactions.category_id` column exists (nullable)
- [ ] Foreign key constraint exists: `transactions.category_id` → `budget_categories.id`
- [ ] Indexes created if specified in migrations

### 2. Backend Deployment
- [ ] Deploy backend code with new service and routes
- [ ] Verify environment variables are set correctly
- [ ] Check application logs for errors

**Verification:**
- [ ] API endpoints respond correctly
- [ ] Authentication/authorization working
- [ ] Account scoping enforced

### 3. Frontend Deployment
- [ ] Build frontend (`npm run build`)
- [ ] Deploy to hosting (Cloudflare Pages, Vercel, etc.)
- [ ] Verify build artifacts are correct

**Verification:**
- [ ] Frontend loads without errors
- [ ] No console errors in browser
- [ ] API calls succeed

## Post-Deployment Smoke Tests

### Test Environment Setup
1. Log in as an account admin/user
2. Navigate to Settings → Budget Categories
3. Verify account has at least one category (from seed or manual creation)

### Smoke Test Checklist

#### 1. Budget Categories Management (Settings)
- [ ] **View Categories**
  - Navigate to Settings → Budget Categories
  - Verify categories list displays correctly
  - Verify transaction counts show (if any transactions exist)

- [ ] **Create Category**
  - Click "Add Category"
  - Enter name: "Test Category"
  - Verify slug auto-generates: "test-category"
  - Click "Create"
  - Verify category appears in list
  - Verify success message displays

- [ ] **Edit Category**
  - Click "Edit" on an existing category
  - Change name to "Updated Category"
  - Click "Save"
  - Verify changes persist
  - Verify success message displays

- [ ] **Archive Category (No Transactions)**
  - Create a category with no transactions
  - Click "Archive"
  - Verify category moves to archived section
  - Verify success message displays

- [ ] **Archive Category (With Transactions)**
  - Attempt to archive a category that has transactions
  - Verify error message: "Cannot archive category: it is referenced by one or more transactions"
  - Verify archive button is disabled

- [ ] **Unarchive Category**
  - Click "Show Archived"
  - Click "Unarchive" on an archived category
  - Verify category returns to active list

- [ ] **Bulk Archive**
  - Select multiple categories (without transactions)
  - Click "Bulk Operations" → "Archive Selected"
  - Verify selected categories are archived
  - Verify success message displays

#### 2. Project Creation with Categories
- [ ] **Create Project with Default Category**
  - Navigate to Projects → Create Project
  - Fill in project name and client name
  - Select a default category from dropdown
  - Submit form
  - Verify project is created
  - Verify default category is saved

- [ ] **Edit Project Default Category**
  - Edit an existing project
  - Change default category
  - Save project
  - Verify default category updates

#### 3. Transaction Creation with Categories
- [ ] **Create Transaction (Required Category)**
  - Navigate to a project → Add Transaction
  - Fill in transaction details
  - Verify category field is required
  - Select a category from dropdown
  - Submit transaction
  - Verify transaction is created with `category_id`

- [ ] **Create Transaction (Validation)**
  - Attempt to submit transaction without category
  - Verify validation error: "Budget category is required"
  - Select category and resubmit
  - Verify transaction creates successfully

- [ ] **Edit Transaction Category**
  - Edit an existing transaction
  - Change category
  - Save transaction
  - Verify category updates

- [ ] **Cross-Account Category Prevention**
  - (If possible) Attempt to use category from different account
  - Verify validation prevents this
  - Verify error message displays

#### 4. Budget Progress Tracking
- [ ] **Budget Progress Display**
  - Navigate to a project with transactions
  - Verify budget progress component displays
  - Verify transactions are grouped by category
  - Verify category names display correctly (not IDs)

- [ ] **Budget Progress Calculations**
  - Create transactions with different categories
  - Verify spending is calculated per category
  - Verify totals are correct
  - Verify progress bars display correctly

#### 5. Category Scoping
- [ ] **Account Isolation**
  - Log in as different account
  - Verify only that account's categories are visible
  - Verify cannot access other account's categories

- [ ] **Category Selection in Forms**
  - Verify `CategorySelect` only shows current account's categories
  - Verify archived categories are hidden by default
  - Verify archived categories appear when `includeArchived` is true

#### 6. Error Handling
- [ ] **Network Errors**
  - Simulate network failure (disable network)
  - Attempt to create/edit category
  - Verify error message displays
  - Re-enable network and retry
  - Verify operation succeeds

- [ ] **Validation Errors**
  - Attempt to create category with empty name
  - Verify validation error displays
  - Attempt to archive category with transactions
  - Verify appropriate error message

## Rollback Plan

If critical issues are discovered:

1. **Frontend Rollback**
   - Revert to previous frontend deployment
   - Frontend will continue to work but won't use new category features

2. **Backend Rollback**
   - Revert backend code
   - API endpoints will return to previous behavior

3. **Database Rollback** (Only if necessary)
   ```sql
   -- Remove category_id column (if needed)
   ALTER TABLE transactions DROP COLUMN IF EXISTS category_id;
   
   -- Drop budget_categories table (if needed)
   DROP TABLE IF EXISTS budget_categories CASCADE;
   ```
   **Warning:** Only rollback database if absolutely necessary. This will lose all category data.

## Monitoring

### Post-Deployment Monitoring (First 24 Hours)
- [ ] Monitor error logs for category-related errors
- [ ] Monitor API response times
- [ ] Check database query performance
- [ ] Monitor user feedback/support tickets

### Key Metrics to Watch
- Error rate for category operations
- API response times for category endpoints
- Number of categories created per account
- Number of transactions with `category_id` set

## Success Criteria

The deployment is considered successful if:
- [ ] All smoke tests pass
- [ ] No critical errors in logs
- [ ] Users can create and manage categories
- [ ] Transactions can be created with categories
- [ ] Budget progress displays correctly
- [ ] Account scoping works correctly
- [ ] No performance degradation

## Known Limitations

1. **No Backfill**: Historical transactions will not have `category_id` set automatically. They can be assigned manually via admin UI.

2. **Legacy Field**: The `transactions.budget_category` string field remains but is not used by the new UI. It can be removed in a future release.

3. **Category Required**: New transactions require a category. Historical transactions without categories will need manual assignment.

## Next Steps (Post-Deployment)

1. **User Communication**
   - Notify users about new category feature
   - Provide documentation/help articles
   - Offer training if needed

2. **Data Migration (Optional)**
   - Create admin tool for bulk category assignment
   - Run one-time script to assign categories to historical transactions (if desired)

3. **Future Enhancements**
   - Consider making `category_id` NOT NULL after all transactions have categories
   - Remove legacy `budget_category` column in future release
   - Add category reporting/analytics features

## Support Contacts

- **Technical Lead**: [Name/Email]
- **Database Admin**: [Name/Email]
- **DevOps**: [Name/Email]

## Revision History

- **2024-XX-XX**: Initial deploy plan created for Chunk 8 implementation

