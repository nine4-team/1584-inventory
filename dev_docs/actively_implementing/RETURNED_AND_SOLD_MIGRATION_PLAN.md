## Returned + Sold migration plan (replace generic “moved”)

### Reality check (based on current code)

This plan was originally written as if “Returned” and “Sold” are mostly inferred from generic item moves.
In the actual codebase today, there are already **canonical inventory flows** and **lineage is already used broadly**:

- **Truth link** is already `items.transaction_id` (and you already have ongoing work to keep `transactions.item_ids` in sync).
- `TransactionDetail` already loads “moved out” items via `lineageService.getEdgesFromTransaction(transactionId, accountId)`.
- Canonical inventory flows exist and are implemented in `src/services/inventoryService.ts`:
  - Allocation uses `INV_PURCHASE_<projectId>` and `INV_SALE_<projectId>`.
  - Returns from a project are implemented as deterministic flows that often end in **inventory** (null transaction), not necessarily a “Return transaction”.
- The UI already distinguishes **Sell** vs **Move** (correction) at the item level, but item-level actions intentionally refuse to move items that are tied to a transaction (“Move the transaction instead.”).

So: **we should not repurpose `item_lineage_edges.note` into an enum** (it’s currently free-form and used for many flows), and we should not assume return/sale semantics can be reliably inferred from “destination alone”.

This revised plan focuses on:

- Keeping “current association” canonical (`items.transaction_id` truth, `transactions.item_ids` current-only cache).
- Keeping lineage edges as the generic movement graph **and** a durable log of transaction association changes (including corrective mistakes).
- Adding an explicit, typed classification for only the movements we want to surface as “Sold” and “Returned” (because intent is not always inferable from the move alone).

### Goal (new rules)

- **Current items in a transaction** are only the items where `items.transaction_id = <transaction_id>`.
- We only show two “moved-like” outcomes from a transaction:
  - **Returned**: item left this transaction into a **return transaction** in the *same project*
  - **Sold**: item left this transaction into **another project** or into **business inventory**
- **Corrective moves** (fixing mistakes) should **not** create “history” that shows up as Sold/Returned.
- **No ghosts**: `transactions.item_ids` should never list items that aren’t currently attached.

---

### Baseline invariant (pre-req)

Make one thing “the truth” and everything else derived:

- **Truth**: `items.transaction_id`
- **Cache**: `transactions.item_ids` is a mirror of current attachments only.

Operationally:

- Keep the DB trigger behavior from `20260203_fix_item_ref_drift_remove_old_ref_on_move.sql` (remove old ref + add new ref whenever `items.transaction_id` changes).
- Use `20260203_backfill_rebuild_transaction_item_ids_from_truth.sql` (or an account-scoped version) whenever legacy data drift/ghost refs exist.

---

### Data model (grounded in current usage)

We keep `item_lineage_edges` as the **generic movement graph** (already used by `TransactionDetail` to load moved-out items).

To support “only show Sold + Returned (hide corrections)”, we add an explicit classification that is **not** overloaded onto `note`.

#### Table 1: `item_lineage_edges` (keep, extend)

Keep it for all move-like history you already record (inventory moves, corrections, sales, returns, etc.).

Add a new nullable column to classify edges we want to surface in UI:

`movement_kind text null` (or enum) with allowed values:

- `sold`
- `returned`
- `correction` (explicit “Move” action / mistake-fix / non-economic move)
- `association` (automatic: records that `items.transaction_id` changed)

Notes:

- **Do not** treat `note` as a classifier.
- `movement_kind` is for UI semantics; lineage still works without it.
- **New edges should always set `movement_kind` and `source`** (legacy edges may remain null/unknown).

Add provenance so we can distinguish “explicit user action” vs “automatic association logging”:

- `source text not null default 'app'` with values: `app|db_trigger|migration`

Durable “original items” set:

- We’ll use two related concepts:
  - **Ever-associated** (durable, audit-friendly): items that were in this transaction at *any point*.
  - **Original items (UI default)**: ever-associated items **excluding corrections** (so accidental adds/moves don’t clutter the main view).

Ever-associated (trigger-based) is:

- items currently attached (`items.transaction_id = txId`), plus
- items that left the transaction (`distinct item_id from item_lineage_edges where from_transaction_id = txId and movement_kind='association'`)

Original items (UI default) is:

- ever-associated
- MINUS items that have an explicit correction intent edge out of this transaction:
  - `exists item_lineage_edges where from_transaction_id = txId and movement_kind='correction' and item_id = <item>`

This is intentionally simple, durable, and matches the trigger-based approach.

Indexes (recommended additions):

- `(account_id, from_transaction_id, movement_kind, created_at)`
- `(account_id, from_transaction_id, created_at)`
- `(account_id, to_transaction_id, created_at)`

DB-level dedupe (must-have):

Because we’ll record a lot more history (including corrective moves), retries/offline replays can spam duplicates unless we enforce dedupe in the database.

Recommended approach (hard DB rule):

- Add an **exclusion constraint** that prevents inserting the “same edge” within a short time window (e.g. 5 seconds).
- This requires `btree_gist` (available on most Supabase Postgres installs).
- We treat `NULL` transaction ids (inventory) as equal by `coalesce(...)`-ing them.

Example (shape, not copy/paste final):

```sql
create extension if not exists btree_gist;

alter table public.item_lineage_edges
  add constraint item_lineage_edges_dedupe_5s
  exclude using gist (
    account_id with =,
    item_id with =,
    coalesce(from_transaction_id, '__null__') with =,
    coalesce(to_transaction_id, '__null__') with =,
    movement_kind with =,
    source with =,
    tstzrange(created_at, created_at + interval '5 seconds') with &&
  );
```

Fallback (if `btree_gist` is not available): implement the same 5-second dedupe check in the trigger function (query recent matching edges before insert) and keep the supporting indexes so it stays fast.

#### Table 2 (optional): `transaction_item_events`

This is useful if you want a durable “original items” set and rich per-transaction audit history.
However, it is **not required** to ship “Sold/Returned” cleanly because:

- you already have `item_lineage_edges` + lineage pointers for “moved out”,
- you already have `transaction_audit_logs` capturing many operations,
- and adding an events table increases write paths + RLS surface area.

If we adopt “auto edge on every transaction_id change”, Table 2 becomes even more optional:

- You can compute “ever-in-transaction” from lineage.
- You can compute “moved out” from lineage.
- You can compute “Sold/Returned” by filtering on `movement_kind`.

Table 2 is still valuable if you want a richer *reasoned* log (added/removed with reasons, UI surface for audit, created_by/source at a finer granularity, etc.).

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `account_id uuid not null`
- `transaction_id text not null`
- `item_id text not null`
- `event_type text not null` (or enum):
  - `added`
  - `removed`
  - `sold`
  - `returned`
  - `corrected_move` (optional but useful)
- `related_transaction_id text null` (destination tx for `sold/returned`)
- `related_project_id uuid null` (optional helper for UI)
- `created_at timestamptz not null default now()`
- `created_by uuid null`
- `note text null`
- `source text not null default 'app'` (`app|migration|system`)

Indexes:

- `(account_id, transaction_id, created_at)`
- `(account_id, item_id, created_at)`
- `(account_id, transaction_id, item_id)`

RLS:

- Mirror `item_lineage_edges` policies: account members can select/insert.

---

### Semantics: how to classify things as Returned vs Sold

#### Returned

Definition:

- Item left a transaction into a **Return transaction** (a transaction row whose `transaction_type = 'Return'`), in the same project context.

Important: your codebase also has a separate “return to inventory” canonical flow (e.g. purchase → inventory). That is a valid return flow, but it does not automatically imply a “Return transaction”.
For this migration, “Returned” means **explicit Return transaction** moves (because that’s what you can show cleanly on a transaction detail screen).

Implementation needs an identity for “return transaction”, but we already have it:

- Use the existing `transactions.transaction_type` (app: `transactionType`) and standardize on a single value (e.g. `'Return'`).
- Do **not** add a second “kind/type” field.

Write:

- `item_lineage_edges`:
  - `from_transaction_id=<sourceTx>`
  - `to_transaction_id=<returnTx>`
  - `movement_kind='returned'`
  - `note=<optional human note>`

#### Sold

Definition:

- Item left a transaction due to an **economic sale** outcome:
  - sold into another project (destination is a different project context), or
  - sold into business inventory (destination is inventory / canonical inventory sale flow).

Important: your codebase distinguishes “Sell” vs “Move” (correction). This classification must come from **the action being performed**, not just “it moved”.

Write:

- `item_lineage_edges`:
  - `from_transaction_id=<sourceTx>`
  - `to_transaction_id=<destTx or null>`
  - `movement_kind='sold'`
  - `note=<optional human note>`

#### Corrective move (wrong project / wrong transaction)

Definition:

- A fix to correct a mistake, not “economic reality”.

Write:

- Update `items.transaction_id` (truth), and let DB triggers keep `transactions.item_ids` aligned.
- Record the association change as a lineage edge (via DB trigger) with:
  - `movement_kind='association'`
  - `source='db_trigger'`
- Also record the user intent as a lineage edge (via app) with:
  - `movement_kind='correction'`
  - `source='app'`
- Avoid writing `movement_kind='sold'|'returned'` for corrective moves (unless the user explicitly chose Sell/Return).

---

### App implementation plan (non-breaking, aligned to canonical flows)

This is the key design decision (updated):

- We **do** record *all* `items.transaction_id` changes as permanent history (including corrective mistakes) to get a durable association log.
- We **do not** try to infer Sold/Returned from the move alone; we mark Sold/Returned only when the user performed an explicit **Sell** or **Return** action.
- We keep using lineage edges for “moved out” loading and history, and we add `movement_kind` to support Sold/Returned UI.

#### 1) Extend lineage edge writes to include a kind (smallest surface-area change)

Changes:

- Add `movement_kind` + `source` to `item_lineage_edges` (DB migration).
- Extend `lineageService.appendItemLineageEdge(...)` to accept `movementKind?: 'sold'|'returned'|'correction'|'association'`.
  - Keep the existing 5-second idempotency guard.
  - Do not break existing callers: default `movementKind` to `null`.

#### 1b) Re-enable automatic association edges (DB trigger)

Because we’re okay with recording corrective mistakes permanently, we can re-enable an “edge per `transaction_id` change” trigger.

Design constraints:

- Trigger writes edges with `movement_kind='association'` and `source='db_trigger'`.
- App-level Sell/Return can still write a second, explicitly-classified edge (`sold` / `returned`) with `source='app'` so UI has durable intent without needing updates.

#### 2) Make Transaction Detail UI show Sold + Returned using lineage (not `transactions.item_ids`)

For a transaction `txId`:

- **In transaction**: items where `items.transaction_id = txId` (truth).
- **Sold**: lineage edges where `from_transaction_id = txId and movement_kind = 'sold'`.
- **Returned**: lineage edges where `from_transaction_id = txId and movement_kind = 'returned'`.

Keep the existing “moved-out fetch” behavior for now (it protects the UI from legacy drift), but change the *rendering* so it no longer shows a generic “Moved” bucket.

Targets:

- `TransactionItemPicker` “add items”
- `ItemDetail` “change transaction”
- any other `assignItem(s)ToTransaction` callers

#### 3) Route the explicit actions to write correct kinds

On `TransactionDetail` (transaction-attached items), ensure these actions exist and write lineage kinds:

- **Sell** (economic):
  - When the user sells an item out of this transaction (to another project or to business inventory), write an edge with `movement_kind='sold'` from this `transactionId`.
  - Then perform the underlying operations your canonical services already use.
- **Return** (explicit Return transaction):
  - Ensure/locate a Return transaction (`transaction_type='Return'`) in the same project context.
  - Move the item into it.
  - Write an edge with `movement_kind='returned'` from this `transactionId` to the Return transaction ID.
- **Move** (correction):
  - Move the item without marking it sold/returned.
  - The DB trigger will record the association edge as `movement_kind='association'` / `source='db_trigger'`.
  - The app writes an explicit intent edge `movement_kind='correction'` / `source='app'`.

This keeps canonical flows canonical, and keeps Sold/Returned strictly tied to user intent.

---

### UI changes (“Transaction Detail”)

Replace the generic “Moved” concept with two sections.

#### Data sources

For a transaction `txId`:

- **In transaction**: `items where items.transaction_id = txId`
- **Returned**: `item_lineage_edges where from_transaction_id = txId and movement_kind='returned'`
- **Sold**: `item_lineage_edges where from_transaction_id = txId and movement_kind='sold'`
- **Ever-associated**:
  - `items where items.transaction_id = txId`
  - UNION `distinct item_id from item_lineage_edges where from_transaction_id = txId and movement_kind='association'`
- **Original items (UI default; ever-associated excluding corrections)**:
  - ever-associated
  - MINUS items with a `movement_kind='correction'` edge from this transaction

#### Rendering/behavior rules

- Never mark something “moved” purely because it appears in `transaction.item_ids`.
- If `transaction.item_ids` disagrees with `items.transaction_id`, treat that as drift (should not happen after triggers + backfill).
- Handle “double edges” explicitly:
  - An association change creates a `movement_kind='association'` edge (trigger).
  - A user intent action may create an additional `movement_kind='sold'|'returned'` edge (app).
  - A correction action creates an additional `movement_kind='correction'` edge (app).
  - **UI rule**: when rendering Sold/Returned, use the most recent edge for that `item_id` + `movement_kind` from this transaction. Do not show the generic association edge in those sections.
  - **If no `sold/returned` edge exists**, the item should not appear in Sold/Returned, even if it moved out.
  - **Original items default**: exclude items whose most recent intent edge out of this transaction is `correction`.

#### UI affordances

- Add “Return” action and “Sell” action where relevant.
- Optionally add an item “History” drawer using `transaction_item_events` for explanations (“why is it sold/returned/removed?”).

---

### Data migration / backfill plan

#### A) Keep current association clean (must-have)

- Rebuild `transactions.item_ids` from truth (+ lineage if desired) using the backfill (globally or per-account).

#### B) Backfill `movement_kind` (optional)

Ship Sold/Returned “from now on” first. Backfill later only if you have strong, reliable inference rules.

If you do backfill, keep it conservative:

Suggested inference rules (safe-ish):

- `movement_kind='returned'` only when `to_transaction_id` points at a transaction whose `transaction_type='Return'`.
- `movement_kind='sold'` only when the edge was created by known sell flows (requires additional provenance; otherwise skip backfill).

---

### Rollout checklist (incremental, non-breaking)

- **Ship 1**: DB migration adding `movement_kind` + `source` to `item_lineage_edges` + required indexes (no UI changes).
- **Ship 2**: Add DB-level dedupe rule (exclusion constraint) so retries don’t spam edges.
- **Ship 3**: Re-enable “edge on every `items.transaction_id` change” trigger writing `movement_kind='association'` / `source='db_trigger'`.
- **Ship 4**: Update `lineageService` to support `movement_kind` (backward compatible defaults).
- **Ship 5**: Update Transaction Detail UI to render **Sold** + **Returned** from lineage edges using `movement_kind` (no more generic “Moved”).
- **Ship 6**: Wire explicit Transaction Detail actions to write `movement_kind='sold'|'returned'` edges (`source='app'`) in addition to the trigger association edge.
- **Ship 7**: (optional) introduce `transaction_item_events` if you still want richer “reasoned” audit beyond movement history.

---

### Validation queries (operational sanity checks)

Ghost ref check (per account):

```sql
with tx_items as (
  select t.account_id, t.transaction_id, unnest(coalesce(t.item_ids, array[]::text[])) as item_id
  from public.transactions t
  where t.account_id = '<account_id>'
), ghosts as (
  select ti.account_id, ti.transaction_id, ti.item_id
  from tx_items ti
  left join public.items i
    on i.account_id = ti.account_id
   and i.item_id = ti.item_id
  where i.item_id is null
     or i.transaction_id is distinct from ti.transaction_id
)
select count(*) as ghost_ref_count
from ghosts;
```

Current attachments must be represented in `transactions.item_ids`:

```sql
select count(*) as missing_in_transaction_item_ids
from public.items i
join public.transactions t
  on t.account_id = i.account_id
 and t.transaction_id = i.transaction_id
where i.transaction_id is not null
  and not (i.item_id = any(coalesce(t.item_ids, array[]::text[])));
```

