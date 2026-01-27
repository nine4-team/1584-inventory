# Offline-First Principles (UX + Correctness Invariants)

This doc defines the offline-first principles that every feature must follow. These are **product invariants** and **architecture constraints**.

Related canonical specs:

- [`sync_engine_spec.plan.md`](../sync_engine_spec.plan.md)
- [`target_system_architecture.md`](./target_system_architecture.md)

---

## North star: local-first correctness

### Principle 1: SQLite is the UI source of truth

- Screens render from **SQLite** queries only.
- User edits write to SQLite **immediately** (transactionally).
- A mutation is “done” for the user when it is committed locally.

### Principle 2: Sync is asynchronous and explicit

- Network is unreliable; sync must be **durable** and **recoverable**.
- The app always maintains explicit sync state:
  - pending outbox ops count
  - last successful delta timestamps
  - last error (if any)

### Principle 3: Collaboration without read amplification

- We do not subscribe to large collections.
- While foregrounded in a project, the app listens only to:
  - `accounts/{accountId}/projects/{projectId}/meta/sync`
- Signal changes trigger targeted delta fetch.

---

## UX invariants (what users must always experience)

### Invariant A: No “spinners of doom”

- If local data exists, show it immediately.
- Use visible “staleness”/sync indicators rather than blocking the UI.

### Invariant B: Offline is a first-class state

When offline:

- all browsing works from local data
- create/update/delete works locally
- media capture works locally (queued upload)
- actions that truly require network (e.g., login) show a clear message and a retry path

### Invariant C: Make pending changes obvious, not scary

- Always show a global pending changes indicator when outbox has entries.
- Provide a manual “Retry sync” action that triggers:
  - outbox flush attempt
  - targeted delta catch-up

### Invariant D: Never lose user work silently

- outbox is durable
- failed ops surface as actionable errors (not just logs)
- user can retry or revert a local pending change (where feasible)

---

## Background limitations (mobile reality)

iOS background execution is constrained. The architecture assumes:

- foreground = strong guarantees (fast propagation)
- background = best effort

Rules of thumb:

- detach listeners when backgrounded
- on resume, always run a delta catch-up before re-attaching the signal listener
- don’t promise “instant sync in background”; promise “syncs when you reopen / when network returns”

---

## Correctness rules for writes (local-first)

### Local write transaction

Every user mutation must be atomic locally:

1. validate inputs (domain layer)
2. update SQLite rows
3. enqueue one or more outbox ops

If any step fails, the local DB must not be left half-updated.

### Idempotency

- Every remote mutation includes `lastMutationId = opId`.
- Retries must be safe and must not double-apply.

### Tombstones for deletes

Deletes must be observable via delta sync:

- remote delete = set `deletedAt` (and `updatedAt`) rather than hard delete
- clients remove locally when delta observes tombstone

---

## Conflict stance (simple and user-trustworthy)

Conflicts are inevitable in collaboration. The goal is not “zero conflicts”; the goal is **trust**.

### Default policy

- For low-risk fields (text, notes, descriptions): prefer automatic merge/“last write wins” with auditability.
- For high-risk fields (money, tax, category allocation): do not silently overwrite if the remote changed since the user’s base version.

### Concrete mechanism

- Store `baseVersion` (server version last seen) on local edits.
- When flushing an update:
  - if server `version != baseVersion`, record a conflict in SQLite and surface a conflict UI.

Conflicts are persisted so they survive app restarts.

---

## Media is also offline-first

- Captured images/PDFs are stored locally immediately.
- Upload is queued and retried.
- The UI must show clear attachment states:
  - `local_only`
  - `uploading`
  - `uploaded`
  - `failed` (with retry)

---

## Feature author checklist (use in every feature spec)

When writing/implementing any feature:

- Does the UI read/write SQLite only?
- Does every mutation enqueue durable outbox ops?
- Do deletes use tombstones (`deletedAt`)?
- Does the feature avoid large listeners?
- Are pending/error states visible and actionable?
- Are critical-field conflicts detectable and resolvable?

