# Navigation Hierarchy Migration Plan

## Goal

Update navigation to be **hierarchical and URL-driven**:

... (Goal content) ...

---

## Current Implementation Status (Updated 2025-12-30)

| Feature / Issue | Status | Notes |
| :--- | :--- | :--- |
| **Hierarchical URL Structure** | ✅ Mostly Done | `/project/:id/items` and `/project/:id/transactions` are the canonical routes. |
| **Legacy Redirects** | ✅ Done | Old `?tab=` URLs and entity-detail deep links redirect correctly. |
| **Project Shell Persistence** | ✅ Done | `ProjectLayout` persists correctly across section changes without flashing or full-page reloads. |
| **Back Navigation (Edit → Detail)** | ⚠️ **Partially Broken** | Transaction edit/cancel now pops the stack correctly, but item edit/create and other flows that still call `useStackedNavigate` on save (e.g. `EditItem`, `AddItem`) re-push the edit URL so Back loops. |
| **Wayfair Invoice Flow** | ❌ **Broken** | The importer still navigates with `useStackedNavigate`, so creating an invoice returns to the import tool first instead of the transaction list. |
| **Layout Consistency** | ⚠️ **In Progress** | Clarified: Item Detail/Edit should open **inline** when accessed from a Transaction Detail page, but may still need full-screen focus for primary entity navigation. |
| **In-Shell Reports** | ❌ Pending | Invoice and Summaries are still rendered as "escape routes" (outside the project shell). |

---

## Implementation Audit (post-implementation notes — **what was not done right**)

This section is a **reality check** against the acceptance criteria and the “reload feel” goals. These items are **specifically responsible** for “everything disappears” and the visible “Loading…” flash during navigation.

### ✅ Implemented correctly (core structure)

- Nested project routes exist: `/project/:projectId/*` with children for `items`, `transactions`, `budget`, and section-scoped entity routes (detail/edit/new/import).
- Legacy redirects exist for old `?tab=` and old entity paths, preserving query params.
- A `ProjectLayout` exists and provides `<Outlet />` + context so section pages can reuse loaded project/items/transactions.
- **Project Shell Persistence**: Switching between section tabs (Items / Transactions / Budget / Accounting) no longer reloads the entire shell or triggers a global "Loading..." flash. Data dependencies are stable.
- **Retry vs Refresh**: `ProjectLayout.retryLoadProject` increments a `reloadToken` and refetches data instead of calling `navigate(0)`, keeping the shell mounted during error recovery.
- **Default section behavior**: `/project/:id` now consults `lastProjectSection` and falls back to `transactions`, matching the plan’s recommendation when no preference is stored.

### ❌ NOT implemented correctly (pending work)

#### 1) **Some project navigation still escapes the `ProjectLayout` route tree**

If a link goes to a route that is **not nested** under `/project/:projectId/*`, the project shell will unmount and you’ll see the “big swap”.

Observed escape routes:

- `/project/:id/invoice`
- `/project/:id/client-summary`
- `/project/:id/property-management-summary`
- Item row navigation still uses `/item/:id` in at least one place

Even with nested entity routes present (`/project/:projectId/items/:itemId`), **if the UI still links to an old global/non-nested route**, the shell will still disappear.

**Fix requirement (conceptual):**
- Ensure all “within a project” navigation uses section-scoped paths (`/project/:projectId/items/...` and `/project/:projectId/transactions/...`).
- Either nest invoice/summaries under `ProjectLayout` (as project-scoped routes) or treat them as deliberate “leave project shell” destinations (and accept the UI swap).

#### 2) **Inventory item links still bypass the nested route tree**

- `InventoryItemRow` and downstream preview components still generate `/item/${itemId}` (and `/item/${itemId}?project=...`) even when rendered inside a project context.
- Clicking those links from `/project/:projectId/items` ejects the user from `ProjectLayout`, so the shell disappears and the user loses local UI state.

**Fix requirement (conceptual):**
- Use the helpers from `src/utils/routes.ts` (`projectItemDetail`, `projectItemEdit`) whenever an item belongs to the active project.
- Only use the global `/item/:id` form when the context is genuinely outside of a project (e.g., business inventory).

#### 3) Minor deviation: budget sub-tab param name drift

The plan’s Option A referenced `/project/:projectId/budget?tab=budget|accounting` (illustrative).
Observed implementation uses `budgetTab` as the query param name.

This is not the cause of the “reload feel”, but it is a **documentation drift** that makes future work/debugging harder.

#### 4) Clarification: inline vs full-screen entity flows

- **Current State**: Most entity detail, edit, and create flows currently render nested within the `ProjectLayout` (tab view).
- **Desired UX (Updated 2025-12-30, reinforced 2026-01-02)**:
  - **Inline is acceptable only inside Transaction Detail**. When an Item Detail/Edit flow originates from a transaction-level inline experience (`TransactionItemsList`), the inline swap is fine as long as Back returns to the transaction.
  - **Outside of that scenario, Item and Transaction detail/edit/create screens must always open as dedicated full-screen routes** so the project shell, breadcrumb history, alerts, etc. are retained. Do **not** inline Project Items tab actions again.
  - **Add/Create flows** (`AddItem`, `AddTransaction`, Wayfair importer, Edit screens) must open with their own URLs. INLINE FORMS ARE A BUG—this note exists precisely so we do not accidentally revert back.
- **Fix requirement**: Ensure that inline-only navigation (like `setViewingItemId` in `TransactionItemsList`) is scoped to transaction details, and that every route launched from Project Items / Project Transactions tabs uses `projectItemDetail`, `projectTransactionDetail`, etc., never `setViewingItemId`.

#### 5) Back navigation ping-pongs between edit/detail due to stacked navigate usage

- Requirement: edit flows should respect the hierarchy: **List → Detail → Edit** and Back should walk upward (**Edit → Detail → List**).
- Observed: `EditTransaction` now uses plain `useNavigate` + `navigationStack.pop`, but other forms (`EditItem`, `AddItem`, `AddTransaction`, `ProjectInvoice`, `ImportWayfairInvoice`, etc.) still call `useStackedNavigate` when finishing. That hook pushes the *current* edit/creation URL onto the stack immediately before navigating away, so the next Back returns to the form the user just left.
- Impact: after saving/canceling, the stack’s top entry is still the edit screen, so pressing Back bounces users between Edit ↔ Detail before they can reach the list view.
- Fix requirement: for flows that are conceptually “going up” the hierarchy, switch to `useNavigate` (or manually pop) so leaving the form does not push another stack entry. Continue to pass `returnTo` via `buildContextUrl` so detail/list fallbacks still work.

#### 6) Wayfair importer still leaves users stuck in its own stack

- The Wayfair import flow uses `useStackedNavigate` for both cancellation and post-create navigation (`src/pages/ImportWayfairInvoice.tsx`), which means the importer page is pushed back onto the stack right before sending the user to a transaction detail.
- Result: after creating a transaction, Back returns to the importer instead of the transactions list/detail the user expected.
- Fix requirement: treat the importer like other edit/create flows—pop the stack (or use plain `useNavigate`) when exiting, and default the fallback destination to `projectTransactions(projectId)`.

### Navigation helpers (already present)

- `src/contexts/NavigationStackContext.tsx` (sessionStorage-backed stack)
- `src/hooks/useStackedNavigate.ts` and `src/components/ContextLink.tsx` push the current location into the stack before navigating
- `src/hooks/useNavigationContext.ts`
  - `buildContextUrl(targetPath)` adds `returnTo=<current location>` to preserve back context
  - `getBackDestination(defaultPath)` prefers stack (`peek`), then `returnTo`, then `defaultPath`

These are useful as fallbacks, but the **primary** “where am I” and “where do I go back to” should be reflected in the URL hierarchy.

---

## Target URL Design

### Keep current base path (low-churn)

To minimize churn, keep `/project/:projectId` as the project base (we can rename to `/projects/:projectId` later).

### Canonical section paths

- `/projects` (already exists)
- `/project/:projectId` → redirects to a default section (or last-used section)
- `/project/:projectId/items`
- `/project/:projectId/transactions`
- `/project/:projectId/budget` (optional; see below)

### Entity paths nested under section

- Items
  - `/project/:projectId/items/:itemId`
  - `/project/:projectId/items/:itemId/edit`
  - `/project/:projectId/items/new`
- Transactions
  - `/project/:projectId/transactions/:transactionId`
  - `/project/:projectId/transactions/:transactionId/edit`
  - `/project/:projectId/transactions/new`
  - `/project/:projectId/transactions/import-wayfair`

### Budget subviews (choose one)

- **Option A (fast):** keep a query param for budget sub-tabs:
  - `/project/:projectId/budget?tab=budget|accounting`
- **Option B (preferred):** fully hierarchical nested segments:
  - `/project/:projectId/budget` (default)
  - `/project/:projectId/budget/accounting`

Recommendation: **Option A first** (minimal surface area), then Option B later.

---

## UX Optimization Recommendations (to prevent “reload” *feels*)

These are compatible with the plan and should be baked into implementation decisions as we migrate.

- **Keep the project shell mounted (highest impact)**:
  - Use a `ProjectLayout` route with `<Outlet />` so the header + tabs persist while section/detail changes.
  - Prefer section-scoped detail paths (`/project/:id/items/:itemId`, `/project/:id/transactions/:txId`) so list → detail stays within the same layout tree.

- **Preserve user state across list → detail → back**:
  - Preserve section in the URL (path segment, not `?tab=`) so refresh/deep links land correctly.
  - Preserve list UI state:
    - Prefer URL params for shareable state (search/filter/sort) where it makes sense.
    - For non-shareable state (selected rows), keep it in a parent that stays mounted (layout/section page) if you want it preserved.
  - Preserve scroll position when returning to a list:
    - Best: keep the list mounted (detail rendered in an outlet beside/over it, or the section route remains mounted).
    - Otherwise: store/restore scroll position per route (simple map keyed by `location.key` or pathname).

- **Avoid loading flashes**:
  - Prefer skeletons over spinners for detail pages.
  - Prefetch detail data on hover/focus (or when a row becomes visible) so navigation feels instant.
  - Cache detail fetches so returning to the same entity is immediate.

- **Avoid hard refresh recovery paths**:
  - Avoid patterns like `navigate(0)` unless you truly want a full refresh; use “refetch” logic instead.
  - Also avoid a **single global Suspense fallback** that replaces the entire UI during navigation; prefer nested/per-route Suspense boundaries so the project shell stays visible.

---

## Compatibility Strategy (no broken links)

We will support old URLs during the migration:

- `/project/:id?tab=inventory` → redirect to `/project/:id/items`
- `/project/:id?tab=transactions` → redirect to `/project/:id/transactions`
- Existing entity routes remain valid during rollout and redirect to canonical routes later:
  - `/project/:id/item/:itemId` → `/project/:id/items/:itemId`
  - `/project/:id/transaction/:transactionId` → `/project/:id/transactions/:transactionId`

Important: keep query params like `returnTo`, `from`, `budgetTab` when redirecting (at minimum preserve `returnTo`).

---

## Implementation Plan (detailed)

### Phase 0 — Add route helpers (prep)

**Goal:** stop sprinkling stringly-typed routes everywhere.

1. Create `src/utils/routes.ts` with pure functions:
   - `projectsRoot() => '/projects'`
   - `projectRoot(projectId) => \`/project/${projectId}\``
   - `projectItems(projectId) => \`/project/${projectId}/items\``
   - `projectItemDetail(projectId, itemId) => \`/project/${projectId}/items/${itemId}\``
   - `projectItemEdit(projectId, itemId) => \`/project/${projectId}/items/${itemId}/edit\``
   - `projectTransactions(projectId) => \`/project/${projectId}/transactions\``
   - `projectTransactionDetail(projectId, txId) => \`/project/${projectId}/transactions/${txId}\``
   - `projectTransactionEdit(projectId, txId) => \`/project/${projectId}/transactions/${txId}/edit\``
   - `projectTransactionNew(projectId) => \`/project/${projectId}/transactions/new\``
   - `projectItemNew(projectId) => \`/project/${projectId}/items/new\``
2. Update 1–2 files to use helpers to establish the pattern.

**Acceptance criteria:** route helpers compile and are used in at least one place.

---

### Phase 1 — Add section routes (without removing old behavior)

**Goal:** introduce `/project/:id/items` and `/project/:id/transactions` with minimal refactors.

1. Create a new page component `src/pages/ProjectLayout.tsx`:
   - Reads `projectId` from params
   - Renders project header + section tabs (Items / Transactions / Budget)
   - Each tab navigates to the corresponding **path** (not `?tab=`).
   - Renders `<Outlet />` for the active section.
   - UX: this keeps the project shell mounted and prevents the “big swap” feeling.
2. Create section pages:
   - `src/pages/ProjectItemsPage.tsx`:
     - Loads project/items (or reuses existing loading from `ProjectDetail` by extracting hooks)
     - Renders `InventoryList`
   - `src/pages/ProjectTransactionsPage.tsx`:
     - Loads project/transactions and renders `TransactionsList`
    - **Important:** once these pages are mounted inside `ProjectLayout`, the layout’s data-loading effect should not restart every time a nested tab changes. Keep the effect’s dependency list stable (avoid depending on changing callbacks like `stackedNavigate`) so the shell only fetches once per project load. This prevents flashes of the global “Loading project…” state when switching between Items/Transactions/Budget.
3. Update `src/App.tsx`:
   - Add a nested route for `/project/:id/*` using `ProjectLayout` and children:
     - `items` → `ProjectItemsPage`
     - `transactions` → `ProjectTransactionsPage`
     - (budget later)

**Acceptance criteria:** `/project/:id/items` and `/project/:id/transactions` render correctly.

---

### Phase 2 — Redirect old `?tab=` URLs to new section paths

**Goal:** keep bookmarks and existing internal links working.

1. Add `src/pages/ProjectLegacyTabRedirect.tsx`:
   - Reads `tab` from search params
   - Redirects:
     - `inventory` → `/project/:id/items`
     - `transactions` → `/project/:id/transactions`
   - If no `tab`, redirect to a default section (choose one; recommended `transactions`)
   - Preserve `returnTo` and other query params as appropriate.
2. Wire it in `src/App.tsx` for `/project/:id` index route.

**Acceptance criteria:** visiting `/project/:id?tab=inventory` lands on `/project/:id/items`.

---

### Phase 3 — Migrate entity routes to section-aware paths

**Goal:** make entity URLs reflect the hierarchy.

1. Add new canonical routes in `src/App.tsx`:
   - `/project/:id/items/:itemId` → existing `ItemDetail`
   - `/project/:id/transactions/:transactionId` → existing `TransactionDetail`
   - `/project/:id/items/:itemId/edit` → existing `EditItem` (or a wrapper)
   - `/project/:id/transactions/:transactionId/edit` → existing `EditTransaction`
   - UX: these canonical paths should be nested under `ProjectLayout` so the project shell stays mounted during list → detail navigation.
2. Keep the old routes temporarily:
   - `/project/:id/item/:itemId` and `/project/:id/transaction/:transactionId`
3. Add redirects from old entity paths to new canonical paths.

**Acceptance criteria:** both old and new entity URLs work; canonical paths are used by the UI.

---

### Phase 4 — Replace `?tab=` fallbacks with hierarchical parent paths

**Goal:** “default back” should go to parent section path, not query tabs.

Update defaults in these pages (examples based on repo search):

- `src/pages/ItemDetail.tsx`
  - default back should be `/project/:id/items` (not `?tab=inventory`)
- `src/pages/TransactionDetail.tsx`
  - default back should be `/project/:id/transactions`
- `src/pages/AddItem.tsx`, `src/pages/EditItem.tsx`
  - post-save and fallback should go to:
    - `returnTo` if present, else the correct parent:
      - edit → detail, or items list
- `src/pages/AddTransaction.tsx`, `src/pages/EditTransaction.tsx`, `src/pages/ImportWayfairInvoice.tsx`
  - post-save and fallback should go to `returnTo` else transactions detail/list as appropriate
- `src/pages/ProjectInvoice.tsx`, `src/pages/ClientSummary.tsx`, `src/pages/PropertyManagementSummary.tsx`
  - replace hardcoded `?tab=` targets with the appropriate parent section path (likely `transactions` or `items` depending on where the user entered the page).

Rule of thumb:

- Navigating **down** the hierarchy: use `buildContextUrl(childPath)` so the child receives a `returnTo`
- Navigating **up** the hierarchy: use explicit parent paths as fallbacks

**Acceptance criteria:** after edits, “Back” returns to the correct parent section consistently.

---

### Phase 5 — Make `/project/:id` behave like a “folder root”

**Goal:** `/project/:id` should always open the most relevant section.

1. Decide the default section (`transactions` recommended, but align with product preference).
2. Store last-used section per project in localStorage:
   - key: `lastProjectSection:<projectId>`
3. In `ProjectLayout.tsx`, whenever the user clicks a section tab, write to localStorage.
4. In `/project/:id` redirect logic:
   - If localStorage entry exists → redirect to that section
   - Else → redirect to default section

**Acceptance criteria:** `/project/:id` opens the last-used section for that project.

---

### Phase 6 — (Optional) Simplify / reduce dependence on NavigationStack

Keep `NavigationStack` as a fallback, but prefer hierarchy:

- For core hierarchy pages, `returnTo` and parent fallbacks should cover most back behavior.
- Gradually reduce reliance on stack for “normal” navigation (it’s still useful for cross-cutting jumps).

---

## Testing Checklist (manual)

- Direct open in a new tab (no prior stack/session):
  - `/project/:id/items` loads
  - `/project/:id/transactions/:txId` loads
- Back-compat redirects:
  - `/project/:id?tab=inventory` → `/project/:id/items`
  - `/project/:id?tab=transactions` → `/project/:id/transactions`
- Back behavior:
  - items list → item detail → back returns to items list
  - tx list → tx detail → back returns to tx list
  - tx detail → edit → cancel/save returns to tx detail
- UX “reload feel” checks:
  - project header/tabs remain visible when navigating list → detail (i.e., `ProjectLayout` stays mounted)
  - list scroll position is preserved when returning from detail
  - list search/filter state is preserved (URL-driven if intended)
  - navigating to any project-scoped page (including invoice/summaries if intended) does **not** leave the `/project/:projectId/*` route tree unless explicitly desired
  - navigating to a lazily-loaded child route does **not** blank the entire app (no full-screen global Suspense fallback)
- Regression checks:
  - business inventory routes still work (`/business-inventory/...`)

---

## Suggested PR Breakdown (recommended)

- **PR 1:** `routes.ts` + add `/project/:id/items` + `/project/:id/transactions` + legacy `?tab=` redirect
- **PR 2:** migrate internal links to canonical section paths (lists → detail links, add buttons)
- **PR 3:** add canonical entity paths (`/items/:itemId`, `/transactions/:txId`) + redirects from old entity paths
- **PR 4:** replace remaining `?tab=` navigations + implement `/project/:id` “last section” behavior

