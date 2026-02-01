# Feature list (target app scope) — Firebase Mobile Ledger

This is the **canonical feature list** for the **new React Native + Firebase** app we’re building.

- Use this doc as **scope/roadmap** (what we are building, including net-new features) **and** as the consolidated parity inventory (what exists today).

Notes:

- Features should remain compatible with the offline-first invariants in `../sync_engine_spec.plan.md` (outbox + delta sync + change-signal; avoid read amplification).
- This list is intentionally high-level; implementation details live under `40_features/` and `_cross_cutting/`.
- **Non-exhaustive by design**: the bullet points under each feature are **not a complete inventory** of behavior. Anyone fleshing a feature out must assume there are additional sub-flows, edge cases, and cross-cutting requirements that need to be discovered and captured.

---

## A) Foundation (must-have platform capabilities)

- **Auth + account context + invitations**
  - Sign in/up, join account via invite, select/switch account where applicable.
- **Offline-first sync engine**
  - SQLite local source of truth, outbox, delta sync, conflict handling, media lifecycle, change-signal listener health.
- **Global sync UX**
  - Connectivity banner, pending state counts, retry UX, error surfacing.
- **Roles v1 (coarse)**
  - `owner/admin/member` gating for settings, presets, invites, destructive operations.

---

## B) Core product (parity-driven areas)

This section is organized **domain-first**:

- “Project” and “Business inventory” are **two workspaces/scopes** that host the same core modules.
- The core reusable modules are **Items**, **Transactions**, and **Spaces**.
- Anything that spans modules (bulk selection, attachments, allocation, etc.) is captured as **shared flows/components** (see section E).

### B0) Workspaces (scope shells)

- **Projects (workspace shell)**
  - Create/edit/delete projects; project home/shell/navigation; manual refresh; project-level settings (budget, design fee, category budgets, main image).
- **Business inventory (workspace shell)**
  - Inventory “home” with Items/Transactions/Spaces tabs (spaces are “storage locations”); allocation entrypoints into projects; manual refresh.

### B1) Items (shared domain module; used by both workspaces)

- **Items**
  - Item CRUD, list/search/sort/filter/group, bulk selection + bulk actions, images, QR, bookmarks, duplicate grouping, dispositions/status, and assignment to space/transaction.
  - **Same attribute shape across scopes** (project items and inventory items are the same “Item” entity; scoping differs).

### B2) Transactions (shared domain module; scope-specific constraints)

- **Transactions**
  - Transaction CRUD, list/search/sort/filter, status, receipts/attachments, CSV export, and browsing/managing attached items (“itemization” UX).
  - **Project vs inventory** may differ in allowed types/controls and in how rollups/reimbursements are interpreted, but the base “Transaction” entity and UI primitives should be reusable.

### B3) Spaces (shared domain module; scope-specific labeling)

- **Spaces**
  - Space CRUD, checklists, notes, images, and item assignment.
  - Space templates (created/managed in presets) and “create from template / save as template”.
  - In business inventory, these are “storage spaces/locations” but should be the **same underlying Space entity**.

### B4) Inventory operations + lineage (cross-workspace correctness; server-owned invariants)

- **Inventory operations + lineage**
  - Allocate/move/sell/deallocate items across project ↔ inventory scopes; item ↔ transaction linking/unlinking; canonical IDs; lineage visibility cues.
  - Multi-doc correctness, idempotency, and retries enforced via server-owned invariants (callable functions/transactions).

### B5) Budget + accounting rollups (project-only module)

- **Budget + accounting rollups**
  - Budget progress and accounting summaries/rollups derived from local data (project context).

### B6) Reports + share/print (project-only module)

- **Reports + share/print**
  - Invoice and summary outputs; mobile sharing/printing (project context).

### B7) Invoice import (parsers that generate transactions/items)

- **Invoice import**
  - Vendor PDF import flows (if retained) that generate transactions (and sometimes items), with robust media + long-running UX.

### B8) Settings + presets (global configuration that feeds other modules)

- **Settings + presets**
  - Business profile (name/logo).
  - Budget category presets.
  - Vendor defaults presets.
  - Tax presets (may be simplified/streamlined vs current).
  - Space template presets (templates include name, notes, and checklists).

---

## C) Net-new planned features (not in the existing web app map, but must be compatible)

### C1) Roles v2: scoped visibility + permissions (budget-category + ownership)

Goal: allow an admin to restrict what a user can **see** and **do**. Example: a kitchen staff member only sees kitchen-category work (and optionally only their own created records).

Security-enforcement compatibility requirements (high-level):

- **Rules-enforceable scoping**: scope data must be checkable via `exists()`/`get()` by known paths.
- **Denormalized selectors**: any entity whose visibility depends on budget category needs a direct selector (prefer `item.inheritedBudgetCategoryId`; use `transaction.budgetCategoryId` for non-canonical transactions) or a server-owned derived field.
- **Ownership fallback** requires `createdBy` fields that are validated at write time.
- **Server-owned invariants**: multi-doc operations validate permissions in callable Functions.

(See `../10_architecture/security_model.md` for enforcement strategy shape.)

### C2) Admin-managed restrictions beyond visibility

Future extension: admin can restrict actions (create/edit/delete/export) per scope or per module (items vs transactions vs reports), still enforced by Rules/Functions.

### C3) Monetization: free tier + upgrade gating (entitlements)

Goal: allow signup with a free tier (e.g., **1 free project**), then prompt for upgrade to create more projects.

Implementation constraints (high-level):

- Firestore Rules cannot safely “count projects” (no server-side aggregate/query in rules), so **project creation must be a server-owned operation** (callable Function) when entitlements are enforced.
- Offline behavior must be explicit: if the user is over the limit while offline, block creation or create a local-only draft that won’t sync until upgraded.

Spec home (cross-cutting): `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`.

---

## D) How to turn this list into specs

- For any feature in A/B/C, create or update `40_features/<feature_slug>/` docs.
- Put shared contracts/flows under `40_features/_cross_cutting/` (e.g., roles/permissions, conflict UX, media lifecycle).
- Follow the canonical speccing workflow in `40_features/_authoring/feature_speccing_workflow.md` (feature folders, prompt packs, templates, evidence rule).
- When expanding a feature, **actively hunt for “everything it does”**:
  - Start from **Appendix X** in this doc (observed behaviors, screen ownership, flows).
  - Capture cross-cutting reuse from section E (list controls, bulk ops, media lifecycle, linking/itemization, QR, pending/error UX, conflicts).
  - Include “boring but critical” behaviors: permission gating, empty/error states, performance constraints, and offline-first invariants.

---

## E) Shared components + shared flows (reuse index for spec authors)

These are not “features” by themselves, but **must be spec’d once and reused** across Project + Business Inventory contexts.

- **Shared Items + Transactions modules**: required shared-component contract for lists, menus, details, and forms across scopes:
  - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- **List controls**: search/filter/sort/grouping, state persistence/restoration, large-list performance assumptions (SQLite indexes).
- **Bulk selection + bulk actions**: select all / per-group select, bulk edit/assign/delete flows.
- **Attachment/media UI**: capture/select, placeholder states (`local_only`/`uploading`/`uploaded`/`failed`), retry and cleanup.
- **Offline media lifecycle (offline cache + uploads + cleanup)**:
  - `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`
  - Guardrails subcomponent (global warning + offline attachment gating):
    - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`
- **Cross-linking UI**: item ↔ transaction linking (“itemization”), item ↔ space assignment, pickers and browse-in-context behaviors.
- **QR flows**: generate/show/print/share QR codes, and the navigation affordances around QR.
- **Pending/sync/error UX**: consistent pending markers, error surfacing, retry affordances that map to outbox + delta sync.
- **Conflict UX**: detection, persistence, and resolution patterns for high-risk fields (money/category/tax).

---

## Appendix X) Observed feature inventory (existing Ledger app)

The following section is a verbatim copy of the prior `feature_map_from_existing_app.md`, preserved here so **no parity evidence/inventory was lost** while still maintaining **one canonical feature list file**.

### Feature Map (Observed) — Ledger → React Native + Firebase (Offline‑First)

This is a **spec-seed feature map**: it inventories the **actual user-visible capabilities** in the current Ledger app (web), and groups them into cohesive units suitable for `40_features/<feature>/...` specs.

For the **target mobile app scope** (including net-new planned features that do not exist in the web app, like scoped roles/permissions), see:

- `40_features/feature_list.md`

## 0) Compatibility rule (do NOT port conflicting behaviors)

This feature map is **not** a “port it 1:1” checklist. The target architecture is the offline-first sync engine described in:

- `/.cursor/plans/firebase-mobile-migration/sync_engine_spec.plan.md`

Therefore, any parity spec produced from this map must obey these invariants:

- **UI reads/writes local DB only**: screens render from SQLite; user edits write SQLite immediately.
- **Explicit outbox**: all remote mutations flow through outbox ops + idempotency (`lastMutationId`).
- **Delta sync only**: remote state reaches the device via delta fetch (by `updatedAt` cursor) applied into SQLite.
- **One tiny listener per active project**: only `meta/sync` is live-listened; **no listeners** on large collections.
- **Server-owned invariants**: multi-doc operations (allocation/sale/lineage/rollups) must be callable-function/transaction based.
- **No read amplification**: avoid patterns like “subscribe to all items/transactions” or “keep arrays updated everywhere.”

Evidence sources (all in-repo):
- Routing: `src/App.tsx`
- App bootstrap (providers + PWA registration): `src/main.tsx`
- Screens: `src/pages/*`
- Auth shell: `src/contexts/AuthContext.tsx`, `src/components/auth/{ProtectedRoute,Login}.tsx`
- Always-on UI: `src/components/{NetworkStatus,SyncStatus,BackgroundSyncErrorNotifier}.tsx`, `src/components/ui/{RetrySyncButton,StorageQuotaWarning}.tsx`
- Offline/collab primitives used by screens: `offlineStore`, `operationQueue`, `syncScheduler`, `offlineMediaService`, conflict UI/services.
- PWA/service worker + background sync loop (web-only, but parity-relevant conceptually): `vite.config.ts`, `public/sw-custom.js`, `src/services/serviceWorker.ts`

---

## 1) Features (numbered)

### 1) Authentication (Google + email/password) + invitation acceptance
- **feature_slug**: `auth-and-invitations`
- **Short description**: Authenticate users (Google OAuth and email/password) and let invited users join an account via tokenized invite links. Establishes session + current account context used everywhere else.
- **Owned screens**:
  - `Login` (rendered by `ProtectedRoute` when unauthenticated)
  - `AuthCallback`
  - `InviteAccept`
- **Primary user flows**:
  - Unauthenticated → `ProtectedRoute` renders `Login` (choose Google or email/password)
  - OAuth callback → session established → navigate into app
  - Email/password login → session established → navigate into app
  - Invite link (`/invite/:token`) → validate token → accept → join account → navigate into app
- **Notable behaviors / constraints**:
  - Auth bootstrap has a **safety timeout**; if auth initialization stalls it flips into a “show login” state (`timedOutWithoutAuth`) instead of infinite spinner.
  - Invite acceptance flow supports both Google OAuth and email/password signup (invite stores token locally to survive OAuth redirect).
- **Entities touched**: users, accounts, invitations, account memberships/roles
- **Offline behaviors required**:
  - **Boot offline** into cached data when a valid session/account context already exists locally
  - If offline at auth time: **block** with clear “requires connection” messaging + retry path
- **Collaboration/realtime needs**: **No**
- **Risk level**: **Med** — token expiry, redirect race conditions, and “wrong account context” can strand users.
- **Dependencies**:
  - Requires auth shell + secure session persistence
  - Requires account context resolution + storage

### 2) App shell: connectivity + sync status + retry UX
- **feature_slug**: `connectivity-and-sync-status`
- **Short description**: Global, always-on UI that makes offline-first behavior understandable: offline banner, slow-connection banner, pending-sync banner, retry button, and background-sync error toasts.
- **Owned screens/components** (global UI):
  - `NetworkStatus` (top banner)
  - `SyncStatus` (bottom-right banner)
  - `RetrySyncButton`
  - `BackgroundSyncErrorNotifier` (toasts)
- **Primary user flows**:
  - Go offline → see “Offline — changes will sync when reconnected”
  - Have queued changes → see “N changes pending”
  - Sync error → see error banner + press “Retry sync”
  - Background sync fails → get a toast (warning if “offline”, error otherwise)
- **Entities touched**: outbox operations, sync scheduler state, “realtime health telemetry” (project-level freshness/disconnect info)
- **Offline behaviors required**:
  - UI must be **local-only** (no network dependency)
  - Provide clear pending/working/error/waiting states while offline/online
  - Retry triggers **foreground sync** + “warm metadata caches” if online
- **Collaboration/realtime needs**: **Yes** (indirect) — banner includes “channels stale/disconnected” signals today; in Firebase this maps to “signal listener health” + last delta run timestamps.
- **Risk level**: **Med** — if this is wrong or noisy, users lose trust in offline-first.
- **Dependencies**:
  - Requires sync engine (outbox, scheduler, manual trigger)
  - Requires offline prerequisites hydration concept (metadata warming)
  - Requires toast system (global notifications)
- **Architecture compatibility notes**:
  - The “sync status” UX must reflect **outbox + delta sync + `meta/sync` health**, not a web-style realtime subscription status.
  - “Retry sync” should trigger **foreground outbox flush + targeted delta catch-up**, not force large listeners.

### 4) Settings + admin/owner management
- **feature_slug**: `settings-and-admin`
- **Short description**: Settings hub for profile info plus admin/owner-managed configuration and presets that drive the rest of the product.
- **Owned screens**:
  - `Settings`
- **Primary user flows**:
  - View current user profile/role
  - Business profile (admin-gated):
    - Update business name
    - Upload/update business logo
  - Presets (admin-gated):
    - Budget categories manager
    - Vendor defaults manager
    - Tax presets manager
    - Space templates manager
  - Users tab (owner/admin): manage users (membership + roles)
  - Account tab (owner): account management
- **Entities touched**: users, memberships/roles, business_profile, budget_categories, vendor_defaults, tax_presets, space_templates, account metadata
- **Offline behaviors required**:
  - Presets must be **readable offline** because downstream screens depend on them (category pickers, vendor pickers, tax computations, templates)
  - For mutations: either queue or explicitly require online; whichever you choose, provide consistent UX + pending states
- **Collaboration/realtime needs**: **No** (eventual refresh is fine)
- **Risk level**: **Med** — permission gating, logo upload, preset correctness affecting many screens.
- **Dependencies**:
  - Requires roles/permissions model
  - Requires media pipeline (logo upload)
  - Requires sync engine for “metadata collections”

### 5) Projects: list + project shell + project-level actions
- **feature_slug**: `projects`
- **Short description**: Create/manage projects and provide a project “home” shell with navigation, refresh, edit, and delete flows.
- **Owned screens**:
  - `Projects`
  - `ProjectLayout` (project wrapper with section navigation and project actions)
  - `ProjectLegacyTabRedirect` / `ProjectLegacyEntityRedirect` (redirect-only; parity convenience)
- **Primary user flows**:
  - Browse projects → open project
  - Create project (via `ProjectForm`)
  - Edit project (name, description, client name, budget, design fee, category budgets, main image, settings)
  - Delete project (confirm, with warning if project contains items)
  - Refresh project data (manual refresh control)
  - Navigate between sections (items/transactions/spaces/budget) and persist last section
- **Entities touched**: projects, items, transactions, spaces, business_profile (branding used in reports), membership/roles
- **Offline behaviors required**:
  - Browse projects from local DB when offline
  - Open a project offline and show last-known snapshot
  - Pending states for create/update/delete
  - Offline-specific error state that auto-recovers on reconnect
- **Collaboration/realtime needs**: **Yes** — project and lists update across users while active.
- **Risk level**: **Med** — multi-collection freshness and deletion correctness.
- **Dependencies**:
  - Requires auth + account context
  - Requires sync engine + local DB schema for projects
  - Depends on connectivity/sync-status UX (global)

### 6) Project items: list/search/filter/sort + detail + CRUD + bulk ops + QR
- **feature_slug**: `project-items`
- **Short description**: Project-scoped item management, including rich list controls (filters/sorts/grouping), bulk editing, item detail navigation, and item images.
- **Owned screens**:
  - `ProjectItemsPage`
  - `InventoryList` (project list UI)
  - `ItemDetail`
  - `AddItem`
  - `EditItem`
- **Primary user flows**:
  - List + browse:
    - Search query filtering (client-side today; must be local DB query in RN)
    - Filter modes observed in list UI:
      - all
      - bookmarked
      - no-sku
      - no-description
      - no-project-price
      - no-image
      - no-transaction
      - to-return
      - returned
      - from-inventory
    - Sort modes:
      - alphabetical
      - creationDate
    - Duplicate grouping in list + per-item “duplicate index/count”
  - Item CRUD:
    - Create item (supports quantity/bulk create)
    - Edit item fields
    - Delete item (confirm)
  - Bulk actions (via `BulkItemControls`):
    - Assign to transaction
    - Set space (including clearing space)
    - Set disposition/status
    - Set SKU
    - Delete selected
  - Item detail UX:
    - Next/previous navigation while preserving list state
    - Bookmark toggle
    - Image management (add/remove/set primary)
    - View QR code (item detail) + “Generate QR Codes” (list action)
  - Disposition changes:
    - Changing disposition to `inventory` triggers deallocation behavior (see cross-cutting “allocation/deallocation”)
- Budget category attribution (canonical transactions):
  - Each item must persist a stable `inheritedBudgetCategoryId` (see `inventory-operations-and-lineage` + canonical attribution rules).
  - Canonical inventory transactions should not require a user-facing budget category; budgeting attribution is item-driven via linked items.
- **Entities touched**: items, item images/media, spaces, transactions (link), projects, conflicts (item conflicts), outbox ops, QR key (`qrKey`), `inheritedBudgetCategoryId`
- **Offline behaviors required**:
  - Create/edit/delete offline (local-first)
  - Bulk actions offline (queued ops; show partial failures)
  - Instant list operations at scale (indexes + local search)
  - Media placeholders while offline; cleanup of unsaved media
  - Conflict banner + resolution flow when conflicts exist
- **Collaboration/realtime needs**: **Yes** — other users’ edits should appear quickly in active project.
- **Risk level**: **High** — performance at scale, bulk ops, media lifecycle, and conflicts on shared items.
- **Dependencies**:
  - Requires local DB + search/indexes
  - Requires outbox + idempotency + retries
  - Requires media pipeline + quota handling
  - Requires conflict detection/resolution UX
  - Requires sync engine + change-signal strategy

### 7) Project transactions: list/search/filter/sort + detail + CRUD + receipts + CSV export
- **feature_slug**: `project-transactions`
- **Short description**: Project-scoped transaction management including receipts/attachments, rich list filters/sorts, edit flows, and CSV export.
- **Owned screens**:
  - `ProjectTransactionsPage`
  - `TransactionsList`
  - `TransactionDetail`
  - `AddTransaction`
  - `EditTransaction`
- **Primary user flows**:
  - List + browse:
    - Search by displayed title/source/type/notes/amount (observed)
    - Sort modes:
      - date-desc / date-asc
      - created-desc / created-asc
      - source-asc / source-desc
      - amount-desc / amount-asc
    - Filter “menu views” observed:
      - reimbursement-status (all / we-owe / client-owes)
      - email-receipt (all / yes / no)
      - source
      - purchase-method
      - transaction-type
      - completeness
      - budget-category
    - “Needs review” filtering is present in code paths (transactions may be flagged)
  - Transaction CRUD:
    - Create transaction (category, type, payment method, amounts, dates, notes)
    - Edit transaction
    - Status changes (pending/completed/canceled)
    - Receipt emailed flag
  - Receipts/attachments:
    - Attach receipt images and “other images”
    - Remove attachments
  - Export:
    - Export transactions to CSV (project-scoped filename)
  - Canonical transactions:
    - App has special casing for canonical inventory transactions (must preserve semantics in Firebase)
    - Budget/category attribution for canonical rows is **item-driven** (group linked items by `inheritedBudgetCategoryId`), not `transaction.budgetCategoryId`
    - Canonical inventory transactions should not require a user-facing budget category (keep uncategorized; attribution is derived).
- **Entities touched**: transactions, budget categories, vendor defaults, tax presets, attachments/media (receipts/other images), items (linked/itemized), conflicts, outbox ops
- **Offline behaviors required**:
  - Create/edit offline (local-first) with pending markers
  - Receipt attachment offline (queue upload; placeholder render)
  - Offline prerequisite gating: categories/vendors/tax presets must be cached (or block with banner + “retry sync”)
  - CSV export should work offline (from local DB)
- **Collaboration/realtime needs**: **Yes**
- **Risk level**: **High** — money-field conflicts/correctness, receipts/media, and complex filters at scale.
- **Dependencies**:
  - Requires local DB + indexing for list queries
  - Requires outbox + retry
  - Requires metadata sync (categories/vendors/tax presets)
  - Requires media pipeline + quota handling
  - Requires sync engine + change-signal strategy

### 8) Cross-entity “inventory operations”: item ↔ transaction linking, allocation, sell/deallocate, lineage
- **feature_slug**: `inventory-operations-and-lineage`
- **Short description**: Multi-entity operations that move/link items across projects/business inventory and transactions, including deallocation/sale flows and lineage visibility.
- **Owned screens** (flow-owned; touches multiple):
  - `ItemDetail`
  - `InventoryList`
  - `TransactionDetail`
  - `BusinessInventoryItemDetail`
  - `BusinessInventory`
- **Primary user flows**:
  - Assign/unassign items to/from a transaction (single + bulk)
  - Add/remove items on a transaction (itemization-style)
  - Allocate item(s) to a project (business inventory → project)
  - Move/sell items between project and business inventory
  - Deallocate when item disposition becomes `inventory`
  - Show lineage breadcrumbs / relationship cues (where present)
- **Budget-category determinism constraints** (canonical; required):
  - Project → Business Inventory: do not allow deallocation/sell unless the item has a known `inheritedBudgetCategoryId` (it must have been linked to a transaction previously).
  - Business Inventory → Project: prompt for a destination-project budget category and persist it back onto the item.
    - Defaulting: if the item already has `inheritedBudgetCategoryId` and that category is enabled/available for the destination project, preselect it.
    - Required choice: if no valid default exists, require selection before completing the operation.
    - Batch behavior: apply one category choice to the whole batch (fast path); optional future enhancement is per-item split.
    - Persistence: on successful allocation/sale, set/update `item.inheritedBudgetCategoryId` to the chosen destination category so future canonical attribution is deterministic.
- **Entities touched**: items, transactions, projects, spaces, lineage edges/pointers, canonical transaction ids, conflicts, outbox ops
- **Offline behaviors required**:
  - Represent multi-entity changes as a single **idempotent operation** in the outbox
  - Robust pending/progress UI for operations that spawn additional writes (e.g., creating canonical transactions)
  - Recoverable retries (avoid “double-sell” / “double-deallocate”)
- **Collaboration/realtime needs**: **Yes**
- **Risk level**: **High** — multi-entity invariants + retries + conflicts are the #1 correctness risk.
- **Dependencies**:
  - Requires sync engine with idempotency keys
  - Requires server-owned invariants (callable function / transaction) for correctness in Firebase (see sync plan §7)
  - Requires conflict UX

### 9) Spaces: CRUD + checklists + space images + templates + item assignment
- **feature_slug**: `spaces`
- **Short description**: Manage “spaces” within a project, including photos, nested checklists, and the ability to attach items to a space.
- **Owned screens**:
  - `ProjectSpacesPage`
  - `SpaceDetail`
  - `SpaceNew`
  - `SpaceEdit`
- **Primary user flows**:
  - Create/edit/delete space
  - Create from template + “save as template” (permission gated)
  - Manage checklists:
    - Create/edit checklist + items
    - Check/uncheck items
    - Inline editing behavior (auto-save patterns)
  - Manage space images:
    - Upload multiple, set primary, remove
  - Space ↔ item assignment:
    - Add existing items to space
    - Create new items “in space”
    - Remove/move items between spaces
- **Entities touched**: spaces, nested checklists, space images/media, space templates, items (spaceId updates), projects, conflicts (possible)
- **Offline behaviors required**:
  - Space CRUD offline + pending states
  - Checklist edits offline (local-first)
  - Image attach offline (queue upload; placeholders)
  - Item assignment offline (queued updates)
- **Collaboration/realtime needs**: **Yes**
- **Risk level**: **Med/High** — nested checklist conflicts + media.
- **Dependencies**:
  - Requires local DB (spaces + indexes)
  - Requires media pipeline + quota handling
  - Requires outbox + sync engine

### 10) Business inventory: global items + global transactions + bulk ops + QR
- **feature_slug**: `business-inventory`
- **Short description**: Global (project-less) items and transactions views with rich list controls, detail/edit flows, and allocation into projects.
- **Owned screens**:
  - `BusinessInventory` (tabs: Items / Transactions)
  - `BusinessInventoryItemDetail`
  - `AddBusinessInventoryItem`
  - `EditBusinessInventoryItem`
  - `AddBusinessInventoryTransaction`
  - `EditBusinessInventoryTransaction`
  - `TransactionDetail` (also routed under business inventory)
  - Note: these may be separate *wrappers/routes*, but must reuse the **shared Items + Transactions module components** (lists/menus/details/forms) rather than reimplementing them per-scope:
    - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- **Primary user flows**:
  - Items tab:
    - Search + filter + sort (mirrors project items patterns)
    - Duplicate grouping
    - Bulk selection (select all / per-group select)
    - Bulk actions:
      - Allocate selected items to a project
      - Assign selected items to a transaction
      - Generate QR codes for selected items
      - Delete selected items
    - Per-item actions: bookmark, duplicate, delete, disposition update, image add/remove
  - Transactions tab:
    - Filter modes include status (`all`, `pending`, `completed`, `canceled`, `inventory-only`) and other filters (source/type/reimbursement/receipt emailed/completeness)
    - Sort menu for transactions (observed in UI)
    - Open transaction detail
  - Allocate/move/sell inventory items into a project (and optionally space)
- **Entities touched**: items, transactions, projects, spaces, attachments/media (images/receipts), vendor defaults, tax presets, budget categories, outbox ops, conflicts, `qrKey`
- **Offline behaviors required**:
  - Full CRUD offline (local-first) + pending UI
  - Bulk actions offline (queued ops; partial failure handling)
  - Media placeholders + queued uploads
  - Local search/filter/sort at scale
- **Collaboration/realtime needs**: **Yes** — current app relies on realtime contexts; target should use change-signal + delta instead of large listeners.
- **Risk level**: **High** — scale + bulk ops + multi-entity allocation/sell + media.
- **Dependencies**:
  - Requires sync engine + local DB + outbox
  - Requires media pipeline + quota handling
  - Requires inventory operations/lineage semantics
- **Architecture compatibility notes**:
  - Must not implement this via “subscribe to all business inventory items/transactions.” Use **one `meta/sync` listener per active scope + delta fetch**.
  - Prefer relationship modeling that avoids updating large arrays on parents (see sync plan §9 note about `item.transactionId` / `item.spaceId`).

### 11) Budget + accounting rollups (project)
- **feature_slug**: `budget-and-accounting`
- **Short description**: Budget progress and accounting rollups within a project (budget vs accounting sub-tabs).
- **Owned screens**:
  - `ProjectBudgetPage` (wrapper)
  - Budget/Accounting tab UI within `ProjectLayout`
- **Primary user flows**:
  - Budget view:
    - Spend vs budget by category
    - Includes design fee and category budgets
  - Canonical inventory transactions contribute to category totals via **item-driven attribution** (`inheritedBudgetCategoryId` on linked items), not `transaction.budgetCategoryId`
  - Canonical inventory transactions contribute to category totals via **item-driven attribution** (`inheritedBudgetCategoryId` on linked items), not `transaction.budgetCategoryId`
  - Design fee progress is tracked as **received** (not “spent”) and excluded from spent totals/category sums
  - Design fee “specialness” should be bound to a stable identifier (slug/metadata), not a mutable display name
  - Accounting view:
    - Rollups like “owed to business” and “owed to client” based on transactions (and excludes canceled)
    - Launch report generation screens (invoice/client/property management)
- **Entities touched**: projects (budget, designFee, category budgets), transactions (amount/status/reimbursementType), budget categories
- **Offline behaviors required**:
  - Must compute from local data offline (no network)
  - Clear stale-data UX when last sync is old
- **Collaboration/realtime needs**: **Yes** (indirect) — recalculates as transactions sync.
- **Risk level**: **Med** — correctness of rollups + category mapping.
- **Dependencies**:
  - Requires local DB for transactions + categories
  - Requires sync engine

### 12) Reports (invoice, client summary, property management summary) + share/print
- **feature_slug**: `reports-and-printing`
- **Short description**: Generate printable/exportable summaries from project data.
- **Owned screens**:
  - `ProjectInvoice`
  - `ClientSummary`
  - `PropertyManagementSummary`
- **Primary user flows**:
  - Invoice:
    - Build invoice totals (charges/credits/net due) from transactions
    - Include line items (where present)
    - Print/share
  - Client summary:
    - Category breakdown
    - Total spent vs market value and “savings”
  - Property management summary:
    - Item list and totals/value
    - Space/location inclusion (where used)
- **Entities touched**: projects, transactions, items, spaces, budget categories, business profile (branding)
- **Offline behaviors required**:
  - Generate reports from local DB offline
  - Indicate when some referenced media is pending upload
- **Collaboration/realtime needs**: **No** (eventual refresh OK)
- **Risk level**: **Med** — formatting + correctness; mobile share/print implementation; performance on large projects.
- **Dependencies**:
  - Requires local DB + synced/cached project collections
  - Requires business profile availability

### 13) Invoice import (Amazon + Wayfair PDFs)
- **feature_slug**: `invoice-import`
- **Short description**: Import vendor PDFs and create transactions (and related items/media) via client-side parsing.
- **Owned screens**:
  - `ImportAmazonInvoice`
  - `ImportWayfairInvoice`
- **Primary user flows**:
  - Upload PDF → parse → show parsed results → create transaction (+ items when applicable)
  - Attach receipt PDF; for Wayfair also handle extracted images/thumbnails
  - Generate parse/debug reports (present in current UI/tooling patterns)
- **Entities touched**: transactions, items, attachments/media (PDF + images), vendor defaults, budget categories, tax presets
- **Offline behaviors required**:
  - Parsing can run offline, but creates/uploads must queue
  - Long-running operations need explicit progress + resumability
- **Collaboration/realtime needs**: **No**
- **Risk level**: **High** — format drift, parse correctness, large file performance, multi-asset upload robustness.
- **Dependencies**:
  - Requires media pipeline (PDF + images)
  - Requires outbox + local DB staging
  - Requires metadata caches (categories/tax/vendors) to classify the transaction

### 14) Installable PWA + service worker caching + background sync loop (web-only, but user-visible)
- **feature_slug**: `pwa-service-worker-and-background-sync`
- **Short description**: The app is installable as a PWA and uses a custom Workbox-based service worker to cache assets and run background sync attempts that delegate queue processing back to open clients.
- **Owned artifacts**:
  - `public/manifest.webmanifest` (install metadata)
  - `vite.config.ts` (PWA injectManifest configuration)
  - `public/sw-custom.js` (Workbox caching + background sync orchestration + SW↔client message bridge)
  - `src/main.tsx` (registers the service worker via `virtual:pwa-register`)
  - `src/services/serviceWorker.ts` (typed wrapper for background sync registration + event listeners + manual triggers)
- **Primary user flows**:
  - Install to home screen (standalone display mode)
  - Navigate while offline (cached JS/CSS + cached images where applicable)
  - Background sync attempts run and surface progress/complete/error to the UI (via SW messages)
  - Manual “Retry sync” can trigger a service-worker-mediated sync attempt
- **Entities touched**: cached assets, cached Supabase storage objects, operation queue processing (delegated)
- **Offline behaviors required**:
  - Offline navigation should still render the app shell (cached bundles)
  - Background sync registration is best-effort; must not block UI if unsupported/unavailable
- **Collaboration/realtime needs**: **No** (this is platform plumbing)
- **Risk level**: **Med/High** — caching bugs and background-sync loops can cause confusing “stale app” or runaway retries.
- **Dependencies**:
  - Depends on operation queue being processable from a foreground client
  - Interacts with global sync-status UX
- **Architecture compatibility notes**:
  - **Do not port this 1:1 to React Native.** RN does not have a service worker; “background sync” becomes **best-effort background execution** and must never be required for correctness.
  - Keep the user-visible expectations (offline use, queued ops, retry UX) but implement via the sync plan’s outbox processor + resume behavior.

### 15) Context-aware navigation stack + scroll restoration (user-visible UX system)
- **feature_slug**: `navigation-stack-and-context-links`
- **Short description**: Reliable “back to where I was” UX for long lists (items/transactions), including preserved list controls and best-effort scroll restoration (preferably back to the tapped row), across business-inventory ↔ project contexts.
- **Mobile approach (Expo Router)**:
  - **Back** is owned by React Navigation (no parallel custom history stack required for correctness).
  - **List state + scroll restoration** are owned by shared list modules (Items/Transactions) via `ListStateStore[listStateKey]` (anchor-first restore + optional offset fallback).
- **Parity evidence (web; not the mobile mechanism)**:
  - `NavigationStackProvider` + `useNavigationStack` (sessionStorage-backed stack)
  - `useStackedNavigate`, `useNavigationContext` (`buildContextUrl`, `getBackDestination`)
  - `ContextLink`, `ContextBackLink`
- **Primary user flows**:
  - Click into item/transaction detail from a long list → back returns to the right list and restores scroll
  - Cross-context navigation (e.g., business inventory → project transaction) preserves a correct back target via native back stack; if entered via deep link/cold start, use `backTarget` fallback
- **Entities touched (mobile)**: list-state store keys (`listStateKey`) and restore hints (e.g., `anchorId`, optional `scrollOffset`). (Expo Router navigation history is managed by the navigation library.)
- **Offline behaviors required**: works fully offline (purely local state)
- **Collaboration/realtime needs**: **No**
- **Risk level**: **Med** — if parity is wrong, the app feels “lost” (especially on mobile).

---

## 2) Cross-cutting flows (put under `40_features/_cross_cutting/`)

These are flows/behaviors that span multiple features and should be spec’d once.

### A) App bootstrap + hydration (auth → local DB → sync engine → UI)
- Define boot order: session/account context, local DB init, outbox init, scheduler init, then render.
- “Warm caches” behavior and what is required before entering offline-first screens.

### B) Offline mutation lifecycle (local-first write → outbox → retry → ack → clear pending)
- Standardize pending UI across entities (items/transactions/spaces/projects).
- Include “waiting for connectivity” vs “syncing” vs “error” states.

### C) Manual/foreground sync + background sync behavior
- What “Retry sync” actually does, how it hydrates prerequisites, and how background sync failure is surfaced.
- Mobile constraints (background execution) need explicit policy, consistent with current UX expectations.
- Evidence pointers (current app/web):
  - Service worker registration + PWA bootstrap: `src/main.tsx`, `vite.config.ts`, `index.html`, `public/manifest.webmanifest`
  - Background sync API + message bus: `src/services/serviceWorker.ts`, `public/sw-custom.js`
  - Queue processing bridge: `src/services/operationQueue.ts`
  - UI surfacing: `src/components/{SyncStatus,BackgroundSyncErrorNotifier}.tsx`, `src/components/ui/RetrySyncButton.tsx`

### D) Collaboration propagation without large listeners (change-signal + delta)
- Replace current large realtime subscriptions with the change-signal + delta approach.
- Define debounce/coalesce and “foreground SLA” expectations.

### E) Conflict detection + resolution UX (items/transactions at minimum)
- When to detect, where to store, how to block syncing, and resolution strategies (single + resolve all).
- The current UI explicitly has “Resolve All (server wins)” semantics — call that out and decide if it remains.

### F) Media lifecycle end-to-end
- Capture/select → local store → placeholder render → upload → attach → cleanup (orphan removal).
- Must include quota warning, offline attachment gating, and failure handling.
- Canonical spec:
  - `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`
- Subcomponent spec (shared UI/validation contract):
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

### G) Search/filter/sort + state restoration
- Web parity persists state via URL params; RN (Expo Router) must persist list state via `ListStateStore[listStateKey]` (and optionally support deep links).
- Include list grouping + bulk selection persistence rules.

### H) Navigation + “return to” + stacked back + scroll restoration
- Make deep linking and “back to list” behavior consistent across items/transactions/business inventory.
- Evidence pointers (current app/web):
  - Navigation stack persistence: `src/contexts/NavigationStackContext.tsx`
  - Stacked navigation helper: `src/hooks/useStackedNavigate.ts`
  - Context URL + `returnTo` param propagation: `src/hooks/useNavigationContext.ts`
  - Back links: `src/components/{ContextLink,ContextBackLink}.tsx`

### I) Roles/permissions gating
- Owner/admin gating for settings, templates, user management, and destructive actions.
- Canonical spec:
  - `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md`

### J) Inventory operations semantics (allocation/sell/deallocate/canonical IDs/lineage)
- Define canonical transaction IDs, lineage updates, and server-owned invariants for multi-entity correctness.

### K) Export/print/share surface
- CSV export and share/print behavior for reports + QR codes on mobile.

### L) Global toast + notification system
- Toasts are used to surface non-blocking success/error states across features (invites, CRUD, sync errors, etc.).
- Evidence pointers: `src/components/ui/ToastContext.tsx`, usage throughout pages/components; background sync errors are also surfaced via `BackgroundSyncErrorNotifier`.

---

## 3) Proposed `40_features/` directory list (folder names only)

- `_cross_cutting`
- `auth-and-invitations`
- `connectivity-and-sync-status`
- `settings-and-admin`
- `projects`
- `project-items`
- `project-transactions`
- `inventory-operations-and-lineage`
- `spaces`
- `business-inventory`
- `budget-and-accounting`
- `reports-and-printing`
- `invoice-import`
- `pwa-service-worker-and-background-sync`
- `navigation-stack-and-context-links`

Note: `pwa-service-worker-and-background-sync` is **web-only**; for a RN migration you may choose to keep it as “parity knowledge” (behavioral expectations) rather than a literal implementation.


