# Prompt Pack — Chat C: Cleanup / orphan GC + quota integration + bounded cache

## Goal
Implement Phase C of the offline media lifecycle:

- cleanup triggers for cancel/delete/replace/post-upload
- best-effort garbage collection for unreferenced blobs/jobs
- quota/guardrails integration points (selection-time and/or local-save-time) without redefining thresholds/copy

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`
- Guardrails subcomponent (referenced by the spec): `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Outputs (required)
- Implement cleanup behaviors for:
  - user cancels selection after local save
  - entity delete while attachments are `local_only` or `uploading`
  - attachment replaced (new primary image, removed receipt, etc.)
  - upload succeeded (delete-on-upload OR retain-with-bounded-policy; either is acceptable but must be bounded)
- Implement best-effort garbage collection that eventually removes unreferenced blobs/jobs.
- Integrate quota/guardrails at the correct points (selection time and/or local-save time) per the spec.

## Constraints
- Must not leak storage over time.
- Cleanup/GC must be best-effort and must not depend on always-running background tasks.
- Do not introduce a full “manage offline storage” UI (explicit non-goal).
- Do not redefine thresholds/copy from the guardrails spec; reuse it.

## Edge cases (must be explicit)
- Delete entity mid-upload: ensure remote attach does not resurrect a deleted attachment reference.
- Replace attachment while previous upload is in-flight: define which one “wins” and how the loser is cleaned up.
- “Dangling jobs”: upload jobs whose owning entity reference no longer exists.
- “Dangling blobs”: blobs that exist but no attachment reference points to them.
- Bounded cache policy:
  - if retaining local blobs post-upload, define eviction triggers (age/size/last-access) so growth is bounded.

