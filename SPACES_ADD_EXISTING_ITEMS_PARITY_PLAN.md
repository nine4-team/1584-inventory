### Spaces “Add Existing Items” Parity Plan (Transactions last)

### Summary
Spaces currently can only add items that already live in the same project (by setting `spaceId`). Transactions can add items from **other projects** and **business inventory** via “outside items” search. This plan brings **Spaces** up to parity first, including the correct **allocation/deallocation** side-effects when “pulling in” items from other projects / business inventory, while **deferring any changes to the existing Transactions flow until the final phase**.

### Goals (what “parity” means)
- **Data parity**: Spaces can add items from:
  - the current project
  - other projects (account-wide)
  - business inventory (account-wide)
- **Behavior parity**: When adding items from:
  - **business inventory → project**: run canonical **allocation** flow
  - **other project → this project**: run canonical **deallocation + allocation** flow
- **UI parity**: Spaces “Add Existing Items” UI matches Transactions’ picker UI (search, tabs, grouped duplicates, select-all, sticky “Add selected”).
- **Shared code**: Prefer shared components so fixes and UX improvements benefit both contexts.
- **Non-goal (for now)**: Do **not** change how Transactions currently “pulls in” items until the final phase.

### Current state (baseline)
### Transactions
- Picker: `src/components/transactions/TransactionItemPicker.tsx`
- Data:
  - project items: `unifiedItemsService.getItemsByProject(...)`
  - outside items (other projects + optional business inventory): `unifiedItemsService.searchItemsOutsideProject(...)`
- Add behavior today:
  - “rehomes” item to project via `unifiedItemsService.updateItem({ projectId })` when needed
  - assigns to transaction via `unifiedItemsService.assignItem(s)ToTransaction(...)`

### Spaces
- Picker: `src/components/spaces/SpaceItemPicker.tsx`
- Data:
  - only project items: `unifiedItemsService.getItemsByProject(...)`
- Add behavior today:
  - sets `spaceId` via `unifiedItemsService.updateItem({ spaceId })`

### Allocation/deallocation primitives to use
- Business inventory → project allocation:
  - `integrationService.allocateBusinessInventoryToProject(accountId, itemId, projectId, amount?, notes?)`
  - implemented via `unifiedItemsService.allocateItemToProject(...)` (canonical allocation logic)
- Project A → project B move with accounting:
  - `integrationService.sellItemToProject(accountId, itemId, sourceProjectId, targetProjectId, { amount?, notes?, space? })`
  - runs deallocation + allocation via canonical transaction logic

---

### Phase 0 — Prep and guardrails (no behavior changes)
### Deliverables
- A shared, reusable “existing items picker” UI component extracted from Transaction picker.
- A shared modal shell component (optional but recommended) so Spaces and Transactions can share UI chrome.
- No changes to Transactions usage yet.

### Steps
- **0.1 Create a shared picker UI component**
  - **New file**: `src/components/items/ExistingItemsPicker.tsx`
  - Start by copying structure from `src/components/transactions/TransactionItemPicker.tsx`, then generalize:
    - Support a `mode: 'space' | 'transaction'` prop.
    - Support tabs:
      - transaction mode: `suggested | project | outside` (feature-flagged by props)
      - space mode: `project | outside` (no suggested)
    - Keep grouped duplicates (`CollapsedDuplicateGroup` + `getInventoryListGroupKey`)
    - Keep selection model + “Add selected” sticky bar
  - **Important**: In Phase 0, the picker should expose an `onAddItems(items: Item[])` callback so the parent can decide what “Add” means.

- **0.2 (Optional but ideal) Create shared modal shell**
  - **New file**: `src/components/items/AddExistingItemsModal.tsx`
  - Encapsulate the common modal markup used by:
    - `src/pages/SpaceDetail.tsx` (current)
    - `src/pages/TransactionDetail.tsx` (current)
  - This keeps UI parity simple and reduces duplication.

- **0.3 Keep existing Transaction picker untouched**
  - Do not change `TransactionDetail.tsx` yet.
  - Do not change Transaction picker behavior yet.

### Acceptance checks
- Shared picker renders correctly in Storybook/dev (if available) or manual page mount.
- No TypeScript errors.
- No changes to runtime behavior anywhere yet.

---

### Phase 1 — Spaces UI parity (still project-only behavior)
### Deliverables
- Spaces “Add Existing Items” modal uses the shared picker UI with the same layout/interaction patterns as Transactions.
- Still only adds from the current project (no outside pull-in yet).

### Steps
- **1.1 Wire shared modal + picker into Spaces**
  - **Edit**: `src/pages/SpaceDetail.tsx`
  - Replace the existing modal’s internals to render:
    - `AddExistingItemsModal` (if created in Phase 0)
    - `ExistingItemsPicker` in `mode="space"`
  - In this phase, configure the picker to only show the `project` tab:
    - It should call `unifiedItemsService.getItemsByProject(...)`
    - It should *not* show outside items yet
  - Implement `onAddItems` for Spaces as the current behavior:
    - `await unifiedItemsService.updateItem(accountId, itemId, { spaceId })` for each selected item

- **1.2 Keep `SpaceItemPicker.tsx` temporarily**
  - Either:
    - keep it as-is during Phase 1, or
    - convert it into a thin wrapper around the new shared picker
  - (Recommendation: wrapper to reduce churn in `SpaceDetail.tsx` while iterating.)

### Acceptance checks
- Space “Add Existing Items” looks/feels like Transaction picker:
  - search input
  - grouped duplicates
  - select all + sticky “Add selected”
- Adding items from the same project still works.

---

### Phase 2 — Spaces data parity: add “Outside” tab (other projects + business inventory)
### Deliverables
- Spaces picker can search “Outside” items:
  - other projects
  - business inventory
- Still **no allocation/deallocation** yet (that is Phase 3).

### Steps
- **2.1 Enable outside search in `ExistingItemsPicker` (space mode)**
  - Use: `unifiedItemsService.searchItemsOutsideProject(accountId, { excludeProjectId: targetProjectId, includeBusinessInventory: true, searchQuery })`
  - Render results in an `outside` tab identical to Transactions:
    - maintain duplicate grouping with the correct context for grouping:
      - treat `item.projectId == null` as “business inventory”
      - otherwise “project”

- **2.2 Add “already in this space” exclusion**
  - In `SpaceDetail.tsx`, pass `excludedItemIds={new Set(associatedItems.map(i => i.itemId))}` to hide items already assigned to this space.

- **2.3 Add selection guardrails for space mode**
  - For “outside” items, if `item.transactionId` is set:
    - disable selection/add controls
    - show a small reason text: “This item is tied to a transaction; move the transaction instead.”
  - Rationale: Space “pull-in” should not implicitly rewire transaction-linked items.

### Acceptance checks
- Spaces picker can find items outside the project (including business inventory).
- Users can select outside items (except transaction-linked items).
- Clicking “Add” still only sets `spaceId` (project movement is not yet correct; that’s Phase 3).

---

### Phase 3 — Spaces behavior parity: canonical project pull-in (allocation/deallocation)
### Deliverables
- When a user adds an item from outside the project into a space, the correct canonical flows run:
  - business inventory → project allocation
  - other project → this project (sell + allocate)
- After pull-in, the item ends up:
  - associated to the target project
  - assigned to the space (`spaceId`)

### Steps
- **3.1 Implement a single helper: “ensure item is in target project”**
  - **New helper** (recommended location): `src/services/itemPullInService.ts` (or `src/utils/itemPullIn.ts`)
  - Signature suggestion:
    - `ensureItemInProjectForSpace(accountId, item, targetProjectId, { spaceName? })`
  - Rules:
    - If `item.projectId === targetProjectId`: do nothing
    - If `item.projectId == null` (business inventory): call
      - `integrationService.allocateBusinessInventoryToProject(accountId, item.itemId, targetProjectId, undefined, note)`
    - If `item.projectId` is another project: call
      - `integrationService.sellItemToProject(accountId, item.itemId, item.projectId, targetProjectId, { notes: note, space: spaceName })`
  - Notes should be explicit for auditability:
    - Example: `Pulled into space "${spaceName}" in project ${targetProjectId}`

- **3.2 Update Spaces add flow to use the helper before setting `spaceId`**
  - In the `onAddItems` implementation used by Space mode:
    - For each selected item:
      - await `ensureItemInProjectForSpace(...)`
      - then `await unifiedItemsService.updateItem(accountId, itemId, { spaceId })`
  - Prefer batching where safe:
    - For performance, group items by source (BI vs project) and run `Promise.all` with a small concurrency cap if needed.

- **3.3 Handle failure modes cleanly**
  - If a pull-in fails for one item:
    - show a clear error message
    - continue or abort consistently (recommend: abort the whole “Add selected” operation to avoid partial surprise, unless you explicitly design for partial success).
  - If offline:
    - both canonical methods have queue behavior; confirm they behave well in this context.
    - if offline queueing is acceptable, show “Saved offline” messaging consistent with the rest of the app.

### Acceptance checks (must pass)
- Add from business inventory into a space:
  - item ends up in the project AND space
  - canonical `INV_PURCHASE_<projectId>` allocation behavior is created/updated as expected
- Add from another project into a space:
  - canonical sell + purchase logic runs (sale in source, purchase in target)
  - item ends up in target project AND space
- Transaction-linked items remain blocked in Space picker (unless you intentionally loosen this later).

---

### Phase 4 — Cleanup and consolidation (Spaces stable)
### Deliverables
- Remove redundant components and duplicated modal markup used only by Spaces.
- Keep Transactions untouched.

### Steps
- **4.1 Reduce duplication**
  - If `SpaceItemPicker.tsx` is now a wrapper and no longer needed, delete it and use `ExistingItemsPicker` directly.
  - Ensure `SpaceDetail.tsx` uses the shared modal component if it exists.

- **4.2 Tests (minimum coverage)**
  - Add unit tests for the new pull-in helper:
    - BI → project path calls `allocateBusinessInventoryToProject`
    - Project → project path calls `sellItemToProject`
    - Same-project path does nothing
  - Add component tests for space mode:
    - outside tab loads
    - transaction-linked items are disabled

---

### Phase 5 (LAST) — Transactions adoption (UI shared, behavior unchanged initially)
This is explicitly the last step per request.

### Deliverables
- Transactions uses the shared picker UI (same visual + interaction parity) **without changing the existing “rehoming + assign” behavior** yet.

### Steps
- **5.1 Swap Transaction modal to shared UI**
  - **Edit**: `src/pages/TransactionDetail.tsx`
  - Replace `TransactionItemPicker` usage with `ExistingItemsPicker mode="transaction"`
  - Keep the existing add behavior by wiring `onAddItems` to:
    - rehome via `unifiedItemsService.updateItem({ projectId })` (current behavior)
    - then assign via `unifiedItemsService.assignItem(s)ToTransaction(...)`
  - Preserve conflict confirmation UX (already in the transaction picker logic; port it as-is).

### Acceptance checks
- No behavior changes in Transactions (verify with a quick manual run):
  - still can add outside items
  - still reassigns transaction-linked items after confirmation
  - still updates transaction items list

---

### Phase 6 (Optional, after Phase 5) — Transactions behavior parity (canonical pull-in)
Only do this once the shared UI is stable and Spaces is proven.

### Deliverables
- Transactions “pull in” uses the same canonical allocation/deallocation logic as Spaces.

### Steps (high level)
- Replace “rehoming” (`updateItem({ projectId })`) with:
  - BI → project: `allocateBusinessInventoryToProject`
  - project A → project B: `sellItemToProject`
- Keep `assignItem(s)ToTransaction` step after pull-in.
- Carefully validate interactions with:
  - items already tied to other transactions (conflict confirm)
  - canonical transaction lineage pointers
  - offline queue behavior

---

### Notes / decisions to confirm in code review
- **Partial success vs all-or-nothing** for multi-select “Add selected” in Space mode.
- Whether Space pull-in should also set `space` string field (in addition to `spaceId`) for legacy UI compatibility.
- Whether transaction-linked items should remain blocked in Space outside tab permanently, or become a separate “advanced” flow later.

