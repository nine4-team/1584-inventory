# Billing and entitlements — Acceptance criteria (migration)

Each non-obvious criterion is backed by an **intentional delta** reference to the migration plan, since this is net-new behavior.

## Entitlements snapshot (server-owned)
- [ ] **Canonical path**: entitlement snapshot lives at `accounts/{accountId}/entitlements/current`.
- [ ] **Plan types**: `planType` supports `free` and `pro`.
- [ ] **Limits present**: snapshot includes `limits.maxProjects`, `limits.maxItems`, `limits.maxTransactions`.
- [ ] **Server-owned writes**: clients cannot write the snapshot; it is written only by trusted backend/Functions.
- [ ] **Client-readable**: authenticated account members can read the snapshot for UX gating.

## Counters (server-owned stats)
- [ ] **Canonical path**: counters live at `accounts/{accountId}/stats`.
- [ ] **Fields present**: `projectCount`, `itemCount`, `transactionCount` exist and are numbers.
- [ ] **Server-owned updates**: counters are updated only by trusted backend/Functions.

## Gated creates
- [ ] **Create project is server-owned**: direct client creates to `accounts/{accountId}/projects/*` are disallowed when limits are enforced; creation happens via callable `createProject`.
- [ ] **Create project enforces limits**:
  - Free tier enforces `projectCount < limits.maxProjects` (with `maxProjects = 1`).
  - Pro tier increases/removes the limit per policy.
- [ ] **Membership/role validated**: callable validates membership per `accounts/{accountId}/members/{uid}` (see `10_architecture/security_model.md`).
- [ ] **Meta/sync updated once**: successful creates update the relevant `meta/sync` doc once per logical operation (see `40_features/sync_engine_spec.plan.md`).

## Offline behavior
- [ ] **Offline allow only when provable**: when offline, gated creates proceed only if cached `entitlements/current` + cached `stats` prove under-limit.
- [ ] **Offline block when unknown/at limit**: when offline and under-limit cannot be proven, the app blocks the operation and instructs the user to connect to verify/upgrade.

## Upgrade retry
- [ ] **Online upgrade CTA**: when blocked online, the UI offers an upgrade CTA.
- [ ] **Retry after entitlement refresh**: after purchase completes (online), the app refreshes entitlement snapshot and retries the blocked operation.

