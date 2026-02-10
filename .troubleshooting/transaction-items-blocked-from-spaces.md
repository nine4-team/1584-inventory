# Issue: Items tied to transactions blocked from being added to spaces

**Status:** Active
**Opened:** 2026-02-09
**Resolved:** _pending_

## Context
- **Symptom:** When attempting to add existing items to a space, the action is blocked if those items are already tied to a transaction. This is incorrect behavior — transaction membership should not affect space membership.
- **Affected area:** "Add existing items" flow for spaces
- **Severity:** Blocks user
- **Reproduction steps:**
  1. Create an item and add it to a transaction
  2. Try to add that same item to a space using the "add existing items" flow
  3. Action is blocked incorrectly
- **Environment:** Branch: supabase

## Research

### Found the blocking logic
**File:** [SpaceDetail.tsx:317-326](src/pages/SpaceDetail.tsx#L317-L326)

```tsx
const getExistingItemDisableState = useCallback((item: Item) => {
  const isOutsideItem = item.projectId !== projectId
  if (isOutsideItem && item.transactionId) {
    return {
      disabled: true,
      reason: 'This item is tied to a transaction; move the transaction instead.'
    }
  }
  return { disabled: false }
}, [projectId])
```

**Current behavior:**
- Items are disabled if they are from a **different project** AND have a **transactionId**
- Items from the **same project** with transactions are NOT blocked
- The reasoning: prevents moving items between projects that are tied to transactions

**Flow:**
1. User clicks "Add Existing Items" in SpaceDetail
2. ExistingItemsPicker is shown with `isItemDisabled={getExistingItemDisableState}`
3. The picker disables outside items with transactions and shows message
4. When items are added: `handleAddExistingItems` → `ensureItemInProjectForSpace` → `updateItem`

### Key files
- [SpaceDetail.tsx](src/pages/SpaceDetail.tsx) - Contains the blocking logic
- [ExistingItemsPicker.tsx](src/components/items/ExistingItemsPicker.tsx) - Renders items with disable states
- [itemPullInService.ts](src/services/itemPullInService.ts) - Handles cross-project item moves

## Investigation Log

### H1: The blocking logic is incorrectly applied to same-project items with transactions
- **Rationale:** The code at SpaceDetail.tsx:319 checks `isOutsideItem && item.transactionId`. If there's a bug where `isOutsideItem` evaluates to true for same-project items, it would incorrectly block them.
- **Experiment:** Verify the logic by checking if `item.projectId !== projectId` can be true for items within the same project. Also check if there's any state where projectId might be undefined or mismatched.
- **Evidence:** FOUND MULTIPLE TYPE/NORMALIZATION ISSUES:
  1. **Inconsistent null handling:** [inventoryService.ts:4307](src/services/inventoryService.ts#L4307) converts null→undefined for projectId, but line 4322 keeps null as null for spaceId
  2. **Missing normalization:** SpaceDetail doesn't normalize projectId, but ExistingItemsPicker does (line 107 calls normalizeProjectId)
  3. **Type mismatch in comparison:** item.projectId is `string|null|undefined`, projectId from URL is `string`, no null/undefined handling in comparison
  4. **Asymmetric data flow:** ExistingItemsPicker normalizes with `normalizeProjectId()`, but getExistingItemDisableState uses raw URL param
- **Verdict:** Confirmed - multiple potential causes for mismatch

### H2: There's additional blocking logic elsewhere (server-side, service layer, etc.)
- **Rationale:** Maybe the frontend `getExistingItemDisableState` isn't the only place blocking items. Could be server-side validation, RLS policies, or service layer validation.
- **Experiment:** Search for ALL validation that could block items with transactions from being added to spaces.
- **Evidence:** Comprehensive search found:
  - NO server-side validation blocking transactions from being added to spaces
  - NO validation in `handleAddExistingItems`, `ensureItemInProjectForSpace`, or `updateItem`
  - NO database constraints or RLS policies blocking space_id assignment based on transaction_id
  - The ONLY blocking logic is `getExistingItemDisableState` in SpaceDetail.tsx
- **Verdict:** Ruled Out - confirmed only one blocking location exists

### H3: The blocking only applies to cross-project items, but user expects it to work
- **Rationale:** The code blocks items from other projects that have transactions. User may be trying to add a cross-project item with a transaction and expecting it to work.
- **Experiment:** Clarify with user: Are you trying to add items from the same project or from a different project? What's the exact scenario?
- **Evidence:** User confirmed that cross-project items with transactions SHOULD remain blocked. The issue is with same-project items.
- **Verdict:** Ruled Out - user agrees cross-project blocking is correct behavior

## Conclusion

**Root cause: Incorrect UX - hard block instead of confirmation**

The investigation reveals:

1. **Original blocking logic was too strict:** Items with transactions were completely blocked from being added to spaces, even though the backend can handle the sale/purchase flow.

2. **User expectation:** Outside items with transactions SHOULD be allowed, but with a confirmation dialog explaining the implications (sale/purchase will occur).

3. **Backend supports this:** The `sellItemToProject` flow handles items with transactions without issue - it creates a sale transaction in the source project and purchase transaction in the target project.

**The solution:**
- Remove the hard block in `getExistingItemDisableState`
- Add confirmation dialog in `handleAddExistingItems` for outside items with transactions
- Dialog message: "This item is tied to a transaction in another project. Adding it to this space will require the project to purchase the item. A sale will be logged in the background. Are you sure you want to proceed?"
- If confirmed, proceed with normal sale/purchase flow via `ensureItemInProjectForSpace`

## ACTUAL ISSUE (from screenshot)

**The items show "0 available" even though 2 items exist in Outside tab.**

Items are being filtered out by `getSelectableItems()` which uses `isItemSelectable()` which checks `isItemDisabled()`.

The blocking happens in ExistingItemsPicker's selection logic, NOT just the add button.

## What to Fix

1. **ExistingItemsPicker.tsx line 155-157:** `getSelectableItems` filters items using `isItemSelectable`
2. **Find `isItemSelectable` function** - it likely calls the `isItemDisabled` prop
3. **The prop comes from SpaceDetail:** `isItemDisabled={getExistingItemDisableState}`
4. **Current blocking logic:** Returns `{disabled: true}` for outside items with transactions
5. **Desired behavior:** Don't filter them out. Instead show confirmation dialog when adding

## Action Items

- Change `isItemDisabled` logic to NOT return disabled for outside items with transactions
- Add confirmation in `handleAddExistingItems` before proceeding with sale/purchase
- Confirmation message: "This requires the project to buy the item. A sale will be logged in the background. Are you sure you want to proceed?"

## Files
- `/Users/benjaminmackenzie/Dev/ledger/src/components/items/ExistingItemsPicker.tsx` - Selection filtering logic
- `/Users/benjaminmackenzie/Dev/ledger/src/pages/SpaceDetail.tsx` - `getExistingItemDisableState` and `handleAddExistingItems`

## Code Changes Applied (Awaiting Verification)

**File:** `/Users/benjaminmackenzie/Dev/ledger/src/pages/SpaceDetail.tsx`

**Change 1 - `getExistingItemDisableState` (lines 344-348):**
- Removed blocking logic that returned `{disabled: true}` for outside items with transactions
- Now returns `{disabled: false}` for ALL items
- Items with transactions should now be selectable

**Change 2 - `handleAddExistingItems` confirmation (lines 317-328):**
- Added confirmation dialog for outside items with transactions before proceeding
- Message: "This requires the project to buy the item. A sale will be logged in the background. Are you sure you want to proceed?"

### H4: Code changes not reflected because user is testing on production
- **Rationale:** Console output shows `https://inventory.1584design.com`, which is the deployed production URL. Local file changes only take effect on the local dev server (localhost).
- **Experiment:** Added `console.log('[DEBUG] getExistingItemDisableState called...')` to the function. User restarted dev server and hard-refreshed but debug log never appeared in the console.
- **Evidence:** Console shows `blob:https://inventory.1584design.com/...` — confirms user is testing on production, not localhost.
- **Verdict:** Pending — waiting for user to confirm whether they're testing locally or on production.

**Next:** User needs to test on **localhost** (local Vite dev server, likely `http://localhost:5173`) to see code changes.
