# Pan-account item search (spec)

## Summary
Add an account-wide item search that lets you find any item across **all projects** and **business inventory**, from anywhere in the app.

Primary entry point: **global header search** (top nav).

Inspiration: the existing “Add existing items” search experience used in transactions (multi-source search + familiar item preview cards).

## Problem
Today, if you want to find a known item you often need to remember where it “lives” (which project vs business inventory) and then navigate there first. That’s slow and error-prone, especially when the account has many projects.

## Goals
- **One place to search** items across the whole account (projects + business inventory).
- **Fast, familiar UI**: type-to-search, quick scoping filters, clear result context.
- **Actionable results**: click a result to open the item detail in the correct place/context.
- **Safe defaults**: do not accidentally load “all items” without a query unless intentionally showing a small “recent items” list.
- **Works online and offline** (best-effort offline results via cached items).

## Non-goals (for v1)
- Full-text search across long fields (e.g. notes OCR).
- Advanced filters (price ranges, disposition, bookmark, etc.).
- Bulk selection or multi-add workflows (transaction/space pickers already cover this).
- Cross-account search.

## Entry points
### Primary (required)
- **Global header**: search icon/button labelled via tooltip “Search items”.
  - Optional shortcut (later): `Cmd+K` / `Ctrl+K`.

### Secondary (nice-to-have)
- **Business inventory page**: “Search all items” button that opens the same modal.
- **Project items page**: “Search all items” button (same modal).

## UX / UI
### Surface
- **Modal overlay** (consistent with existing “existing items” modal patterns).
- Title: “Search items”
- Close actions:
  - Close button
  - Escape key
  - Click outside (optional; ok to skip if current modal pattern doesn’t support it)

### Layout (wire outline)
- Header row:
  - Title: “Search items”
  - Close button
- Control row:
  - Search input (autofocus)
  - Scope filter:
    - All (default)
    - Projects
    - Business inventory
- Results area:
  - Loading state
  - Empty state (no results)
  - Results list using existing item preview cards

### Result display rules
Each item card should clearly communicate:
- **Description** and **SKU** if present
- **Primary price label** (existing behavior)
- **Context**:
  - If `projectId` exists: treat as **project item**
  - If `projectId` is null: treat as **business inventory item**
- Clicking the card opens the appropriate item detail route:
  - Project items should open with project context.
  - Business inventory items should open in business inventory.

## Search behavior
### Query
- Search input is a plain string.
- **Debounce** network calls (e.g. 200–300ms) to avoid spamming requests.

### Minimum query / recent items
To avoid accidentally fetching the entire `items` table:
- If query length is 0:
  - Show **recent items** (paginated, e.g. 30) as a convenience, OR show an instructional empty state (“Type to search”).
- If query length is 1 (optional threshold):
  - Prefer “Type 2+ characters to search” (to reduce noisy matches).

### Matching fields (server-side)
Use existing query behavior from the unified item search:
- `description`
- `source`
- `sku`
- `payment_method`
- `business_inventory_location`

Future extension candidates:
- `notes`
- `space`
- numeric amount fields (if stored as searchable strings)

### Scope filter behavior
Scope filter affects which results are shown:
- **All**: show both project items and business inventory items.
- **Projects**: show only items with non-null `projectId`.
- **Business inventory**: show only items with null `projectId`.

Implementation note: scope can be done client-side after an “All” query, or by adding service options later for server-side scoping.

### Pagination
- Default limit: 30 results per page
- “Load more” pattern (button) or infinite scroll (later)

## Data sources and service hooks
### Recommended v1 service hook
Reuse existing unified service search, which already supports:
- account scoping
- business inventory inclusion
- optional search query
- pagination
- offline fallback via cached items

Spec expectation:
- “All account” search is achieved by calling the existing search with **no excluded project** and **include business inventory**.

## Error handling
- On network error: show a small inline message (“Couldn’t load results”) and keep the UI usable.
- Offline: show cached results if available.

## Permissions / visibility
- Only show items within the **current account** (`account_id`).
- Respect any existing RLS / auth enforcement (service already ensures auth when online).

## Analytics (optional)
Track:
- Search opened
- Query executed (length only, no raw text)
- Result count bucket (0, 1–5, 6–20, 20+)
- Item opened from results (project vs business inventory)

## QA scenarios
- Search finds an item in:
  - the current project
  - a different project
  - business inventory
- Scope filter hides/shows correctly.
- Clicking a project result opens the item with correct project context.
- Clicking a business inventory result opens correct business inventory detail.
- Empty query behavior is safe (doesn’t hang the UI).
- Offline mode shows cached results and doesn’t crash.

## Rollout checklist
- Add global header entry
- Modal opens/closes reliably
- Search is debounced
- Results show correct context and link targets
- Basic manual QA passes (above scenarios)

