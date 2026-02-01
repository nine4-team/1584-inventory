# Prompt Pack — Chat D: Tests + edge-case audit

## Goal
Add acceptance criteria / test cases to reduce regression risk and prevent bypass of server-owned limits.

## Outputs (required)
Create (if helpful) or update:

- `40_features/_cross_cutting/billing-and-entitlements/acceptance_criteria.md`

Optional:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md` (to link test cases)

## Inputs to review (source of truth)
- Definition of done: `40_features/_authoring/templates/definition_of_done.md`
- Security model: `10_architecture/security_model.md`
- Sync invariants: `40_features/sync_engine_spec.plan.md`

## What to capture
- Free vs pro allow/deny matrix for create project/item/transaction
- Boundary cases (at limit, over limit)
- Offline cases (no cache, stale cache, cache present and under-limit)
- “After purchase” retry behavior (online only)

