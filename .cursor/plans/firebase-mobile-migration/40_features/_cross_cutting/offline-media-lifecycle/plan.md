## Goal
Ship the **offline media lifecycle contract** (local cache + attachment state machine + durable uploads + cleanup) in a way that:

- stays compatible with the migration architecture: **offline-first**, SQLite source of truth, **outbox**, **delta sync**, **change-signal** (no “subscribe to everything”)
- is reusable across features that capture/select attachments (Items, Transactions, Spaces, Settings, Invoice import, etc.)
- does not leak device storage over time (bounded cache + garbage collection)

Spec source of truth:
- `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`

Cross-cutting guardrails dependency (do not redefine thresholds/copy here):
- `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Primary risks (what can go wrong)
- Unbounded storage growth due to missing orphan cleanup paths (cancel, delete, replace, post-upload).
- Upload queue is not durable/idempotent, causing duplicate remote objects or “stuck pending forever” states.
- A design that relies on platform background execution for correctness (must be best-effort only).
- Violating architecture constraints (e.g., adding large listeners or network-dependent UI reads).

## Outputs produced by this work order
Minimum:
- `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md` (canonical contract)
- `40_features/_cross_cutting/offline-media-lifecycle/plan.md` (this file)
- `40_features/_cross_cutting/offline-media-lifecycle/prompt_packs/` (Chats A–D)

## Implementation phases (2–4 slices)

### Phase A — Local media cache + records + UI state contract
**Goal**: establish the local persistence layer and the minimum cross-feature attachment contract.

**What it changes (high level)**
- Define/implement the local media cache location and a durable local media record.
- Define/implement the attachment reference shape/state fields needed for UI to render `local_only` / `uploading` / `uploaded` / `failed`.
- Ensure feature surfaces link domain entities to attachments without requiring network access.

**Exit criteria**
- Selecting/capturing media creates a durable local blob + local record.
- Domain entities can reference attachments locally and render the required state machine.
- Selection-time validation integrates with quota/guardrails (via the guardrails spec), without redefining those rules here.

**Key risks**
- Divergent attachment reference shapes across features (hard to reuse; breaks consistency).
- Local record lifecycle gaps (e.g., losing references on app restart).

### Phase B — Durable upload queue + idempotent processing
**Goal**: make uploads reliable, restart-safe, and safe to retry.

**What it changes (high level)**
- Implement persistent upload jobs with idempotency keys.
- Implement retry classification (retryable vs terminal) and status transitions to drive `uploading`/`failed`.
- Integrate “Retry sync” to also trigger pending media uploads (best-effort; must not be required for correctness).

**Exit criteria**
- Upload jobs survive app restarts and resume/continue when connectivity returns.
- Idempotency prevents duplicate remote objects/attachments when retries occur.
- Failures produce explicit `failed` UI states with a retry path.

**Key risks**
- Non-idempotent remote writes (duplicate objects, inconsistent attachment references).
- Platform constraints (background tasks, connectivity) causing “never completes” if not handled with foreground retry.

### Phase C — Cleanup + garbage collection + bounded cache behavior
**Goal**: prevent storage leaks and handle orphans deterministically.

**What it changes (high level)**
- Implement cleanup triggers for cancel/delete/replace/post-upload.
- Implement best-effort garbage collection that removes unreferenced blobs/jobs eventually.
- Define/implement bounded-cache policy for retained local blobs (if retention is chosen).

**Exit criteria**
- Orphaned blobs/jobs are eventually removed (best-effort GC exists and runs).
- Deleting/replacing attachments does not leave storage and queue artifacts behind.
- Post-upload behavior is bounded (either delete-on-upload or retain-with-policy).

**Key risks**
- Missing reference tracking (hard to know what is safe to delete).
- GC that is too aggressive (deletes still-needed local-only media) or too weak (leaks).

### Phase D — Hardening (edge-case audit + tests)
**Goal**: reduce regression risk and ensure cross-feature consistency.

**What it changes (high level)**
- Add targeted tests for state transitions and cleanup invariants.
- Audit edge cases: entity delete mid-upload, app restart during upload, repeated retries, permission/terminal failures.

**Exit criteria**
- Tests cover the required state machine and key cleanup scenarios.
- Documented behavior exists for terminal vs retryable failures and for “Retry sync” behavior.

**Key risks**
- Cross-feature drift (one feature handles states/cleanup differently).
- Silent failures where UI never updates from `uploading`/`local_only`.

