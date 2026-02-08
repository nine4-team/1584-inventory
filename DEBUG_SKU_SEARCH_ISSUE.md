# SKU Search Issue - Debug Context

## Observed Behavior

**What works:**
- Business Inventory → Items tab: Searching "400297" successfully shows item with SKU "400297050281"

**What doesn't work:**
- Business Inventory Transaction → Add Existing Item → Suggested tab: Searching "400297" does not show item with SKU "400297050281"
- Business Inventory Transaction → Add Existing Item → Outside tab: Searching "400297" does not show item with SKU "400297050281"

## Item Being Searched For
- **SKU**: 400297050281
- **Description**: Large succulents in round light wood-like bowl
- **Source**: Ross
- **Context**: Business inventory item (no project_id)
- **Link**: https://inventory.1584design.com/business-inventory/I-1770409972867-v870?bizItemSearch=400297050

## Code Observations

### Working Search (Business Inventory Items)
**Location**: `src/pages/BusinessInventory.tsx` lines 611-612

Uses client-side filtering:
```typescript
matchesItemSearch(item, inventorySearchQuery, {
  locationFields: ['businessInventoryLocation']
})
```

The `matchesItemSearch` utility (`src/utils/itemSearch.ts` lines 91-92) includes SKU normalization logic that strips non-alphanumeric characters, allowing "400297" to match "400297050281".

### Non-Working Search (Transaction Item Picker)
**Location**: `src/components/transactions/TransactionItemPicker.tsx`

**Recent change**: Added client-side `matchesItemSearch` filtering to lines 158-183 for all three tabs (suggested, project, outside), but search still doesn't work.

**Current tab structure when used in business inventory transaction context:**
- Suggested tab: Shows items from same source with no transaction_id
- Outside tab: Shows items from outside the current project scope
- **No business inventory tab**: Unlike project context which has "suggested, project, outside", business inventory context only has "suggested, outside"

## Hypothesis: Tab Structure Gap

When TransactionItemPicker is used in a **project transaction context**:
- 3 tabs: Suggested | Project | Outside
- Business inventory items would appear in "Outside" tab

When TransactionItemPicker is used in a **business inventory transaction context**:
- 2 tabs: Suggested | Outside
- Business inventory items (project_id = null) don't have a dedicated tab
- They could only appear in "Suggested" if they match the suggested criteria (same source, no transaction_id)
- If they don't match suggested criteria, they have nowhere to appear

**Question to explore**: Does this item match the "Suggested" criteria for this transaction? If not, it may be architecturally excluded from appearing in any tab.

## Areas to Explore

### 1. Suggested Items Logic
**Location**: `src/services/inventoryService.ts` lines 2792-2824, function `getSuggestedItemsForTransaction`

Filters by:
- Same account_id
- Same source as transaction
- transaction_id IS NULL
- Orders by date_created DESC
- Limits to 50 items

**Questions:**
- Does the item have the same source as the transaction being edited?
- Does the item have a null transaction_id, or is it already assigned to another transaction?
- Is it within the first 50 results when ordered by date_created?

### 2. Outside Items Logic
**Location**: `src/services/inventoryService.ts` lines 4654-4771, function `searchItemsOutsideProject`

**Observed behavior:**
- Line 4667: When search query exists, `hasSearchQuery = true`
- Line 4669: Condition `if (online && !hasSearchQuery)` means the simple Supabase query block only runs when there's NO search query
- Line 4734-4770: When search query exists, attempts to call `rpc_search_items_outside_project`
- **Observation**: This RPC function does not exist in any migration files in `supabase/migrations/`
- Line 4766-4769: Catches error and falls back to offline search results

**Questions:**
- When the RPC call fails, what items are in the offline cache?
- Does the offline cache include this business inventory item?
- Is the simple query path (lines 4669-4713) actually what's needed, but it's being skipped when there's a search query?
- Line 4688-4691 includes `sku.ilike.%${query}%` - would this match "400297" in "400297050281"?

### 3. Business Inventory Items in "Outside" Tab
**Location**: `src/components/transactions/TransactionItemPicker.tsx` lines 86, 258-289

Line 86: `includeBusinessInventory` is set to `targetProjectId !== null`

**Questions:**
- When viewing a business inventory transaction (no project), what is `targetProjectId`?
- If `targetProjectId` is null, then `includeBusinessInventory = false`, which would exclude business inventory items from the "Outside" tab
- Is this the intended behavior, or should business inventory items be included when searching from a business inventory transaction context?

## Suggested Investigation Steps

1. **Check if item matches suggested criteria**: Verify transaction source matches item source, and item transaction_id is null
2. **Inspect TransactionItemPicker usage context**: Check what `projectId` and `transaction.projectId` are when used in business inventory transaction context
3. **Trace includeBusinessInventory flag**: See if business inventory items are being architecturally excluded from "Outside" tab search
4. **Consider tab structure**: Determine if business inventory transaction context needs different tabs (e.g., add "Business Inventory" tab alongside "Outside")
5. **Test database query directly**: Try the Supabase query from line 4688-4691 with the search term to see if it returns the item

## Files Involved
- `src/components/transactions/TransactionItemPicker.tsx` - UI component with tab logic
- `src/services/inventoryService.ts` - `getSuggestedItemsForTransaction`, `searchItemsOutsideProject`
- `src/pages/TransactionDetail.tsx` - Where TransactionItemPicker is used
- `src/utils/itemSearch.ts` - Client-side search/matching logic that works in Business Inventory
