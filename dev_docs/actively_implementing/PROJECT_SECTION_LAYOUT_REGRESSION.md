## Title

Project Section Layout Regression & Remediation Plan

## Author

codex

## Stakeholders

- Ben (UX + product)
- Engineering (navigation + routing)
- QA (regression verification)

## Background / Problem Statement

The navigation hierarchy rollout nested **every** project-scoped route beneath `ProjectLayout`. While this preserved the shell, it also meant that *entity detail / edit / creation flows now render inside the section card*, because the `ProjectLayout` outlet lives within the tabbed panel. The plan + user requirement was explicit: only inline rendering inside the **transaction detail item viewer** (`TransactionItemsList`) is acceptable. All other flows must remain full-screen (dedicated route) so breadcrumbs, alerts, and other global UI work properly.

Current behavior:

- `/project/:id/items/:itemId`, `/project/:id/items/:itemId/edit`, `/project/:id/items/new`
- `/project/:id/transactions/...` (detail/edit/new/import)

all render *inline* within the Items/Transactions card, removing the immersive view, confusing navigation, and violating the acceptance criteria.

We need to restore full-screen entity flows without throwing away the hierarchical routing work or reintroducing “big swap” reloads.

## Goals

1. **Preserve hierarchical URLs** and the project shell for section navigation (`/project/:id/items`, `/project/:id/transactions`, `/project/:id/budget`).
2. **Render entity screens (detail/edit/new/import/report)** in a dedicated full-height surface, not inside the section card.
3. **Retain data reuse** (loaded project/items/transactions) to avoid extra fetches.
4. **Keep Back navigation deterministic**: list → detail → edit → list should work via URLs + `NavigationContext`.

## Non-goals

- Re-architect the routing stack globally.
- Re-introduce `?tab=` navigation.
- Change the inline experience inside `TransactionDetail`’s `TransactionItemsList` (this remains inline by design).

## Proposed Fix (High-level)

Create two conceptual layers:

1. **ProjectShellRoute** (keeps header + tabs + summary cards, loaded data, and listens to realtime changes).
2. **Section Outlet vs. Entity Outlet**:
   - When the location is a **section index** (`/items`, `/transactions`, `/budget`), render the tab card with the list (current behavior).
   - When the location matches an **entity route** (`/items/:itemId`, `/transactions/:txId`, `/.../new`, `/invoice`, etc.), render a **full-width content wrapper** that hides the tab card and stretches the entity screen to the viewport while still providing the project header/back link.

This can be achieved without moving routes out of `ProjectLayout` by letting `ProjectLayout` detect the “mode” (section vs. entity) and conditionally render either:

- `SectionLayout` (current card + tabs + nested Outlet)
- `EntityLayout` (full-page panel containing `<Outlet />`)

We already have `resolveSectionFromPath`. Extend it with a helper `isSectionRoute(pathname)` to detect when the remainder is exactly `items`, `transactions`, or `budget`. Everything else under `/project/:id/...` becomes “entity mode.”

## Detailed Plan

### 1. Routing & Layout Detection

- Add `isPrimarySectionRoute(pathname, projectId)` in `ProjectLayout.tsx` to detect when the path is **exactly** `/items`, `/transactions`, or `/budget`.
- Store this as `viewMode: 'section' | 'entity'`.
- When `viewMode === 'section'`, render the current tab card + list outlet.
- When `viewMode === 'entity'`, render a new `FullScreenEntityFrame` component:
  - Keeps project header/back button.
  - Optionally shows tabs collapsed (or hides them entirely).
  - Renders `<Suspense><Outlet /></Suspense>` in a full-width container (not inside the card).

### 2. Styling / Layout

- Wrap the existing card in a conditional container so entity routes don’t inherit the padding/margins intended for lists.
- Ensure the project cover + summary still render at the top (users expect to see project context).
- Add `min-h-screen` or similar to the entity frame so forms scroll naturally.

### 3. Back Navigation Consistency

- Since entity routes stay under the project shell, we can keep using `ContextBackLink` + `getBackDestination`.
- Verify that entity routes still write `returnTo` when link originates from list rows (already handled by `ContextLink` + `buildContextUrl` after earlier work).

### 4. TransactionDetail Inline Exception

`TransactionDetail` intentionally swaps in inline forms (`TransactionItemsList` → `setViewingItemId`). This remains untouched. The detection logic must treat `/project/:id/transactions/:transactionId` as **entity mode** so the **overall** detail page is full-screen, while the component continues to manage its inline sub-flow.

### 5. Legacy Reroutes

No change required; `ProjectLegacyEntityRedirect` already lands on `/project/:id/items/:itemId`. The new layout logic simply ensures those URLs render full screen.

## Step-by-step Implementation

1. **Augment ProjectLayout**
   - Add `const isSectionRoute = matchSectionRoute(location.pathname, projectId)`.
   - Replace the static `<div className="bg-white shadow rounded-lg">` block with:
     ```tsx
     {isSectionRoute ? (
       <SectionPanel ...>{/* existing list outlet */}</SectionPanel>
     ) : (
       <EntityPanel>
         <Suspense fallback={...}>
           <Outlet context={outletContext} />
         </Suspense>
       </EntityPanel>
     )}
     ```
2. **EntityPanel component**
   - Lives in `ProjectLayout.tsx` or extracted file.
   - Provides consistent padding/margins, ensures width spans container, and optionally hides tabs (or shows a breadcrumb).
3. **QA / Testing**
   - Load `/project/:id/items` (list should look as before).
   - Open `/project/:id/items/:itemId` and `/project/:id/items/:itemId/edit`, confirming full-screen layout + header/back is visible.
   - Repeat for transaction detail/edit/new/import plus invoice/reports.
   - Verify `TransactionDetail` still allows inline item forms.
   - Regression for `/project/:id/budget?tab=accounting`.

## Risks & Mitigations

- **CSS bleed:** Rendering entity flow outside the card may need new spacing. Mitigate with a dedicated wrapper component.
- **Data duplication:** Both section + entity routes rely on `ProjectLayout`’s context. By keeping all routes under the same layout and continuing to pass `Outlet` context, no extra fetches are necessary.
- **Future section variants:** If we add more tabs (e.g., “Accounting”), expand the `isSectionRoute` helper accordingly.

## Rollout / Validation Checklist

1. Implement layout split (section vs. entity) + new wrapper.
2. Update unit / component tests if necessary (e.g., snapshot for `ProjectLayout`).
3. Manual QA matrix:
   - Items list/detail/edit/new.
   - Transactions list/detail/edit/new/import.
   - Reports (invoice/client/property).
   - Post-navigate Back flows.
4. Confirm no console warnings about missing context.

## Open Questions

- Do we want to **animate** transitions between section ↔ entity? (Optional / future).
- Should tabs remain visible for entity routes? (Probably no; doc recommends hiding to avoid confusion).

## Next Steps

1. Implement detection + layout split in `ProjectLayout`.
2. QA all entity flows.
3. Remove temporary inline experiences (other than `TransactionItemsList`) if any pop up.
