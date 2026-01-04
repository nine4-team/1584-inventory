## Budget Categories → Account Presets Consolidation Plan

### Context
- `budget_categories` is a standalone table with FK references, offline caching, and CRUD endpoints.
- `account_presets` already stores other account-level defaults inside the `presets` JSON blob.
- Maintaining both patterns produces duplicate cache layers, diverging RLS policies, and inconsistent onboarding.

### Objectives
- Single canonical store for account-scoped presets (`account_presets`).
- Preserve existing ergonomics: categories still behave like relational rows with IDs.
- No data loss; transactions referencing category IDs remain valid.
- Keep offline-first behavior and Supabase security semantics intact.

### Target Architecture
- Embed categories under `account_presets.presets.budget_categories` as an ordered array of objects `{ id, name, slug, is_archived, metadata, created_at, updated_at }`.
- Expose read/write compatibility via a Postgres view + RPC layer (`vw_budget_categories`) so existing services can select/insert as if the table still exists.
- Category IDs stay as UUIDs; transactions continue storing the UUID.
- All preset data (default category, ordering, categories) is cached via a single offline payload.

### Migration Phases
1. **Preparation**
   - Confirm every account has an `account_presets` row; create ones that are missing.
   - Document the new contract in `dev_docs` and align with engineering leads.
2. **Dual-Write Enablement**
   - Extend `accountPresetsService` with helpers to get/set embedded categories.
   - Update `budgetCategoriesService` to write to both the table and the embedded blob (feature-flagged).
   - Add observability (logs/metrics) comparing table vs blob counts per account.
3. **Data Backfill**
   - Supabase SQL migration to aggregate each account’s categories, sorted by existing `budget_category_order`, and store them inside `account_presets`.
   - Set a checksum column (e.g., MD5 of serialized object) to validate parity during rollout.
4. **Read Switch**
   - Create `vw_budget_categories` (selects from `account_presets`, unnesting the JSON array) and a `rpc_upsert_budget_category` for writes.
   - Flip the app to read via the view (or through the expanded service) while still persisting to the table for fallback.
   - Run automated parity checks; block rollout if mismatches occur.
5. **Retirement**
   - Freeze table writes (RLS deny insert/update) once metrics show parity for a full release cycle.
   - Update `transactions.category_id` FK to reference a generated table or trigger that validates IDs against the JSON payload.
   - Drop the legacy table and clean up code paths, feature flags, and caches.

### Schema & Supabase Work
- Migration scripts:
  - `01_ensure_account_presets.sql` – backfill missing rows.
  - `02_embed_budget_categories.sql` – populate JSON payload, set checksum.
  - `03_create_budget_category_view.sql` – define view + helper functions with appropriate RLS.
  - `04_adjust_transactions_fk.sql` – new constraint strategy once the table is retired.
- RLS:
  - Mirror existing `budget_categories` policies on the view/RPC functions.
  - Ensure `account_presets` policies allow updates to `presets -> budget_categories` only by owners.

### Application Changes
- **Service layer**
  - Add serialization/deserialization utilities in `accountPresetsService`.
  - Refactor offline cache to hydrate categories from the consolidated payload; drop duplicate cache keys.
  - Introduce telemetry comparing counts between sources.
- **Feature flagging**
  - `BUDGET_CATEGORIES_EMBEDDED_READS`
  - `BUDGET_CATEGORIES_EMBEDDED_WRITES`
  - `BUDGET_CATEGORIES_TABLE_DISABLED`
  - Use gradual rollout (internal → beta → everyone).

### Testing Strategy
- Unit tests for new serialization helpers and dual-write logic.
- Integration tests hitting Supabase functions to exercise the view/RPC.
- Migration dry-runs against production snapshots: compare row counts, ID sets, and serialized hashes.
- Offline regression tests: ensure category cache warms from the new payload and updates propagate while offline.

### Rollback Plan
- Keep dual-writes enabled until the table is dropped so we can repopulate either side quickly.
- Store migration checkpoints (per-account hashes) so we can re-sync the table from `account_presets` if needed.
- Maintain feature flags for at least one release post-migration to revert reads back to the legacy table.

### Ownership & Timeline
- **Data layer**: Supabase migrations + view/RPC work (data engineering).
- **App layer**: Service refactors + feature flags (application team).
- **QA**: Offline + regression testing (QA automation team).
- Suggested timeline: 1 sprint for dual-write + backfill, 1 sprint for read switch + validation, 1 sprint for retirement/cleanup.
