# Cell Two Project — Canonical Sale Missing

## Summary
The canonical sale transaction `INV_SALE_60734ca8-8f0d-4f96-8cab-f507fa0829e5` is **not present** in `public.transactions`, despite client logs indicating a successful create. Supabase API logs show a **successful POST** followed by a **DELETE** for the same transaction ID shortly afterward. The item in question remains allocated to a different project and is tied to an `INV_PURCHASE_…` transaction.

User update: **manual “Sell to Business Inventory” works** (sale transaction created, item appears in business inventory). This suggests the failure is specific to the Cell Two / sell‑to‑project path, not the generic deallocation flow.

## Scope
- Project ID: `60734ca8-8f0d-4f96-8cab-f507fa0829e5`
- Item ID: `I-1766005262000-b754`
- Account ID: `2d612868-852e-4a80-9d02-9d10383898d4`
- Canonical sale ID expected: `INV_SALE_60734ca8-8f0d-4f96-8cab-f507fa0829e5`

## Supabase Checks (Executed)
**Result: transaction missing**
- Query: `transactions` where `transaction_id = INV_SALE_60734ca8-8f0d-4f96-8cab-f507fa0829e5`
- Result: `[]`

**Result: no INV_SALE for that project**
- Query: `transactions` where `project_id = 60734ca8-8f0d-4f96-8cab-f507fa0829e5` and `transaction_id like 'INV_SALE_%'`
- Result: `[]`

**Result: item still allocated and tied to purchase**
- Query: `items` where `item_id = I-1766005262000-b754`
- Result:
  - `project_id = 2115f472-03a1-4872-aa20-881a24d36389`
  - `transaction_id = INV_PURCHASE_2115f472-03a1-4872-aa20-881a24d36389`
  - `disposition = purchased`, `inventory_status = allocated`

## Supabase API Log Findings
Time window around the action (2026‑01‑22 ~18:30 UTC):
- `GET /rest/v1/transactions ... INV_SALE_60734...` → **406** (no row yet)
- `POST /rest/v1/transactions` → **201** (create succeeded)
- `PATCH /rest/v1/transactions?transaction_id=eq.INV_SALE_60734...` → **204**
- `DELETE /rest/v1/transactions?transaction_id=eq.INV_SALE_60734...` → **204** (row removed)

These logs indicate the canonical sale was created successfully and then deleted shortly after.

## Interpretation
- The missing transaction is **not** a UI filtering/fetching issue; the row is absent in the database.
- The create **did happen**, but it was followed by a **delete**, likely triggered by client logic that removes empty canonical transactions or a follow‑on corrective path.
- The item is still tied to `INV_PURCHASE_2115f472-...`, which suggests the flow may have reversed or rolled back the sale.
- The fact that **direct “Sell to Business Inventory” works** points to the **sell‑to‑project orchestration** as the likely culprit.

## Delete Path (Traced)
The follow‑on delete aligns with the **sell‑to‑project allocation path**:

1) `sellItemToProject(...)` calls `deallocationService.handleInventoryDesignation(...)`  
   - Creates `INV_SALE_<sourceProjectId>` and moves item to business inventory.

2) `allocateItemToProject(...)` sees the item in an `INV_SALE_...` transaction  
   - Scenario A.2: `handleSaleToDifferentProjectMove(...)` for a different target project.

3) `handleSaleToDifferentProjectMove(...)` calls `removeItemFromTransaction(...)`  
   - If the sale transaction becomes empty, it **deletes the transaction**.

The delete is implemented here:
```5786:5828:src/services/inventoryService.ts
  async removeItemFromTransaction(...) {
    ...
    if (updatedItemIds.length === 0) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('account_id', accountId)
        .eq('transaction_id', transactionId)
      ...
      console.log('🗑️ Deleted empty transaction:', transactionId)
    }
```

And the sell‑to‑project path that removes the sale transaction:
```5574:5589:src/services/inventoryService.ts
  async handleSaleToDifferentProjectMove(...) {
    const purchaseTransactionId = `INV_PURCHASE_${newProjectId}`
    // Remove item from existing Sale transaction
    await this.removeItemFromTransaction(accountId, itemId, currentTransactionId, finalAmount)
    // Add item to Purchase transaction for new project
    await this.addItemToTransaction(accountId, itemId, purchaseTransactionId, ...)
```

This matches the API logs showing:
- POST create `INV_SALE_60734...`
- DELETE `INV_SALE_60734...` shortly after

## Next Checks (Recommended)
- Identify which code path issued the **DELETE** for `INV_SALE_60734...`:
  - Look for client-side calls to `transactions` delete in the time window.
  - Specifically check any logic that deletes canonical transactions when `item_ids` becomes empty.
- Confirm whether a **purchase‑reversion** path ran:
  - Item remains tied to `INV_PURCHASE_2115f472-...`, which aligns with a reversion behavior.
- If possible, capture the network request payloads around the delete:
  - The Supabase logs show the request IDs and endpoints, but not request bodies.

## Artifacts
- Supabase API logs captured via MCP (`service: api`)
- Supabase DB queries executed via MCP (`execute_sql`)
