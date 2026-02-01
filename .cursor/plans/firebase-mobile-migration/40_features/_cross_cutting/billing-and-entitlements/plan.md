## Goal
Ship the **billing + entitlements enforcement contract** (RevenueCat-backed) in a way that:

- stays compatible with the migration architecture: offline-first, SQLite source of truth, outbox, delta sync, change-signal
- enforces limits server-side (Callable Functions + server-owned counters)
- provides a predictable offline UX that drives upgrade when online

Spec source of truth:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`

## Primary risks (what can go wrong)

- Enforcement leaks into client UI only (bypassable).
- Counting via Firestore Rules (not possible / unsafe).
- Read amplification if we “count by querying” frequently.
- Confusing offline UX (drafts that later fail/vanish).
- RevenueCat coupling: mirroring unstable provider state instead of storing a stable enforcement snapshot.

## Outputs produced by this work order

Minimum:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md` (canonical contract)
- `40_features/_cross_cutting/billing-and-entitlements/plan.md` (this file)
- `40_features/_cross_cutting/billing-and-entitlements/prompt_packs/` (Chats A–D)

Optional (if needed for clarity):

- `40_features/_cross_cutting/billing-and-entitlements/acceptance_criteria.md`

## Implementation phases (2–4 slices)

### Phase A — Data shape + RevenueCat → Firestore entitlement snapshot
**Goal**: establish the server-owned enforcement snapshot contract used by UI and Functions.

**What it changes (high level)**
- Define `accounts/{accountId}/entitlements/current` with `planType` + `limits`.
- Define the minimal provider audit fields for RevenueCat.
- Define read permissions and “server-owned only” write constraints.

**Exit criteria**
- There is one canonical snapshot doc per account.
- Clients can read it for UX gating, but cannot write it.

### Phase B — Server-owned counters + gated callable creates
**Goal**: enforce limits without rule-time aggregation or expensive queries.

**What it changes (high level)**
- Define `accounts/{accountId}/stats` counters.
- Implement gated callable Function(s):
  - `createProject` (required)
  - (optionally later) `createItem`, `createTransaction`
- Ensure each server-owned operation updates `meta/sync` once per logical operation.

**Exit criteria**
- Direct client creates for gated collections are disallowed.
- Callable creates enforce `stats` against `limits`.

### Phase C — Offline UX + paywall retry semantics
**Goal**: make the user experience predictable and conversion-friendly.

**What it changes (high level)**
- Define offline policy:
  - allow only if cached snapshot + stats prove under-limit
  - otherwise block and prompt to go online/upgrade
- Define “after purchase” behavior:
  - refresh entitlements snapshot
  - retry the blocked operation

**Exit criteria**
- Offline behavior is explicit and consistent across gated creates.
- Online upgrade path is immediate and retries work reliably.

### Phase D — Hardening (tests + edge-case audit)
**Goal**: reduce regression risk and prevent bypass.

**Exit criteria**
- Tests cover allow/deny decisions for free vs pro and boundary conditions (at limit, over limit, missing cache).
- Rules/Functions/clients are consistent with “server-owned” constraints.

