# Account Presets JSON Merge Plan

## Problem Statement

After embedding budget categories into `account_presets.presets`, multiple services still perform **write-on-read** initialization by calling `upsertAccountPresets` with payloads like `{ presets: { tax_presets: [...] } }`. Because the Supabase upsert treats `presets` as a whole column, every such call overwrites sibling keys (e.g., `budget_categories`). Opening screens that fetch tax presets or vendor defaults now deletes the newly migrated categories, causing blank budget progress bars.

## Goals

1. Eliminate implicit writes triggered by read flows (tax presets, vendor defaults, etc.).
2. Ensure any future preset updates merge JSON server-side so unrelated keys persist.
3. Provide monitoring and fallback steps so we can confirm no further data loss occurs.

## Guiding Principles

- **Explicit writes only:** Services should write when users intentionally save changes, not as a side-effect of reads.
- **Server-side merge:** JSON modifications must occur inside SQL/RPC so the database guarantees atomic merge semantics.
- **Idempotent + observable:** Re-running seeders or helpers should be safe, and we should detect if a preset section unexpectedly disappears again.

## Implementation Plan

### Phase 1 – Database/RPC Layer

1. **Create RPC `rpc_merge_account_presets_section`:**
   - Parameters: `p_account_id uuid`, `p_section text`, `p_payload jsonb`.
   - Behavior:
     - Upsert `account_presets` row if missing.
     - Merge `p_payload` into `presets` using `jsonb_set(COALESCE(presets,'{}'),'{' || p_section || '}', p_payload, true)`.
     - Return the updated section JSON.
   - Benefits: Clients no longer need to fetch + merge manually; the database enforces atomic writes.

2. **Add a safe helper RPC `rpc_initialize_presets_section_if_absent`:**
   - Inputs: `p_account_id`, `p_section`, `p_default jsonb`.
   - Only writes when the target key is NULL/missing.
   - Will support future migrations that need to backfill defaults without touching existing data.

3. **Backfill monitoring column:**
   - Add `presets_audit jsonb` (or reuse `presets->'last_migrated_at'`) to log timestamps per section (e.g., `{"budget_categories":"2026-01-04T..."}`) so we can query for regressions if a section disappears.

### Phase 2 – Service Layer Updates

1. **Refactor `accountPresetsService.upsertAccountPresets`:**
   - Deprecate direct `supabase.from('account_presets').upsert`.
   - Introduce `mergeAccountPresetsSection(accountId, section, payload)` that calls the new RPC.
   - Keep legacy `upsertAccountPresets` only for metadata fields (e.g., `defaultCategoryId`) to minimize churn.

2. **Update dependent services:**
   - `taxPresetsService`:
     - Replace write-on-read initialization with pure in-memory defaults (return defaults, no write).
     - When user saves presets, call `mergeAccountPresetsSection(accountId, 'tax_presets', payload)`.
   - `vendorDefaultsService`:
     - Same adjustments; no write during read, merge during explicit save.
   - Any other service touching `account_presets.presets` must switch to the merge helper.

3. **Introduce shared `ensurePresetSection(accountId, section, defaults)` helper (optional):**
   - Uses the “initialize if absent” RPC to lazily seed sections only when strictly necessary (e.g., onboarding creating a brand-new account).

### Phase 3 – Remediation & Verification

1. **Reseed affected accounts:**
   - Re-run the budget-category seeding migration or invoke `rpc_initialize_presets_section_if_absent` for `budget_categories` across all accounts.

2. **Add automated check:**
   - Create a cron or dashboard query that flags accounts where `presets->'budget_categories' IS NULL` so we catch regressions quickly.

3. **QA Checklist:**
   - Open all flows (tax presets manager, vendor defaults, transaction forms) to ensure no writes occur unless saving.
   - Confirm via Supabase queries that `budget_categories` persists after interacting with those flows.
   - Run unit tests for `taxPresetsService` and `vendorDefaultsService` to cover no-write-on-read and merge behavior.

## Rollback Plan

- Keep the old `upsertAccountPresets` path behind a feature flag; if the RPC introduces issues, toggle back temporarily.
- Because the new RPC only touches JSON sections, rollbacks are limited to redeploying client/service code; no schema rollback needed beyond dropping the RPC.

## Success Criteria

- Reads never mutate `account_presets`.
- Each preset section update merges without deleting others.
- Follow-up audits show `budget_categories` remains populated for all accounts even after heavy use of tax/vendor features.
