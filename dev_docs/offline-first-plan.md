# Offline-First Reliability Plan

## Goal
Make the app reliably usable offline for core workflows (create/view transactions, items, projects, and offline media) by ensuring all critical UI and service modules are available without network access.

## Scope
- Offline-capable UI for core routes (project list, project items, transactions, add/edit transaction, item detail).
- Offline data and sync continue to use existing IndexedDB/offline services.
- Asset and chunk availability guaranteed offline for critical flows.

## Current Failure Mode
- Route components are lazy-loaded, so their JS chunks are fetched at navigation time.
- When offline and a chunk is not cached, dynamic imports fail and the route breaks.

## Plan

### 1) Define Offline-Critical Routes and Modules
Create a definitive list of routes and shared modules that must work offline:
- `/projects`, `/project/:projectId/items`, `/project/:projectId/transactions`
- `/project/:projectId/transactions/new` (AddTransaction)
- `/project/:projectId/items/:itemId` (ItemDetail)
- Any offline UI helpers required by those routes (image upload/preview, offline media utilities)

Deliverable: `dev_docs/offline-critical-routes.md` listing pages and related modules.

### 2) Precache Required Chunks
Ensure the service worker precaches the JS chunks for the offline-critical routes.

Options (pick one):
- **Option A (preferred)**: Use Workbox `additionalManifestEntries` with a build-time manifest of required chunks.
- **Option B**: Use Workbox `globPatterns` to precache all `assets/*.js` and `assets/*.css`.

Constraints:
- Do NOT hard-code filenames.
- Avoid precaching non-critical large bundles if size is a concern.

Deliverable: Update `vite.config.ts` + build step to inject a reliable list of chunks.

### 3) Remove Lazy Loading for Offline-Critical Routes
If a route must work offline, it should not rely on a dynamic import at navigation time.

Approach:
- Convert offline-critical routes to static imports (eager load) or
- Keep lazy but prefetch and precache those chunks at app start when online.

Deliverable: update `src/App.tsx` route imports for offline-critical screens.

### 4) Add Explicit Cache Warming
When online, proactively load and cache offline-critical route chunks:
- Trigger a `Promise.all` of `import()` for critical routes on app boot.
- Ensure cache entries exist before the user goes offline.

Deliverable: `src/App.tsx` boot sequence update with caching guarantees.

### 5) Service Worker Runtime Strategy for Chunks
Keep a safe runtime caching strategy for JS chunks:
- `CacheFirst` for `/assets/*.js` and `/assets/*.css`
- Optional expiration to limit storage use

Deliverable: update `public/sw-custom.js` runtime caching for script/style assets.

### 6) Offline Navigation Fallback UX
Handle missing chunk gracefully:
- If a route is not cached, show an offline-friendly message and route the user back to a cached screen.

Deliverable: error boundary + offline fallback UI component.

### 7) Offline Test Plan
- Simulate first-load online then offline.
- Navigate to each offline-critical route while offline.
- Validate create transaction flow works end-to-end with offline queue.

Deliverable: `dev_docs/offline-test-plan.md`.

## Milestones
1. Define offline-critical routes and modules.
2. Precache required chunks without hard-coded filenames.
3. Remove lazy loading or warm cache for critical routes.
4. Validate offline navigation and transaction creation.

## Risks and Tradeoffs
- Precache size vs reliability: precaching more assets increases reliability but may increase load time and storage use.
- Eager-loading more code increases initial bundle size but eliminates offline navigation failures.

## Success Criteria
- App boots and can navigate to offline-critical screens with network disabled.
- Add transaction works offline with no missing chunk errors.
- No service worker install failures from missing assets.
