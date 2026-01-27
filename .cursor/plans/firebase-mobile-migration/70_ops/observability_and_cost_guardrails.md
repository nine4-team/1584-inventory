# Observability and Cost Guardrails (Firebase + RN)

This doc defines the operational guardrails for the Firebase + React Native migration:

- prevent accidental “subscribe to everything” patterns
- monitor Firestore/Storage/Functions costs
- detect sync regressions early (latency, failures, read amplification)

Architecture baseline:

- **one listener per active scope** (project `meta/sync` OR inventory `inventory/meta/sync`)
- **delta fetch** for data convergence
- **SQLite local-first** for UI and search

Canonical sync design:

- [`sync_engine_spec.plan.md`](../sync_engine_spec.plan.md)

---

## Guardrail 1: “No large listeners” enforcement

### Policy (team rule)

- Only the scope signal doc may be listened to continuously while a scope is active:
  - project: `accounts/{accountId}/projects/{projectId}/meta/sync`
  - inventory: `accounts/{accountId}/inventory/meta/sync`
- No listeners on:
  - `items`
  - `transactions`
  - `spaces`
  - `attachments`

### Implementation guardrails (client)

- Wrap Firestore SDK access behind a single adapter/module.
- In that adapter:
  - expose `listenToScopeSyncSignal(scope)`
  - disallow generic `onSnapshot(collection(...))` APIs from being called by feature code
- Add runtime assertions in dev builds:
  - if any listener path matches `.../items/*` etc, throw or hard-log as an error.

### Code review checklist

- Any new `onSnapshot` usage must cite this doc and justify why it is not a large collection listener.
- Feature specs should include “listener audit” notes when relevant.

---

## Guardrail 2: Sync latency and correctness telemetry

### Core metrics (client-emitted)

Emit structured events (analytics/log sink) for:

- `sync.signal_listener.attached` / `detached`
- `sync.signal_listener.error`
- `sync.delta.start` / `complete`
  - counts per collection (docs applied)
  - duration (ms)
- `sync.outbox.flush.start` / `complete`
  - ops attempted / succeeded / failed
  - duration (ms)
- `sync.op.failed`
  - error code, retryable flag, entity type
- `sync.conflict.created` / `resolved`

### SLA targets (foregrounded)

- signal-to-delta-start: < 1s typical
- delta duration: < 2s typical for small batches
- end-to-end propagation (two devices): 1–3s typical, < 5s worst (foreground)

---

## Guardrail 3: Firestore cost monitoring

### What drives cost here

- **writes**:
  - entity writes
  - `meta/sync` increments
  - attachment metadata writes
- **reads**:
  - `meta/sync` reads (fanout to foreground collaborators)
  - delta query reads

### Dashboards (minimum)

Create dashboards for:

- Firestore:
  - document reads / writes over time
  - top collections by reads/writes
  - latency/error rates
- Functions:
  - invocations, p95 latency, errors, cold starts
- Storage:
  - bytes stored
  - egress (download) if/when clients view media frequently

### Alerts (minimum)

Alert on:

- sudden spikes in reads (likely accidental listeners)
- sustained high error rate on callable functions
- outbox failure rate > threshold

---

## Guardrail 4: Index and query safety

### Sync queries must stay uniform

- delta sync queries should be limited to predictable shapes (by `updatedAt` + stable tie-breaker).
- feature list views should not add Firestore query patterns to power UI lists; they should be SQLite-powered.

### Index management

- Track required Firestore indexes in a single place (later doc or tooling).
- Treat “missing index in prod” as a release blocker for affected flows.

---

## Guardrail 5: Storage/media cost controls

### Thumbnails and caching

- Generate thumbnails locally for immediate UX.
- Cache aggressively to reduce repeated downloads/egress.

### Attachment lifecycle

- Ensure every uploaded Storage object has a corresponding Firestore `attachments/{id}` doc.
- On delete, consider:
  - tombstone the attachment doc
  - enqueue background cleanup of the Storage object (callable function if needed)

---

## Emulator-based test plan (ops-focused)

Minimum local testing setup:

- Firebase emulators:
  - Auth
  - Firestore
  - Functions
  - Storage

Test cases:

- two-device propagation:
  - device A writes → device B receives within SLA (foreground)
- offline queue:
  - device offline writes 50 ops → reconnect → flush + delta convergence
- conflict creation:
  - both devices update same critical field → conflict recorded + resolvable
- media:
  - offline capture → queued upload → uploaded + linked metadata

---

## Production smoke checks (every release)

- verify only one listener exists per active project
- verify delta runs on resume and after signal change
- verify outbox is durable across app restarts
- verify pending changes UI works (counts, retry)

