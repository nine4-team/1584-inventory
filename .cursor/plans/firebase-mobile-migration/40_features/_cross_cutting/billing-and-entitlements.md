# Billing and Entitlements (Cross-cutting)

This doc defines **how monetization gates are enforced** in the Firebase mobile app (React Native + Firebase), in a way that is compatible with:

- offline-first (SQLite + outbox + delta sync)
- Firestore Rules constraints (no aggregate queries)
- server-owned invariants (callable Functions)

---

## Goals

- Allow **free tier** usage (example policy: **1 free project**) with a clear upgrade path.
- Enforce limits **server-side** so clients cannot bypass gates.
- Provide predictable UX offline (no “mystery failures”).

---

## Core concepts

### Account entitlement

Entitlements are scoped to an `accountId` and determine feature limits.

Suggested shape (example):

- `accounts/{accountId}/entitlements/current`
  - `planId`: `"free" | "pro" | ...`
  - `status`: `"active" | "past_due" | "canceled"`
  - `maxProjects`: `1` (free) or higher
  - `updatedAt`

Notes:

- Treat entitlements as **server-owned** (written only by Functions / trusted backend).
- The client can read entitlements for UX (“Upgrade” banners, gating messages).

---

## Policy example: “1 free project”

### Enforcement rule

- Project creation is allowed only if `projectCount < maxProjects` (unless `maxProjects` is unlimited).

### Why this must be a callable Function

Firestore Rules cannot compute `projectCount` safely (no server-side count/aggregate). Therefore:

- Disallow direct client `create` on `accounts/{accountId}/projects/{projectId}`
- Provide a callable Function `createProject(...)` that:
  - verifies membership + role
  - reads `entitlements/current`
  - queries current project count (or uses a server-maintained counter)
  - creates the project in a transaction/batch
  - updates `meta/sync` once per logical operation

If we choose to maintain a counter:

- Keep `accounts/{accountId}/stats` with `projectCount`, updated only by Functions.
- Ensure creation/deletion paths update it transactionally with the project write.

---

## Offline behavior policy (must choose explicitly)

Option A (recommended): **Block over-limit creation while offline**

- If offline and user is at/over limit, show an upgrade/online-required prompt.
- Still allow editing existing projects offline.

Option B: **Local-only draft project**

- Allow creating a local draft in SQLite.
- Mark it as “not yet created remotely” and prevent sharing/collaboration.
- On reconnect:
  - attempt `createProject` (may fail if still over limit)
  - if upgrade completes, retry and then begin normal sync.

Option A is simpler and avoids confusing “draft projects that disappear” when upgrade fails.

---

## Upgrade flow (high-level)

- When gating triggers, show upgrade prompt.
- After purchase succeeds, refresh entitlements and retry the blocked operation.

Implementation note: purchase provider specifics (Stripe vs App Store/Play Billing) are out of scope for this doc; this doc only defines **entitlement enforcement** and data shapes.

