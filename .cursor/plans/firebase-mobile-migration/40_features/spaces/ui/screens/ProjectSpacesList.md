# ProjectSpacesPage — Screen contract

## Intent
Let a user browse and search Spaces for a project, see per-space item counts, and enter creation flow.

## Inputs
- Route params:
  - `projectId`
- Entry points:
  - Project shell tab: “Spaces” (`ProjectLayout` section nav)

## Reads (local-first)
- Local DB queries:
  - `spaces` for the current project scope
  - `items` for the project (to compute item counts by `item.spaceId`)
- Derived view models:
  - `itemCountsBySpace[spaceId] = count(items where item.spaceId === spaceId)`
  - `filteredSpaces` by search query (matches name or notes)

## Writes (local-first)
- Add space:
  - Navigates to create screen (`SpaceNew`) with `returnTo` context (if applicable)

## UI structure (high level)
- Header:
  - “Add” button
  - Search input (“Search spaces...”)
- Body:
  - Empty state (no spaces or no results)
  - Grid of `SpacePreviewCard`

## User actions → behavior (the contract)
- Tap **Add**:
  - Navigate to `SpaceNew` for the current project.
- Type in **Search**:
  - Filter spaces by substring match against `space.name` and `space.notes` (case-insensitive).
- Tap a **Space card**:
  - Navigate to `SpaceDetail` for that space with navigation context (`returnTo`) preserved.

## States
- Loading:
  - Uses project shell loading; this screen assumes `ProjectLayout` has provided `spaces` + `items`.
- Empty:
  - When no spaces and search query empty: “No spaces yet” + CTA to Add.
  - When search query active and no matches: “No spaces found”.
- Error:
  - Surface via project shell error boundary/state (screen-local errors should be rare).
- Offline:
  - List renders from local DB; search works offline.
- Pending sync:
  - Spaces and item counts may be stale until next delta; should not block browsing.

## Media (if applicable)
- Space cards may render a primary image.
- Offline placeholders (`offline://`) must be resolvable in the list card renderer.

## Collaboration / realtime expectations
- While project is foregrounded, updates should appear on the next delta after a change-signal bump.
- No listeners on the `spaces` collection; project freshness comes from `meta/sync` + delta.

## Performance notes
- Expected dataset size is modest (dozens), but search should be debounced for mobile keyboards.
- Item counts must be computed efficiently (prefer precomputed counts or indexed queries if item list is large).

## Parity evidence
- List UI, search, empty states, item counts: `src/pages/ProjectSpacesPage.tsx`
- Card rendering + offline image resolution: `src/components/spaces/SpacePreviewCard.tsx`
- Routing helpers: `src/utils/routes.ts` (`projectSpaces`, `projectSpaceNew`, `projectSpaceDetail`)

