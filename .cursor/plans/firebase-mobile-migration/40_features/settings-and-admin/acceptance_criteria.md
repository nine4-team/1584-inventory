# Acceptance criteria: Settings + admin/owner management

Each criterion includes **parity evidence** (“Observed in …”) or an explicit **intentional delta**.

## Navigation + access
- [ ] **Settings is reachable from global navigation** and routes to the Settings screen.
  - Observed in `src/components/layout/Header.tsx` (Settings link to `/settings`).
- [ ] **Top-level tabs are role-gated**:
  - `General`: always visible
  - `Presets`: always visible
  - `Users`: visible only for admin/owner
  - `Account`: visible only for owner
  - Observed in `src/pages/Settings.tsx` (tab buttons guarded by `isOwner()` / `isAdmin`).

## General tab (profile)
- [ ] **Profile section shows full name, email, and role**, and indicates role changes require an admin.
  - Observed in `src/pages/Settings.tsx` (“Profile Information”).

## General tab (business profile; admin-only)
- [ ] **Business profile editor is visible only to admins**.
  - Observed in `src/pages/Settings.tsx` (`{isAdmin && (...)}`).
- [ ] **Business name is editable and required**; Save is disabled when blank.
  - Observed in `src/pages/Settings.tsx` (Save button disabled when `!businessNameInput.trim()`).
- [ ] **Logo upload validates file type and size** and shows an inline error for invalid images.
  - Observed in `src/pages/Settings.tsx` (`ImageUploadService.validateImageFile` with 10MB messaging).
- [ ] **Saving business profile**:
  - uploads logo (if changed) then updates business profile and refreshes context
  - shows success confirmation that auto-clears
  - shows error banner on failure
  - Observed in `src/pages/Settings.tsx` (`handleSaveProfile`, `profileSuccess`, `profileError`).

## Presets tab (admin-only)
- [ ] **Non-admin users see an access message**: “Presets are only configurable by account administrators.”
  - Observed in `src/pages/Settings.tsx`.

### Budget categories
- [ ] Admin can **view budget categories**, including archived categories when “Show Archived” is enabled.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`showArchived`, archived section).
- [ ] Admin can **create a budget category** with name required.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`handleStartCreate`, `handleSave`, name validation).
- [ ] Admin can **edit a budget category name**.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`handleStartEdit`, `updateCategory`).
- [ ] Admin can **archive/unarchive** budget categories.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`archiveCategory`, `unarchiveCategory`).
- [ ] Admin can **reorder active categories by drag** and order is persisted.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`handleDrag*`, `setBudgetCategoryOrder`).
- [ ] Admin can **toggle itemization enabled** for a category with an explanatory tooltip.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`handleToggleItemization`, `getItemizationEnabled`).
- [ ] Admin can set an **account-wide default transaction category** and save it.
  - Observed in `src/components/BudgetCategoriesManager.tsx` (`getDefaultCategory`, `setDefaultCategory`).

### Vendor defaults
- [ ] Admin can **view and edit 10 vendor slots** (freeform text) and save per-slot.
  - Observed in `src/components/VendorDefaultsManager.tsx` (`updateVendorSlot`, “Slot \(n\) updated successfully”).
- [ ] Admin can **clear a vendor slot**.
  - Observed in `src/components/VendorDefaultsManager.tsx` (`handleDeleteSlot`).
- [ ] Admin can **reorder vendor slots by drag** and new order is persisted.
  - Observed in `src/components/VendorDefaultsManager.tsx` (`handleDrag*`, saving each slot’s new position).

### Tax presets
- [ ] Admin can **view and reorder tax presets** by drag and persist order.
  - Observed in `src/components/TaxPresetsManager.tsx` (`handleDrag*`, `updateTaxPresets`).
- [ ] Admin can **edit a tax preset**:
  - name is required
  - rate must be between 0 and 100
  - Observed in `src/components/TaxPresetsManager.tsx` (`handleSaveEdit` validation).
- [ ] Admin can **delete a tax preset** but cannot delete the last remaining preset.
  - Observed in `src/components/TaxPresetsManager.tsx` (`if (presets.length <= 1) ...`).

### Space templates
- [ ] Admin can **create/edit a space template**; name is required; notes are optional.
  - Observed in `src/components/spaces/SpaceTemplatesManager.tsx` (`handleSave` validation).
- [ ] Admin can **edit checklists inside a template**, including adding/removing checklists and items.
  - Observed in `src/components/spaces/SpaceTemplatesManager.tsx` (checklists editor in modal).
- [ ] Admin can **archive/unarchive** templates.
  - Observed in `src/components/spaces/SpaceTemplatesManager.tsx` (`archiveTemplate`, `unarchiveTemplate`).
- [ ] Admin can **reorder templates by drag** and persist order.
  - Observed in `src/components/spaces/SpaceTemplatesManager.tsx` (`updateTemplateOrder`).

## Users tab (admin/owner)
- [ ] Users tab is accessible only to admin/owner.
  - Observed in `src/pages/Settings.tsx` and `src/components/auth/UserManagement.tsx` (`canManageUsers`).
- [ ] Admin/owner can **create an invitation link** (email + role).
  - Observed in `src/components/auth/UserManagement.tsx` (`createUserInvitation`).
- [ ] The invitation link is **copied to clipboard** and confirmation feedback is shown.
  - Observed in `src/components/auth/UserManagement.tsx` (`navigator.clipboard.writeText`, `copiedToken`).
- [ ] Pending invitations are displayed with **copy link** affordance.
  - Observed in `src/components/auth/UserManagement.tsx` (`getPendingInvitations`, list with copy button).
- [ ] Team members list shows name, email, and role badge.
  - Observed in `src/components/auth/UserManagement.tsx`.

## Account tab (owner)
- [ ] Account tab is accessible only to owner.
  - Observed in `src/pages/Settings.tsx` and `src/components/auth/AccountManagement.tsx` (`isOwner()` gating).
- [ ] Owner can **create a new account** (account name + first user email required).
  - Observed in `src/components/auth/AccountManagement.tsx` (`createAccount`, validation).
- [ ] After account creation, an **invitation link is displayed** with copy affordance.
  - Observed in `src/components/auth/AccountManagement.tsx` (invitation link display + copy).
- [ ] Owner can **view all accounts** and expand an account to view **pending invitations** with copy buttons.
  - Observed in `src/components/auth/AccountManagement.tsx` (`getAllPendingInvitationsForAccounts`, expand/collapse UI).

## Offline policy (intentional delta)
- [ ] **Preset reads** must work offline if previously cached.
  - Intentional delta vs web: web parity fetches directly; mobile requires explicit local caching (see `40_features/sync_engine_spec.plan.md`).
- [ ] **Admin/owner writes** in Settings are **online-required** by default (business profile updates, presets mutations, invites, account creation).
  - Intentional delta: make offline failure explicit and immediate (no “false success”).

