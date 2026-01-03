# Offline Edit Conflict Loop Fix

## Problem

After fixing item creation, a new issue emerged: **offline item edits were stuck in an infinite loop** where:
1. User edits an item offline → UPDATE_ITEM operation queued
2. Local cache updated optimistically with new values
3. When online, conflict detection runs and detects conflict (optimistic local vs old server)
4. UPDATE operation is **blocked** by the conflict
5. UPDATE can't execute to sync local changes to server
6. Conflict persists → operation retries → blocked again → **infinite loop**

### Symptoms
- Console flooded with: `Conflicts detected for queued operation, delaying execution`
- Background sync keeps triggering but operations never complete
- UI shows "Syncing changes..." indefinitely
- Operation ID `17f72324-c2d3-4608-8e3d-30f9ecb52825` (or similar) stuck in queue

## Root Cause

The `shouldBlockOperation` method was blocking **all** operations (including UPDATE_ITEM) when conflicts existed on the target item. This created a chicken-and-egg problem:

- **UPDATE_ITEM operations are meant to sync local changes to the server**, which resolves conflicts
- But they were being blocked by the very conflicts they were trying to resolve
- This prevented the sync from happening, so conflicts persisted forever

## Solution

### 1. Allow UPDATE_ITEM Operations to Proceed Despite Conflicts

**File:** `src/services/operationQueue.ts`

**Change:** Modified `shouldBlockOperation` to allow UPDATE_ITEM operations to proceed even when conflicts exist on the target item.

```typescript
// UPDATE_ITEM operations should NOT be blocked by conflicts on the target item
// because the UPDATE will sync the local state to the server, resolving the conflict
if (operation.type === 'UPDATE_ITEM') {
  return false
}
```

**Rationale:** UPDATE operations sync local optimistic changes to the server, which resolves conflicts. Blocking them creates an infinite loop.

### 2. Clear Conflicts After Successful UPDATE

**File:** `src/services/operationQueue.ts`

**Change:** After a successful UPDATE operation, clear any conflicts for that item since the sync resolved them.

```typescript
// Clear any conflicts for this item since the UPDATE successfully synced local state to server
if (accountId) {
  await offlineStore.deleteConflictsForItems(accountId, [data.id])
}
```

**Rationale:** Once the UPDATE syncs local state to server, the conflict is resolved. Clearing it prevents re-detection.

### 3. Remove Redundant Conflict Check

**File:** `src/services/operationQueue.ts`

**Change:** Removed duplicate conflict check after operation failure (conflicts are already checked before execution).

**Rationale:** Reduces overhead and prevents confusion. Conflict checking before execution is sufficient.

### 4. Enhanced Logging

**File:** `src/services/operationQueue.ts`

**Change:** Added detailed logging to help diagnose conflict resolution flow:
- Log when UPDATE proceeds despite conflicts
- Log when conflicts are cleared after successful UPDATE
- Include operation type, target item ID, and conflict details

## Expected Behavior After Fix

1. User edits item offline → UPDATE_ITEM queued, local cache updated optimistically
2. When online, conflict detection runs and detects conflict (optimistic local vs old server)
3. **UPDATE operation proceeds** (not blocked) ✅
4. UPDATE executes, syncs local state to server
5. Local cache updated with server response + `last_synced_at` timestamp
6. **Conflicts cleared** for the item ✅
7. Future conflict detection will skip this item (2-second grace period) or won't detect conflict (data matches)

## Testing

### Manual Test Steps
1. Go offline
2. Edit an existing item (change name, description, etc.)
3. Go online
4. Verify:
   - Operation queue processes successfully
   - No infinite loop in console
   - Item updates sync to server
   - No persistent "Conflicts detected" messages
   - UI shows "Synced" or "Saved" status

### Expected Console Output
```
UPDATE_ITEM proceeding despite conflicts - will resolve on sync {operationId: '...', targetItemId: '...'}
Cleared conflicts for item after successful UPDATE {itemId: '...'}
```

### What to Watch For
- ✅ Operations complete successfully
- ✅ No repeated "Conflicts detected" warnings
- ✅ Background sync completes without looping
- ✅ UI shows correct sync status

## Related Issues

- **Item Creation:** Fixed in `OFFLINE_ITEM_CREATION_REMEDIATION.md`
- **Conflict Detection:** May still detect conflicts, but UPDATE operations can now resolve them
- **Background Sync Loops:** Fixed in `OFFLINE_ITEM_CREATION_REMEDIATION.md` (cooldown + loop detection)

## Files Changed

- `src/services/operationQueue.ts`:
  - `shouldBlockOperation()`: Allow UPDATE_ITEM to proceed
  - `executeUpdateItem()`: Clear conflicts after success
  - `processQueue()`: Removed redundant conflict check
  - `executeOperation()`: Enhanced logging

## Status

✅ **FIXED** - 2026-01-06

The infinite loop should now be resolved. UPDATE operations can proceed to sync local changes and resolve conflicts automatically.
