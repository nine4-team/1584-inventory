# Offline Item Creation Diagnosis (Rev 2)

## TL;DR
Creating an item offline currently fails for two independent reasons:

1. **Design issue** – The operation queue refuses to run *any* operation while `conflictDetector` reports unresolved conflicts for the project (`executeOperation` returns early and the queue keeps retrying). The offline create never reaches Supabase until the user manually clears every conflict, even if those conflicts belong to unrelated items.
2. **Implementation issue** – `offlineItemService.createItem` enqueues the CREATE operation *before* persisting the optimistic item to IndexedDB. If `offlineStore.saveItems` throws (quota, initialization failure, tab closes, etc.), the queue is left with a pointer to an item that was never saved. When conflicts are finally cleared, `executeCreateItem` cannot find the payload and the operation dies with `local item I-… not found in offline store`.

The log stream provided by QA shows both problems back-to-back, which is why the experience deteriorates into repeated conflict banners followed by a permanent failure after “Resolve all.”

---

## Evidence Walkthrough

| Phase | Observations | Interpretation |
| --- | --- | --- |
| Offline attempt | Network stack logs multiple `net::ERR_INTERNET_DISCONNECTED` failures while Add Item loads vendor defaults and project context. There are **no** IndexedDB errors or user-visible failures when `Create` is tapped. | The CREATE operation was queued and the UI assumed the optimistic item existed locally. |
| Reconnect | Every sync attempt logs `Conflicts detected, blocking operation execution` followed by retries (`operationQueue.ts:397/350`). | `operationQueue.executeOperation` exits early whenever `conflictDetector.detectConflicts(projectId)` returns non‑zero, so the CREATE never runs while legacy conflicts exist. |
| After “Resolve all” | Queue resumes, but `executeCreateItem` immediately logs `Cannot create item: local item I-1767378821705-c9sr not found in offline store` and the operation is marked permanently failed after several retries. | When the CREATE finally runs, the referenced item is missing from IndexedDB, so Supabase never receives the payload. |

---

## Findings

### 1. Conflict gating blocks unrelated operations (design flaw)
- `executeOperation` always invokes `conflictDetector.detectConflicts(projectId)` for the project associated with the head-of-queue operation. A non-empty response short-circuits the entire execution path and the queue just retries later.
- In practice this means **any** conflict on project `P` freezes **all** pending operations for `P`, even if they target completely different items (including brand-new creates that have no conflicts yet).
- In the reproduced session the queue was stuck in this loop until the user clicked “Resolve all,” which explains the repeated warnings and lack of progress while back online.
- This behavior contradicts the offline UX goal: a user cannot sync fresh work until they clean up historical conflicts, so “offline create” is effectively disabled for accounts with unresolved data drift.

### 2. CREATE operation is persisted before the optimistic item (implementation flaw)
- In `offlineItemService.createItem`, `operationQueue.add` is called **before** `offlineStore.saveItems([tempItem])` (lines `122‑166` of the service).
- If `saveItems` throws (e.g., IndexedDB unavailable, quota exceeded, tab unloads mid-transaction), the promise rejects, but the queued operation is already durable in the `operations` store. Nothing rolls it back.
- Later, when the queue finally processes the CREATE, `executeCreateItem` looks up the payload via `offlineStore.getItemById(data.id)` (line `443`). The missing record produces the exact error seen in the log: `local item … not found`.
- Because the failure happens long after the UI reported success, the user has no way to retry without clearing the operation queue manually. The emitted error is also swallowed by the retry logic until it hits the “permanent failure” threshold.

### 3. Instrumentation blind spots hide IndexedDB failures
- `offlineStore.init()` errors are explicitly swallowed (`await offlineStore.init().catch(() => {})`), so we never log when IndexedDB is unavailable.
- `saveItems` does not verify that `this.db` exists or that the transaction completes; any exception surfaces only after the operation queue has been mutated.
- Neither the Add Item screen nor the offline service reports failures back to the user, so QA can only infer that something went wrong when the queue later crashes.

---

## Root Cause Statement

> Offline item creation fails because (a) the queue architecture blocks CREATE operations whenever unrelated conflicts exist for the same project, so the new operation never executes until the user resolves old conflicts; and (b) once conflicts are cleared, the queued CREATE references an optimistic item that was never persisted to IndexedDB because the enqueue happened before the save, leading `executeCreateItem` to error with “local item … not found.”

Both issues are required to reproduce the reported behavior, which is why this is rated as **design + implementation** problem rather than a single logic bug.

---

## Recommendations

### A. Decouple conflict handling from unrelated operations (design fix – high priority)
1. Restrict the “conflict gate” to operations that touch items already known to be in conflict. Options:
   - Keep the existing gate but only block when `operation.data.id` appears in the conflicts table.
   - Allow CREATE operations to bypass the gate entirely; they cannot have server conflicts until after the insert succeeds.
2. Surface conflicts in the UI without freezing the queue. For example, let the queue continue but raise toasts whenever a conflicting UPDATE/DELETE is skipped, so the user can continue syncing non-conflicting work.

### B. Make enqueue + local persistence atomic (implementation fix – high priority)
1. Write the optimistic item to IndexedDB **before** writing to the operations store. Only queue the operation after the `saveItems` transaction completes successfully.
2. If the save fails, propagate a descriptive error back to the Add Item form and do not enqueue anything.
3. Optionally wrap both the item write and the operation write in a single logical transaction (e.g., two-phase approach or a dedicated “pending creates” store) so we never observe one without the other.

### C. Improve diagnostics and recovery (medium priority)
1. Stop swallowing `offlineStore.init` errors; log them and fail fast with a user-facing message (“Offline storage unavailable…”).
2. Add structured logging around `saveItems`/`getItemById` so future QA runs can confirm whether the item actually hit IndexedDB.
3. Extend `executeCreateItem` with a one-time retry that re-fetches the optimistic item (or at least emits a telemetry event) before marking the operation permanently failed.

### D. Regression tests
1. Automated test that simulates an IndexedDB failure (mock `saveItems` to throw) and asserts no CREATE operation remains queued.
2. Integration test ensuring the queue still processes new operations while unrelated conflicts exist, once the gating logic is adjusted.
3. Manual QA checklist covering: offline create with outstanding conflicts, IndexedDB quota exceeded, browser restart between enqueue and reconnect.

---

## Status & Next Steps

| Step | Owner | Notes |
| --- | --- | --- |
| Adjust conflict gate logic so CREATE operations bypass or only block on matching item IDs. | Sync infrastructure | Restores ability to sync new offline work despite legacy conflicts. |
| Reorder `offlineItemService.createItem` so persistence happens before queuing; add rollback/error handling. | Offline service | Prevents orphaned CREATE operations. |
| Add telemetry + user messaging for IndexedDB failures. | Offline service/UI | Gives QA and users actionable feedback instead of silent failures. |
| Re-test scenario: create offline, reconnect with unresolved conflicts, hit “Resolve all,” ensure item syncs to Supabase. | QA | Confirms both fixes work together. |

Priority remains **HIGH** because offline item creation is a flagship requirement for the offline functionality program, and current behavior makes the feature unreliable for any account with lingering conflicts or intermittent IndexedDB failures.
