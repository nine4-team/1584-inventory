# Business Inventory Transaction Fix Plan

## Problem
When a user adds an item inside a transaction in the **Business Inventory** context, the app freezes. This contrasts with the **Projects** context where the same action works correctly.

**Note:** This issue is intermittent. Sometimes the item creation works, and other times it causes the UI to freeze. This intermittency points to a **race condition** or state oscillation caused by the lack of a stable realtime "source of truth."

## Root Cause Analysis
The issue stems from structural differences in how `TransactionDetail` handles data synchronization and realtime updates when a `projectId` is missing (which is the case for Business Inventory transactions).

### 1. Missing Realtime Context
In `TransactionDetail.tsx`, the `useProjectRealtime` hook is initialized with `derivedRealtimeProjectId`.
- **Projects**: `derivedRealtimeProjectId` is a valid UUID. The hook subscribes to changes and triggers updates.
- **Business Inventory**: `derivedRealtimeProjectId` is `null`. The hook returns empty state and no-ops.
- **Consequence**: The `useEffect` that monitors `realtimeProjectItems` (lines 513-542) never fires for Business Inventory. If the UI relies on this effect to stabilize state after an optimistic update, it may get stuck or desynchronized.

### 2. Skipped Explicit Subscriptions
`TransactionDetail.tsx` has `useEffect` blocks (lines 1060, 1080) that set up explicit subscriptions for the transaction and its items.
- **Code**: `if (!resolvedProjectId) return`
- **Business Inventory**: `resolvedProjectId` is null/undefined.
- **Consequence**: No realtime listeners are attached. The view relies entirely on manual refreshes.

### 3. No-op `refreshRealtimeAfterWrite`
The `refreshRealtimeAfterWrite` callback (lines 144-150) is used after mutations (add/update item).
- **Code**: `if (!derivedRealtimeProjectId) return Promise.resolve()`
- **Business Inventory**: Returns immediately.
- **Consequence**: The broader context is never refreshed after a write. While `refreshTransactionItems` is called separately, the lack of a broader refresh (which usually confirms the write via a different path) might be leaving the component in an unstable state or causing a race condition with optimistic updates.

### 4. `TransactionAudit` Prop Issue
The `TransactionAudit` component is rendered with `projectId={projectId || transaction.projectId || ''}`.
- **Business Inventory**: Passes an empty string `''`.
- **Risk**: If `TransactionAudit` has internal logic that depends on a valid UUID or triggers effects when this prop changes/is empty, it could contribute to instability.

## Implementation Plan

### Step 1: Enable Realtime for Business Inventory
Modify `TransactionDetail.tsx` to support subscriptions without a `projectId`.

1.  **Update Transaction Subscription**:
    Change the `useEffect` at line 1060. If `resolvedProjectId` is missing, use `transactionService.subscribeToBusinessInventoryTransactions` (or a specific single-transaction subscriber that doesn't require project ID) instead of returning early.

2.  **Update Item Subscription**:
    Change the `useEffect` at line 1080. If `resolvedProjectId` is missing, subscribe to the account-wide items channel or a business-inventory specific channel using `unifiedItemsService`.

### Step 2: Fix `refreshRealtimeAfterWrite`
Update the callback to handle the Business Inventory case.

```typescript
const refreshRealtimeAfterWrite = useCallback(
  async (includeProject = false) => {
    if (derivedRealtimeProjectId) {
      return refreshRealtimeCollections(includeProject ? { includeProject: true } : undefined).catch(err => {
        console.debug('TransactionDetail: realtime refresh failed', err)
      })
    } else {
      // Business Inventory fallback
      // Trigger a refresh of the specific transaction and its items explicitly
      return refreshTransactionItems()
    }
  },
  [derivedRealtimeProjectId, refreshRealtimeCollections, refreshTransactionItems]
)
```

### Step 3: Verify `hydrateOptimisticItem`
Ensure `hydrateOptimisticItem` in `src/utils/hydrationHelpers.ts` correctly handles the `business-inventory` cache key. (Current analysis suggests it does, but verify it aligns with how `TransactionDetail` reads data).

### Step 4: Safety Checks
1.  **TransactionAudit**: Guard the render of `TransactionAudit` to ensure it doesn't render if `projectId` is missing, or update the component to handle empty strings gracefully without effects.
2.  **Infinite Loops**: The freeze suggests a `useEffect` dependency loop. Check `TransactionItemsList` for effects that depend on `items` or `projectId` that might cycle when `projectId` is undefined.

## Summary of Changes
| File | Change |
|------|--------|
| `src/pages/TransactionDetail.tsx` | Update `refreshRealtimeAfterWrite` to handle null `projectId`. |
| `src/pages/TransactionDetail.tsx` | Update subscription `useEffect` hooks to allow Business Inventory subscriptions. |
| `src/pages/TransactionDetail.tsx` | Guard `TransactionAudit` against empty `projectId`. |
