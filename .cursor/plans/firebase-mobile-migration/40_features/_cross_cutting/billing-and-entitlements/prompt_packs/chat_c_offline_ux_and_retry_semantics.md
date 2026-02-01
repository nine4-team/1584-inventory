# Prompt Pack — Chat C: Offline UX + retry semantics

## Goal
Make offline behavior and upgrade retry semantics explicit and consistent for gated actions.

## Outputs (required)
Update:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`

## Inputs to review (source of truth)
- Offline-first + outbox + delta sync: `40_features/sync_engine_spec.plan.md`
- Projects create screen contract references this doc:
  - `40_features/projects/ui/screens/ProjectsList.md`

## What to capture
- Offline policy:
  - allow only if cached entitlements + cached stats prove under-limit
  - otherwise block and instruct to go online to verify/upgrade
- Online policy:
  - when blocked, show upgrade CTA
  - after purchase, refresh entitlements snapshot and retry blocked operation

