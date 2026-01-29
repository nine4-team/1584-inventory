# Screen contract: `TransactionForm` (create + edit)

## Intent
Create or edit a transaction in the current workspace scope (project or business inventory) with predictable validation, explicit offline prerequisites gating, and offline-safe media attachment behavior.

Shared-module requirement:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Canonical vs non-canonical constraint (new model; required)

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Rules:

- This form is for **user-facing (non-canonical)** transactions.
- **Canonical inventory transactions** (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`) are system-generated and should be treated as **read-only** (recommended: hide/disable “Edit” entrypoint for canonical rows).

## Inputs
- Route params:
  - `scope`: `'project' | 'inventory'`
  - `projectId` (required when `scope === 'project'`; absent when `scope === 'inventory'`)
  - `transactionId` (edit only)
- Query params:
  - `returnTo` (optional back destination)
- Entry points:
  - Transactions list → “Create Manually” (`AddTransaction`)
  - Transaction detail → “Edit” (`EditTransaction`)

## Reads (local-first)
- Local DB queries:
  - Project name (for labeling and media path hints; only when `scope === 'project'`)
  - Budget categories (for category picker)
  - Vendor defaults (for source picker)
  - Tax presets (for tax preset picker)
  - Account default category (initial default)
  - Transaction (edit only)
  - Transaction items (edit only; and optionally create form if itemization enabled)
- Derived view models:
  - `itemizationEnabled` derived from selected category
- Cached metadata dependencies:
  - Budget categories, vendor defaults, tax presets, account presets (default category)

## Writes (local-first)

### Create (submit)
- Local DB mutation(s):
  - Insert `transactions` row with form fields
  - Insert/associate any transaction items created in-form (if itemization enabled)
  - Persist media attachment metadata arrays:
    - `receiptImages[]`
    - `otherImages[]`
    - (legacy compat) `transactionImages[]` may mirror receipts
- Outbox op(s) enqueued:
  - `createTransaction` with idempotency key (e.g. `tx:create:<clientMutationId>`)
  - Media upload ops for any `offline://` placeholders, plus eventual patch of transaction’s image arrays to server URLs
  - Item creates/updates as part of transaction creation (must be deterministic and idempotent)
- Change-signal:
  - Bump project `meta/sync` (conceptually) for transactions/items.

### Edit (submit)
- Local DB mutation(s):
  - Update `transactions` fields
  - Update attachments arrays for receipts/other images
  - Update existing items and/or create new items if user adds “draft” items
- Outbox op(s) enqueued:
  - `updateTransaction` (fields + arrays)
  - Item ops as needed (update/create/unlink)
  - Media uploads for newly added files (offline placeholders)

## UI structure (high level)
- Header:
  - Back (returnTo/stacked back)
  - Retry sync button when sync error is present
- Form sections:
  - Source/vendor selection (vendor slots + custom “Other”)
  - Budget category picker (required)
  - Transaction type (Purchase/Return)
  - Payment method (Client Card / Company)
  - Status (edit only: pending/completed/canceled)
  - Reimbursement type (None / owed-to-company / owed-to-client)
  - Amount (required)
  - Tax preset selection + optional Subtotal (“Other”)
  - Transaction date
  - Notes
  - Transaction items (only when itemization enabled; edit also shows if existing items exist)
  - Receipts upload
  - Receipt emailed toggle
  - Other images upload
- Footer actions:
  - Cancel
  - Save/Create with disabled state when submitting or prerequisites not ready

## User actions → behavior (the contract)
- **Offline prerequisites not ready**:
  - Show a banner and disable submit.
  - On submit attempt, show an error explaining prerequisites must be synced.
- **Source selection**:
  - Choosing a vendor radio sets `source`.
  - Choosing “Other” clears source and shows a text input.
- **Category selection**:
  - Required.
  - Changing category may enable/disable itemization; if disabling but there are existing items (edit), show warning and still allow managing existing items.
  - New requirement (item attribution determinism): if editing a non-canonical transaction and the category changes, update all linked items to keep attribution deterministic:
    - `item.inheritedBudgetCategoryId = transaction.category_id` for each linked item
    - This ensures future canonical inventory transactions can attribute amounts by item category without asking the user to learn a “canonical category”.
- **Amount**:
  - Required and must be positive.
- **Tax preset**:
  - “No Tax” sets tax rate pct=0.
  - Selecting a preset shows its percentage.
  - “Other” requires subtotal; subtotal cannot exceed total amount.
- **Receipts + other images**:
  - Adding files:
    - Online: upload and attach
    - Offline: create `offline://<mediaId>` placeholder and attach immediately; queued upload later
  - Removing files:
    - Removes from the attached array immediately.
    - If file is an `offline://` placeholder, also deletes the local media blob file.
- **Status ↔ reimbursement coupling (edit)**:
  - If status becomes `completed` while reimbursement is set, reimbursement is cleared.
  - If reimbursement is set while status is `completed`, status becomes `pending`.

## States
- Loading:
  - Edit shows “Loading transaction…” while hydrating/fetching.
- Error:
  - General error banner displays submission failures.
- Offline:
  - Form remains usable if prerequisites are warm; otherwise it is blocked.
- Pending sync:
  - After saving offline or with placeholder uploads, show “saved offline” feedback and allow user to navigate away.
- Permissions denied:
  - Create: deny when user lacks account context (unless system owner).
  - Edit: deny when user lacks required role.
- Quota/media blocked:
  - If the local media subsystem is full, media selection should be blocked with an explicit message (cross-cutting quota behavior).

## Media (if applicable)
- Receipt attachments accept images and PDFs.
- Other images accept images.
- Placeholder URLs use `offline://<mediaId>` and must render via local blob resolution in previews.

## Collaboration / realtime expectations
- Form does not require live collaboration; changes should converge via outbox + delta sync.

## Performance notes
- Avoid per-item network calls during itemization edits; use local DB and batched outbox ops.

## Parity evidence
- Create prerequisites gate + banner: Observed in `src/pages/AddTransaction.tsx` (`useOfflinePrerequisiteGate`, `OfflinePrerequisiteBanner`).
- Default category (online vs cached): Observed in `src/pages/AddTransaction.tsx` (`getDefaultCategory`, `getCachedDefaultCategory`).
- Vendor defaults (online vs cached): Observed in `src/pages/AddTransaction.tsx` (`getAvailableVendors`, `getCachedVendorDefaults`).
- Tax presets (online vs cached): Observed in `src/pages/AddTransaction.tsx` (`getTaxPresets`, `getCachedTaxPresets`, `NO_TAX_PRESET_ID`, `Other` validation).
- Edit permission gating: Observed in `src/pages/EditTransaction.tsx` (`hasRole(UserRole.USER)`).
- Edit status ↔ reimbursement coupling: Observed in `src/pages/EditTransaction.tsx` (`handleInputChange`).
- Existing image preview/removal: Observed in `src/pages/EditTransaction.tsx` (`TransactionImagePreview`, remove handlers).
- Offline placeholder upload path: Observed in `src/pages/AddTransaction.tsx`/`src/pages/EditTransaction.tsx` (`OfflineAwareImageService.upload*`).
