---
name: ""
overview: ""
todos: []
isProject: false
---

## Firebase RN Offline-First + Delta Sync + Change Signal Plan

**Status**: Draft (ready to implement)

**Last updated**: 2026-01-25

**Goal**: React Native mobile app with **local-first correctness** and **cross-user propagation within ~1–3 seconds while foregrounded** using **delta sync + a tiny change signal** (no subscribing to large collections).

This plan is explicitly informed by the current Ledger web app implementation:

- Local DB as source of truth (`offlineStore`)
- Explicit outbox (`operationQueue`) + scheduler (`syncScheduler`)
- Explicit conflict detection + persisted conflicts (`conflictDetector`, `conflictResolver`)
- Offline media placeholder + upload processing (`offlineMediaService`, placeholder URLs)

---

## Requirements (restated plainly)

- **Local-first**: editing user sees changes immediately from local DB.
- **Fast propagation while online + foregrounded**: other users on the same account/project see changes within ~1–3s typical, <5s worst, without manual refresh.
- **Offline is normal**: create/update/delete items and transactions offline; attach receipts/photos offline.
- **Instant search**: local search must be instant at **1,000–10,000 items**. (Amendment: **prefix search is OK**.)
- **Cost control**: no “subscribe to all items/transactions”; avoid read amplification.
- **Entities**: accounts, projects, transactions, items, spaces, media attachments (images + PDFs).
- **Collaboration**: 2+ users concurrently per account/project.
- **Migration**: single existing customer today; no need for web+mobile cross-backend collaboration during rollout.

---

## 1) Target architecture overview

### High-level flow (diagram-like)

React Native UI

→ reads/writes only to Local DB (SQLite)

→ writes create Outbox ops

Outbox Processor (foreground; optional background best-effort)

→ applies ops to Firestore (batched)

→ updates small Change Signal doc per project

Change Signal Listener (1 per active project)

→ on signal change, run Delta Fetch (small targeted queries)

→ apply patches to Local DB

Media path

→ store files locally + queue uploads

→ upload to Firebase Storage (resumable)

→ write attachment metadata to Firestore + update parent references

### Firebase services used

- **Firestore**: canonical entity docs + `meta/sync` change signal.
- **Firebase Auth**: user identity and membership.
- **Firebase Storage**: receipts/images/PDFs.
- **Cloud Functions (Callable + optional triggers)**: server-owned invariants and rollups; optional backstop for change signal.

---

## 2) Local persistence strategy (React Native)

### Recommendation: SQLite + FTS (prefix search) + outbox tables

Use SQLite as the device source of truth (mirrors your web `offlineStore` design), because:

- You already operate with an explicit outbox and local canonical state.
- You need instant search/filtering across 1k–10k items and multiple fields.
- You want to avoid Firestore listeners over large collections.

### Suggested libraries (implementation detail)

- SQLite driver with strong performance and transactions (e.g., `react-native-quick-sqlite`).
- Optional small KV store for tiny sync state (e.g., MMKV), but SQLite-only is fine.

### Local schema (conceptual)

Core tables:

- `accounts(id, ...)`
- `projects(id, accountId, ..., updatedAtServer, deletedAtServer, localPending, baseVersion, lastMutationId, ...)`
- `items(id, accountId, projectId, transactionId, spaceId, ..., updatedAtServer, deletedAtServer, localPending, baseVersion, lastMutationId, ...)`
- `transactions(id, accountId, projectId, ..., updatedAtServer, deletedAtServer, localPending, baseVersion, lastMutationId, ...)`
- `spaces(id, accountId, projectId, ..., updatedAtServer, deletedAtServer, localPending, baseVersion, lastMutationId, ...)`
- `attachments(id, accountId, projectId, parentType, parentId, storagePath, mimeType, size, sha256, localUri, uploadState, ...)`

System tables:

- `outbox_ops(opId, accountId, projectId, entityType, entityId, opType, payloadJson, createdAtLocal, attemptCount, lastError, state)`
- `conflicts(conflictId, accountId, projectId, entityType, entityId, field, localJson, serverJson, createdAt, resolvedAt, resolution)`
- `sync_state(accountId, projectId, collection, cursorUpdatedAt, cursorDocId, lastSeenSeq, updatedAtLocal)`

### UI source of truth + pending writes

- UI renders from SQLite only.
- Mark rows with `localPending=1` while outbox has unsent ops for that entity.
- Clear `localPending` only when the server state for that entity confirms (via `lastMutationId` match or a successful write ack).

---

## 3) Delta sync design (plain language)

### Canonical fields required on each Firestore doc

For each entity doc (projects/items/transactions/spaces/attachments):

- `accountId` (string)
- `projectId` (string) where applicable
- `updatedAt` (Firestore server timestamp)
- `deletedAt` (Firestore server timestamp | null)
- `version` (number; increments every accepted change)
- `updatedBy` (uid)
- `lastMutationId` (string; idempotency key from outbox op)
- `schemaVersion` (number; optional but recommended)

### Deletes (tombstones, explained)

Instead of immediately deleting a document, we mark it deleted so every device can “learn about the delete” via delta sync.

- On delete: set `deletedAt = serverTimestamp()`, also update `updatedAt`, increment `version`, set `lastMutationId`.
- Clients: when delta sync sees `deletedAt != null`, remove from local DB (or mark deleted locally).
- Cleanup: optional TTL or scheduled cleanup after N days (30–90) to remove old tombstones.

### Initial sync vs incremental sync

- **Initial sync** (first time on a project): fetch each collection ordered by `updatedAt` ascending, in pages.
- **Incremental sync**: fetch “docs updated after my last checkpoint” (cursor).

### Cursor design (to avoid missing docs)

Store a cursor per collection as:

- `cursorUpdatedAt` (timestamp)
- `cursorDocId` (string)

Why: multiple docs can share the same `updatedAt`; ordering by `(updatedAt, docId)` ensures stable paging.

### Idempotency + retries

- Applying deltas to SQLite is idempotent (upsert by primary key; delete-if-exists).
- Outbox ops are idempotent by `lastMutationId`.

---

## 4) Fast cross-user propagation within seconds (foreground-only SLA)

### The change signal doc (one tiny listener per active project)

Document:

`accounts/{accountId}/projects/{projectId}/meta/sync`

Fields:

- `seq` (number; monotonic)
- `changedAt` (server timestamp)
- `byCollection` (map of collection -> seq), e.g. `items`, `transactions`, `spaces`, `attachments`, `projects`

Example:

```json
{
  "seq": 10233,
  "changedAt": "serverTimestamp",
  "byCollection": { "items": 4311, "transactions": 5874, "spaces": 92, "attachments": 201, "projects": 17 }
}
```

### How the signal updates for every mutation (recommended)

**Preferred**: update the signal client-side in the same batched write as the mutation.

- Pros: fastest latency (no function cold start), simplest path to 1–3 seconds.
- Cons: security rules must allow safe `increment()` updates only for authorized project members.

**Optional backstop**: Cloud Function trigger to update the signal.

- Pros: catches any writes even if a buggy client forgets.
- Cons: extra latency and ops complexity; at-least-once triggers can over-increment (harmless but causes extra delta runs).

### Client behavior

When a project is active and app is foregrounded:

- attach exactly **one** listener to `meta/sync`
- on change, run targeted delta fetch for only collections whose `byCollection[...]` advanced
- apply to SQLite
- update `lastSeenSeq` per collection

When app backgrounded:

- stop listening

On resume/open:

- do one delta sync pass immediately, then attach listener

### Meeting 1–3 seconds typical

- Listener delivery is typically sub-second.
- Delta queries are small (only since cursor), typically a handful of docs.
- SQLite apply is local, transaction-batched.

---

## 5) Write path / offline queue

### Model: keep the explicit outbox (matches current web design)

Do not rely on “subscribe-to-everything” Firestore client cache. Instead:

- UI writes go to SQLite immediately
- an outbox op is recorded and later flushed to Firestore when online

### Preventing double-writes on reconnect

- Each op has `opId`
- Every Firestore mutation writes `lastMutationId = opId`
- If the same op is retried, it becomes a safe overwrite and can be detected as already applied

### Batching

Batch entity write(s) + `meta/sync` update together.

For multi-doc operations (e.g., item allocation/sale), use Callable Function (see §7).

---

## 6) Conflict handling (no jargon)

### Default behavior (recommended)

- For most fields (name, description, notes, space assignment): “latest change becomes official,” and keep an audit log.
- For critical money/reporting fields (transaction amount, category, tax): do **not** silently overwrite if remote changed since you last saw it.

### Concrete mechanism

Store `baseVersion` on local edits (the server version at edit start).

When flushing an UPDATE:

- if server `version` changed since `baseVersion`, create a conflict record locally and surface a simple conflict UI:
  - choose “mine” or “theirs”
  - optionally merge for text fields (notes/description)

Preserve your current “don’t block UPDATE forever” principle: updates can proceed, but critical-field collisions must be visible and resolvable.

---

## 7) Server-owned invariants / derived data (correctness without read explosions)

Based on current web code patterns (canonical transaction ids, lineage pointers, rollups), these should be server-owned:

- project rollups: counts/totals
- lineage pointers: origin/latest, canonical relationships
- inventory allocation/sale flows that touch multiple docs

### Implementation

- Use **Callable Cloud Functions** for multi-doc operations so updates are atomic and correct.
- Function runs a Firestore transaction:
  - reads minimal required docs
  - writes updated docs
  - updates `meta/sync` once

Avoid doing client-side “recompute everything” loops that cause extra reads.

---

## 8) Media (Firebase Storage) offline strategy

Your web app already does offline media placeholders. Mobile should do the same, but store files on-device.

### Local handling

- Store captured media in app file storage (local filesystem).
- Insert attachment metadata into SQLite immediately.
- If offline: queue upload in `media_uploads`.

### Upload processing

- Use resumable uploads with retries/backoff.
- On successful upload:
  - write `attachments/{attachmentId}` in Firestore (storagePath, size, mimeType, sha256, uploadedAt)
  - link it to parent entity (item/transaction/space) via attachment reference(s)
  - update `meta/sync` in the same write batch

### Thumbnails + caching

- Generate small thumbnails locally for immediate UX.
- Optionally generate server thumbnails via Storage trigger if needed later.
- Cache thumbnails aggressively to control egress.

---

## 9) Cost model + cost-control plan (numbers with your workload)

### Key cost drivers

- **Change signal fanout**: each signal update is read by each foreground listener.
- **Delta fetch reads**: docs returned by delta queries.
- **Writes**: entity writes + signal updates (+ any rollup/invariant writes).

### Your estimated monthly workload per project

Assumptions per project-month:

- items created: 1,000–2,000
- items edited: ~10% = 100–200 (not counting space assignment edits; see note below)
- transactions: 40–50 (some edits)
- spaces: 7–14 (some edits)
- media files:
  - item: ~2 each ⇒ 2,000–4,000
  - transaction: ~2 each ⇒ 80–100
  - space: ~10 each ⇒ 70–140
  - total media objects ⇒ ~2,150–4,240

Important note: each item being “associated with a space and a transaction” should NOT require updating arrays on transactions/spaces if we model relationships via `item.transactionId` and `item.spaceId` (recommended). That reduces writes and conflicts significantly.

### Firestore writes (rough order-of-magnitude)

Per item creation:

- 1 write to `items/{itemId}`
- 1 write to `meta/sync` (batched)

= 2 writes

So for 1,000–2,000 items:

- ~2,000–4,000 writes/month (items + signal)

Media:

Uploading to Storage is separate from Firestore. In Firestore:

- 1 write to `attachments/{attachmentId}` per file
- optionally 1 update to parent doc reference list (can often be avoided by querying attachments by parentId in local DB)
- 1 signal update (batched)

So 2,150–4,240 attachments:

- ~4,300–8,480 writes/month if you do (attachment + signal) only

Total rough writes/month/project:

- items: 2,000–4,000
- attachments: 4,300–8,480
- plus transactions/spaces/edits: smaller compared to media+items

### Firestore reads (rough order-of-magnitude)

Foreground listeners:

- 1 read per signal change per foreground collaborator.
- If most activity is a single active user, fanout is low.

Delta reads:

- roughly “number of changed docs returned to each other online collaborator during active time.”

Cost-control levers (baked into design):

- exactly one listener per active project (`meta/sync`)
- no listeners on large collections
- delta fetch only on signal change
- model relationships via foreign keys on `items` instead of updating large arrays
- stop listeners when backgrounded

If signal fanout ever becomes a problem at scale, the next step is to move the signal to RTDB (bandwidth-billed) while keeping Firestore for deltas.

---

## 10) Migration / rollout plan (your situation: single customer)

### Staged plan

1) Build the RN app on Firebase with the new sync architecture.

2) Create a one-time Postgres → Firestore migration for the existing customer.

3) Validate correctness (counts, spot checks, reconciliation reports).

4) Cut over customer usage to the new mobile + Firebase backend.

5) Optionally migrate the web app later (not required for initial rollout).

### Data migration details

- Use your business identifiers as document ids where possible:
  - items: current `itemId` (business id) → Firestore doc id
  - transactions: `transactionId` → Firestore doc id
- Backfill:
  - `updatedAt` from `last_updated/updated_at`
  - `deletedAt` for soft deletes (if applicable)
  - initial `version`
- Verification:
  - item counts per project
  - transaction counts per project
  - a reconciliation export that compares key fields between Postgres and Firestore

---

## 11) Testing plan

Must include automated tests in emulators plus manual “real device” smoke tests.

### Scenarios

- Offline create/update/delete items and transactions; restart app; ensure state persists.
- Reconnect: outbox flushes exactly once; pending flags clear.
- Two devices foregrounded:
  - device A edits
  - device B updates within 1–3 seconds typical, <5 seconds worst
- Conflict scenarios:
  - both edit same transaction amount while offline
  - reconnect and verify conflict UI + correct final state
- Media:
  - attach while offline
  - resume upload on reconnect
  - ensure other device sees attachment metadata quickly
- Load tests:
  - 10k items local DB search/prefix filtering remains instant

---

## 12) Implementation milestones (numbered with acceptance criteria + risks)

1) **Firestore schema + security rules**

   - Acceptance: authorized project members can read/write; only safe updates to `meta/sync`.
   - Risk: rules complexity around increments and membership checks.

2) **SQLite schema + indexing (prefix search + filters)**

   - Acceptance: 10k items list filter + prefix search stays responsive (<100ms typical query time).
   - Risk: schema migrations on mobile; ensure backward compatibility.

3) **Outbox + optimistic local writes (port your current model)**

   - Acceptance: offline create/update/delete works with app restarts; ops retry with backoff.
   - Risk: background execution constraints; keep reliable foreground behavior first.

4) **Firestore write layer (batched entity write + meta/sync)**

   - Acceptance: single mutation updates other device within SLA while foregrounded.
   - Risk: idempotency and retry safety; ensure `lastMutationId` is written.

5) **Delta sync fetch + apply**

   - Acceptance: cursor correctness (no missed docs); applies in SQLite transactions.
   - Risk: cursor edge cases when multiple docs share same timestamp.

6) **Signal listener (one per active project)**

   - Acceptance: no subscriptions to large collections; listener stops on background.
   - Risk: burst changes; implement debounce + “catch up until current seq.”

7) **Conflict subsystem**

   - Acceptance: critical fields do not get silently overwritten; conflict records persist; resolution UI updates local+server.
   - Risk: too many conflicts if versioning rules are inconsistent; tune critical-field list.

8) **Server-owned invariants (Callable Functions)**

   - Acceptance: multi-doc ops (allocate/sell/deallocate) remain correct under concurrency.
   - Risk: function latency; keep payloads minimal and avoid extra reads.

9) **Media pipeline (offline queue + resumable upload + attachment docs)**

   - Acceptance: offline capture and later upload works; attachment appears on other device.
   - Risk: storage egress; implement thumbnails + caching early.

10) **Migration tooling + verification**

   - Acceptance: 100% of existing customer data migrated and verified.
   - Risk: field mapping; timestamps; ensure `updatedAt` is correct for delta sync.

11) **Instrumentation + cost dashboards**

   - Acceptance: can measure reads/writes per project and detect regressions (accidental listeners).
   - Risk: invisible cost creep without guardrails; add runtime checks for listeners.

---

## Appendix A: Example Firestore structure

```
accounts/{accountId}
accounts/{accountId}/members/{uid}

accounts/{accountId}/projects/{projectId}
accounts/{accountId}/projects/{projectId}/meta/sync
accounts/{accountId}/projects/{projectId}/items/{itemId}
accounts/{accountId}/projects/{projectId}/transactions/{transactionId}
accounts/{accountId}/projects/{projectId}/spaces/{spaceId}
accounts/{accountId}/projects/{projectId}/attachments/{attachmentId}
```

---

## Appendix B: Pseudocode (signal listener + delta sync)

### Signal listener (one per active project)

```ts
function startProjectListener(accountId: string, projectId: string) {
  const ref = doc(`accounts/${accountId}/projects/${projectId}/meta/sync`)

  return onSnapshot(ref, (snap) => {
    const signal = snap.data()
    if (!signal) return

    // debounce/coalesce (e.g., 200ms)
    enqueue(async () => {
      const state = await loadSyncState(accountId, projectId)

      for (const collection of ["items","transactions","spaces","attachments","projects"] as const) {
        if ((signal.byCollection?.[collection] ?? 0) > (state.lastSeenSeq?.[collection] ?? 0)) {
          await deltaSyncCollection(accountId, projectId, collection, state.cursor[collection])
          state.lastSeenSeq[collection] = signal.byCollection[collection]
        }
      }

      await saveSyncState(accountId, projectId, state)
    })
  })
}
```

### Delta sync loop (paged by updatedAt + docId)

```ts


async function deltaSyncCollection(accountId: string, projectId: string, collection: string, cursor: { at: Timestamp; id: string }) {
  let lastAt = cursor.at
  let lastId = cursor.id

  while (true) {
    const q = query(
      collectionRef(accountId, projectId, collection),
      orderBy("updatedAt", "asc"),
      orderBy(documentId(), "asc"),
      startAfter(lastAt, lastId),
      limit(500)
    )

    const page = await getDocs(q)
    if (page.empty) break

    const patches = page.docs.map(d => ({ id: d.id, ...d.data() }))

    await sqlite.transaction(tx => applyPatches(tx, collection, patches))

    const last = page.docs[page.docs.length - 1]
    lastAt = last.data().updatedAt
    lastId = last.id
    await saveCursor(accountId, projectId, collection, { at: lastAt, id: lastId })
  }
}
```