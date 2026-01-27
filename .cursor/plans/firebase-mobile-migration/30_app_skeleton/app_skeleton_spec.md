# App Skeleton Spec (Expo RN + Firebase, Local-First)

This spec defines the reusable “starter app” foundation that all features will sit on:

- Expo bootstrap + navigation shell
- auth/session bootstrap
- local DB init + migrations
- sync wiring (outbox + delta + signal listener)
- global UX patterns (offline banner, sync status, retry, conflicts)
- logging + error boundaries

This skeleton must enforce the invariants described in:

- [`../10_architecture/target_system_architecture.md`](../10_architecture/target_system_architecture.md)
- [`../10_architecture/offline_first_principles.md`](../10_architecture/offline_first_principles.md)
- [`../sync_engine_spec.plan.md`](../sync_engine_spec.plan.md)

---

## Boot sequence (startup order)

### 0) Crash-safe initialization

- Initialize logging (dev vs prod behavior)
- Register a global error boundary
- Configure “safe mode” UI for fatal init failures (DB migration failure, corrupted local state)

### 1) Auth bootstrap (Firebase Auth)

Responsibilities:

- restore session from device keychain/secure storage
- determine `currentUser` (or unauthenticated)
- if unauthenticated and offline: show “requires connection” for login flows

Outputs:

- `authState: loading | authenticated | unauthenticated`
- `uid` when authenticated

### 2) Account context bootstrap

Responsibilities:

- determine the current `accountId` and role for the authenticated user
- cache membership doc locally (SQLite or lightweight KV)

Constraints:

- membership is required to open any account data
- if membership is missing or disabled: show “no access” UI and sign out / switch account

### 3) Local DB init + migrations

Responsibilities:

- open SQLite
- run schema migrations (using `PRAGMA user_version`)
- validate core tables exist
- optionally run lightweight integrity checks

### 4) App hydration from local DB

Responsibilities:

- read last active scope (project or business inventory), last visited route (if you persist it)
- render UI immediately from SQLite state (even offline)

### 5) Sync wiring

Once DB + account context is ready:

- start outbox processor (foreground loop)
- if a scope is active:
  - run one delta catch-up pass immediately for that scope
  - attach a single signal listener for that scope:
    - project: `accounts/{accountId}/projects/{projectId}/meta/sync`
    - inventory: `accounts/{accountId}/inventory/meta/sync`

---

## Navigation shell

### Requirements

- Auth gate at the top level:
  - unauthenticated: show auth stack (login, signup, invite accept)
  - authenticated: show app tabs/stack
- Project scope:
  - allow selecting an active project
  - when project changes:
    - stop project sync for old project
    - start project sync for new project
 - Business inventory scope:
   - entering Business Inventory activates inventory sync scope
   - leaving Business Inventory detaches inventory signal listener (and may attach a project listener if a project is active)

### Deep links

Support deep links for:

- invite acceptance (`/invite/<token>`)
- auth callback flows (if web-based OAuth flow is used)

---

## Local-first data access pattern (hooks + services)

### Read pattern (screen)

- screens use hooks that subscribe to SQLite query results
- screens never depend on Firestore query subscriptions

### Write pattern (mutation)

Any mutation must:

1. validate (domain layer)
2. write SQLite transactionally
3. enqueue outbox ops
4. update UI immediately (because SQLite changed)

Outbox flush happens asynchronously.

---

## Sync engine integration points

### Scope sync lifecycle

Public APIs the app skeleton uses:

- `startScopeSync(scope)`
  - scope is either `{ type: "project", id: projectId }` or `{ type: "inventory" }`
  - run delta catch-up for that scope
  - attach scope signal listener (one listener total)
  - resume outbox flush
- `stopScopeSync()`
  - detach the active scope listener
  - pause any scope-scoped timers
- `triggerForegroundSync()`
  - manual retry: flush outbox + delta catch-up

### Foreground/background handling

On background:

- detach `meta/sync` listener
- stop or pause outbox flushing (best effort background work only)

On resume:

- delta catch-up
- reattach listener

---

## Global UX components (always-on)

### Network status banner

Shows:

- offline
- online but “poor connection” (optional)

Rules:

- never blocks reading local data
- provides clear messaging: “changes will sync when reconnected”

### Sync status indicator

Shows:

- pending outbox ops count
- “syncing…” while outbox flush/delta apply is active
- last error summary

### Retry sync action

A global action that triggers:

- outbox flush attempt
- delta catch-up

### Conflict indicator

If conflicts exist in SQLite:

- show a non-blocking indicator
- navigate to a conflict resolution screen

---

## Media pipeline integration

### Capture/import

- store selected media locally immediately
- create an `attachments` row with `upload_state = local_only`

### Upload queue

- uploads are resumable
- upload errors are persisted and visible in UI
- on successful upload:
  - write Firestore attachment metadata doc
  - increment the correct signal doc in the same write batch:
    - project attachment: project `meta/sync`
    - inventory attachment: `accounts/{accountId}/inventory/meta/sync`

---

## Component sharing rule (anti-divergence)

To avoid “inventory UI” and “project UI” drifting into separate implementations:

- shared UI components must live in one shared library/module (design system + common composites)
- pages/screens are thin; they compose shared components + wire query/mutations
- “business inventory” and “project inventory” should reuse the same list, row, filter, and detail components with a `scope` prop (`projectId` string or `null`)

This is enforced by:

- no feature-local copies of common components
- code review rule: if a new component resembles an existing one, refactor into shared component instead of forking

---

## Logging and observability (client)

### Minimum required logging

Log structured events for:

- app start, resume, background
- auth transitions
- DB migration success/failure
- outbox processing:
  - op started / succeeded / failed (with error codes)
- delta sync:
  - run started / completed
  - docs applied counts per collection
  - last cursor values persisted
- signal listener health:
  - attached/detached
  - disconnects/errors

### Error boundary behavior

- show a safe fallback UI
- allow user to:
  - retry initialization
  - export logs (dev build) for debugging
  - reset local cache (last resort, guarded)

---

## Non-goals (for the skeleton)

- Perfect background sync on iOS (best-effort only)
- Complex per-project ACLs (account-wide membership first)
- Full pixel-parity with web (skeleton defines infra + global patterns)

