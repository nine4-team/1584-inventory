# Business Profile Consolidation Plan

## Objective
Fold the standalone `business_profiles` table into the `accounts` table so every business-facing field (name, logo, metadata) lives on the account record itself. This removes redundant storage, ensures onboarding data immediately appears in the UI, and simplifies offline sync/versioning.

## Success Criteria
- `accounts` table exposes `business_name`, `business_logo_url`, `business_profile_updated_at`, `business_profile_updated_by`, `business_profile_version`.
- All read & write paths prefer the new columns while remaining backwards compatible during rollout.
- HighLevel onboarding, settings UI, invoices, headers, and offline caches all display the same business name/logo without extra fetches.
- `business_profiles` table can be safely dropped after verification.

## Current State
- HighLevel onboarding writes only to `accounts.name`.
- UI components (`Header`, `ProjectInvoice`, `ClientSummary`, etc.) read `BusinessProfileContext`, which in turn fetches `business_profiles`.
- Offline/versioning logic already added `version` to the `business_profiles` table (2025‑01‑01 migration).
- Duplicate sources allow the UI to fall back to `COMPANY_NAME`, which is confusing for new accounts.

## Constraints & Risks
- Must not break existing clients or queued offline operations that still reference `business_profiles`.
- Need a reversible rollout (feature flag/environment switch).
- Backfill must be idempotent & capture changes made mid-migration.
- Ensure RLS continues to enforce account-scoped access.
- Storage rules for logo uploads already rely on account paths; keep them unchanged.

## Rollout Plan

### Phase 0 – Preparation
1. Inventory every read/write of `business_profiles` (services, contexts, Edge functions, tests).
2. Snapshot current `accounts` + `business_profiles` data for diff/restore.
3. Add temporary logging/monitoring for unexpected writers.

### Phase 1 – Schema Expansion (non-breaking)
1. Migration adds nullable columns to `accounts`:
   - `business_name TEXT`, `business_logo_url TEXT`
   - `business_profile_updated_at TIMESTAMPTZ DEFAULT NOW()`
   - `business_profile_updated_by UUID REFERENCES users(id)`
   - `business_profile_version INTEGER DEFAULT 1`
2. Update `accounts` RLS policies to allow admins/owners to edit the new columns.
3. Document fallbacks: UI should default to `accounts.name` if `business_name` is null.

### Phase 2 – Backfill & Dual Writes
1. SQL backfill:
   - Copy existing `business_profiles` rows into matching `accounts` columns.
   - For accounts without profiles, set `business_name = accounts.name` (logo null).
2. Add dual-write mechanism:
   - DB triggers OR service-layer changes so updates to either table keep the other in sync.
   - Re-run backfill after triggers deploy to catch late writes.

### Phase 3 – Application Updates
1. Introduce a helper (e.g., `accountBusinessProfileService`) that reads from the `accounts` columns first, falling back to `business_profiles` if needed.
2. Update:
   - `BusinessProfileContext`, invoices, headers, property/client summaries.
   - `Settings` page + `businessProfileService`.
   - `highlevel-onboard` Edge function to set `business_name` when creating accounts.
3. Keep API surface backwards compatible: `businessProfileService` can internally target `accounts` while still writing to both tables during the bridge period.
4. Guard rollout behind a feature flag or env var for quick rollback.

### Phase 4 – Verification
1. Run nightly consistency checks comparing `business_profiles` to `accounts` for any divergence.
2. Monitor logs/UI for missing names/logos.
3. Disable dual-write triggers temporarily and confirm nothing breaks; re-enable if issues arise.

### Phase 5 – Decommission `business_profiles`
1. Communicate cutoff date and ensure no code references the table (CI grep/lint).
2. Final sync: copy any remaining differences into `accounts`.
3. Drop dual-write triggers.
4. Migration to drop:
   - RLS policies, indexes, and finally the `business_profiles` table.
5. Update Supabase generated types and documentation to reflect new schema.

### Phase 6 – Cleanup
1. Remove `businessProfileService` (or keep as thin wrapper around `accounts`).
2. Update docs/onboarding guides to state business branding lives on `accounts`.
3. Remove fallback logic (`COMPANY_NAME`) once data confirmed.
4. Confirm offline caches/project payloads serialize `business_name` from `accounts`.

## Testing Checklist
- [ ] Migration applies on staging/prod replicas without locking issues.
- [ ] Backfill script verified against snapshots; rerunnable without duplicates.
- [ ] UI smoke tests show correct business name/logo post-migration.
- [ ] Offline flows (queue replay) still operate because `projects` payloads now carry updated account info.
- [ ] HighLevel onboarding creates accounts whose names appear immediately in Settings/Header.

## Rollback Strategy
- Keep `business_profiles` table intact until Phase 5 completion for instant fallback.
- Feature flag can revert UI/services to legacy fetch path if issues arise.
- Snapshotted data + reversible migrations allow restoring prior state if necessary.
