# Prompt Pack — Chat B: Mobile background execution policy + cost guardrails

## Goal
Specify a mobile background execution policy that is:
- **safe to skip** (foreground path guarantees correctness)
- **not expensive** (bounded work; no polling; no background listeners)
- aligned with the change-signal + delta approach

## Outputs (required)
Update or create the following docs:
- `40_features/pwa-service-worker-and-background-sync/feature_spec.md`
- `40_features/pwa-service-worker-and-background-sync/acceptance_criteria.md`

## Inputs (source of truth)
- `40_features/sync_engine_spec.plan.md`
- `40_features/connectivity-and-sync-status/feature_spec.md`

## What to decide (capture as spec)
- Definition of a bounded “sync work unit”
- Backoff rules and stop conditions
- Telemetry needed to detect cost creep
- Any platform notes (iOS/Android) that constrain guarantees (without prescribing libraries)

## Evidence rule
Anything that is a platform constraint should be written as an **intentional delta** with a short rationale.

