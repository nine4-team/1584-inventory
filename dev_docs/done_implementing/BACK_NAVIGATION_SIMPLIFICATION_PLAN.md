# Back Navigation Simplification Plan (ReturnTo + Replace)

## Goal

Fix Back button behavior **without changing the current full-screen entity UX**.

Specifically:

- **Edit → Save → Detail → Back** should **NOT** return to Edit.
- Wayfair flow **create/import → transaction detail → Back** should **NOT** return to the importer; it should return to the **transactions list**.

This plan intentionally **does not** re-architect the UI into an “inline” experience. It keeps the current feel:

- Global app chrome (top menu) stays consistent.
- Project “home” UI (hero/summary/tabs card) appears on section routes only.
- Entity pages (detail/edit/new/import/reports) remain **full-screen**.

---

## Definitions (to prevent the previous regression)

### Shell

**Shell = global app chrome only** (top menu: Projects / Inventory / Settings).

- This is allowed to stay mounted for all routes.
- “Shell mounted” must **never** mean “Project home UI persists under entity pages.”

### Project Home UI (Section Mode)

Section routes show project home UI:

- `/project/:projectId/items`
- `/project/:projectId/transactions`
- `/project/:projectId/budget` (and sub-views)

### Entity UI (Full-screen Mode)

Entity routes must hide the project home UI and render a dedicated entity surface:

- `/project/:projectId/items/:itemId`
- `/project/:projectId/items/:itemId/edit`
- `/project/:projectId/items/new`
- `/project/:projectId/transactions/:transactionId`
- `/project/:projectId/transactions/:transactionId/edit`
- `/project/:projectId/transactions/new`
- `/project/:projectId/transactions/import-wayfair`
- Project reports (invoice / summaries) **if** they are project-scoped

**Exception (allowed inline)**:

- Only the inline “transaction items viewer/editor” inside `TransactionDetail` is allowed to be inline. The `TransactionDetail` page itself is still an entity route and must be full-screen.

---

## Root Cause (why Back loops)

The Back loop happens when leaving an edit/create screen causes a new navigation history entry to be created *from the edit page itself*.

Common ways this happens:

- Using a “stacked navigate” helper that **pushes the current URL** (the edit screen) onto a custom stack immediately before navigating away.
- Navigating away from save/cancel via a normal `navigate(target)` (push) when the correct behavior is to *replace* the edit URL.

Resulting loop:

- Item Detail → Edit Item
- Save → Item Detail (but edit URL remains directly behind it)
- Back → Edit Item (bad)

---

## Proposed Approach (simpler + deterministic)

### Principle A: “Downward navigation” carries explicit return context

When navigating **down** the hierarchy (list → detail, detail → edit, list → new/import), include an explicit return target:

- `returnTo` query param **or**
- `location.state.returnTo`

This plan prefers **`location.state`** (no messy URL encoding), but either works.

### Principle B: “Upward navigation” uses history replace

When exiting edit/new/import flows (save/cancel), navigate to the return target with:

- `navigate(returnTo, { replace: true })`

If `returnTo` is missing, use a canonical parent fallback (also with `replace: true`).

This guarantees:

- Edit → Save → Detail, and Back goes further up (e.g., list), not back to Edit.

---

## Implementation Design

### 1) Standardize return context helpers

Add a small helper module (naming is intentionally self-evident):

- `src/utils/navigationReturnTo.ts`
  - `getReturnToFromLocation(location): string | null`
  - `buildNavigateStateWithReturnTo(location): { returnTo: string }`
  - `navigateToReturnToOrFallback(navigate, location, fallbackPath): void` (uses `replace: true`)

**Note:** If you already have `buildContextUrl()` / `getBackDestination()` helpers, you can reuse the intent, but this plan’s rule is strict:

- Use the helpers for **downward** navigation only.
- Use `replace: true` for **upward** navigation always.
- Do **not** push the edit/import URL into any custom stack when leaving it.

### 2) Stop using `useStackedNavigate` for save/cancel in forms

Anywhere you currently do “onSave/onCancel: stackedNavigate(...)”, replace it with:

- Determine `returnTo` from `location.state` or query param
- `navigate(returnTo ?? fallback, { replace: true })`

Targets include (at minimum):

- `src/pages/EditItem.tsx`
- `src/pages/AddItem.tsx`
- `src/pages/EditTransaction.tsx`
- `src/pages/AddTransaction.tsx`
- `src/pages/ImportWayfairInvoice.tsx`

### 3) Ensure entry points *set* returnTo

Where the user clicks into a child page, ensure we provide return context:

- Items list row → Item detail: set `state: { returnTo: currentLocation }`
- Item detail → Edit item: set `state: { returnTo: currentLocation }`
- Transactions list row → Transaction detail: set `state: { returnTo: currentLocation }`
- Transaction detail → Edit tx: set `state: { returnTo: currentLocation }`
- Transactions list → Import Wayfair: set `state: { returnTo: currentLocation }`

If some links are `<Link to="...">` today, convert them to either:

- a wrapper component that automatically attaches state, or
- a `ContextLink` variant that uses **state** rather than query params

### 4) Wayfair-specific rule

Importer exit behavior must be:

- After creating a transaction, navigate to the transaction detail using `replace: true`, and carry `returnTo` pointing at the transactions list.

So the history is:

- Transactions list → Importer → (create) → Transaction detail
- Back → Transactions list

### 5) Optional: keep NavigationStack only as a fallback for cross-cutting jumps

If you keep `NavigationStackContext`, constrain its use:

- Allowed: rare cross-cutting flows (e.g., “jump to related entity and come back”).
- Not allowed: standard list/detail/edit/new/import flows.

---

## Acceptance Criteria (UX must match)

### Item edit loop

- From `/project/:id/items`, open an item detail.
- Navigate to edit.
- Save or cancel.
- Press Back.
- **Expected**: Back returns to item list (or whatever `returnTo` was), **not** to edit.

### Wayfair importer

- From `/project/:id/transactions`, open import wayfair.
- Create transaction and land on transaction detail.
- Press Back.
- **Expected**: Back returns to `/project/:id/transactions`, **not** importer.

### TransactionDetail inline exception

- From transaction detail, open an inline item view/edit inside `TransactionItemsList`.
- Back behavior for inline UI remains correct for that component.
- Navigating the browser Back from the transaction detail still returns to transactions list (not a form loop).

---

## Testing Checklist (manual)

- **Direct entry (no prior state)**:
  - Open `/project/:id/items/:itemId/edit` in a fresh tab
  - Save/cancel
  - **Expected**: fallback goes to `/project/:id/items/:itemId` or `/project/:id/items` (choose one rule and implement consistently), and Back does not loop

- **Normal in-app navigation**:
  - List → Detail → Edit → Save → Back
  - List → New → Save → Back
  - List → Import → Create → Detail → Back

---

## Notes (why this is safer than “stack” inference)

- Browser history already *is* a stack. The loop happens because we add the wrong entries.
- `replace: true` is the simplest reliable way to treat edit/import screens like an “overlay” without actually implementing modal routes.
- `returnTo` makes “where do I go back to?” explicit and testable; it eliminates guesswork and reduces dependence on ad-hoc stack behavior.

