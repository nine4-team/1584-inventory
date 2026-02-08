# Bug: Item Not Appearing in Suggested Items Tab

## Summary
An item that meets all criteria for the "Suggested Items" tab is not appearing when searching in the Add Existing Items modal within a business inventory transaction.

## Expected Behavior
Item with SKU `400297050281` should appear in the **Suggested** tab when:
- Opening transaction: http://localhost:3000/business-inventory/transaction/5f68a8fc-4489-4415-b7d2-cd1793972970
- Clicking "Add Existing Item"
- Going to "Suggested" tab
- Searching for "400297"

## Actual Behavior
The item does not appear in search results despite meeting all criteria.

## Item Details (from diagnostic)
- **Item ID:** `I-1770409972867-v870`
- **SKU:** `400297050281`
- **Source:** `Ross`
- **Transaction ID:** `null` (before being manually added)
- **Project ID:** `null` (business inventory item)

## Transaction Details
- **Transaction ID:** `5f68a8fc-4489-4415-b7d2-cd1793972970`
- **Source:** `Ross`
- **Project ID:** `null` (business inventory transaction)

## Suggested Tab Criteria (ALL MET ✅)
For an item to appear in Suggested tab, it must:
1. ✅ **Source matches transaction source** (`Ross` = `Ross`)
2. ✅ **transaction_id IS NULL** (was `null` before manual add)
3. ❓ **Be in top 50 most recent items** (by `date_created DESC`) with same source and null transaction_id

## Diagnostic Results
The database search **DOES find the item**:
- ✅ Item exists in database
- ✅ Source matches
- ✅ Is business inventory item
- ✅ Database query `sku.ilike.%400297%` returns the item
- ✅ Client-side search utility `matchesItemSearch()` should match it

**But:** Item does not appear in the Suggested tab UI when searching.

## Relevant Code Files

### Query Logic
**File:** `src/services/inventoryService.ts`
**Function:** `getSuggestedItemsForTransaction` (lines 2792-2824)

```typescript
// Supabase query
const { data, error } = await supabase
  .from('items')
  .select('*')
  .eq('account_id', accountId)
  .eq('source', transactionSource)  // ✅ 'Ross'
  .is('transaction_id', null)       // ✅ null
  .order('date_created', { ascending: false })
  .limit(limit)  // 50
```

### UI Component
**File:** `src/components/transactions/TransactionItemPicker.tsx`

**Loading:** Lines 216-244 (loads suggested items)
**Filtering:** Lines 161-168 (client-side search filter using `matchesItemSearch`)

```typescript
const suggestedMatches = useMemo(() => {
  if (!normalizedQuery) return suggestedItems
  return suggestedItems.filter(item =>
    matchesItemSearch(item, searchQuery, {
      locationFields: ['space', 'businessInventoryLocation']
    }).matches
  )
}, [normalizedQuery, searchQuery, suggestedItems])
```

### Search Utility
**File:** `src/utils/itemSearch.ts`
**Function:** `matchesItemSearch` (lines 77-119)

Includes SKU normalization (lines 91-92):
```typescript
(normalizedSkuQuery &&
  (item.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedSkuQuery))
```

This should match `"400297"` in `"400297050281"`.

## Investigation Areas

### 1. Top 50 Limit
**Question:** Is this item outside the top 50 most recent Ross items with `transaction_id = null`?

**Test:** Run this query to check item's position:
```sql
SELECT item_id, sku, date_created,
       ROW_NUMBER() OVER (ORDER BY date_created DESC) as position
FROM items
WHERE account_id = '<account_id>'
  AND source = 'Ross'
  AND transaction_id IS NULL
ORDER BY date_created DESC
LIMIT 100;
```

If position > 50, that's the issue.

### 2. Database Query Execution
**Question:** Is the query actually returning this item?

**Debug:** Add console logging in `getSuggestedItemsForTransaction`:
```typescript
console.log('Suggested items query result:', {
  transactionSource,
  itemCount: data?.length,
  items: data?.map(i => ({ itemId: i.item_id, sku: i.sku }))
})
```

### 3. Client-Side Filtering
**Question:** Is the item being filtered out after loading?

**Debug:** Add logging in `TransactionItemPicker`:
```typescript
console.log('Suggested items before filter:', suggestedItems.length)
console.log('Suggested items after filter:', suggestedMatches.length)
console.log('Search query:', searchQuery)
```

## Workaround (Temporary)
The item DOES appear in the **Inventory** tab and can be added from there.

## Notes
- The item works correctly in Business Inventory → Items tab (main inventory view)
- Search functionality works there with same SKU search
- Issue is specific to the transaction modal's Suggested tab
- Created diagnostic tool at `src/components/debug/DiagnoseSuggestedItems.tsx` (remove after debugging)
