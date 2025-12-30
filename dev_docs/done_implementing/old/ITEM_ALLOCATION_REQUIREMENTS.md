# Item Deallocation and Inventory Return Requirements

## Overview

This document outlines the requirements for simplifying and updating how items are deallocated from projects and moved back to inventory. The system must handle two distinct scenarios through the inventory designation in the disposition field, ensuring proper transaction management and financial tracking.

## Core Concepts

### Inventory Designation via Disposition Field
- Items are designated for inventory return through the existing `disposition` field
- **Correct disposition values and meanings**:
  - `"keep"` - Item stays in the project (green)
  - `"to return"` - Item is going to be returned to the store/vendor (light red)
  - `"returned"` - Item has already been returned to store/vendor (dark red)
  - `"inventory"` - Item is being moved back to business inventory (brown) - **THIS TRIGGERS DEALLOCATION**
- Legacy `"return"` is still present for backward compatibility in the UI (maps to the light red badge). It should be removed during data cleanup, with `"to return"` used going forward.
- When `disposition` is set to `"inventory"`, this triggers the deallocation process to move the item back to business inventory

### Three Primary Scenarios

#### Scenario 0: Initial Allocation Case
An item is moved from business inventory to a project, creating the original allocation transaction.

#### Scenario 1: Existing Transaction Case
An existing transaction represents the item's original movement from inventory to a project. This transaction must be properly managed when items are returned.

**Criteria for Identifying Original Allocation Transactions**:
- `status = 'pending'` (transaction is still active/unpaid)
- `reimbursement_type = 'Client Owes'` (represents allocation from business inventory to project)

#### Scenario 2: No Existing Transaction Case
Items are moved directly to inventory without a prior transaction representing the original allocation (no transaction exists with `status = 'pending'` and `reimbursement_type = 'Client Owes'`).

## Detailed Requirements

### Scenario 0: Initial Allocation Case

#### Inventory Item Allocated to Project
**Trigger**: Item moved from business inventory to project inventory
**Action**: Create `pending` transaction with `reimbursement_type: 'Client Owes'`

**Requirements**:
1. **Automatic Transaction Creation**: When an item is allocated from business inventory to a project, automatically create a pending transaction
2. **Transaction Details**:
   - `status: 'pending'`
   - `reimbursement_type: 'Client Owes'`
   - `transaction_type: 'Purchase'`
   - `source: 'Inventory'`
   - `budget_category: 'Furnishings'`
   - `trigger_event: 'Inventory allocation'`
3. **Amount Calculation**: Use item's `market_value` or `price` as the transaction amount
4. **Link Items**: Associate the allocated item with this transaction for tracking

### Scenario 1: Existing Transaction Management

#### Partial Deallocation
**Condition**: Transaction contains multiple items, but only a subset are being returned to inventory.

**Requirements**:
1. **Item Removal**: Remove the returned items from the existing transaction
2. **Amount Recalculation**: Update the transaction amount to reflect the sum of remaining item project prices
3. **Transaction Status**: Keep the transaction status as `"pending"` (represents ongoing "Client owes us" obligation for remaining items)
4. **Audit Trail**: Maintain complete history of which items were returned and when

#### Complete Deallocation
**Condition**: All items in the transaction are being returned to inventory.

**Requirements**:
1. **Transaction Cancellation**: Automatically update transaction status to `"canceled"`
2. **Item Removal**: Remove all items from the transaction
3. **Amount Reset**: Set transaction amount to $0.00 or remove amount field

### Scenario 2: Direct Inventory Designation

#### No Prior Transaction
**Condition**: Item is moved to inventory without an existing transaction representing the original project allocation.

**Requirements**:
1. **Conditional Transaction Creation**:
   - If `payment_method = 'Client Card'`: Create a transaction (client paid originally, so we need to buy it back)
   - If `payment_method = '1584 Design'`: Do NOT create a transaction (business already purchased the item)
2. **Transaction Type Determination**:
   - **Purchase Transaction**: For client-purchased items (`payment_method = 'Client Card'`), create a purchase transaction representing the business buying it back from the client and set payment method to "1584 Design"
   - **Return Transaction**: For items that originated from business inventory (identified by any associated transaction with `status = 'pending'`, `reimbursement_type = 'Client Owes'`, and `budget_category = 'Furnishings'`), create a return transaction to reverse the allocation
3. **Multiple Item Bundling**: If multiple items are moved simultaneously, bundle all items into a single transaction
4. **Amount Calculation**: Set transaction amount to the sum of the `project_price` for all items attached to the transaction
5. **Inventory Movement**: Move item from project to business inventory
6. **Status Update**: Update item status to reflect inventory return
7. **Inventory Tracking**: Ensure item appears in business inventory with proper designation

### Current Data Model Analysis

The existing system already supports the required functionality:

#### Current Item Interface (✅ Already Implemented)
```typescript
interface Item {
  // core
  item_id: string
  project_id: string
  transaction_id: string
  disposition?: string // 'keep' | 'to return' | 'returned' | 'inventory' (legacy 'return' still in some data/UI -> remove)
  // business inventory fields appear on business items and may be used when allocated
  inventory_status?: 'available' | 'pending' | 'sold'
  current_project_id?: string
  pending_transaction_id?: string
}
```

#### Current Transaction Interface (✅ Already Implemented)
```typescript
interface Transaction {
  // ... existing fields ...
  status?: 'pending' | 'completed' | 'cancelled';
  // Transaction already supports the required status values - no cancellation reason needed
}
```

### Business Logic Requirements

#### Deallocation Processing Workflow (Triggered by 'inventory' disposition)
1. **Identify Associated Transaction**: Use the item's `transaction_id` (if any) to locate the related transaction and any linked business inventory item (via `pending_transaction_id`).
2. **Determine Deallocation Scope**: Based on the set of items sharing the `transaction_id`, decide if it's a partial or complete deallocation.
3. **Process Financial Impact**:
   - Partial: recalculate and update the transaction `amount` and keep `status: 'pending'`.
   - Complete: set `status: 'cancelled'`.
4. **Execute Inventory Movement**:
   - If returning an allocation from business inventory (Client Owes flow): use `returnItemFromProject` to cancel the pending transaction and set the business item back to `inventory_status: 'available'`.
   - If moving a project item without a prior allocation transaction into business inventory: use `moveItemToBusinessInventory` to create a `We Owe` pending transaction and create the business inventory item.
5. **Maintain Audit Trail**: Persist updates with existing `last_updated` fields on affected records.

#### Trigger Logic Details
- The UI already updates `disposition` on project items. When `disposition` is set to `"inventory"`, add automation to:
  - Look up other project items with the same `transaction_id` to compute partial vs complete deallocation.
  - If a business inventory item exists whose `pending_transaction_id` matches this `transaction_id`, treat this as a return of an allocated business item and call `businessInventoryService.returnItemFromProject(...)`.
  - Otherwise, treat as a direct movement into business inventory and call `businessInventoryService.moveItemToBusinessInventory(...)`.
- After movement, remove the project item record or clear its project linkage as appropriate to avoid double-counting.

#### Amount Calculation Rules
- **Partial Deallocation**: `new_amount = sum(project_price of remaining_items)` (transaction remains `"pending"`). Parse numeric strings safely and format back to a canonical currency string.
- **Complete Deallocation**: `new_amount = '0.00'` (transaction status set to `"cancelled"`). Prefer setting to `'0.00'` rather than removing the field.

#### Existing APIs to Use (✅ Available)
- `itemService.getTransactionItems(projectId, transactionId)` to enumerate items tied to a transaction.
- `transactionService.updateTransaction(projectId, transactionId, updates)` to update `amount` and `status`.
- `businessInventoryService.returnItemFromProject(itemId, transactionId, projectId)` to cancel a pending allocation and mark the business item available.
- `businessInventoryService.moveItemToBusinessInventory(itemId, projectId, amount, notes?)` to move a project item into business inventory and create a `We Owe` pending transaction.

### Integration Requirements

#### With Existing Systems
1. **Business Inventory System**: Items returned should appear in business inventory

#### Data Consistency Requirements
1. **Atomic Operations**: All related changes (item status, transaction updates, inventory moves) must happen together
2. **Rollback Capability**: System should handle failures and rollback partial changes
3. **Validation Rules**: Ensure data integrity across all related entities

### Error Handling and Edge Cases

#### Error Scenarios
1. **Transaction Not Found**: Handle cases where expected transaction doesn't exist
3. **Partial Failures**: Handle cases where some items return successfully but others fail


