# Prompt Pack — Chat B: Durable upload queue + idempotent retries

## Goal
Implement Phase B of the offline media lifecycle:

- durable upload queue (survives restarts)
- idempotent upload processing (no duplicate remote objects/attachments)
- retry classification + user-visible retry affordances

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`
- Architecture constraints (referenced by the spec): `sync_engine_spec.plan.md`

## Outputs (required)
- Implement a persistent upload job representation that includes:
  - local media id
  - owning entity reference
  - destination bucket/path strategy inputs (as required)
  - idempotency key
  - durable status needed to drive `uploading`/`failed` UI states
- Implement retry logic:
  - distinguish retryable (network/transient 5xx) vs terminal (permission denied, unsupported file)
  - ensure repeated retries do not create duplicate remote objects/attachments
- Implement triggering behavior:
  - when online, pending jobs run
  - global “Retry sync” also triggers pending media uploads (best-effort; must not be required for correctness)

## Constraints
- Upload work must be durable across app restarts.
- Retries must be safe via idempotency keys.
- Do not assume background execution for correctness; foreground retries must work.
- Keep compatibility with the “no large listeners; delta sync + change-signal” architecture.

## Edge cases (must be explicit)
- App closes mid-upload: expected state on next launch (`uploading` vs `failed` vs resume).
- Connectivity flapping: avoid thrash; ensure eventual completion when stable online.
- Terminal failure cases:
  - permission denied
  - unsupported file types
  - remote rejects content/size
  - ensure UI reaches `failed` with a clear retry/error path.
- Idempotency collisions: how keys are generated so “same attachment” retries are stable, but different attachments do not collide.

