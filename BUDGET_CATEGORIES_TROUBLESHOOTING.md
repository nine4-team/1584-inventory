# Budget Categories Not Displaying - Troubleshooting Guide

## Issue Description
Budget categories are not showing up in the UI despite existing in the database. The UI shows "No categories available" or loading states without errors.

## Timeline
- **Working**: Categories were displaying correctly
- **Broke**: Approximately 10 minutes ago, after recent migration
- **Symptoms**: No visible errors, categories simply not displayed

## Recent Changes That May Have Caused This

### Migration: 20250105_consolidate_business_name_into_name.sql
- Consolidated `business_name` column into `name` column in accounts table
- Updated business profile service to use `name` field instead of `business_name`

### Code Changes in Commit 6629e8d ("updated budget categories etc.")
- Modified `supabase.ts` to add account validation in `createOrUpdateUserDocument`
- Added account existence check that sets `accountId = null` if account doesn't exist
- Modified `businessProfileService.ts` to use `name` instead of `business_name`

## Potential Root Causes (Prioritized)

### 1. Account Context Issues
**Hypothesis**: The AccountContext is not providing the correct `currentAccountId`

**Evidence Needed**:
- What account ID is the user currently associated with?
- Is the account ID valid and exists in the database?
- Did the account validation in `supabase.ts` set `accountId = null`?

**Investigation Steps**:
```typescript
// In browser console or add temporary logging
console.log('Current account ID:', currentAccountId)
console.log('Account loading:', loading)
console.log('Current account:', currentAccount)
```

### 2. Authentication Issues
**Hypothesis**: User session is invalid, causing `ensureAuthenticatedForDatabase()` to fail

**Evidence Needed**:
- Is the user properly authenticated?
- Does `supabase.auth.getSession()` return a valid session?
- Are there any authentication errors in browser console?

### 3. RLS (Row Level Security) Blocking Access
**Hypothesis**: The `can_access_account(account_id)` function returns false

**Evidence Needed**:
- Is the user a system owner? (`is_system_owner()`)
- Does the user have a record in `users` table with matching `account_id`?
- Check: `SELECT can_access_account('actual-account-id-here')`

**Database Query**:
```sql
-- Check user's account association
SELECT id, account_id FROM users WHERE id = 'current-user-id';

-- Check if user can access the account
SELECT can_access_account('account-id-here');

-- Check if user is system owner
SELECT is_system_owner();
```

### 4. Database View Issues
**Hypothesis**: The `vw_budget_categories` view is not returning data correctly

**Evidence Needed**:
- Does the view return data for the account?
- Are the JSONB fields being parsed correctly?

**Database Query**:
```sql
-- Check if view returns data
SELECT * FROM vw_budget_categories WHERE account_id = 'account-id-here';

-- Check source data
SELECT account_id, presets->'budget_categories' as categories
FROM account_presets
WHERE account_id = 'account-id-here';
```

### 5. Network Status Detection Issues
**Hypothesis**: App incorrectly detects as offline, blocking category loading

**Evidence Needed**:
- What does the network status service report?
- Is the `/ping.json` endpoint accessible?
- Does Supabase connectivity check pass?

### 6. Offline Cache Issues
**Hypothesis**: App is offline and caches are empty, but user expects online behavior

**Evidence Needed**:
- Is the app actually online?
- Are IndexedDB caches populated?
- Check browser DevTools > Application > IndexedDB

### 7. Component Logic Issues
**Hypothesis**: CategorySelect component logic has bugs

**Evidence Needed**:
- What path does the component take in its useEffect?
- Are the service calls being made?
- Check browser network tab for API calls

## Diagnostic Checklist

### Browser Console Investigation
```javascript
// Check React DevTools or add these logs temporarily

// 1. Account Context
console.log('AccountContext:', {
  currentAccountId,
  currentAccount,
  loading,
  isOwner: user?.role === 'owner'
});

// 2. Network Status
console.log('Network Status:', {
  isOnline,
  isSlowConnection,
  lastOnline,
  connectionType
});

// 3. Offline Prerequisites
console.log('Offline Prerequisites:', {
  isReady,
  status,
  blockingReason,
  budgetCategories,
  taxPresets,
  vendorDefaults
});

// 4. Service Call Results
// Add logging to budgetCategoriesService.getCategories
console.log('Service called with:', { accountId, includeArchived, options });
console.log('Service returned:', categories);
```

### Database Investigation
```sql
-- 1. Check user account association
SELECT u.id, u.account_id, a.name as account_name
FROM users u
LEFT JOIN accounts a ON u.account_id = a.id
WHERE u.id = 'current-user-id';

-- 2. Check account exists
SELECT id, name FROM accounts WHERE id = 'account-id';

-- 3. Check budget categories exist
SELECT account_id, jsonb_array_length(presets->'budget_categories') as category_count
FROM account_presets
WHERE account_id = 'account-id';

-- 4. Check view works
SELECT count(*) FROM vw_budget_categories WHERE account_id = 'account-id';

-- 5. Check RLS policies
SELECT schemaname, tablename, cmd, qual
FROM pg_policies
WHERE tablename IN ('accounts', 'account_presets', 'vw_budget_categories');
```

### Component Testing
```typescript
// Test CategorySelect directly
// Temporarily modify to bypass offline checks
const TestCategorySelect = () => {
  const { currentAccountId } = useAccount()
  const [categories, setCategories] = useState([])

  useEffect(() => {
    if (currentAccountId) {
      budgetCategoriesService.getCategories(currentAccountId, false)
        .then(setCategories)
        .catch(console.error)
    }
  }, [currentAccountId])

  return <div>Categories: {JSON.stringify(categories)}</div>
}
```

## Immediate Fixes to Try

### 1. Clear Offline Caches
```javascript
// In browser console
if ('caches' in window) {
  caches.keys().then(names => {
    names.forEach(name => caches.delete(name))
  })
}

// Clear IndexedDB
indexedDB.deleteDatabase('ledger-offline-store')
```

### 2. Force Online Mode
```javascript
// Temporarily modify network status
localStorage.setItem('force-online', 'true')
window.location.reload()
```

### 3. Check Authentication
```javascript
// In browser console
supabase.auth.getSession().then(({ data }) => console.log('Session:', data))
```

## Most Likely Culprits (Based on Timeline)

1. **Account validation in supabase.ts** - The new account existence check may be failing
2. **Business profile consolidation** - The migration may have corrupted account data
3. **Authentication session expiry** - User may need to re-authenticate
4. **RLS policy changes** - Recent changes may have affected access permissions

## Next Steps

1. **Immediate**: Add comprehensive logging to CategorySelect component
2. **Check**: User's account association in database
3. **Verify**: Authentication status
4. **Test**: Direct database queries vs view queries
5. **Confirm**: Network status detection is working

## Prevention

- Add more robust error handling and user feedback
- Implement better offline/online state management
- Add telemetry to track when categories fail to load
- Create automated tests for the critical path

## Files to Monitor
- `src/components/CategorySelect.tsx`
- `src/services/budgetCategoriesService.ts`
- `src/contexts/AccountContext.tsx`
- `supabase/migrations/20250105_consolidate_business_name_into_name.sql`
- `src/services/supabase.ts` (createOrUpdateUserDocument function)