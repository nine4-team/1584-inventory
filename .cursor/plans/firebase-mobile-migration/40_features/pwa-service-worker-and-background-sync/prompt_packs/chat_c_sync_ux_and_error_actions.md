# Prompt Pack — Chat C: Sync UX + error actions (better than “Retry” everywhere)

## Goal
Align the user-visible sync experience with the new architecture:
- automatic-first syncing
- manual controls only when actionable
- error states that guide the right fix (not just “try again”)

## Outputs (required)
Update or create the following docs:
- `40_features/pwa-service-worker-and-background-sync/feature_spec.md`
- `40_features/pwa-service-worker-and-background-sync/acceptance_criteria.md`

If needed for cross-link consistency:
- `40_features/connectivity-and-sync-status/feature_spec.md` (only if conflicts arise)

## Source-of-truth evidence (web)
- `src/components/SyncStatus.tsx` (banner logic; offline messaging; error gating)
- `src/services/syncScheduler.ts` (retry scheduling patterns)
- `src/components/ui/RetrySyncButton.tsx` (manual trigger semantics)

## Evidence rule
If we change UX promises from web parity, call it out as an **intentional delta** (what + why), and ensure it remains compatible with local-first + outbox + delta + change-signal.

