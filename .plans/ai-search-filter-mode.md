# AI Search Filter Mode — ExistingItemsPicker

## Status: Ready for implementation

## Context

AI search is currently inline in `ExistingItemsPicker` (added in the previous session). After the user submits a description, it calls `searchItemsByDescription` and pre-selects the matched item IDs. The problem: matched items are buried in the full list. The fix is to use the AI result IDs as a **filter** — show only matched items — while keeping the normal picker UX intact.

## What to change

**File:** `src/components/items/ExistingItemsPicker.tsx`

### 1. Replace `selectedItemIds` pre-selection with a filter + pre-selection

Add a new state variable:

```ts
const [aiFilteredIds, setAiFilteredIds] = useState<Set<string> | null>(null)
```

`null` = no AI filter active (normal mode). A populated `Set<string>` = AI filter is active.

### 2. Update `handleAiSearch`

Replace the current `setSelectedItemIds` mutation with:

```ts
const matchedIds = new Set(
  result.matches
    .map(m => m.itemId)
    .filter(id => allVisibleItems.has(id))
)
setAiFilteredIds(matchedIds)

// Also pre-select the matched items (appropriate for spaces context)
setSelectedItemIds(prev => {
  const next = new Set(prev)
  matchedIds.forEach(id => next.add(id))
  return next
})

setAiUnmatched(result.unmatched)
```

Remove the `setAiMode(false)` and `setAiDescription('')` calls from the `finally` block — they already happen there, keep those as-is.

### 3. Filter rendered items when `aiFilteredIds` is active

The three item arrays (`suggestedMatches`, `projectMatches`, `outsideMatches`) should be filtered when an AI filter is active. Apply this after the existing `useMemo` computations:

```ts
const suggestedFiltered = useMemo(() => {
  if (!aiFilteredIds) return suggestedMatches
  return suggestedMatches.filter(item => aiFilteredIds.has(item.itemId))
}, [aiFilteredIds, suggestedMatches])

const projectFiltered = useMemo(() => {
  if (!aiFilteredIds) return projectMatches
  return projectMatches.filter(item => aiFilteredIds.has(item.itemId))
}, [aiFilteredIds, projectMatches])

const outsideFiltered = useMemo(() => {
  if (!aiFilteredIds) return outsideMatches
  return outsideMatches.filter(item => aiFilteredIds.has(item.itemId))
}, [aiFilteredIds, outsideMatches])
```

Then use `suggestedFiltered`, `projectFiltered`, `outsideFiltered` everywhere that currently uses `suggestedMatches`, `projectMatches`, `outsideMatches` **downstream** — specifically in:
- `allVisibleItems` memo
- `currentTabItems` memo
- Tab count labels in the nav
- The render blocks inside `activeTab === 'suggested'`, `'project'`, `'outside'`

> Note: The **existing** text search (`normalizedQuery`) still applies on top — the filter chain is: raw items → text search → AI filter → render. This is already how it would work naturally since `suggestedMatches` etc. already incorporate `normalizedQuery`.

### 4. Show an "AI Results" banner + clear button when filter is active

Below the AI input row (the `{aiMode && ...}` block) and above the tabs, add a banner that appears when `aiFilteredIds !== null`:

```tsx
{aiFilteredIds !== null && (
  <div className="mt-2 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
    <Sparkles className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
    <span className="flex-1 text-xs text-primary-800">
      AI Results — {aiFilteredIds.size} match{aiFilteredIds.size !== 1 ? 'es' : ''}
    </span>
    <button
      type="button"
      onClick={() => setAiFilteredIds(null)}
      className="text-primary-500 hover:text-primary-700 flex-shrink-0 text-xs font-medium"
    >
      Clear
    </button>
  </div>
)}
```

### 5. Tabs stay visible with filtered counts

No structural change needed — the tabs already display counts derived from the filtered arrays. Once `suggestedFiltered` etc. are wired in, the tab labels automatically show the filtered counts (e.g., "Project (3)"). No special "AI Results" tab needed.

### 6. Clear AI filter when user types in the text search bar

When `searchQuery` changes, clear `aiFilteredIds`:

```ts
// In the search input onChange:
onChange={(event) => {
  setSearchQuery(event.target.value)
  setAiFilteredIds(null)  // add this
}}
```

Also clear `aiFilteredIds` when the user clicks "AI Search" again (already clears `aiUnmatched`, add `aiFilteredIds` to that):

```ts
onClick={() => { setAiMode(true); setAiUnmatched([]); setAiFilteredIds(null) }}
```

## What does NOT change

- The inline AI input UI (the text field + "Find Items" + cancel X) — unchanged
- The amber unmatched banner — unchanged, still shown when `aiUnmatched.length > 0`
- Tab structure, tab switching, selection checkboxes, "Add Selected", per-item "Add" buttons — all unchanged
- `SpaceDetail.tsx` — no changes
- `aiSpaceSearch.ts` — no changes
- Worker — no changes

## Behavior summary

| State | What user sees |
|-------|---------------|
| Normal | All items across tabs, normal counts |
| Text search active | Server/client filtered items, normal counts |
| AI filter active | Only matched items shown, filtered counts per tab, blue "AI Results — N matches · Clear" banner |
| AI filter + text search | Items must match both filters (additive narrowing) |
| User clears filter | Banner disappears, all items return, pre-selections remain |

## Key files

- `src/components/items/ExistingItemsPicker.tsx` — only file that changes
