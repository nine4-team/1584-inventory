# Vendor / Source Defaults — Plan (revised)

## Status: 🟡 In Progress (90% Complete)

**Last Updated:** Current session

### ✅ Completed
- [x] Database migration for vendor_defaults table (`015_add_vendor_defaults.sql`)
- [x] Seed migration to populate first 10 vendors (`016_seed_vendor_defaults.sql`)
- [x] Backend service (`vendorDefaultsService.ts`) with GET, PATCH, PUT endpoints
- [x] VendorDefaultsManager component for Settings page
- [x] Settings page integration (admin-only section)
- [x] AddTransaction form updated to use vendor defaults
- [x] EditTransaction form updated to use vendor defaults
- [x] EditBusinessInventoryTransaction form updated to use vendor defaults
- [x] AddBusinessInventoryItem form render updated (needs useEffect fix)

### 🔄 In Progress / Needs Fixes
- [ ] AddBusinessInventoryTransaction.tsx — Add vendor loading logic (currently uses TRANSACTION_SOURCES in useEffect)
- [ ] AddBusinessInventoryItem.tsx — Add vendor loading logic (currently uses TRANSACTION_SOURCES in useEffect)

### 📋 Remaining
- [ ] AddItem.tsx — Update to use vendor defaults (4 references to TRANSACTION_SOURCES)
- [ ] EditItem.tsx — Update to use vendor defaults (3 references to TRANSACTION_SOURCES)
- [ ] Run database migrations in production
- [ ] Test admin settings UI for vendor defaults management
- [ ] Test transaction forms with configured vendor defaults
- [ ] Verify empty slots are handled correctly
- [ ] Update documentation

---

## Implementation Details

### Files Created/Modified

**Database:**
- `supabase/migrations/015_add_vendor_defaults.sql` - Creates vendor_defaults table with RLS policies
- `supabase/migrations/016_seed_vendor_defaults.sql` - Seeds first 10 vendors from TRANSACTION_SOURCES

**Services:**
- `src/services/vendorDefaultsService.ts` - Service layer with:
  - `getVendorDefaults()` - Returns all 10 slots
  - `updateVendorSlot()` - Updates a single slot (1-10)
  - `updateVendorDefaults()` - Updates all slots
  - `getAvailableVendors()` - Returns non-null vendors for forms

**Components:**
- `src/components/VendorDefaultsManager.tsx` - Admin UI component for managing slots
- `src/pages/Settings.tsx` - Added VendorDefaultsManager section (admin-only)

**Forms Updated:**
- `src/pages/AddTransaction.tsx` - ✅ Complete
- `src/pages/EditTransaction.tsx` - ✅ Complete
- `src/pages/EditBusinessInventoryTransaction.tsx` - ✅ Complete
- `src/pages/AddBusinessInventoryTransaction.tsx` - 🔄 Render done, needs useEffect fix
- `src/pages/AddBusinessInventoryItem.tsx` - 🔄 Render done, needs useEffect fix
- `src/pages/AddItem.tsx` - ⏳ Pending
- `src/pages/EditItem.tsx` - ⏳ Pending

### Technical Notes

- **Vendor Identifier:** Using vendor name as both id and name (string-based, not UUID)
- **Empty Slots:** Allowed - slots can be null/empty and are filtered out in `getAvailableVendors()`
- **Duplicates:** Currently allowed - no uniqueness constraint enforced
- **RLS:** Uses `is_account_admin()` function for authorization checks
- **Fallback:** Service falls back to first 10 from TRANSACTION_SOURCES if no defaults exist

---

Purpose
- Provide exactly 10 configurable slots in Settings (admin-only). On first load the slots are pre-populated with the first 10 entries from the application's existing ordered source/vendor list. Admins can edit any slot individually and save changes. Transaction forms must use only these 10 slots as their source list (no fallback to any other source list).

Key constraints (explicit)
- There are exactly 10 slots (indexed 1..10). They always exist in the Settings UI.
- On initial seed, each slot is pre-filled from the first 10 entries of the app's existing ordered sources list.
- Admins can change any slot independently and save that single slot without affecting other slots.
- Transaction Add/Edit forms must only ever draw their source/vendor options from these 10 configured slots. No fallback to a broader vendor list; if a slot is empty that slot is treated as empty (but on initial seed they will be populated).
- Only admins may view or modify these slots.

- Scope
- UI: Admin-only Settings page that shows 10 fixed slots (1..10). Each slot displays vendor name + id (or empty), a freeform text input to enter any vendor/source string, and an individual Save button for that slot.
- Backend: Storage for an ordered array of exactly 10 vendor identifiers, an API to read all slots, and an API to update an individual slot (and optionally a bulk update endpoint).
- Transaction forms: Always fetch the 10-slot list and render only those as the available source options.
- Data: Migration/seed to pre-populate the 10 slots using the first 10 entries from the app's existing ordered sources.

High-level tasks (revised)
1. Identify where the app's ordered list of existing sources lives and record the first 10 entries (ids + names) for the initial seed.
2. Data model: store exactly 10 slots (ordered array length 10). Each slot holds either a vendor id or null/empty.
3. Backend endpoints:
   - GET /api/admin/vendor-defaults — returns an ordered array of 10 slots: { "slots": [ { "id": "v_x", "name": "..." } | null, ... ] }
   - PATCH /api/admin/vendor-defaults/slots/:index — update a single slot (index 1..10). Body: { "vendorId": "any string" | null }
   - (Optional) PUT /api/admin/vendor-defaults — replace all 10 slots in one call.
   - All endpoints require admin authorization.
4. Settings UI (admin-only):
   - Always show 10 rows labeled 1..10.
   - Each row shows the currently configured vendor (name + id) or "Empty".
   - Each row has an edit control that searches existing vendors/sources and a Save button to persist only that slot.
   - Show validation (e.g., prevent duplicate vendor ids if desired) — discuss if duplicates should be allowed.
5. Transaction form integration:
   - On load, fetch `/api/admin/vendor-defaults` and use the returned 10 slots as the complete source list for the vendor selector.
   - Render slots in order; skip empty slots if present (but do not add any other vendors).
   - No fallback to any other vendor list.
6. Authorization & UI visibility:
   - Only admins can call the APIs and see the Settings page. Non-admins won't see the settings UI.
7. Migration / Seed:
   - Create a migration/seed that pulls the current ordered sources and writes the first 10 into the slots table/value.
   - Document how to re-run the seed in environments.
8. Tests & Docs:
   - Unit tests for GET and PATCH endpoints (admin auth, validation).
   - UI tests for settings page visibility and per-slot save behavior.
   - Integration tests to ensure transaction forms only render from configured slots.
   - Update docs to explain the 10-slot behavior and that transaction forms only use these slots.

Selection and seed guidance
- The initial seed must use the application’s existing ordered source/vendor list and pick the first 10 entries in that exact order. Record both id and name into the seed so the Settings UI displays names immediately.
- Confirm which identifier to persist (database id, external id, or slug) and use it consistently.

Data model suggestions
- Preferred: A settings table with a single key `vendor_defaults.top_10` storing a JSON array of exactly 10 values (vendor id or null). This keeps retrieval cheap and ordering explicit.
- Alternative: A `vendor_default_slots` table with 10 rows (slot_index 1..10, vendor_id nullable, updated_by, updated_at).

API contract (examples)
- GET /api/admin/vendor-defaults
  - response: { "slots": [ { "id":"v_1","name":"Acme Co"}, null, { "id":"v_3","name":"Baz Ltd" }, ... ] } (length 10)
- PATCH /api/admin/vendor-defaults/slots/:index
  - body: { "vendorId": "v_2" | null }
  - response: 200 OK with updated slot
  - validations: index ∈ [1,10]; vendorId may be any string or null
  - errors: 400 validation / 403 unauthorized
- (Optional) PUT /api/admin/vendor-defaults
  - body: { "slots": [ "v_1", null, "v_3", ... ] } (exactly 10 entries)

UI details (exact)
- Settings page (Admins only):
  - Location: `Settings → Transaction Defaults` (or `Settings → Vendors`).
  - UI behavior:
    - Always display rows 1..10.
    - Each row: vendor display (name + id or "Empty"), a freeform text input edit control, and a single-slot Save button.
    - Edits only persist on clicking that row's Save; other rows are unaffected.
    - Optionally show a small "Last updated by / at" tag per row.
    - Provide a "Reset to seeded values" bulk action if desired (requires confirmation).
- Transaction Add/Edit form:
  - On open, synchronously fetch the 10-slot list and present only those items in the vendor selector (in order). Empty slots are omitted from the selector.
  - No fallback to any other vendor list; do not display any vendor not present in the configured slots.

Security & permissions
- Strict admin-only server-side checks for GET/PATCH/PUT endpoints.
- Client-side UI hidden from non-admin users.
- Record audit information for slot updates (who, what, when).

Deployment & rollout
1. Implement backend storage + GET and PATCH endpoints.
2. Implement migration/seed that populates slots from the app's ordered sources (first 10).
3. Deploy backend and run migration/seed.
4. Implement Settings UI and deploy frontend.
5. Update transaction forms to fetch and use the 10-slot list exclusively.
6. Run tests and monitor POST-deploy.

Acceptance criteria (revised)
- Settings UI shows exactly 10 slots pre-populated from the app's first-10 ordered sources.
- Admins can edit any slot and save that slot independently.
- Transaction Add/Edit pages only ever offer vendors that are present in the configured 10 slots (empty slots are skipped).
- Non-admins cannot view or modify slots.
- Initial values are populated via a migration/seed that draws the first 10 from the existing ordered source list.

Notes & follow-ups
- Decide whether duplicate vendor ids across slots are allowed; if not, enforce uniqueness in UI/backend.
- Confirm whether empty slots are permitted after admin edits (we currently allow null to clear a slot).
- Confirm which vendor identifier to persist.

Estimated effort (revised)
- Backend storage + GET/PATCH endpoints + seed: 1-2 days
- Settings UI (10-slot rows + per-slot save): 1-2 days
- Transaction form integration + tests: 1 day
- Tests & docs: 0.5-1 day

Mapping to todos (reconciled)
- Create plan markdown document for vendor defaults — ✅ done (this doc)
- Select first 10 existing vendors and record their IDs — ✅ done (Homegoods, Amazon, Wayfair, Target, Ross, Arhaus, Pottery Barn, Crate & Barrel, West Elm, Living Spaces)
- Create DB seed/migration for default top-10 vendors — ✅ done (`016_seed_vendor_defaults.sql`)
- Add admin-only settings page for managing top-10 defaults — ✅ done (`VendorDefaultsManager.tsx` + Settings integration)
- Load defaults into Add/Edit transaction pages — 🔄 in progress (most forms updated, 2 need useEffect fixes, 2 remaining)
- Add API endpoints and enforce admin RBAC — ✅ done (`vendorDefaultsService.ts` with RLS policies)
- Add tests and update documentation — ⏳ pending


