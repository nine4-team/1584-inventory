# Feature spec: Settings + admin/owner management

## Summary
`settings-and-admin` is the administrative and configuration hub for an account. It includes:

- Read-only profile view for all users.
- Admin-managed configuration that drives other modules (business profile, presets).
- Admin/owner flows for invitations and user/account management.

This feature is **not collaborative in the realtime sense** (no “live updates” required), but it must be **correct and explicit** about online-required mutations and about offline readability of presets.

## Owned screens
- `Settings` (tabbed screen): see `ui/screens/Settings.md`

## Primary user flows (parity)

### A) View profile + role
- Open Settings → General → Profile section shows name/email/role.

Parity evidence: `src/pages/Settings.tsx`.

### B) (Admin) Update business profile (name + logo)
- Open Settings → General → Business Profile section.
- Edit business name.
- Optionally pick a logo file → preview renders immediately.
- Save:
  - Upload logo (if changed) then update business profile record.
  - Success banner appears and auto-clears.

Parity evidence:
- UI + save sequencing: `src/pages/Settings.tsx` (`handleSaveProfile`).
- Read/write: `src/contexts/BusinessProfileContext.tsx`, `src/services/businessProfileService.ts`.
- Logo upload + validation: `src/services/imageService.ts`, `src/pages/Settings.tsx` (`validateImageFile`, `uploadBusinessLogo`).

### C) (Admin) Manage presets
Open Settings → Presets → choose one:

- Budget categories:
  - Create/edit category (name required)
  - Archive/unarchive categories
  - Reorder categories by drag
  - Toggle per-category “itemization enabled”
  - Set account-wide default transaction category

Parity evidence: `src/components/BudgetCategoriesManager.tsx`.

- Vendor defaults:
  - 10 slots; edit a slot (freeform vendor/source name) and save
  - Clear a slot
  - Reorder slots by drag

Parity evidence: `src/components/VendorDefaultsManager.tsx`.

- Tax presets:
  - Edit a preset (name required; rate 0–100)
  - Delete a preset (must keep at least one)
  - Reorder presets by drag

Parity evidence: `src/components/TaxPresetsManager.tsx`.

- Space templates:
  - Create/edit template (name required, notes optional)
  - Edit checklists: checklist + items CRUD inside the template editor
  - Archive/unarchive templates
  - Reorder templates by drag

Parity evidence: `src/components/spaces/SpaceTemplatesManager.tsx`.

### D) (Admin/Owner) Invite users, view pending invites, view team roster
- Open Settings → Users.
- Create invitation link (email + role selection).
- Link is copied to clipboard automatically; pending invitations show copy action.
- Team list shows users and role badges.

Parity evidence: `src/components/auth/UserManagement.tsx`.

### E) (Owner) Create accounts + manage account-level pending invitations
- Open Settings → Account.
- Create account: provide account name + first user email (admin).
- A new invitation link is shown with a copy button.
- Accounts list shows pending invitations; expands to show invitation links and copy affordances.

Parity evidence: `src/components/auth/AccountManagement.tsx`.

## Entities touched (conceptual; Firebase mapping)
These are “small metadata” entities that must sync efficiently and be cached locally:

- `accounts` / business profile fields (name, logo URL, versioning metadata)
- `budget_categories` (including archive state and optional metadata like itemization enabled)
- `vendor_defaults` (10 slots + ordering)
- `tax_presets` (array/collection with ordering)
- `space_templates` (including nested checklists)
- `account_memberships` / users list
- `invitations` (pending invitations per account)

## Offline behavior (required)

### Reads (must work offline)
- Presets (budget categories, vendor defaults, tax presets, space templates) must be readable offline because:
  - transaction forms require vendors/tax/categories
  - space creation requires templates

Implementation note:
- This implies the sync engine must treat these as “metadata collections” that are hydrated early and stored in SQLite (or equivalent).

### Writes (policy)
- Admin/owner writes in Settings should be **online-required by default** (business profile update, presets mutation, invites, account creation).
  - Intentional delta: web parity does not always hard-block offline actions; RN should be explicit to avoid “false success” flows.
  - If we later introduce “metadata outbox” writes, this spec can be updated to allow queued writes with clear pending UX.

### App restart / reconnect
- If presets were previously cached:
  - App restart offline should still allow downstream screens to function using cached presets.
- On reconnect:
  - A foreground sync should refresh metadata collections; Settings should reflect updated values on next open (or via manual refresh where present).

## Permissions / role gating (required)
- **Everyone**: can access Settings → General → Profile section.
- **Admin (or owner)**:
  - can access Business Profile editor
  - can access Presets editor
  - can access Users tab
- **Owner only**:
  - can access Account tab

Parity evidence:
- Tab visibility: `src/pages/Settings.tsx` (`isOwner()`, `isAdmin`).
- Users / account access checks: `src/components/auth/UserManagement.tsx`, `src/components/auth/AccountManagement.tsx`.

## Error states (required)
- Not authenticated / no account context:
  - Settings should fail closed: show “No account found…” messaging where accountId is required.
- Network offline:
  - For admin/owner write actions: show a clear “requires connection” error.
- Validation errors:
  - Business profile name required
  - Logo file validation (type + size)
  - Tax preset validation (name required; 0–100)

## Collaboration / realtime needs
- **No** realtime requirement; eventual consistency is sufficient.
- Do not implement via large listeners. If we need near-real-time freshness, treat it as metadata delta sync triggered by change-signal and/or foreground sync.

## Dependencies
- Auth + account context (user role, current accountId): `src/contexts/AuthContext.tsx`, `src/contexts/AccountContext.tsx`
- Business profile context/service: `src/contexts/BusinessProfileContext.tsx`, `src/services/businessProfileService.ts`
- Offline prerequisites / metadata caching: `src/services/offlineStore.ts` (existing web parity caching for some metadata), and sync engine spec for Firebase.
- Media upload pipeline: `src/services/imageService.ts`, plus quota guardrail for offline selection:
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

