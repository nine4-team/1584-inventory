# Navigation Hierarchy Migration Plan

## Goal

Update navigation to be **hierarchical and URL-driven**:

- **Projects** (root)
- **Project** (folder root)
- **Project section** (items, transactions, budget, etc.)
- **Entity detail** (item detail, transaction detail)
- **Deep flows** (edit forms, import flows)

Desired behavior:

- **Back is hierarchical**:
  - Edit → returns to detail
  - Detail → returns to the correct project + section
  - Section → returns to the project root
- URLs are **shareable**, **refresh-safe**, and support deep links.
- We keep backward compatibility for existing links (`/project/:id?tab=...`, existing entity routes) via redirects.

---

## Current State (as of 2025-12-28)

### Unresolved / Not Implemented Yet

- `ProjectLayout` still reloads the entire shell whenever the user switches between **Items / Transactions / Budget / Accounting**. Root cause: the layout’s data-loading effect depends on `stackedNavigate`, which changes whenever the URL changes, so switching tabs retriggers the effect and shows the global “Loading project…” state. The fix is to keep stable dependencies (avoid including `stackedNavigate` or other tab-dependent callbacks) so the layout fetches once per project and nested routes change without flashing.

### Routing

Routes are declared in `src/App.tsx` using `react-router-dom` `<Routes>/<Route>`.

Notable patterns:

- Project is currently: `/project/:id` with **section selected via query param**:
  - `?tab=inventory|transactions`
  - `?budgetTab=budget|accounting` (nested “budget tabs” state)
- Entity routes already exist:
  - `/project/:id/item/:itemId` (Item detail)
  - `/project/:id/transaction/:transactionId` (Transaction detail)

### UX note: why clicking an item/transaction “reloads” the page

When you click a row inside the project page, we navigate to a **different route** (`/project/:id/item/:itemId` or `/project/:id/transaction/:transactionId`).
This is **client-side navigation** (not a full document reload), but it can *feel* like a reload because:

- The **project page component unmounts** and the detail page mounts (big UI swap).
- The detail page may show a loading state while fetching data (flash/spinner).
- List state (scroll, filters, selection) can be lost if the list unmounts.

This plan’s move to **nested, hierarchical routes** is the best-practice fix: keep the project “shell” mounted and swap only the nested content.

---

## Implementation Audit (post-implementation notes — **what was not done right**)

This section is a **reality check** against the acceptance criteria and the “reload feel” goals. These items are **specifically responsible** for “everything disappears” and the visible “Loading…” flash during navigation.

### ✅ Implemented correctly (core structure)

- Nested project routes exist: `/project/:projectId/*` with children for `items`, `transactions`, `budget`, and section-scoped entity routes (detail/edit/new/import).
- Legacy redirects exist for old `?tab=` and old entity paths, preserving query params.
- A `ProjectLayout` exists and provides `<Outlet />` + context so section pages can reuse loaded project/items/transactions.

### ❌ NOT implemented correctly (root causes of the “reload” feel)

#### 1) **Global Suspense fallback still blanks the entire app during route changes**

- Current implementation wraps the entire routing tree in a single `<Suspense fallback={...}>`.
- Because many pages/layouts are `lazy()` loaded, navigating to a route whose JS chunk is not already loaded will **replace the entire UI with the fallback** (everything disappears, then “Loading”).
- This directly defeats the “keep the project shell mounted” UX goal even if routes are nested correctly.

**Fix requirement (conceptual):** move Suspense boundaries *down* (e.g., to outlet/content level) or prefetch route chunks so the project shell does not disappear when swapping child routes.

#### 2) **Some project navigation still escapes the `ProjectLayout` route tree**

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

#### 3) **A hard refresh-style recovery path exists (`navigate(0)` / history go(0))**

The plan explicitly said:

> Avoid patterns like `navigate(0)` unless you truly want a full refresh; use “refetch” logic instead.

Observed implementation has a “retry” path that effectively does a **refresh-style navigation**. This is a direct mismatch with the UX goal and can contribute to “reload” behavior under failure/retry.

**Fix requirement (conceptual):** retry should call the same data-loading function, not reload the current route.

#### 4) **Stringly-typed project routes still exist in a few places**

Phase 0 goal was to reduce route strings by using helpers (`src/utils/routes.ts`).

Observed: some navigation still hardcodes project routes (e.g., invoice/summaries). This increases the chance that links bypass the nested/canonical route tree.

**Fix requirement (conceptual):** use route helper functions for *all* project-scoped navigation, especially from `ProjectLayout`.

#### 5) Minor deviation: budget sub-tab param name drift

The plan’s Option A referenced `/project/:projectId/budget?tab=budget|accounting` (illustrative).
Observed implementation uses `budgetTab` as the query param name.

This is not the cause of the “reload feel”, but it is a **documentation drift** that makes future work/debugging harder.

#### 6) Minor deviation: default section differs from the plan recommendation

The plan recommended defaulting `/project/:id` to **transactions** (unless product preference differs).
Observed implementation currently defaults to **items** when there is no explicit preference stored.

This is not the cause of the “reload feel”, but it is another **plan/implementation mismatch** worth correcting or explicitly deciding.

#### 7) Regression: detail/edit flows no longer render as full-screen pages

- Requirement: entity detail, edit, and create flows (`ItemDetail`, `TransactionDetail`, add/edit forms) should **leave the Project shell** and take over the entire viewport to minimize distraction and ensure focused editing.
- Observed: recent navigation refactor keeps these flows nested under the `items` / `transactions` tabs, so the project tabs/header remain mounted.
- Impact: review/edit screens now appear constrained inside the tab content area instead of the intended full-screen experience, and their layout/styling regress (breadcrumbs, spacing, escape hatch buttons).
- Fix requirement: route to the full-screen variants (or mount them outside the section layout) for all detail/add/edit flows so they behave like the pre-migration UX.

#### 8) Back navigation ping-pongs between edit/detail due to stacked navigate usage

- Requirement: edit flows should respect the hierarchy: **List → Detail → Edit** and Back should walk upward (**Edit → Detail → List**).
- Observed: `EditTransaction` (and similar forms) invoke the navigation-stack-aware `useStackedNavigate` when leaving the page, which re-pushes the edit URL right before navigating back to detail.
- Impact: after returning to detail, the navigation stack’s top entry is the edit screen, so pressing Back immediately sends the user back to Edit (sequence becomes Edit → Detail → Edit → List).
- Fix requirement: edit/cancel/back handlers must pop the stack **without** re-pushing the current URL (use plain `useNavigate` and/or `getBackDestination(returnTo)`), ensuring the next Back truly reaches the list view.

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

