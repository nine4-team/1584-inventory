---
name: transaction_item_tabs_pull_v2
overview: "Pro-grade transaction item picker inside the Transaction Items section: universal search across Suggested/Project/Outside scopes, grouped results, multi-select, and safe reassignment confirmation. Reuse existing primitives (`updateItem`, `assignItem(s)ToTransaction`) and add only one small search service for cross-scope queries."
todos:
  - id: txn-items-picker-ui
    content: Build the universal-search item picker inside the Transaction Items section in `TransactionDetail` (subsumes existing suggested items UI).
    status: completed
  - id: grouped-selection
    content: Implement grouped rendering + selection (via `CollapsedDuplicateGroup`) including “Add group” and “Add selected”.
    status: completed
  - id: transaction-link-indicator
    content: Ensure Project/Outside lists reuse `ItemPreviewCard`’s transaction link micro-UI to indicate items already associated with a transaction.
    status: completed
  - id: outside-search
    content: Add an Outside search panel/modal that shares the universal search query and supports grouped results + selection.
    status: completed
  - id: service-cross-scope-search
    content: Add a single, focused `unifiedItemsService.searchItemsOutsideProject` method (online query + offline fallback).
    status: completed
  - id: reassignment-confirmation
    content: Add mixed-mode reassignment confirmation (list first N conflicting items + counts) and require confirm before proceeding.
    status: completed
  - id: rename-add-to-create
    content: Rename the Transaction Items section button from “Add Item” to “Create item” (still creates a new item).
    status: completed
  - id: tests
    content: Update/add tests for universal search routing, grouping/selection, and reassignment confirmation gating.
    status: completed
---

## What’s changing vs the previous plan

- **Move the feature to where it belongs**: the picker lives in the **Transaction Items** section (not in `TransactionAudit`).
- **Universal search**: one search input drives Suggested/Project/Outside; results can auto-switch tabs.
- **Grouped + bulk add**: group items (existing grouping logic), select individuals or whole groups, and add in bulk.
- **Reliable reassignment**: if any selected item is already linked to a different transaction, require a confirmation dialog listing conflicts.
- **Copy tweak**: rename the Transaction Items section button from “Add Item” → **Create item** (create-new item, not associate-existing).

## UX / UI design

### Layout (inside the **Transaction Items** section)

- Host this UI inside [`/Users/benjaminmackenzie/Dev/ledger/src/pages/TransactionDetail.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/TransactionDetail.tsx) under the “Transaction Items” header.
- Keep `TransactionAudit` focused on metrics; remove/suppress its “Suggested items” block.
- Provide a compact picker UI:
- **Universal search** input
- Tabs:
  - **Suggested** (vendor-based suggestions)
  - **Project** (all items in the transaction’s current project)
  - **Outside** (other projects + business inventory; shown via a modal/panel)
- Tab headers show **result counts** for the current search.
- Bulk action row: **Add selected**.

### Universal search behavior

- The search query is shared state across all tabs.
- Each tab applies the same query:
- Suggested: client-side filter of the already-fetched suggested list.
- Project: query via `unifiedItemsService.getItemsByProject(..., { searchQuery })`.
- Outside: query via `unifiedItemsService.searchItemsOutsideProject(...)`.
- If active tab’s filtered results are empty and another tab has results, auto-switch:
- Prefer Suggested → Project → Outside (configurable), using “first tab with results”.

### Rows and CTAs

- **CTA label rules**:
- If item is already associated to the *current* transaction: show **Added** (disabled).
- If item is in-scope (already in the transaction’s project, or business-inventory transaction with item already `projectId=null`): show **Add** (associate only).
- If item is out-of-scope (different project or business inventory): show **Pull** (non-canonical re-home + associate).

### Transaction-linked indicator (Project tab)

- Reuse `ItemPreviewCard`’s built-in transaction link micro-UI (Receipt icon + title/amount) which appears when `item.transactionId` is set.
- Source: [`/Users/benjaminmackenzie/Dev/ledger/src/components/items/ItemPreviewCard.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/components/items/ItemPreviewCard.tsx)

### Grouped display + group actions

- Group items in All items + Outside project lists using:
- `getInventoryListGroupKey(item, 'project')` for All items
- `getInventoryListGroupKey(item, 'businessInventory')` for business inventory results (outside search)
- For other-project results (outside search), still group with `'project'`.
- Source: [`/Users/benjaminmackenzie/Dev/ledger/src/utils/itemGrouping.ts`](/Users/benjaminmackenzie/Dev/ledger/src/utils/itemGrouping.ts)
- Render groups using `CollapsedDuplicateGroup` (supports indeterminate checkbox + group checkbox).
- Source: [`/Users/benjaminmackenzie/Dev/ledger/src/components/ui/CollapsedDuplicateGroup.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/components/ui/CollapsedDuplicateGroup.tsx)
- Group header includes:
- Group checkbox (select all items in group)
- “×N View all” affordance (existing)
- A group-level action: **Add group** (adds all items in that group, subject to confirmation rules)

## Core behavior: “Add/Pull to this transaction”

### Confirmation rule

- If any item to be added has `item.transactionId` set and it’s **not** the current transaction, show a confirmation dialog listing the conflicting items:
- Show first ~10 with description/SKU + current transaction label (if available).
- Show counts: “and X more”.
- If confirmed, proceed; if canceled, do nothing.

### Movement/association model (per your decision)

- **Non-canonical re-home** when needed:
- If the destination transaction is in Project A and item is in Project B: update `item.projectId = ProjectA`.
- If the destination transaction is business inventory (`projectId=null`): update `item.projectId = null`.
- Then associate/reassign:
- Use `unifiedItemsService.assignItemToTransaction(...)` / `assignItemsToTransaction(...)` (already used elsewhere and handles lineage when `itemPreviousTransactionId` is provided).

## Service-layer changes

### 1) Outside-project search (single new service method)

Add `unifiedItemsService.searchItemsOutsideProject(accountId, { excludeProjectId, includeBusinessInventory, searchQuery, pagination })`:

- Online: Supabase query on `items` scoped to `account_id`, with `or(...)` matching `description/source/sku/...` and excluding `project_id = excludeProjectId`.
- Offline fallback: use `offlineStore.getAllItems()` and apply similar filters.

### 2) No new “pull items into transaction” service API (intentional)

- The “Add/Pull” operation will be a small **UI-level orchestrator** composed from existing primitives:
- `unifiedItemsService.updateItem` (re-home `projectId` when needed)
- `unifiedItemsService.assignItemToTransaction` / `assignItemsToTransaction` (associate + lineage)
- This keeps confirmation + selection logic co-located with the UI and reduces long-term surface area.

## Frontend implementation steps

### 1) Implement picker inside Transaction Items section

- Host inside `TransactionDetail` “Transaction Items” section.
- Add a focused component (proposal): [`/Users/benjaminmackenzie/Dev/ledger/src/components/transactions/TransactionItemPicker.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/components/transactions/TransactionItemPicker.tsx)
- Owns shared picker state:
  - `searchQuery` (universal)
  - `activeTab`
  - `selectedItemIds`
  - conflict dialog state
- Tabs:
  - Suggested: `transactionService.getSuggestedItemsForTransaction(accountId, transaction.source, limit)` + client filter
  - Project: `unifiedItemsService.getItemsByProject(accountId, projectId, { searchQuery })`
- Add/Pull orchestrator (UI-level):
  - Hydrate selected items for conflict detection (`getItemById` if needed)
  - If conflicts exist, show confirmation dialog and only proceed if confirmed
  - Re-home (only when needed): `updateItem({ projectId: targetProjectId })`
  - Associate/reassign:
  - For correctness, do not assume a single shared previous transaction
  - Batch only when items share the same `previousTransactionId`; otherwise call `assignItemToTransaction` per item

### 2) New modal: outside project search

New file proposal: [`/Users/benjaminmackenzie/Dev/ledger/src/components/ui/TransactionItemOutsideSearch.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/components/ui/TransactionItemOutsideSearch.tsx)

- Shares the same `searchQuery` value (universal search) and uses the new `searchItemsOutsideProject`.
- Supports grouped rendering + selection + “Add selected”.

### 3) Confirmation dialog

- Reuse existing confirm patterns (e.g. `BlockingConfirmDialog`) for:
- “These items are already linked to another transaction. Reassign anyway?”
- List conflicting items.

### 4) Rename “Add Item” to “Create item”

- In the Transaction Items section, rename the create-new button label to **Create item**.
- Keep meaning consistent:
- **Create item** opens `TransactionItemForm` (create a new item).
- **Add/Pull** (in picker) associates existing items.

## Notes / constraints

- We’ll avoid creating INV_* canonical transactions for these pulls; this is a “re-home + associate” workflow.
- We will not rely on `unifiedItemsService.addItemToTransaction(...)` for this feature; instead use `assignItem(s)ToTransaction` to keep lineage and transaction pointer behavior consistent.

## Testing

- Prefer tests close to the new picker component.
- Update/add tests to cover:
- universal search routing between tabs
- grouping + group selection correctness
- reassignment warning dialog gates execution
- Add vs Pull labeling and disabled Added state