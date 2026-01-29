# Offline media lifecycle (offline cache + uploads + cleanup)

This doc defines the **cross-cutting offline media subsystem** used anywhere the app captures/selects attachments (images, PDFs, etc.).

It is intentionally broader than the UI guardrail docs: it covers the end-to-end lifecycle from **selection** → **local persistence** → **upload queueing** → **remote attachment** → **cleanup**.

## Scope (what this covers)
- **Local media cache**: where selected/captured files are stored when offline (or before upload).
- **Placeholder rendering contract**: how UI represents attachment states (`local_only`, `uploading`, `uploaded`, `failed`).
- **Upload queueing + processing**: what gets queued, when it runs, and how retries/errors work.
- **Cleanup**: orphan removal and “don’t leak storage forever” policies.
- **Quota accounting** (high-level): how we measure and enforce “can we accept more media right now?”

## Non-goals (explicitly out of scope)
- A full “manage offline storage” UI (browse/delete individual cached blobs).
- A detailed background execution spec for React Native (best-effort; must not be required for correctness).
- Choosing exact RN storage libraries/implementations (this doc defines contracts/behavior).

## Compatibility constraints (must obey)
- Must be compatible with `sync_engine_spec.plan.md` (local-first + outbox + delta sync + no read amplification).
- Must work across multiple features consistently (Items, Transactions, Spaces, Settings, Invoice import, QR exports, etc.).

## Core lifecycle (happy path)
1) **User selects/captures a file**
   - Validate file size/type limits (feature-specific) and cross-cutting offline constraints (see “Quota + guardrails” below).
2) **Persist locally**
   - Write the file into the local media cache.
   - Create/update a local media record (metadata: size, localUri/path, checksum if used, timestamps, owning scope).
3) **Link to the domain entity**
   - Create/update the relevant attachment reference on the owning entity (e.g. `item.primaryImage`, `transaction.receipts[]`, `space.images[]`, `businessProfile.logo`).
4) **Enqueue upload work**
   - Enqueue an upload job with an idempotency key and the minimal info required to upload later (local media id, destination bucket/path strategy, owning entity reference).
5) **Upload + remote attach**
   - When online, upload job runs and produces a remote object reference (path/url + metadata).
   - Update the attachment reference to `uploaded`.
6) **Cleanup (post-upload)**
   - Apply policy: keep or delete local cached blob after upload (implementation choice), but **must** prevent unbounded growth over time.

## Required attachment state machine (UI contract)
Any UI surface that renders attachments must handle these states:
- **`local_only`**: file exists locally but not yet uploaded.
- **`uploading`**: upload in progress (or scheduled imminently).
- **`uploaded`**: remote object exists and attachment reference is remote-backed.
- **`failed`**: upload failed; user can retry (and/or system retries).

Additional internal states may exist (e.g. `orphaned`, `deleted`, `purge_pending`), but the UI contract above is the minimum.

## Queueing + retries (behavior)
- Upload work must be **durable** across app restarts (queued jobs persist in local storage).
- Retries should be safe:
  - Use **idempotency** keys so the same job doesn’t create duplicate remote objects/attachments.
  - Distinguish “retryable” (network, transient 5xx) vs “terminal” (permission denied, unsupported file).
- User-visible retry affordances:
  - Feature UIs may expose per-attachment retry.
  - Global “Retry sync” should also trigger pending media uploads (subject to platform constraints).

## Cleanup / orphan handling (must not leak storage)
The subsystem must define a cleanup strategy for:
- **User cancels selection** after local save.
- **Entity delete** while attachments are still `local_only` or `uploading`.
- **Attachment replaced** (new primary image, removed receipt, etc.).
- **Upload succeeded** (optional: remove local blob; or retain with bounded cache policy).

Minimum requirement:
- There must be a best-effort garbage collection step that removes unreferenced blobs/jobs eventually.

## Quota + guardrails (subcomponent)
Selection-time validation and global warnings are specified separately as a reusable UI/validation contract:
- `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

This lifecycle doc defines **where** those rules apply (at selection time and/or local-save time) but does not redefine thresholds/copy.

## Platform notes (migration relevance)
- **Web parity** uses IndexedDB-backed storage and a heuristic quota estimate (see evidence below).
- **React Native** must use platform-appropriate file storage + accounting. Do **not** assume a fixed 50MB limit.
- Regardless of platform, keep the **user-facing semantics** stable:
  - Warnings at “getting full”
  - Hard block before the system becomes unstable (near-full/offline selection gating)
  - Clear retry/error messaging

## Parity evidence pointers (current web app)
Primary sources:
- Local storage accounting and media persistence:
  - `src/services/offlineStore.ts`
  - `src/services/offlineMediaService.ts`
  - `src/services/offlineAwareImageService.ts`
- Attachment selection UI + offline gating integration:
  - `src/components/ui/ImageUpload.tsx`
- Global warning banner:
  - `src/components/ui/StorageQuotaWarning.tsx` (mounted in `src/App.tsx`)

