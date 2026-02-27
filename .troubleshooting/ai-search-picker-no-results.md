# Issue: AI Search Returns No Results in ExistingItemsPicker

**Status:** Resolved
**Opened:** 2026-02-26
**Resolved:** 2026-02-26

## Info
- **Symptom:** AI search in ExistingItemsPicker (spaces context) returns "not found" for terms that previously worked in the old standalone modal.
- **Affected area:** `src/components/items/ExistingItemsPicker.tsx` — `handleAiSearch` and `allVisibleItems`

### Architecture change context
Old flow (modal):
- `AiSpaceSearchModalLoader` fetched ALL project items via `getItemsByProject()` upfront
- Passed full list to `searchItemsByDescription(description, allItems)`
- Typically ~50 items per project

New flow (inline picker):
- `handleAiSearch` reads from `allVisibleItems` — a Map built from the **filtered** arrays
- In spaces context: `mode="space"`, `includeSuggested={false}`, `includeProject=true`, `includeOutside=true`
- Sends all items across all tabs (project + outside) — typically ~345 items

## Root Cause

Two compounding issues:

### 1. gpt-4o-mini degrades with large item lists
The model can do semantic matching (e.g. "bird" → heron) with ~50 items but loses this ability at ~80+ items. With 345 items, it consistently fails to make category→species inferences.

**Evidence:**
- 50 items: 3/3 bird-related items matched ("bird art" → heron, crane, parrot) — 100% success
- 80 items: 1/3 matched — model starts losing semantic depth
- 343 items (single request): 0/3 matched — complete failure

### 2. Prompt structure was suboptimal
Original prompt used a single user message with rules and items combined. The rules got lost in the noise of 345 item listings.

## Resolution

### Fix 1: Restructured prompt (system + user split)
- Moved matching rules to a **system message** (higher attention weight)
- Added explicit category→specific examples: "tree art" → "Oak Painting", "cat figurine" → "Siamese Statue"
- Added markdown fence stripping for JSON parsing robustness

### Fix 2: Batching for large item lists
- Items > 50 are split into batches of 50, sent to gpt-4o-mini in parallel via `Promise.all`
- Results merged: matches collected from all batches, unmatched only reported if ALL batches report it
- Items ≤ 50 still use single request (no overhead)

**Results after fix:**
- 343 items with "bird art": 3/3 matches found (heron, crane, parrot) — 100% across 3 consecutive runs
- Small payloads still work (no regression)

### Additional cleanup
- Removed stale `console.log('[DEBUG] getExistingItemDisableState...')` from `SpaceDetail.tsx:347`

## Experiments

### H1: Items already in the space are excluded, so AI can't find them
- **Result:** Confirmed by code reading — `excludedItemIds` removes already-in-space items. But this is by design (picker is for adding NEW items to the space).
- **Verdict:** Not the bug — the user was searching for items not yet in the space.

### H2: gpt-4o-mini can't handle 345 items in a single request
- **Experiment:** Tested same prompt at 50 vs 80 vs 343 items
- **Result:** Works at 50, degrades at 80, fails at 343
- **Verdict:** CONFIRMED — root cause

### H3: Prompt improvements alone fix the issue
- **Experiment:** Tried generic principles (no examples), specific examples, system/user split
- **Result:** System/user split with examples works at 50 items but still fails at 343
- **Verdict:** Insufficient alone — batching required

### H4: Batching at 50 items per batch fixes the issue
- **Experiment:** Split 343 items into 7 batches of ~50, parallel requests
- **Result:** 3/3 matches, 3/3 runs, 100% consistency
- **Verdict:** CONFIRMED — this is the fix

## Files Changed
- `ledger-ai-worker/src/index.ts` — prompt restructure + batching logic
- `src/pages/SpaceDetail.tsx` — removed stale debug console.log
