# Phase 5: UI Resilience & Testing - Manual QA Checklist

This checklist covers manual testing scenarios for Phase 5 of the offline system normalization.

## Prerequisites

Before starting QA, ensure:
- [ ] All automated tests pass (`npm test`)
- [ ] Application builds successfully (`npm run build`)
- [ ] Service worker is registered and active
- [ ] IndexedDB is accessible in browser DevTools

## Test Environment Setup

1. Open browser DevTools → Application → Storage → IndexedDB
2. Note current database state (take screenshots if needed)
3. Open Network tab and set throttling to "Offline" when needed
4. Have multiple browser tabs/devices available for conflict testing

---

## 1. Offline Prerequisites Integration

### 1.1 TransactionItemForm - Prerequisite Banners

**Test:** Form shows inline banner when metadata caches are cold

**Steps:**
1. Clear IndexedDB budget categories and tax presets caches
2. Go offline (Network tab → Offline)
3. Navigate to a transaction form with items
4. Open TransactionItemForm

**Expected:**
- [ ] Red inline banner appears with message about missing prerequisites
- [ ] Banner includes "Retry sync" button
- [ ] Submit button is disabled
- [ ] Banner message is clear and actionable

**Test:** Form allows submission when caches are warm

**Steps:**
1. Go online
2. Wait for metadata caches to hydrate (check console logs)
3. Go offline
4. Navigate to TransactionItemForm

**Expected:**
- [ ] No banner displayed
- [ ] Submit button is enabled
- [ ] Form can be submitted successfully

**Test:** Retry sync button triggers metadata hydration

**Steps:**
1. Clear metadata caches
2. Go offline
3. Open TransactionItemForm (should show banner)
4. Go online
5. Click "Retry sync" button in banner

**Expected:**
- [ ] Button shows loading state
- [ ] Metadata caches are hydrated (check console logs)
- [ ] Banner disappears after hydration completes
- [ ] Submit button becomes enabled

### 1.2 ProjectForm - Prerequisite Banners

**Test:** Form shows inline banner when metadata caches are cold

**Steps:**
1. Clear IndexedDB budget categories cache
2. Go offline
3. Navigate to create/edit project form

**Expected:**
- [ ] Red inline banner appears with message about missing prerequisites
- [ ] Banner includes "Retry sync" button
- [ ] Submit button is disabled

**Test:** Form allows submission when caches are warm

**Steps:**
1. Go online
2. Wait for metadata caches to hydrate
3. Go offline
4. Navigate to project form

**Expected:**
- [ ] No banner displayed
- [ ] Submit button is enabled
- [ ] Form can be submitted successfully

---

## 2. Offline Transaction CRUD

### 2.1 Create Transaction Offline

**Test:** Create transaction with warm caches

**Steps:**
1. Ensure metadata caches are warm (go online briefly, then offline)
2. Go offline
3. Create a new transaction
4. Fill in all required fields
5. Submit form

**Expected:**
- [ ] Transaction is created immediately (no network error)
- [ ] Transaction appears in transaction list
- [ ] Transaction has optimistic ID (starts with `T-`)
- [ ] Operation is queued (check SyncStatus component)

**Test:** Create transaction with child items

**Steps:**
1. Go offline with warm caches
2. Create transaction
3. Add 2-3 items to the transaction
4. Submit

**Expected:**
- [ ] Transaction is created
- [ ] All items are created with optimistic IDs
- [ ] Items are linked to transaction via optimistic transaction ID
- [ ] All operations are queued

**Test:** Create transaction with cold caches (should fail gracefully)

**Steps:**
1. Clear metadata caches
2. Go offline
3. Try to create transaction with category/tax preset

**Expected:**
- [ ] Form shows prerequisite banner
- [ ] Submit button is disabled
- [ ] Error message explains what's missing
- [ ] No transaction is created

### 2.2 Edit Transaction Offline

**Test:** Edit existing transaction

**Steps:**
1. Go offline
2. Open existing transaction
3. Modify amount or other fields
4. Save changes

**Expected:**
- [ ] Changes are saved immediately
- [ ] Updated transaction appears in list
- [ ] Update operation is queued
- [ ] No "entity not found" errors

**Test:** Edit transaction with optimistic ID

**Steps:**
1. Create transaction offline (gets optimistic ID)
2. Immediately edit that transaction
3. Save changes

**Expected:**
- [ ] Transaction can be edited
- [ ] Changes persist
- [ ] Both create and update operations are queued

### 2.3 Delete Transaction Offline

**Test:** Delete transaction

**Steps:**
1. Go offline
2. Delete an existing transaction
3. Confirm deletion

**Expected:**
- [ ] Transaction is removed from UI immediately
- [ ] Delete operation is queued
- [ ] Transaction does not reappear after refresh (while offline)

---

## 3. Offline Project CRUD

### 3.1 Create Project Offline

**Test:** Create project with warm caches

**Steps:**
1. Ensure metadata caches are warm
2. Go offline
3. Create new project
4. Fill in name, client, budget categories
5. Submit

**Expected:**
- [ ] Project is created immediately
- [ ] Project appears in project list
- [ ] Project has optimistic ID (starts with `P-`)
- [ ] Operation is queued

**Test:** Create project with budget categories

**Steps:**
1. Go offline with warm caches
2. Create project
3. Set budget amounts for multiple categories
4. Submit

**Expected:**
- [ ] Project is created with all budget categories
- [ ] Total budget is calculated correctly
- [ ] Budget categories persist

### 3.2 Edit Project Offline

**Test:** Edit existing project

**Steps:**
1. Go offline
2. Open existing project
3. Modify name, budget, or other fields
4. Save changes

**Expected:**
- [ ] Changes are saved immediately
- [ ] Updated project appears in list
- [ ] Update operation is queued

### 3.3 Delete Project Offline

**Test:** Delete project

**Steps:**
1. Go offline
2. Delete an existing project
3. Confirm deletion

**Expected:**
- [ ] Project is removed from UI immediately
- [ ] Delete operation is queued
- [ ] Project does not reappear after refresh (while offline)

---

## 4. Sync Replay

### 4.1 Queue Processing

**Test:** Operations sync when coming back online

**Steps:**
1. Go offline
2. Create transaction, edit project, delete item
3. Go online
4. Wait for sync to complete (check SyncStatus)

**Expected:**
- [ ] All operations are processed
- [ ] Optimistic IDs are replaced with real IDs
- [ ] Entities update in UI with real IDs
- [ ] No duplicate entities
- [ ] Queue is cleared after successful sync

**Test:** Child items sync after parent transaction

**Steps:**
1. Go offline
2. Create transaction with 2 items
3. Go online
4. Wait for sync

**Expected:**
- [ ] Transaction syncs first
- [ ] Child items sync after transaction gets real ID
- [ ] Items are linked to transaction with real transaction ID
- [ ] No orphaned items

### 4.2 Sync Failure Handling

**Test:** Partial sync failure

**Steps:**
1. Go offline
2. Create multiple transactions
3. Go online
4. Simulate network error (throttle network or disconnect mid-sync)
5. Reconnect

**Expected:**
- [ ] Successfully synced operations are removed from queue
- [ ] Failed operations remain in queue
- [ ] Retry sync button is available
- [ ] No data loss

---

## 5. Conflict Resolution

### 5.1 Transaction Conflicts

**Test:** Detect transaction conflicts

**Steps:**
1. Open transaction in Tab A
2. Edit same transaction in Tab B (offline)
3. Save in Tab B
4. Go online in Tab A
5. Try to sync Tab B

**Expected:**
- [ ] Conflict is detected
- [ ] Conflict banner appears
- [ ] Conflict shows which fields differ
- [ ] User can resolve conflict (choose local or server version)

**Test:** Resolve transaction conflict

**Steps:**
1. Create conflict scenario (as above)
2. Open conflict resolution view
3. Choose to keep local version
4. Save resolution

**Expected:**
- [ ] Conflict is resolved
- [ ] Transaction updates with chosen version
- [ ] Conflict banner disappears
- [ ] No duplicate transactions

### 5.2 Project Conflicts

**Test:** Detect project conflicts

**Steps:**
1. Open project in Tab A
2. Edit same project in Tab B (offline)
3. Save in Tab B
4. Go online in Tab A
5. Try to sync Tab B

**Expected:**
- [ ] Conflict is detected
- [ ] Conflict shows field differences (name, budget, etc.)
- [ ] User can resolve conflict

---

## 6. Cache Hydration

### 6.1 Detail Page Hydration

**Test:** Transaction detail page shows optimistic entity

**Steps:**
1. Go offline
2. Create transaction (gets optimistic ID)
3. Navigate to transaction detail page using optimistic ID

**Expected:**
- [ ] Page loads without "not found" error
- [ ] Transaction data is displayed correctly
- [ ] All fields are visible
- [ ] Can edit the transaction

**Test:** Project detail page shows optimistic entity

**Steps:**
1. Go offline
2. Create project (gets optimistic ID)
3. Navigate to project detail page using optimistic ID

**Expected:**
- [ ] Page loads without "not found" error
- [ ] Project data is displayed correctly
- [ ] Budget categories are visible
- [ ] Can edit the project

### 6.2 List Page Hydration

**Test:** Transaction list shows optimistic entities

**Steps:**
1. Go offline
2. Create multiple transactions
3. Navigate to transaction list

**Expected:**
- [ ] All transactions appear in list
- [ ] Optimistic transactions are clearly marked (optional)
- [ ] Can click through to detail pages
- [ ] List updates immediately after creating new transaction

**Test:** Project list shows optimistic entities

**Steps:**
1. Go offline
2. Create multiple projects
3. Navigate to project list

**Expected:**
- [ ] All projects appear in list
- [ ] Can click through to detail pages
- [ ] List updates immediately after creating new project

---

## 7. IndexedDB Quota Exhaustion

### 7.1 Storage Quota Handling

**Test:** Handle quota exceeded error

**Steps:**
1. Fill IndexedDB with test data (or simulate quota error)
2. Try to create transaction offline

**Expected:**
- [ ] Error message is shown to user
- [ ] Error explains storage issue
- [ ] Suggests freeing space or going online
- [ ] No partial data is saved

**Test:** Graceful degradation

**Steps:**
1. Simulate quota exceeded
2. Try various offline operations

**Expected:**
- [ ] Operations fail gracefully
- [ ] Error messages are user-friendly
- [ ] App does not crash
- [ ] Can retry after freeing space

---

## 8. Multi-Device Scenarios

### 8.1 Cross-Device Sync

**Test:** Sync across devices

**Steps:**
1. Create transaction on Device A (offline)
2. Create different transaction on Device B (offline)
3. Go online on both devices
4. Wait for sync

**Expected:**
- [ ] Both transactions appear on both devices
- [ ] No conflicts (different transactions)
- [ ] IDs are consistent across devices
- [ ] Data is synchronized correctly

### 8.2 Cross-Device Conflicts

**Test:** Resolve conflicts across devices

**Steps:**
1. Edit same transaction on Device A and Device B (both offline)
2. Go online on both devices
3. Wait for sync

**Expected:**
- [ ] Conflicts are detected on both devices
- [ ] Conflict resolution works correctly
- [ ] Final state is consistent across devices

---

## 9. Edge Cases

### 9.1 Rapid Online/Offline Toggling

**Test:** Rapid connectivity changes

**Steps:**
1. Toggle network on/off rapidly (5-10 times)
2. Create/edit entities during toggling

**Expected:**
- [ ] App handles connectivity changes gracefully
- [ ] No duplicate operations
- [ ] Operations queue correctly
- [ ] Sync resumes when stable connection returns

### 9.2 Large Data Sets

**Test:** Handle large offline operations

**Steps:**
1. Go offline
2. Create transaction with 20+ items
3. Create multiple projects with many budget categories
4. Go online and sync

**Expected:**
- [ ] All operations complete successfully
- [ ] No performance degradation
- [ ] UI remains responsive
- [ ] No memory leaks

### 9.3 Browser Refresh

**Test:** Persist queue across refresh

**Steps:**
1. Go offline
2. Create transaction
3. Refresh browser
4. Go online

**Expected:**
- [ ] Queue persists after refresh
- [ ] Operations sync after refresh
- [ ] No data loss
- [ ] Optimistic entities remain accessible

---

## 10. Telemetry & Logging

### 10.1 Console Logging

**Test:** Verify structured logging

**Steps:**
1. Open browser console
2. Perform offline operations
3. Check console logs

**Expected:**
- [ ] Logs include operation IDs
- [ ] Logs include account/project IDs
- [ ] Error logs are detailed
- [ ] Success logs confirm operations

### 10.2 Telemetry Events

**Test:** Verify telemetry events

**Steps:**
1. Open browser console
2. Clear metadata caches
3. Go offline
4. Open form (should trigger cache cold event)
5. Go online and hydrate (should trigger cache warm event)

**Expected:**
- [ ] `offlineMetadataCacheCold` event fires
- [ ] `offlineMetadataCacheWarm` event fires
- [ ] `offlineMetadataValidationBlocked` event fires when blocked
- [ ] Events include relevant metadata

---

## Sign-Off

**Tester Name:** _________________________

**Date:** _________________________

**Overall Status:**
- [ ] All tests passed
- [ ] Critical issues found (list below)
- [ ] Minor issues found (list below)

**Issues Found:**

1. 
2. 
3. 

**Notes:**

_________________________________________________
_________________________________________________
_________________________________________________
