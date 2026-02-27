# Issue: AI Space Search Not Working

**Status:** Resolved
**Opened:** 2026-02-26
**Resolved:** 2026-02-26

## Info
- **Symptom:** User reports AI search is not working (details not yet specified)
- **Affected area:** `src/components/spaces/AiSpaceSearchModal.tsx`, `src/utils/aiSpaceSearch.ts`, `src/pages/SpaceDetail.tsx`, Cloudflare Worker at `ledger-ai-worker/src/index.ts`

### Architecture
- Modal is opened from SpaceDetail via `ExistingItemsPicker` → "AI Search" button
- `AiSpaceSearchModalLoader` fetches all project items via `unifiedItemsService.getItemsByProject()`
- `AiSpaceSearchModal` calls `searchItemsByDescription()` → POST to `VITE_AI_WORKER_URL`
- Worker receives `{description, items}`, calls OpenAI gpt-4o-mini, returns `{matches[], unmatched[]}`
- CORS is dynamic: reflects request Origin if it matches `env.ALLOWED_ORIGIN`, or if `ALLOWED_ORIGIN === '*'`

### Evidence gathered
- Worker URL in `.env`: `VITE_AI_WORKER_URL=https://ledger-ai.team-1d4.workers.dev`
- **Live worker test (2026-02-26):** Sent POST with `{"description":"white sofa","items":[{"id":"1","name":"White Linen Sofa"}]}` → HTTP 200, `{"matches":[{"itemId":"1","phrase":"white sofa"}],"unmatched":[]}` ✅ Worker is alive and returning correct format
- Modal component looks correct — no obvious logic bugs
- `AiSpaceSearchModalLoader` fetches items only from the current project (`getItemsByProject`), which limits search scope to project items only (not full inventory)

### Candidate failure points (not yet triaged)
1. CORS error (worker's `ALLOWED_ORIGIN` env var may not include the app's origin)
2. OpenAI API key expired/missing/quota exceeded on the worker
3. UI trigger not reachable (button not rendering, or `showAiSearchModal` gating condition failing)
4. `getItemsByProject` returning empty — modal renders with no items to match against
5. Modal UI bug — search button works but results display incorrectly

## Experiments

### H1: Worker has a CORS issue blocking the browser request
- **Rationale:** Worker responds fine from curl but browser sends an Origin header; `ALLOWED_ORIGIN` env var may be misconfigured
- **Experiment:** Check browser network tab for a CORS preflight failure (OPTIONS → non-2xx, or missing CORS headers on response)
- **Result:** _pending — need user to report browser console/network errors_
- **Verdict:** Inconclusive

### H2: OpenAI key/quota issue on the worker
- **Rationale:** Worker returns 502 if OpenAI call fails; curl test worked so key is valid *at time of test*
- **Experiment:** Replicate with actual inventory items; if 502, check worker logs in Cloudflare dashboard
- **Result:** _pending_
- **Verdict:** Inconclusive

### H3: `getItemsByProject` returns empty, so AI has nothing to match
- **Rationale:** Loader only passes project items (not full inventory). If project has no items, `allItems` is `[]`, and AI returns no matches even on a valid description
- **Experiment:** Add console.log or check if modal shows spinner indefinitely (items haven't loaded) vs "No items matched"
- **Result:** _pending_
- **Verdict:** Inconclusive

### H4: UI trigger issue — modal never opens or button unreachable
- **Rationale:** `showAiSearchModal` only set via `ExistingItemsPicker`'s `onAiSearch` callback; if that picker isn't open, the button can't be reached
- **Experiment:** Confirm modal can be opened and search button is clickable
- **Result:** _pending_
- **Verdict:** Inconclusive

## Resolution

- **Root cause:** `ALLOWED_ORIGIN` in `wrangler.toml` was set to production only (`https://inventory.1584design.com`). Worker's CORS logic did a single-value equality check, so `http://localhost:3000` was blocked on preflight.
- **Fix:** Changed `ALLOWED_ORIGIN` to a comma-separated list; updated worker to parse the list and reflect the matching origin in CORS headers.
- **Files changed:**
  - `ledger-ai-worker/wrangler.toml` — added `http://localhost:3000` to `ALLOWED_ORIGIN`
  - `ledger-ai-worker/src/index.ts` — split `ALLOWED_ORIGIN` on commas, check `allowedOrigins.includes(origin)`
- **Verified:** curl preflight with `Origin: http://localhost:3000` → `access-control-allow-origin: http://localhost:3000` ✅; production origin still works ✅
- **Lessons:** When a Cloudflare Worker needs to serve both prod and localhost, store allowed origins as a comma-separated var. Single-value ALLOWED_ORIGIN is a common footgun.
