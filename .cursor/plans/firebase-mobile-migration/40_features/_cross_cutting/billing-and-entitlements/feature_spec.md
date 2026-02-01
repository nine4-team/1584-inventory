# Billing and entitlements (RevenueCat) — Feature spec (cross-cutting)

This doc defines the **monetization enforcement contract** for the Firebase mobile migration (React Native + Firebase), compatible with:

- offline-first (SQLite + outbox + delta sync)
- Firestore Rules constraints (no aggregate queries, no server-side “count” in rules)
- server-owned invariants (Callable Cloud Functions)

It is intentionally **provider-aware** (RevenueCat) but **provider-agnostic at the enforcement boundary**: Firestore holds a server-owned “enforcement snapshot” that Functions/Roles/UI can rely on without embedding RevenueCat-specific state machines everywhere.

---

## Where it’s used

- Projects: create project must be entitlement-gated (see `40_features/projects/feature_spec.md`)
- Items (planned): create/edit must enforce free-tier limits
- Transactions (planned): create/edit must enforce free-tier limits

---

## Goals

- Allow a free tier with explicit limits:
  - **maxProjects = 1** (per account)
  - **maxItems = 20**
  - **maxTransactions = 5**
- Allow upgrade to **Pro** that increases/removes limits.
- Enforce limits **server-side** (clients cannot bypass).
- Provide predictable UX offline (clear messaging; no “mystery failures”).

---

## Non-goals

- Implementing payment flows (purchase UI, paywall UI design, App Store / Play Billing specifics).
- Defining every RevenueCat field or mirroring the entire RevenueCat customer object in Firestore.

---

## Definitions

### Plan types (product language)

- **Free**
- **Pro**

These are product-level plan types. They are not necessarily 1:1 with store products; RevenueCat is the source of truth.

### Enforcement snapshot (server-owned)

We store a minimal, server-owned document in Firestore that represents:

- whether the account is currently entitled to Pro behavior
- what limits apply right now

This is what the client reads for UX and what callable Functions use for allow/deny decisions.

---

## Data model (recommended)

### Entitlements snapshot

Path:

- `accounts/{accountId}/entitlements/current`

Recommended fields (v1):

- `accountId: string` (redundant but helps debugging / validation)
- `planType: "free" | "pro"` (product language, not store product)
- `limits`:
  - `maxProjects: number`
  - `maxItems: number`
  - `maxTransactions: number`
- `updatedAt: Timestamp`
- `source` (optional but recommended for auditing/debug):
  - `provider: "revenuecat"`
  - `environment?: "sandbox" | "production"`
  - `appUserId?: string`
  - `lastSyncedAt?: Timestamp`

Rules:

- Treat this doc as **server-owned** (written only by Functions / trusted backend).
- Clients can read it for gating UX.

### Stats (server-owned counters)

To enforce limits without expensive queries and without rules-time aggregation, maintain server-owned counters:

- `accounts/{accountId}/stats`
  - `projectCount: number`
  - `itemCount: number`
  - `transactionCount: number`
  - `updatedAt: Timestamp`

Notes:

- These are updated only by server-owned operations (callable Functions / trusted backend).
- Counters should be updated transactionally with the operation that changes them.

---

## Enforcement points (Rules vs Functions vs Client)

### Source of truth

- **Callable Functions** are the source of truth for **limit-enforced creates** (and any multi-doc operation).
- **Firestore Rules** should disallow direct client creates where enforcement depends on counts/limits.
- **Client UX** uses the snapshot to preflight and show the right messaging, but cannot be relied on for enforcement.

### Gated operations (v1)

#### Create project (required)

- Disallow direct client `create` to `accounts/{accountId}/projects/{projectId}`.
- Provide callable Function:
  - `createProject({ accountId, ...projectFields })`
  - validates membership + role (see `10_architecture/security_model.md`)
  - reads `accounts/{accountId}/entitlements/current`
  - reads `accounts/{accountId}/stats.projectCount`
  - enforces: `projectCount < limits.maxProjects` (unless “unlimited” in Pro policy)
  - writes the new project doc
  - increments `stats.projectCount`
  - updates `projects/{projectId}/meta/sync` once per logical operation

#### Create item / transaction (planned)

Same pattern as project creation:

- disallow direct client creates where a limit must be enforced
- provide server-owned create Functions (`createItem`, `createTransaction`) that enforce `itemCount` / `transactionCount`

---

## Offline behavior contract

### Guiding principle

Upgrade requires network, so offline behavior must prioritize:

- avoiding “local drafts that later disappear”
- giving a clear “go online to upgrade/verify” path when limits might be exceeded

### Policy (v1)

When offline, for any **gated create** (project/item/transaction):

- If the app can prove (from **cached** `entitlements/current` + **cached** `stats`) that the operation is **under the limit**, it may proceed locally (pending state) and will sync when online.
- If the app cannot prove it is under the limit (missing cache, stale cache, or already at limit), the app must:
  - block the operation
  - show a clear message: “Connect to verify your plan / upgrade to Pro”
  - provide an upgrade CTA that works once online

Rationale:

- This preserves conversion (upgrade CTA appears immediately when online).
- It avoids confusing local-only drafts when enforcement later denies on reconnect.

---

## RevenueCat integration contract (high-level)

This spec assumes RevenueCat is the source of truth for plan entitlements.

Minimum requirement:

- A server-owned path updates `accounts/{accountId}/entitlements/current` to match RevenueCat-derived access.

Implementation choices (acceptable):

- RevenueCat webhooks → Cloud Function → update entitlements snapshot
- Client purchase completes → client triggers a “refresh entitlements” callable that re-validates with RevenueCat server-side → updates snapshot

Regardless of mechanism:

- Firestore entitlements snapshot must remain the stable enforcement boundary.

---

## Parity evidence

This is a **net-new** feature area in the migration plan (not implemented in the current web app); it is referenced as:

- `40_features/feature_list.md` → C3 “Monetization: free tier + upgrade gating (entitlements)”
- `40_features/projects/feature_spec.md` references this doc for server-enforced project creation

