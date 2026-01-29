# Prompt Pack — Chat A: Web parity inventory (SW + background sync)

## Goal
Extract the **actual** web behavior of “PWA/service worker/background sync” and translate it into:
- parity evidence bullets we can cite in this feature’s docs
- an explicit list of intentional deltas for React Native + Firebase

## Outputs (required)
Update or create the following docs:
- `40_features/pwa-service-worker-and-background-sync/feature_spec.md`
- `40_features/pwa-service-worker-and-background-sync/acceptance_criteria.md`

## Source-of-truth code pointers
Primary:
- `public/sw-custom.js`
- `src/services/serviceWorker.ts`

Related:
- `src/services/operationQueue.ts` (SW delegates queue processing to foreground clients)
- `src/components/SyncStatus.tsx` (how background vs foreground sync status is surfaced)

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include:
- **Observed in**: file + function/section name, OR
- **Intentional delta**: what changes + why

