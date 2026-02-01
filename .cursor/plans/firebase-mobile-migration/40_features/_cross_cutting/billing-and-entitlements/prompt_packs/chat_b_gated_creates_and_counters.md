# Prompt Pack — Chat B: Gated creates + server-owned counters

## Goal
Specify the callable Function + counter enforcement strategy for the free-tier limits.

## Outputs (required)
Update:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`

Optional (only if needed):

- `40_features/_cross_cutting/billing-and-entitlements/acceptance_criteria.md`

## Inputs to review (source of truth)
- Security model callable guidance: `10_architecture/security_model.md`
- Sync + idempotency + change-signal constraints: `40_features/sync_engine_spec.plan.md`
- Projects create delta requirements:
  - `40_features/projects/feature_spec.md` (createProject callable + meta/sync update)

## What to capture
- Server-owned counters shape:
  - `accounts/{accountId}/stats` (`projectCount`, `itemCount`, `transactionCount`)
- Required callable operations:
  - `createProject` (required)
  - `createItem`, `createTransaction` (planned)
- Idempotency expectations + meta/sync update semantics

## Evidence rule (anti-hallucination)
Net-new feature: cite architecture docs and label intentional deltas.

