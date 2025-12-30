# Budget category fixes

## Summary

This document captures UI and data issues with the Budget Categories settings screen and prescribes recommended changes to simplify the UX and remove unused complexity.

## Problems observed

- **Bulk operations UI**: There is a "bulk operations" feature visible in Settings that adds significant complexity. It is not necessary for normal user workflows and should be removed.
- **Slug column is present**: A `slug` column appears in the categories table. It is not actionable for end users and creates noise in the UI. Remove the column and any code that generates/depends on it.
- **Transactions column is present and populated**: There's a `transactions` column displayed and populated. This column is not useful in the settings table and should be removed from the UI and from any code paths that populate it.
- **Status / Archive behavior is confusing**:
  - The purpose of archive is to hide a category without deleting it so past transactions can still reference it. That is useful.
  - If we keep a `status` column, its only meaningful states are `active` vs `archived`. If archived categories are meant to be hidden, the UI should not require a `status` column in the settings table unless it's used for toggling visibility.
  - The current behavior disables/grays-out the archive button when a category has transactions, which defeats the archive feature — users should be able to archive categories even when they are referenced by past transactions.

## Recommendations

- **Remove bulk operations**: Delete the bulk operations UI and remove any backend or frontend code that implements or routes bulk operations for budget categories. Keep the UI focused and simple.
- **Remove `slug` column and logic**: Remove the `slug` column from the settings table and eliminate any code that generates or uses slugs for display in this context. If slugs are needed elsewhere (internal APIs), keep them out of the user-facing settings table.
- **Remove `transactions` column and population logic**: Remove the `transactions` column from the settings view and delete the logic that calculates or populates that column. If a transactions count is required elsewhere, provide it in a dedicated report or details panel — not in the main settings list.
- **Clarify and fix archive/status behavior**:
  - Option A (preferred if we want less UI clutter): Remove the `status` column from the table and keep a single "Archive" action per category. Archived categories should be hidden from category pickers in forms by default (or behind a "show archived" toggle) while remaining available for historical transactions.
  - Option B (if `status` is valuable): Keep a minimal `status` column with only `active`/`archived` states, but ensure the archive/unarchive action is always allowed. Do NOT disable archive just because a category has past transactions.
  - Either option must ensure archived categories remain resolvable for existing transactions and must be hidden from new-transaction pickers unless the user explicitly enables "show archived".

## Acceptance criteria

- Bulk operations UI and related code removed; no remaining visible controls or routes for bulk category changes.
- `slug` column removed from settings UI and not displayed anywhere in the categories list.
- `transactions` column removed from settings UI and any code that populates it disabled or deleted.
- Archive action available regardless of whether a category is referenced by transactions.
- Archived categories are hidden by default from category pickers but still usable for historical data; there is a clear way to view/unarchive archived categories.

## Suggested next steps / implementation checklist

- [ ] Remove bulk operations frontend components and any backend endpoints supporting bulk changes.
- [ ] Remove `slug` column from migrations / UI components and delete generation/population code used only for display.
- [ ] Remove `transactions` column and the code that computes/populates it. If counts are needed, provide a separate endpoint or details view.
- [ ] Decide between Option A or Option B for `status` behavior and implement:
  - Update UI to remove `status` column if Option A chosen.
  - Ensure archive toggle is always enabled and update any logic that currently disables it when transactions exist.
  - Make archived categories hidden from pickers by default; add a "show archived" toggle in pickers or settings.
- [ ] Update tests and migrations as required and run the test suite.

## Notes

Keep changes incremental and test that archived categories remain resolvable for old transactions throughout the refactor. If any database migrations are required to drop columns, make sure to provide a reversible migration path.


