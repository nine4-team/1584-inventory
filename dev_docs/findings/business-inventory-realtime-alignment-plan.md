# Business Inventory Realtime Alignment Plan

## Goal
Align business inventory realtime behavior with the project realtime model so UI updates are driven by a centralized snapshot provider (not per-page subscriptions), including offline/reconnect recovery and lineage refresh.

## Scope and Lifecycles
- Provider must be scoped by business/account context (similar to per-project scoping).
- On business/account change or sign-out, subscriptions must be torn down and snapshot reset.

## Primary Mechanism Comparison
### Projects (Current Baseline)
- Centralized `ProjectRealtimeProvider` maintains per-project snapshots.
- Provider owns realtime subscriptions for transactions and items and pushes updates into a shared snapshot.
- UI consumes `useProjectRealtime(...)`, not direct subscriptions, so any update to the snapshot re-renders all consumers.

### Business Inventory (Current)
- `BusinessInventory` page subscribes directly to business-inventory items and transactions and stores results in local component state.
- `BusinessInventoryItemDetail` also subscribes directly and updates local state.
- Refresh-on-reconnect and offline sync refresh are implemented in the page, not centrally.

## Differences That Matter
1. **Centralized snapshots vs per-page state**
   - Projects use a provider-level snapshot that all screens share.
   - Business inventory uses local state on each screen.
2. **Single subscription owner vs multiple subscriptions**
   - Projects: provider manages one set of subscriptions per project.
   - Business inventory: each page can create its own subscriptions.
3. **Refresh triggers location**
   - Projects: refresh hooks live in provider (offline, reconnect, sync-complete).
   - Business inventory: refresh hooks live only on `BusinessInventory`, not in a shared layer.

## Alignment Plan (Step-by-Step, Safe Path)
### Phase 1: Create a Business Inventory Realtime Provider
1. Add `BusinessInventoryRealtimeContext` modeled on `ProjectRealtimeContext`.
   - File: `src/contexts/BusinessInventoryRealtimeContext.tsx`.
   - Snapshot state should include:
     - `items`, `transactions`, `isLoading`, `error`, `telemetry`.
   - Snapshot must be scoped to the active business/account id.
2. Provider responsibilities:
   - Initialize snapshot from initial fetch.
   - Start and own subscriptions for:
     - `subscribeToBusinessInventoryItems`.
     - `subscribeToBusinessInventoryTransactions`.
   - Write subscription updates into the shared snapshot.
   - Ensure subscription teardown and snapshot reset on business/account change.
3. Provide hook API:
   - `useBusinessInventoryRealtime()`, returns snapshot and refresh helpers.

### Phase 2: Move Refresh Logic Into the Provider
1. Centralize refresh helpers:
   - `refreshCollections()` should refetch items + transactions.
   - Enforce the same query filters in refresh as in subscriptions.
   - Apply a simple race guard so refresh results do not overwrite newer realtime updates.
2. Register `registerBusinessInventoryRefreshCallback` in the provider:
   - Offline services call the callback to refresh the snapshot.
3. Move reconnect and sync-complete refresh into the provider:
   - `subscribeToNetworkStatus` (offline -> online).
   - `onSyncEvent('complete')` when pending ops = 0.

### Phase 3: Migrate Screens to the Provider
1. `BusinessInventory`:
   - Remove local subscriptions.
   - Read `items`/`transactions` from `useBusinessInventoryRealtime`.
   - Replace local `refreshBusinessInventoryCollections` with provider `refreshCollections`.
2. `BusinessInventoryItemDetail`:
   - Remove local subscription.
   - Use `useBusinessInventoryRealtime` to locate the current item in snapshot.
   - If the snapshot is still loading, show a loading state.
   - If the item is missing after load, show "Item not found" view.

### Phase 4: Post-Write Safety Refresh
1. After business-inventory writes (create/edit/delete/allocate/disposition changes):
   - Call `refreshCollections()` as a safety net.
2. Guardrails:
   - Debounce or gate refresh if realtime is healthy to avoid excessive calls.
   - Avoid refresh loops from offline callback + realtime events.

## Acceptance Criteria
- Business inventory list and detail update immediately for create, update, delete.
- Allocating to a project removes from business inventory without reload.
- Transactions list never includes unrelated project transactions after realtime updates.
- Reconnect and offline sync completion always refresh the snapshot.
- Offline service writes trigger a provider refresh (no stale list after background sync).
- Provider tears down subscriptions and resets snapshot on business/account change.
- Refresh results never overwrite newer realtime changes.

## Implementation Checklist (Do Not Skip)
- [ ] Add `BusinessInventoryRealtimeContext` + provider wrapper in `src/App.tsx`.
- [ ] Subscribe in provider to business-inventory items + transactions.
- [ ] Implement `refreshCollections()` in provider and wire `registerBusinessInventoryRefreshCallback`.
- [ ] Move reconnect + sync-complete refresh logic into provider.
- [ ] Update `BusinessInventory` to consume the provider, remove subscriptions.
- [ ] Update `BusinessInventoryItemDetail` to consume the provider.
- [ ] Add post-write refresh calls in business-inventory flows.
- [ ] Verify list, detail, and transactions update on realtime changes.
- [ ] Verify subscription teardown on business/account change and sign-out.
- [ ] Verify filters for items/transactions are consistent between refresh/subscriptions.
- [ ] Add manual QA checklist for reconnect + sync-complete behavior.
