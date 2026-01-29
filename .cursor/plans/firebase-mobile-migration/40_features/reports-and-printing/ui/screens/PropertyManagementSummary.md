## Intent
Provide a printable/shareable “Property Management Summary” for a project: totals and a simple item list oriented toward property managers (what’s in the home, value, and location where applicable).

## Inputs
- Route params:
  - `projectId` (required)
- Entry points (where navigated from):
  - Project shell → Accounting tab → “Property Management Summary”

## Reads (local-first)
- Local DB queries:
  - Project by id (name, clientName)
  - Items for project (including `description`, `source`, `sku`, `space`/location label, `marketValue`)
  - Business profile (logo + name)
- Derived view models:
  - `totalMarketValue`: sum of item `marketValue`

## Writes (local-first)
- None (read-only report).

## UI structure (high level)
- Action bar: Back + Share/Print
- Header: logo (if available), “Property Management Summary”, project name/client name, date
- Empty state: “No items found”
- Summary card: total items + total market value
- Items list:
  - description
  - source + sku (when present)
  - space/location (when present)
  - market value; show “No market value set” when value \(0\)

## User actions → behavior (the contract)
- Tap Back:
  - Use native back stack; fallback target is project items list for this project.
  - Web parity evidence: `src/pages/PropertyManagementSummary.tsx` (`fallback = projectItems(...)`, `getBackDestination`).
- Tap Share/Print:
  - Web parity uses `window.print()`.
  - Mobile requirement: share/print via native flows using a rendered artifact derived from local state.

## States
- Loading: show “Loading property management summary…” while queries/derived model resolve.
  - Parity evidence: `src/pages/PropertyManagementSummary.tsx` loading block.
- Empty: show “No items found” if there are no items for the project.
  - Parity evidence: `src/pages/PropertyManagementSummary.tsx`.
- Error: show error state + Back button.
  - Parity evidence: `src/pages/PropertyManagementSummary.tsx` error block.
- Offline: must render from local DB.
- Pending sync: if business logo or other referenced media is pending upload, show a non-blocking warning that exports may omit branding/media.

## Collaboration / realtime expectations
- No realtime requirement while open.
- Values reflect local DB until the next delta sync run.

## Performance notes
- Item list can be large; virtualization is required.
- Favor stable derived computations (e.g., `totalMarketValue`) with memoization keyed on item change signals, not per-render scans.

## Parity evidence
- Totals + item list fields: `src/pages/PropertyManagementSummary.tsx`
- Entry routes: `src/pages/ProjectLayout.tsx`, `src/utils/routes.ts`

