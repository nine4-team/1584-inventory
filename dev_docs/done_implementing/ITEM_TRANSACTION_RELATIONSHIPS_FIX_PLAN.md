# Item-Transaction Relationship Tracking Fix Plan

## Problem Statement

The current dual-tracking system for item-transaction relationships creates fundamental consistency issues:

- **Items table**: Tracks `transaction_id`, `latest_transaction_id`, `previous_project_transaction_id`
- **Transactions table**: Tracks `item_ids` array

When items move between transactions, the system removes them from the source transaction's `item_ids` array, breaking historical visibility. This violates the principle that a transaction should maintain a complete record of all items that were ever part of it.

## Root Cause

The dual-tracking architecture worked when items never left transactions, but inventory movement operations broke this assumption. The recent "Moved Items section missing" bug exposed this architectural flaw - TransactionDetail pages can't show moved items because they're no longer in the transaction's `item_ids` array.

## Current Issues

1. **Consistency violations**: Items know they moved, but source transactions forget they ever had them
2. **Lost historical context**: No way to see complete transaction history from the transaction side
3. **Query complexity**: TransactionDetail needs complex lineage queries to reconstruct what should be simple relationships
4. **Maintenance burden**: Every item movement requires updates in two places, increasing error potential

## Recommended Solution: Single Source of Truth with Status Metadata

### Option 1: Enhanced Transaction-Centric Tracking (Recommended for Minimal Changes)

Keep all items in `item_ids` arrays but add relationship status metadata:

```sql
-- Add to transactions table
ALTER TABLE transactions ADD COLUMN item_relationships JSONB;

-- Example structure:
-- {
--   "item_id_1": {"status": "active", "joined_at": "2025-01-01T00:00:00Z"},
--   "item_id_2": {"status": "moved", "moved_at": "2025-01-15T00:00:00Z", "moved_to": "tx_456"},
--   "item_id_3": {"status": "deallocated", "deallocated_at": "2025-01-20T00:00:00Z"}
-- }
```

**Benefits:**
- Transactions maintain complete historical record
- Minimal breaking changes to existing queries
- Clear separation between "items involved" vs "current status"
- TransactionDetail can show both active and moved items without complex queries

**Implementation:**
1. Stop removing items from `item_ids` when they move
2. Add status metadata to track relationship state
3. Update queries to filter by status when needed
4. Migrate existing moved items back to source transactions with "moved" status

### Option 2: Item-Centric Tracking (Cleaner Long-term)

Move relationship tracking entirely to the items table:

```sql
-- Items table gets richer relationship tracking
ALTER TABLE items ADD COLUMN transaction_history JSONB;

-- Example structure:
-- [
--   {"transaction_id": "tx1", "status": "active", "joined_at": "...", "left_at": null},
--   {"transaction_id": "tx2", "status": "moved", "joined_at": "...", "left_at": "..."},
--   {"transaction_id": "tx3", "status": "active", "joined_at": "...", "left_at": null}
-- ]
```

**Benefits:**
- Single source of truth eliminates consistency issues
- Items maintain their complete transaction history
- Transactions can be derived from items (acceptable performance trade-off)
- No more dual-tracking maintenance burden
- Easier to audit complete item lifecycle

**Drawbacks:**
- Requires more migration work
- Changes how transactions query their items
- Performance impact for transaction-centric queries

## Implementation Strategy

### Phase 1: Immediate Fix (Stop the Bleeding)
1. **Stop removing items** from `item_ids` arrays during movement operations
2. **Add temporary metadata** to distinguish active vs moved items
3. **Update TransactionDetail** to handle both active and moved items in `item_ids`

### Phase 2: Proper Status Tracking
1. **Choose tracking approach** (Option 1 recommended for minimal disruption)
2. **Add database schema** for relationship status
3. **Migrate existing data** to include moved items back in source transactions
4. **Update all movement operations** to maintain status instead of removing items

### Phase 3: Query Optimization
1. **Update core queries** to leverage status metadata
2. **Add database indexes** for performance
3. **Update application code** to use new relationship model
4. **Add comprehensive tests** for relationship tracking

## Migration Path

### For Option 1 (Transaction-Centric):
1. Add `item_relationships` column to transactions table
2. For each existing lineage edge, add the moved item back to source transaction's `item_ids` with "moved" status
3. Update movement/deallocation functions to set status instead of removing items
4. Update queries to filter by status when needed

### Data Migration Example:
```sql
-- Find all moved items and add them back to source transactions
INSERT INTO transaction_item_relationships (transaction_id, item_id, status, moved_at, moved_to_tx)
SELECT
  le.from_transaction_id,
  le.item_id,
  'moved',
  le.created_at,
  le.to_transaction_id
FROM item_lineage_edges le
WHERE le.from_transaction_id IS NOT NULL;
```

## Benefits of This Approach

1. **Consistency**: Single source of truth prevents sync issues
2. **Historical integrity**: Transactions maintain complete item history
3. **Query simplicity**: No more complex lineage reconstruction
4. **Auditability**: Clear trail of all item movements
5. **Performance**: Better than current lineage-based reconstruction
6. **Maintainability**: Simpler update logic for movement operations

## Risk Mitigation

1. **Backward compatibility**: Keep existing APIs working during transition
2. **Performance monitoring**: Watch for query performance regression
3. **Data validation**: Ensure relationship integrity during migration
4. **Rollback plan**: Ability to revert if issues arise

## Success Criteria

1. TransactionDetail pages show moved items without complex queries
2. No data loss during item movements
3. Consistent state between items and transactions tables
4. Improved performance for relationship queries
5. Clear audit trail for all item movements

## Next Steps

1. Choose implementation approach (Option 1 recommended)
2. Create detailed migration scripts
3. Update movement operation functions
4. Implement and test the changes
5. Monitor performance and data integrity