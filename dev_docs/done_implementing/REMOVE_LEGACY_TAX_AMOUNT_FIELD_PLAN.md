# Remove Legacy Tax Amount Field Plan

## Overview
The legacy `taxAmount` field in the Item interface and `tax_amount` column in the items table is no longer used. This field was replaced by separate `taxAmountPurchasePrice` and `taxAmountProjectPrice` fields. This document outlines the safe removal of this legacy field.

## Current Status Analysis

### Database Analysis (Confirmed via Supabase query)
- **Total items**: 273
- **Items with legacy `tax_amount`**: 0 (all null/empty)
- **Items with `tax_amount_purchase_price`**: 257
- **Items with `tax_amount_project_price`**: 257

**Conclusion**: No data migration needed - the legacy field contains no active data.

### Code Usage Analysis
The legacy `taxAmount` field is only used in:
- Type definitions (marked as legacy)
- Database conversion functions
- Item duplication logic (recently added)
- Test utilities

## Implementation Plan

### Phase 1: Code Changes (Safe to deploy immediately)

#### 1.1 Remove from Type Definitions
**File**: `src/types/index.ts`
- Remove `taxAmount?: string;` from Item interface
- Update comment for tax fields section

#### 1.2 Update Database Conversion Functions
**File**: `src/services/inventoryService.ts`
- Remove `taxAmount: converted.tax_amount || undefined,` from `_convertItemFromDb`
- Remove `if (item.taxAmount !== undefined) dbItem.tax_amount = item.taxAmount` from `_convertItemToDb`

#### 1.3 Remove from Duplication Logic
**File**: `src/services/inventoryService.ts`
- Remove `tax_amount: originalItem.taxAmount || null,` from `duplicateItem` method

#### 1.4 Update Test Utilities
**File**: `src/services/__tests__/test-utils.ts`
- Remove `taxAmount: '8.38',` and `taxAmount: '7.62',` from mock item objects

### Phase 2: Database Migration (Deploy after code changes)

#### 2.1 Create Migration File
**File**: `supabase/migrations/YYYYMMDD_remove_legacy_tax_amount.sql`
```sql
-- Remove legacy tax_amount column as it's no longer used
-- All tax amount data is now stored in tax_amount_purchase_price and tax_amount_project_price
ALTER TABLE items DROP COLUMN tax_amount;
```

#### 2.2 Deploy Migration
- Run migration in staging environment first
- Verify no breaking changes
- Deploy to production

## Risk Assessment

### Low Risk Changes (Phase 1)
- **Type removal**: TypeScript will catch any remaining usage
- **Conversion functions**: Only used for database I/O, removing unused field is safe
- **Duplication logic**: Removing unused field copying is safe
- **Test utilities**: Only affects tests, no production impact

### Medium Risk Change (Phase 2)
- **Database column drop**: Irreversible, but confirmed no data loss
- **Mitigation**: Test thoroughly in staging, have backup ready

## Testing Strategy

### Unit Tests
- Update any tests that reference `taxAmount` in mock data
- Ensure inventory service tests still pass
- Verify tax calculation logic remains intact

### Integration Tests
- Test item creation, updates, and duplication
- Verify tax amounts still display correctly in UI
- Test transaction completeness calculations

### Manual Testing
- Create items with tax rates
- Duplicate items and verify tax amounts copy correctly
- Check transaction totals and item aggregations
- Verify tax display in all relevant UI components

## Rollback Plan

### Phase 1 Rollback
If issues arise with code changes:
1. Revert the commit
2. Re-add the type definition and conversion logic
3. The database column remains untouched

### Phase 2 Rollback
If database migration causes issues:
1. Restore from backup (if needed)
2. The application can run with the column present but unused
3. Revert code changes if necessary

## Success Criteria

1. ✅ All existing functionality works (tax calculations, display, duplication)
2. ✅ No TypeScript errors
3. ✅ All tests pass
4. ✅ Database migration completes successfully
5. ✅ No data loss
6. ✅ Application performance unaffected

## Timeline

- **Phase 1 (Code)**: 1-2 days development + testing
- **Phase 2 (Database)**: 1 day migration + verification
- **Total**: 2-3 days

## Dependencies

- Requires Supabase migration deployment process
- Should be done during low-traffic period
- Coordinate with team for database deployment

## Notes

- The legacy field was originally the only tax amount field before separate purchase/project tax amounts were added
- All current tax functionality uses `taxAmountPurchasePrice` and `taxAmountProjectPrice`
- This cleanup will simplify the data model and remove confusion about which tax field to use