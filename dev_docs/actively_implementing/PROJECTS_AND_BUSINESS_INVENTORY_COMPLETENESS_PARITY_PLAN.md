# Projects + Business Inventory Completeness Parity Plan

## Goal

Get **functional parity** between **Projects** and **Business Inventory** for **transaction completeness tracking**, without breaking existing flows.

“Parity” here means:

- The same **canonical completeness calculation** is used everywhere.
- The same persisted flag (`transactions.needs_review`) is maintained reliably for **both** contexts.
- The same UI “completeness tracker” can render in both contexts via **shared components** (no drift).

## Current state (what’s true in the codebase today)

- Canonical completeness computation lives in `transactionService.getTransactionCompleteness(...)` (`src/services/inventoryService.ts`).
- The persisted list-friendly flag is `transactions.needs_review` (added in `supabase/migrations/20251110_add_needs_review_flag.sql`).
- `TransactionDetail` renders the “Transaction Audit” panel (completeness tracker) **only if it can resolve a non-null project id**.
  - Business Inventory transactions have `project_id = null`, so the audit panel is effectively missing there.
- Business Inventory “Completeness” filtering is currently a thin filter on `Transaction.needsReview` (which is good), but correctness depends on the recompute pipeline being triggered.

## Key invariant we must align with (from Returned/Sold migration plan)

From `dev_docs/actively_implementing/RETURNED_AND_SOLD_MIGRATION_PLAN.md`:

- **Truth** for current association: `items.transaction_id`
- **Cache** (current-only mirror): `transactions.item_ids` must not contain ghosts
- “Ever-associated / moved-out” is a **lineage** concern (`item_lineage_edges`), not `transactions.item_ids`

Implication:

- Completeness should **not depend on `transactions.item_ids` to find items**, because that cache is (and should remain) current-only.
- If completeness wants to remain stable when items are moved/sold/returned, it must source “ever-associated” items via **lineage**, and explicitly exclude “corrections”.

## What we are fixing

### A) Projects completeness: correctness + “no ghosts”

We need to ensure the canonical completeness computation uses a stable, invariant-aligned item set and never counts ghost items.

### B) Business Inventory completeness: functional parity

We need the same computation + persisted `needs_review` flag + UI tracker in Business Inventory transaction detail and lists.

### C) Shared implementation to prevent drift

We need to remove “project-only” assumptions from the completeness UI and service layer so both contexts use the same code paths.

---

## Plan overview (safe rollout)

### Phase 0 — Safety rails (shadow mode + metrics)

- [ ] Add a “shadow” completeness computation (new logic) alongside the current logic in `transactionService.getTransactionCompleteness`.
  - Compare results (status + variance) and log mismatches with enough context to debug.
  - Do **not** change the persisted `needs_review` behavior yet.
- [ ] Add a narrow diagnostic logger around `transactionService.notifyTransactionChanged`:
  - Count calls by event type / caller to make sure recomputes are actually triggered from the expected flows.

Exit criteria:

- Mismatch rate is acceptably low on real data (or mismatches are understood and fixed).

### Phase 1 — Fix Projects completeness (canonical item set, invariant-aligned)

#### 1. Canonical item set for completeness

Define a single item set for completeness that is consistent with Transaction Detail semantics:

- **Current items**: items where `items.transaction_id = txId`
- **Moved-out items**: items referenced by lineage edges with `from_transaction_id = txId`
- **Exclude**: items that only appear due to a correction/mistake fix

Implementation direction:

- Prefer querying by `items.transaction_id` for “current”.
- Use `item_lineage_edges` to add “moved-out / ever-associated”.
- Use `movement_kind` to exclude `correction` edges (and/or apply the “original items” rule described in the migration plan).

#### 2. Remove reliance on `transactions.item_ids` for completeness

- [ ] Stop using `transactions.item_ids` as the primary/first source of item IDs for completeness.
  - It is a current-only cache by design and will not contain moved-out items.
  - It must not be treated as “durable association history”.

#### 3. Recompute pipeline audit (Projects)

Ensure every Project mutation that can affect completeness triggers recompute, via the centralized API:

- `transactionService.notifyTransactionChanged(accountId, transactionId, { deltaSum?, flushImmediately? })`

Checklist (projects):

- [ ] Transaction edits that affect subtotal/tax/amount/category trigger recompute
- [ ] Adding/removing items triggers recompute (ideally batched per user action)
- [ ] Moving items between transactions triggers recompute for both old and new
- [ ] Offline queued operations still result in recompute (queued `needs_review` update or recompute on sync)

Exit criteria:

- For a representative sample of project transactions:
  - `needs_review` matches the canonical computation
  - no “complete but zero items visible” cases due to ghosts

### Phase 2 — Extract shared completeness API + UI primitives (prevents drift)

The goal is to make completeness context-agnostic.

#### 1. Service API

- [ ] Introduce a shared service method that does not require a project id:
  - `getTransactionCompletenessById(accountId, transactionId)`
  - It should internally fetch the transaction by `transaction_id` and compute completeness based on the canonical item set.
- [ ] Keep the existing signature as a wrapper for compatibility, but route all callers through the shared method.

#### 2. UI component extraction

Today `src/components/ui/TransactionAudit.tsx` assumes:

- it always has a `projectId`
- item edit links are always project routes

To support both contexts without forking:

- [ ] Split into shared pieces:
  - `TransactionCompletenessPanel` (pure completeness tracker UI)
  - `MissingPriceList` (render list + actions)
- [ ] Make “edit item” navigation injectable:
  - pass a callback like `getItemEditHref(item) => string`
  - or render-prop for the action column

Exit criteria:

- One shared completeness panel is used in both contexts.
- No business-inventory-only fork of the completeness tracker exists.

### Phase 3 — Business Inventory parity (UI + recompute + backfill)

#### 1. Make transaction detail render completeness for biz-inv transactions

Today Business Inventory routes transactions to `TransactionDetail` without a project id:

- `/business-inventory/transaction/:transactionId` → `TransactionDetail`

Fix options (pick one; prefer the one with least special casing):

- **Option A (recommended)**: Create `BusinessInventoryTransactionDetail` wrapper that:
  - loads the transaction by id,
  - renders the same shared `TransactionCompletenessPanel`,
  - uses biz-inv routes for edit actions
- **Option B**: Update `TransactionDetail` to support `projectId = null` for completeness/audit rendering.
  - Be careful: `TransactionDetail` has project-specific assumptions beyond completeness (budget category display, routing, etc.).

#### 2. Ensure recompute triggers exist in biz-inv flows

Business Inventory actions that must trigger recompute:

- Transaction create/edit (amount/subtotal/tax/category)
- Assign/unlink item to transaction from biz-inv UI
- Any item purchase price changes that affect a biz-inv transaction

Requirement:

- [ ] Biz-inv flows call the same `notifyTransactionChanged`/batch helpers as projects.

#### 3. Backfill `needs_review` for biz-inv transactions

- [ ] Run an application-driven backfill (script) that:
  - iterates `transactions where project_id is null`
  - computes canonical completeness
  - writes `needs_review`

Exit criteria:

- Business Inventory “Completeness” filter is accurate (backed by `needs_review`).
- Business Inventory transaction detail shows the same completeness panel as projects (shared UI).

### Phase 4 — Remove shadow code + lock in invariants

- [ ] Remove the old completeness item-sourcing logic.
- [ ] Keep a small set of regression tests to prevent future drift:
  - projects vs biz-inv should produce identical completeness results given the same transaction + items + lineage.

---

## Acceptance criteria (definition of done)

- **Projects**
  - `needs_review` matches canonical completeness computation.
  - No ghost item scenarios cause “complete” while showing 0 items.
  - Completeness remains stable when items are sold/returned/moved, per lineage semantics (and excluding corrections).

- **Business Inventory**
  - Completeness panel is visible for biz-inv transactions.
  - `needs_review` is maintained and used for filtering (same as projects).
  - No UI fork: shared components are used.

## Test plan (high signal)

- **Unit**
  - Completeness computation boundaries (near/complete/incomplete/over)
  - Item set assembly rules (current + moved-out, exclude correction)
  - `needs_review` recompute uses canonical computation and respects “itemization disabled” rules

- **Integration / E2E**
  - Create purchase transaction + add items → status becomes complete
  - Move/sell/return items out → completeness remains consistent with “ever-associated minus corrections”
  - Business Inventory transaction (project_id null) renders completeness panel and maintains `needs_review`

## Notes / risks

- The biggest risk is accidentally changing the meaning of completeness (current-only vs ever-associated).
  - This plan assumes completeness should remain audit-friendly (stable across moved-out items) and uses lineage to do that.
- If the intended meaning is “current-only”, we should decide that explicitly and simplify the item set accordingly.

