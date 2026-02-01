# Prompt Pack — Chat A: Data model + entitlements snapshot (RevenueCat)

## Goal
Specify the canonical Firestore **enforcement snapshot** for entitlements (free vs pro) and the minimal RevenueCat integration contract.

## Outputs (required)
Update or create:

- `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`
- `40_features/_cross_cutting/billing-and-entitlements/plan.md`

## Inputs to review (source of truth)
- Migration workflow: `40_features/_authoring/feature_speccing_workflow.md`
- Security model (membership + rules/function boundaries): `10_architecture/security_model.md`
- Feature list C3: `40_features/feature_list.md`

## Required decisions (already made)
- Plan types: `free`, `pro`
- Limits (free tier):
  - `maxProjects = 1`
  - `maxItems = 20`
  - `maxTransactions = 5`

## What to capture
- Firestore path and field shape for:
  - `accounts/{accountId}/entitlements/current`
- “Server-owned only” write policy and client read policy
- Minimal provider audit fields aligned to RevenueCat (don’t mirror the full provider object)

## Evidence rule (anti-hallucination)
This is net-new; label non-obvious behaviors as **intentional deltas** and cross-link the canonical sources above.

