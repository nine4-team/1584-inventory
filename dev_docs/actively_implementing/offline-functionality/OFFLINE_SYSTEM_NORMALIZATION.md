# Offline System Normalization Plan

## 🔥 Immediate Remediation Issues

Use this section to track the regressions introduced during the initial implementation pass. Each item needs an owner + fix before we mark the corresponding workstream complete.

1. **Offline deletes leave ghost records in IndexedDB** ✅ **FIXED 2026‑01‑02**  
   - `offlineTransactionService.deleteTransaction` / `offlineProjectService.deleteProject` now purge the cached entity as soon as the delete is queued so optimistic lists stop resurfacing ghosts.  
   - `operationQueue.executeDeleteTransaction` / `executeDeleteProject` delete the server record, remove the local IndexedDB entry, and clear related conflicts to keep queues clean.  
   - **Follow-up:** add regression tests that create → delete offline and verify `offlineStore.get*ById` returns `null` after sync (tracked in testing checklist).

2. **Project payloads drop budget/settings metadata when replayed online** ✅ **FIXED 2026‑01‑02**  
   - `DBProject` now includes `accountId`, `budgetCategories`, `defaultCategoryId`, `settings`, `metadata`, counts, and totals so the offline cache mirrors production.  
   - `offlineProjectService.create/update` persists the full record, including derived counts, and queue payloads carry the entire update set.  
   - `operationQueue.executeCreate/UpdateProject` hydrates from IndexedDB, sends every field to Supabase, and saves the server echo back into `offlineStore`.  
   - **Follow-up:** add Vitest coverage for offline project create/edit flows with custom budget allocations + metadata (see Testing section).

3. **Offline transaction create does not roll back child items on failure** ✅ **FIXED 2026‑01‑02**  
   - `offlineTransactionService.createTransaction` now tracks every child `offlineItemService.createItem` result (item + operation IDs) and rolls them back if a later item fails or if queueing the parent transaction throws.  
   - Rollback removes the optimistic child items from `offlineStore` and calls the new `operationQueue.removeOperation` helper so we do not leave orphaned queue entries that reference a transaction that never existed.

4. **Doc status vs. code reality mismatch** ✅ **FIXED 2026‑01‑02**  
   - The “Current State Analysis” now reflects that transactions and projects ship with the same offline primitives as items, and explicitly calls out the remaining hydration/test gaps so the roadmap mirrors code reality instead of labeling the features as “missing.”

Add more bullets here as we discover additional regressions.

5. **Metadata warmers fire multiple times per boot** ✅ **FIXED 2026‑01‑04**  
   - Guard rails added to `cacheBudgetCategoriesOffline`, `cacheTaxPresetsOffline`, and `cacheVendorDefaultsOffline` so they now accept pre-fetched data, diff against IndexedDB, and skip writes/network fetches when nothing changed.  
   - `hydrateMetadataCaches` passes the `force` flag through (Retry Sync still hydrates) and vendor defaults now share the same debounce logic.  
   - Result: no more duplicate fetches/log spam per mount while still writing whenever fresh metadata arrives from Supabase or form submissions.

6. **Transaction detail conflicts fail to resolve** ✅ **FIXED 2026‑01‑04**  
   - `offlineStore.getConflicts` now normalizes every record (backfills `itemId`/transactionId/projectId` by inspecting stored payloads and trimming keys) so legacy rows stop surfacing with blank identifiers.  
   - `useConflictResolution` + `ConflictResolutionView` now trim IDs when hydrating conflicts, which keeps `resolveAllConflicts` from feeding undefined IDs into `conflictResolver.applyResolution`.  
   - Result: “Resolve all” succeeds again and conflict entries are cleaned as they’re read from IndexedDB.

7. **Offline network gating still hit Supabase auth refresh** ✅ **FIXED 2026‑01‑04**  
   - `networkStatusService.runConnectivityCheck` now pings the uncached Google `generate_204` endpoint instead of the service-worker’d `/ping.json`, so `isNetworkOnline()` flips to `false` as soon as real connectivity drops.  
   - Connectivity checks no longer call `supabase.auth.getSession()` during offline probes, so we stop spamming the console with refresh attempts while intentionally offline.  
   - Result: Add Transaction and every other offline path short‑circuit into the offline queue without attempting to hit Supabase when the device is disconnected.

## Purpose
This document captures the established offline patterns discovered through code analysis and provides a roadmap for normalizing offline functionality across all entities (items, transactions, projects) in the application.

## Implementation Status

### Phase 0: Offline Invariants & Metadata ✅ **COMPLETE**
- [x] IndexedDB schema expanded for `budget_categories` and `tax_presets`
- [x] `offlineMetadataService` with caching and retrieval APIs
- [x] Background refresh integrated into `budgetCategoriesService` and `taxPresetsService`
- [x] `useOfflinePrerequisites` hook created
- [x] Telemetry events implemented (`offlineMetadataCacheWarm`, `offlineMetadataCacheCold`, `offlineMetadataValidationBlocked`)

**Files Created/Modified:**
- `src/services/offlineStore.ts` - Added budget categories and tax presets stores
- `src/services/offlineMetadataService.ts` - New service for metadata caching
- `src/hooks/useOfflinePrerequisites.ts` - New hook for prerequisite checking
- `src/services/budgetCategoriesService.ts` - Added auto-caching
- `src/services/taxPresetsService.ts` - Added auto-caching

### Phase 1: Purpose-built Offline Services ✅ **COMPLETE**
- [x] Create `offlineTransactionService.ts`
- [x] Create `offlineProjectService.ts`
- [x] Integrate with `offlineItemService` for child item creation

### Phase 2: Upgrade Unified Orchestrators ✅ **COMPLETE**
- [x] Update `transactionService` CRUD methods
- [x] Update `projectService` CRUD methods
- [x] Add offline-first branching with network gating

### Phase 3: Operation Queue & Conflict Hygiene ✅ **COMPLETE**
- [x] Extend operation typings for transactions/projects (project updates now include metadata/budget/default category fields)
- [x] Implement queue executors for transaction/project operations (delete executors purge IndexedDB + conflicts after Supabase success)
- [x] Expand conflict tracking beyond items
- [x] Add conflict detectors for transactions/projects

### Phase 4: Read Surfaces & React Query Hydration ✅ **COMPLETE**
- [x] Add hydration helpers for transactions/projects
- [x] Update detail/edit pages for cache-first reads
- [x] Update list queries to follow cache-first order

### Phase 5: UI Resilience & Testing ✅ **COMPLETE** _(test refresh pending)_
- [x] Integrate `useOfflinePrerequisites` into forms
- [x] Add inline banners and disabled states
- [x] Add React Query hydration to all transaction/project detail/edit/list pages
- [ ] Add automated tests (new offline delete + project metadata regressions still to cover)
- [x] Manual QA checklist

**Files Created/Modified:**
- `src/components/ui/OfflinePrerequisiteBanner.tsx` - New reusable banner component
- `src/components/TransactionItemForm.tsx` - Integrated prerequisite checking
- `src/components/ProjectForm.tsx` - Integrated prerequisite checking
- `src/components/ui/RetrySyncButton.tsx` - Added metadata rehydration support
- `src/services/__tests__/offlineTransactionService.test.ts` - Transaction CRUD tests
- `src/services/__tests__/offlineProjectService.test.ts` - Project CRUD tests
- `src/services/__tests__/offline-integration-phase5.test.ts` - Integration tests
- `dev_docs/actively_implementing/offline-functionality/PHASE5_QA_CHECKLIST.md` - Manual QA checklist

## Current State Analysis

### ✅ Fully Implemented: Items

Items have complete offline support following a well-established pattern:

**Architecture:**
- `unifiedItemsService` acts as an offline-aware orchestrator
- `offlineItemService` handles offline-specific operations
- `operationQueue` manages sync operations
- `offlineStore` (IndexedDB) caches optimistic data

**Key Files:**
- `src/services/inventoryService.ts` (lines 2589-3012) - unifiedItemsService CRUD
- `src/services/offlineItemService.ts` - offline-specific operations
- `src/services/operationQueue.ts` - sync queue execution
- `src/services/offlineStore.ts` - IndexedDB persistence

### ✅ Offline CRUD Path: Transactions

**Current Implementation:**
- `transactionService.create/update/delete` (see `src/services/inventoryService.ts`) now hydrates `offlineStore`, gates on `isNetworkOnline()`, and delegates to `offlineTransactionService` when offline or when Supabase rejects.  
- `offlineTransactionService` persists the full transaction payload (metadata, counts, child item IDs) before queueing, validates cached categories/tax presets, and now rolls back optimistic child items + their queued operations if anything fails mid-flight.  
- `operationQueue.executeCreate/Update/DeleteTransaction` replays full records from IndexedDB, clears conflicts, and replays any queued child item operations once the parent sync succeeds.
- React Query hydration helpers (`hydrateTransactionCache`, `hydrateProjectTransactionsCache`) are integrated into detail/edit/list pages for cache-first loading.

**Remaining Gaps:**
- Automated regression coverage for offline transaction flows is still pending (see "Testing & diagnostics" section).

### ✅ Offline CRUD Path: Projects

**Current Implementation:**
- `projectService.create/update/delete` mirrors the offline-first gating used for items/transactions and shares the metadata prerequisite checks so forms never submit without cached budgets/settings.  
- `offlineProjectService` stores derived counts/settings/totals so queue executors can replay full records, and delete executors purge IndexedDB + conflicts immediately.  
- Queue executors hydrate from IndexedDB before syncing to Supabase and clear `project` conflicts once the server accepts the change set.

**Remaining Gaps:**
- We still owe integration/unit coverage for offline project CRUD and hydration flows (see "Testing & diagnostics" section).

## Established Patterns (Code-Backed)

### Pattern 1: Optimistic ID Generation + Cache-First Architecture

**What:** Always generate optimistic IDs upfront, persist full entity data to IndexedDB before queueing operations.

**Why:** Ensures entities are immediately accessible offline, prevents orphaned operations, enables full-record replication.

**Implementation:**
```typescript
// unifiedItemsService.createItem (line 2591-2592)
const optimisticItemId = `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

// offlineItemService.createItem (line 158-159)
await offlineStore.saveItems([tempItem]) // BEFORE queueing
const operationId = await operationQueue.add(operation, ...)
```

**Files to Apply:**
- `src/services/inventoryService.ts` - transactionService methods
- `src/services/inventoryService.ts` - projectService methods

### Pattern 2: Offline-First Branching with Network Gating

**What:** Check `isNetworkOnline()` early, delegate to offline service immediately when offline, fall back to offline queue on network errors.

**Why:** Provides deterministic offline behavior, prevents hanging requests, ensures UI always gets immediate feedback.

**Implementation:**
```typescript
// unifiedItemsService.createItem (line 2651-2652)
if (!isNetworkOnline()) {
  return queueOfflineCreate('offline')
}

// unifiedItemsService.updateItem (line 2768-2772)
if (!online) {
  const { offlineItemService } = await import('./offlineItemService')
  await offlineItemService.updateItem(accountId, itemId, updates)
  return
}

// Catch block fallback (line 2933-2937)
catch (error) {
  console.warn('Failed to update item online, falling back to offline queue:', error)
  const { offlineItemService } = await import('./offlineItemService')
  await offlineItemService.updateItem(accountId, itemId, updates)
}
```

**Files to Apply:**
- `src/services/inventoryService.ts` - All transactionService CRUD methods
- `src/services/inventoryService.ts` - All projectService CRUD methods

### Pattern 3: Offline Store Hydration Before Operations

**What:** Initialize and hydrate from `offlineStore` before attempting any Supabase operations, even when online.

**Why:** Prevents empty state flashes, ensures cached data is available for conflict resolution, enables optimistic UI updates.

**Implementation:**
```typescript
// unifiedItemsService.createItem (line 2643-2649)
try {
  await offlineStore.init()
  await offlineStore.getAllItems().catch(() => [])
} catch (e) {
  console.warn('Failed to hydrate from offlineStore:', e)
}

// unifiedItemsService.updateItem (line 2756-2766)
try {
  await offlineStore.init()
  const existingOfflineItem = await offlineStore.getItemById(itemId).catch(() => null)
  if (existingOfflineItem) {
    // Pre-hydrate React Query cache if needed
  }
} catch (e) {
  console.warn('Failed to hydrate from offlineStore:', e)
}
```

**Files to Apply:**
- `src/services/inventoryService.ts` - All transactionService methods
- `src/services/inventoryService.ts` - All projectService methods

### Pattern 4: Full-Record Replication from Cache

**What:** Queue executors load complete entity data from IndexedDB, not just operation payload fields, when syncing to server.

**Why:** Prevents data loss, ensures server receives all user-entered fields (source, sku, qrKey, etc.), maintains consistency.

**Implementation:**
```typescript
// operationQueue.executeCreateItem (line 559-604)
const localItem = await offlineStore.getItemById(data.id)
// Send FULL item data, not just operation.data fields
await supabase.from('items').insert({
  item_id: data.id,
  account_id: accountId,
  project_id: localItem.projectId ?? data.projectId,
  source: localItem.source ?? null, // All fields from localItem
  sku: localItem.sku ?? null,
  // ... every field from localItem
})

// operationQueue.executeUpdateItem (line 704-757)
const localItem = await offlineStore.getItemById(data.id)
const updatedLocalItem = { ...localItem, ...data.updates, lastUpdated: now }
// Send FULL updated item, not just updates
await supabase.from('items').update({ ...all fields from updatedLocalItem })
```

**Files to Apply:**
- `src/services/operationQueue.ts` - Add executeCreateTransaction, executeUpdateTransaction, executeDeleteTransaction
- `src/services/operationQueue.ts` - Add executeCreateProject, executeUpdateProject, executeDeleteProject

### Pattern 5: React Query Cache Hydration

**What:** Hydrate React Query cache from offlineStore before rendering, check cache before service calls.

**Why:** Prevents "item not found" errors for optimistic entities, enables immediate UI updates, reduces service calls.

**Implementation:**
```typescript
// ItemDetail.tsx (lines 85-143)
await hydrateItemCache(getGlobalQueryClient(), currentAccountId, actualItemId)
const cachedItem = queryClient.getQueryData<Item>(['item', accountId, itemId])
if (cachedItem) {
  setItem(cachedItem)
  return
}

// getItemById (lines 4280-4308)
const queryClient = tryGetQueryClient()
if (queryClient) {
  const cachedItem = queryClient.getQueryData<Item>(['item', accountId, itemId])
  if (cachedItem) return cachedItem
}
```

**Files to Apply:**
- `src/utils/hydrationHelpers.ts` - Add hydrateTransactionCache, hydrateProjectCache
- All detail/edit pages for transactions and projects

### Pattern 6: Optimistic Updates with Rollback on Failure

**What:** Save optimistic data to IndexedDB before queueing, rollback on queue failure to prevent orphaned records.

**Why:** Maintains data integrity, prevents IndexedDB bloat, ensures operations always have backing data.

**Implementation:**
```typescript
// offlineItemService.createItem (line 158-202)
try {
  await offlineStore.saveItems([tempItem])
} catch (error) {
  throw new OfflineQueueUnavailableError(...)
}

const operationId = await operationQueue.add(operation, ...)
catch (error) {
  // Rollback optimistic item
  await offlineStore.deleteItem(itemId)
  throw error
}
```

**Files to Apply:**
- New offlineTransactionService.ts
- New offlineProjectService.ts

### Pattern 7: Conflict Resolution After Successful Sync

**What:** Clear conflicts for an entity after successful UPDATE operation syncs local state to server.

**Why:** Prevents stale conflict banners, resolves conflicts automatically when sync succeeds.

**Implementation:**
```typescript
// operationQueue.executeUpdateItem (line 804-817)
await offlineStore.saveItems([dbItem])
try {
  await offlineStore.deleteConflictsForItems(accountId, [data.id])
  console.log('Cleared conflicts for item after successful UPDATE', { itemId: data.id })
} catch (conflictClearError) {
  console.warn('Failed to clear conflicts after UPDATE (non-fatal)', ...)
}
```

**Files to Apply:**
- `src/services/operationQueue.ts` - Update/delete executors for transactions and projects

## Normalization Roadmap

### Phase 0: Offline invariants & metadata

**Goals:** Make sure every rule the online code currently enforces (budget-category ownership, tax preset lookups, authenticated user attribution) can be satisfied without the network.

**Tasks:**
1. Expand offline caching for supporting tables.
   - Persist `budget_categories`, `tax_presets`, and user/account context to IndexedDB using new helpers (`cacheBudgetCategoriesOffline`, `cacheTaxPresetsOffline`).
   - Add background refresh + manual hydration entry points so caches stay warm whenever a user is online.
2. Provide read APIs for the cached metadata.
   - Export `getCachedBudgetCategoryById` / `getCachedTaxPresetById` utilities for offline services.
   - Surface “validation unavailable” errors in the UI when caches are cold so the user understands why an action is blocked while offline.
3. Document the invariants that must be satisfied before going offline (e.g., “sync categories/presets first”) inside onboarding / offline UX flows.
4. Gate offline actions with inline messaging.
   - Only surface cache health where it matters: `TransactionItemForm`, `ProjectForm`, and `BudgetCategoriesManager` use the cached metadata helpers before submission and render plain-language inline banners when something is missing.
   - Submit buttons stay disabled until caches are replenished (`MissingOfflinePrerequisiteError`), and copy tells users exactly what to do (“Go online and sync tax presets before editing offline.”).
5. Instrument cache hydration + UX blockers (developer visibility only).
   - Emit `offlineMetadataCacheWarm`, `offlineMetadataCacheCold`, and `offlineMetadataValidationBlocked` events through the telemetry bridge plus console logs so support can diagnose issues without exposing checklists or jargon to end users.

**Files:**
- `src/services/offlineStore.ts`
- `src/services/budgetCategoriesService.ts`
- `src/services/taxPresetsService.ts`
- Offline UX helpers

**Offline metadata UX spec (user-facing pieces only):**
- Entry points: `TransactionItemForm`, `ProjectForm`, `BudgetCategoriesManager`.
- Data contract: `useOfflinePrerequisites()` returns `{ isReady, blockingReason, hydrateNow() }`.
- States: `ready` (silent), `warming` (tiny inline spinner near submit button), `blocked` (red inline banner with single sentence + “Retry sync” button that calls `hydrateNow` when online).
- Copy example: “Need tax presets synced to finish this offline. Go online and tap Retry sync.”
- Exit criteria: manual QA deletes caches, sees banner on each form, rehydrates online, and the banner disappears without reload.

### Phase 1: Purpose-built offline services for transactions & projects

**Goals:** Mirror `offlineItemService` for the remaining entity types, including optimistic ID generation, rollback, and dependency handling.

**Tasks:**
1. Create `offlineTransactionService.ts`.
   - Support `createTransaction`, `updateTransaction`, `deleteTransaction`.
   - Generate optimistic IDs (`T-${Date.now()}-${rand}`) and persist the *entire* transaction payload (including tax metadata, `itemIds`, `needsReview` state, etc.) before queueing.
   - When a transaction create includes items, delegate to `offlineItemService` (or a lightweight helper) so child items are queued with the same optimistic transaction ID.
   - Enforce local validations using the metadata cached in Phase 0. If validation data is missing while offline, surface a typed error for the UI.
2. Create `offlineProjectService.ts`.
   - Mirror the structure above for project CRUD with optimistic IDs (`P-...`).
   - Persist derived fields (e.g., `itemCount`, `transactionCount`, `settings`) so queue executors can replay full records.
3. Ensure each service rolls back optimistic cache entries when `operationQueue.add` fails or when preconditions cannot be met.

**Files:**
- `src/services/offlineTransactionService.ts` (new)
- `src/services/offlineProjectService.ts` (new)
- `src/services/offlineItemService.ts` (integration helpers)

### Phase 2: Upgrade unified orchestrators & dependent flows

**Goals:** Route every transactional path through the new offline services while preserving the existing online-only logic (validations, tax calculations, child-item creation).

**Tasks:**
1. Update `transactionService` CRUD:
   - Hydrate `offlineStore` + metadata caches up front so the optimistic state is available to the UI.
   - Perform an `isNetworkOnline()` gate; call the offline service immediately when offline or when Supabase rejects/ times out.
   - When online, continue executing the current Supabase flow **but** keep the optimistic ID consistent with the offline path and enqueue a fallback create/update if any portion fails after the user committed changes.
   - Ensure `unifiedItemsService.createTransactionItems` can run offline by delegating to `offlineItemService` when the parent transaction is queued.
2. Update `projectService` CRUD with the same pattern.
3. Surface typed errors / UI affordances when a mutation cannot be queued (e.g., metadata cache missing, offline storage quota exceeded).

**Files:**
- `src/services/inventoryService.ts`
- `src/components/TransactionItemForm.tsx` (for error surfacing if dependencies are missing)

### Phase 3: Operation queue, schema, and conflict hygiene

**Goals:** Teach the queue how to replay transaction/project operations and keep IndexedDB in sync once the server accepts the changes.

**Tasks:**
1. Extend operation typings.
   - Add dedicated interfaces for transaction/project operations (`CreateTransactionOperation`, etc.) so payloads include the fields the executors need.
   - Update `operationQueue.inferAccountId` and related helpers to recognize the new operation shapes (string constants already exist; this is about payloads).
2. Implement queue executors.
   - `executeCreateTransaction/UpdateTransaction/DeleteTransaction` and the project equivalents must load the *full* record from IndexedDB, perform the Supabase mutation, cache the server response, and clear conflicts.
   - When a transaction create succeeds, replay any queued child item operations that relied on the optimistic transaction ID.
3. Expand conflict tracking beyond items.
   - Introduce an `entityType` discriminator (item | transaction | project) in `DBConflict`.
   - Add detectors for transactions/projects (field comparison rules, timestamp/version heuristics) and wire them into the queue + UI.
   - Define conflict dimensions per entity (transactions: `amount`, `allocatedAmount`, `taxPresetId`, `itemIds`, `status`; projects: `budget`, `status`, `settings`, `allocationMode`) and mark each conflicting field so `ConflictResolutionView` can highlight the exact deltas.
   - Emit `conflict:resolved` once `operationQueue` clears conflicts so banners disappear automatically after sync.
4. Validate IndexedDB schema/indexes for the new stores or add a migration (e.g., indexes on `transactions.projectId`, `projects.accountId`, `conflicts.entityType`).

**Conflict detector spec:**
```typescript
// src/services/conflictDetector.ts
export function detectTransactionConflict(local: Transaction, remote: Transaction): TransactionConflict | null {
  const conflictingFields = diffFields(local, remote, [
    'amount',
    'allocatedAmount',
    'taxPresetId',
    'itemIds',
    'status',
    'notes',
  ])
  if (!conflictingFields.length) return null
  return {
    entityType: 'transaction',
    entityId: local.id,
    fields: conflictingFields,
    lastResolvedAt: null,
  }
}
```
- Integrate the new detectors inside `operationQueue.handleConflict` and pipe their output into `ConflictResolutionView` plus `TransactionAudit`.
- Add Vitest coverage comparing synthetic local/remote payloads for both entities to guarantee we do not regress the heuristics later.

**Files:**
- `src/types/operations.ts`
- `src/services/operationQueue.ts`
- `src/services/offlineStore.ts`
- `src/services/conflictDetector.ts` (or new detectors)

### Phase 4: Read surfaces & React Query hydration

**Goals:** Ensure the UI can render optimistic entities immediately and remain consistent while offline.

**Tasks:**
1. Add hydration helpers.
   - `hydrateTransactionCache`, `hydrateProjectCache`, `hydrateOptimisticTransaction`, `hydrateOptimisticProject`.
   - Mirror the existing item helpers (cache priming + optimistic record seeding).
2. Update detail / edit / list pages.
   - Transaction detail/edit, project detail/edit, and summaries should check React Query cache first, then `offlineStore`, and only hit Supabase when online.
   - Inject hydration calls in route-level loaders or `useEffect` hooks similar to `ItemDetail`.
3. Update `transactionService.getTransactionById`, `projectService.getProject`, and any list queries (`getTransactions`, `getProjects`) to follow the cache-first order and cache results after network fetches.
4. Ensure offline mutations update the relevant caches immediately so the UI never shows “entity not found” for optimistic records.

**Files:**
- `src/utils/hydrationHelpers.ts`
- `src/pages/**/*Transaction*.tsx`, `src/pages/**/*Project*.tsx`
- `src/services/inventoryService.ts`

### Phase 5: UI resilience, diagnostics, and testing

**Goals:** Validate the end-to-end flow and give users actionable feedback while offline.

**Tasks:**
1. Offline UX and diagnostics.
   - Keep `NetworkStatus` scoped to connectivity only; surface prerequisite problems directly inside the forms via inline banners and disable states.
   - Teach `RetrySyncButton` to trigger metadata rehydration when online and log outcomes to the console/telemetry so support can trace issues without exposing extra UI chrome.
   - Add structured logging/analytics for queue outcomes so regressions are observable.
2. Integration / regression testing.
   - Add Vitest/Playwright coverage for: offline transaction create/edit/delete (with and without cached metadata), project CRUD offline, queued child item creation, sync replay, conflict resolution, and cache hydration (detail screens rendering optimistic records).
   - Include negative tests for validation failures (e.g., stale tax preset) to confirm typed errors reach the UI.
3. Manual QA checklist: simulate airplane mode, IndexedDB quota exhaustion, and multi-device conflict scenarios before shipping.

**Files:**
- `src/components/NetworkStatus.tsx`, `src/components/ui/RetrySyncButton.tsx`
- `src/services/__tests__/`
- End-to-end test harnesses / docs

## High-risk work: detailed exit criteria

### Offline metadata UX
- **Deliverables:** `useOfflinePrerequisites` hook, inline banners/disabled states in `TransactionItemForm`, `ProjectForm`, `BudgetCategoriesManager`, “Retry sync” action that rehydrates metadata, and supporting telemetry events.
- **Entry criteria:** IndexedDB caches for categories/presets implemented (Phase 0 Task 1) and background hydrators wired.
- **Exit tests:** Go offline with warm caches → forms submit normally; manually clear caches while offline → red inline banner + disabled submit; go back online, hit “Retry sync” → banner disappears without refresh.
- **Owner handoff:** Provide copy deck for inline messaging plus QA checklist covering warm → blocked → recovered flows.

### Conflict detector generalization
- **Deliverables:** Entity-aware `DBConflict` schema, detector functions with per-field diffing, queue integration, `ConflictResolutionView` updates, and Vitest coverage.
- **Entry criteria:** Transaction/project offline services emit conflicts with `entityType`.
- **Exit tests:** Simulate remote edits while offline, ensure queue logs conflict payload, banner surfaces with per-field highlights, resolving clears IndexedDB + UI state.
- **Owner handoff:** Document diff heuristics + rationale inside `conflictDetector.ts` comments to guide future entity additions.

## Implementation Checklist

### Metadata & prerequisites
- [x] Persist budget categories and tax presets to IndexedDB + expose cached lookups (`offlineStore` migrations 6/8 + `offlineMetadataService.cacheBudgetCategoriesOffline/cacheTaxPresetsOffline` now back all reads).
- [x] Add background hydration / manual refresh UI for the metadata caches (`budgetCategoriesService`, `taxPresetsService`, and `hydrateMetadataCaches` behind `RetrySyncButton`).
- [x] Block offline mutations (with actionable messaging) when validation data is missing (`useOfflinePrerequisites` + `OfflinePrerequisiteBanner` gate `TransactionItemForm`, `ProjectForm`, and `BudgetCategoriesManager` submit states).

### Transactions ✅ **COMPLETE**
- [x] Create `offlineTransactionService.ts` with optimistic ID generation, dependency validation, and rollback.
- [x] Ensure offline transaction creates also queue their child items via `offlineItemService`.
- [x] Update `transactionService.create/update/delete` to hydrate caches, gate on network state, delegate to offline services, and fall back gracefully on Supabase errors.
- [x] Implement queue executors for transaction operations and replay previously queued child-item operations once a transaction syncs.
- [x] Extend React Query hydration helpers and detail/edit views for transactions.

### Projects ✅ **COMPLETE**
- [x] Create `offlineProjectService.ts` with parity to the item/transaction services (now persists budget categories, metadata, counts, totals).
- [x] Update `projectService.create/update/delete` to follow the offline-first branching and metadata validation rules.
- [x] Implement queue executors for project operations (create/update/delete replay full records and clear conflicts).
- [x] Add React Query hydration helpers and project detail/edit cache checks.

### Operation queue & conflicts
- [x] Define typed payloads for transaction/project operations in `src/types/operations.ts` (project updates now include metadata/default category info).
- [x] Update `operationQueue` to support the new payloads, executors, and `inferAccountId` rules (delete executors now purge offline cache + conflicts).
- [x] Introduce an `entityType`-aware conflict model plus detectors for transactions/projects, and clear those conflicts after successful syncs.
- [x] Verify / migrate IndexedDB stores and indexes required for the new entities (migrations 6-9 in `offlineStore` add the stores, indexes, and vendor-defaults cache so replay + conflict hygiene stay fast).

### Read surfaces & UI hydration ✅ **COMPLETE**
- [x] Add `hydrateTransactionCache`, `hydrateProjectCache`, `hydrateOptimisticTransaction`, and `hydrateOptimisticProject`.
- [x] Update transaction/project list + detail pages to follow the cache → offlineStore → network order.
- [x] Make offline mutations update React Query caches immediately so optimistic records stay visible.

**Files Modified:**
- `src/utils/hydrationHelpers.ts` - Added `hydrateTransactionCache`, `hydrateProjectCache`, `hydrateOptimisticTransaction`, `hydrateOptimisticProject`, `hydrateProjectsListCache`, `hydrateProjectTransactionsCache`
- `src/pages/EditTransaction.tsx` - Added cache-first hydration before loading transaction
- `src/pages/TransactionDetail.tsx` - Already had hydration (verified)
- `src/pages/EditBusinessInventoryTransaction.tsx` - Added cache-first hydration
- `src/pages/ProjectLayout.tsx` - Added project cache hydration
- `src/pages/Projects.tsx` - Added projects list cache hydration
- `src/pages/TransactionsList.tsx` - Added project transactions cache hydration

### Testing & diagnostics
- [x] Expand offline UX (banners, retry buttons, telemetry) to mention transaction/project queue state and missing prerequisites (`OfflinePrerequisiteBanner`, `RetrySyncButton`, and queue health logs now surface the state across forms).
- [ ] Add automated tests for offline transaction/project CRUD, queued item creation, sync replay, and hydration flows.
- [ ] Run manual QA for airplane mode, IndexedDB quota exhaustion, and multi-device conflicts prior to release.

### Testing
- [ ] Test transaction creation offline
- [ ] Test transaction editing offline
- [ ] Test transaction deletion offline (verify IndexedDB + conflicts purge immediately)
- [ ] Test project creation offline (full metadata/budget replication)
- [ ] Test project editing offline (budget categories + counts stay in sync)
- [ ] Test project deletion offline (verify IndexedDB + conflicts purge immediately)
- [ ] Test sync when coming back online
- [ ] Test conflict resolution for transactions/projects
- [ ] Test React Query cache hydration
- [ ] Test "not found" scenarios for optimistic entities

## Outstanding gaps (unaddressed)

- [x] **Offline transaction edits overwritten on reconnect.** `operationQueue.getEntityIdsWithPendingWrites` now exposes the set of transaction IDs with queued `UPDATE`/`DELETE` work, and `cacheTransactionsOffline` skips writing those records back into IndexedDB when a network fetch completes. Result: the optimistic transaction stays intact until the queue replays and clears the pending operation.
- [x] **Offline item edits overwritten on reconnect.** The same guard rails above now apply to items (and projects for parity): `cacheItemsOffline` consults the pending-write set before persisting Supabase payloads, so IndexedDB never overwrites an item that still has a queued update/delete. Queue executors continue to hydrate from the preserved offline copy, preventing stale server data from clobbering offline edits.

- [x] Re-check every offline CRUD path (items, transactions, projects, lineage) for missing network gating so offline screens don't keep pinging Supabase when connectivity is gone. `AddTransaction` gating now mirrors the item/project forms and `CategorySelect` forces cache-only reads when offline so we no longer hit `account_presets` / `budget_categories` in airplane mode.
- [x] Bridge offline mutations into our realtime snapshots. `ProjectRealtimeProvider` hydrates from IndexedDB when offline, registers `refreshFromIndexedDB` with the offline queue, and calls `unifiedItemsService.syncProjectItemsRealtimeCache` so optimistic writes appear in `ProjectLayout`/`InventoryList` without waiting for Supabase.

### Vendor defaults: caching implemented (status: done, follow-ups)
- Status: implemented. Vendor defaults are now cached in IndexedDB and will be used offline when available; cache hydrations happen once per successful online fetch/update (no endless loops).
- What changed:
  - Added `vendorDefaults` store + migration (db version bump) and methods: `saveVendorDefaults`, `getVendorDefaults`, `clearVendorDefaults` in `src/services/offlineStore.ts`.
  - Added caching helpers `cacheVendorDefaultsOffline(accountId, slots?)` and `getCachedVendorDefaults(accountId)` in `src/services/offlineMetadataService.ts`.
  - `vendorDefaultsService.getVendorDefaults` now:
    - Short‑circuits to the cache when offline.
    - Hydrates the cache (passing already-fetched slots) after successful network fetchs/updates to avoid recursive cache calls.
    - Falls back to `TRANSACTION_SOURCES` when no canonical data exists.
  - `useOfflinePrerequisites` now includes `vendorDefaults` in its warmth checks so the prerequisite banner and Retry button cover vendor defaults as well.
  - Retry/hydration flow: `RetrySyncButton` → `hydrateMetadataCaches` will populate vendor defaults along with tax presets and categories.
- Files touched (non-exhaustive): 
  - `src/services/offlineStore.ts` (migration + vendor defaults CRUD)
  - `src/services/offlineMetadataService.ts` (cacheVendorDefaultsOffline, getCachedVendorDefaults, included in hydrateMetadataCaches)
  - `src/services/vendorDefaultsService.ts` (cache-aware reads + cache hydration)
  - `src/hooks/useOfflinePrerequisites.ts` (vendorDefaults warmth + UI gating)
  - `src/components/ui/RetrySyncButton.tsx` (unchanged API; it uses hydrateNow)
- Follow-ups / tests:
  - Add Vitest tests ensuring `getVendorDefaults` does not call Supabase when `isNetworkOnline() === false`.
  - Add tests for `offlineStore` vendor defaults CRUD and `cacheVendorDefaultsOffline`.

### Transaction combobox uncontrolled → controlled: fixed (status: done)
- Status: implemented. The combobox no longer flips between uncontrolled/controlled during hydration.
- What changed:
  - Hydration helper `hydrateProjectTransactionsCache` now reads the project-specific transactions from IndexedDB and primes React Query before components mount (`src/utils/hydrationHelpers.ts`).
  - `EditItem` (and AddItem) hydrate the project-transactions cache on mount, then fetch network data; they also read primed React Query data to avoid empty-state flashes.
  - Combobox control fixes:
    - `EditItem` now guards the combobox `value`: if the selected transaction ID is not yet present in the loaded options, it passes `''` (empty) to avoid undefined.
    - `src/components/ui/Combobox.tsx` now resolves the selected option to `null` if not found (prevents Headless UI receiving undefined).
  - Added `getCachedProjectTransactions` helper for direct offline reads (used during hydration).
- Files touched (non-exhaustive):
  - `src/pages/EditItem.tsx` (hydrate before fetch, guard value)
  - `src/utils/hydrationHelpers.ts` (hydrateProjectTransactionsCache, getCachedProjectTransactions)
  - `src/components/ui/Combobox.tsx` (selectedOption null guard)
  - `src/services/inventoryService.ts` (transaction offline helpers already present; hydration now used)
- Follow-ups / tests:
  - Unit-test the combobox guard and add an integration test simulating: online warm cache, offline warm cache, offline cold cache (ensure UI gating + banner).

Notes
- I updated the docs to reflect what was implemented and the follow-ups that would be good to add as tests. If you'd like, I can:
  - Add the Vitest tests now (I left them as follow-ups to keep the change focused), or
  - Reword the doc further (shorter or more verbose) and add links to specific diffs/PRs.

## Key Principles

1. **Optimistic First:** Always generate IDs and persist data before queueing operations
2. **Cache-First Reads:** Check React Query cache → offlineStore → Supabase (when online)
3. **Full-Record Sync:** Queue executors load complete entities from IndexedDB, not just operation payloads
4. **Network Gating:** Check `isNetworkOnline()` early, delegate to offline services immediately
5. **Graceful Fallback:** All network operations fall back to offline queue on failure
6. **Conflict Hygiene:** Clear conflicts after successful syncs
7. **Rollback on Failure:** Remove optimistic data if queueing fails

## Success Criteria

- All CRUD operations (create, read, update, delete) work offline for items, transactions, and projects
- Optimistic entities are immediately accessible via React Query cache and offlineStore
- No "entity not found" errors for optimistic entities
- Sync queue processes all operations when connectivity returns
- Conflict resolution works for all entity types
- UI provides immediate feedback for all offline operations
- No orphaned data in IndexedDB (rollback on queue failure)

## Notes

- This normalization follows the exact patterns already established for items
- The code analysis revealed these patterns are consistent and well-tested
- No new architectural patterns are needed - just application of existing patterns
- Priority: Transactions (higher user impact) → Projects (lower frequency)
