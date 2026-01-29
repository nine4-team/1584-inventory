# PWA service worker + background sync (Web parity) → Mobile background execution + sync scheduling (RN/Firebase)

This feature captures the **existing web app’s** PWA/service-worker behavior (offline navigation + background retry) and specifies the **React Native + Firebase equivalent**.

Key migration delta:
- **React Native has no Service Worker**. We do **not** port the mechanism.
- We **do** preserve (and improve) the user-facing promise: local-first correctness + automatic sync attempts + clear “needs attention” UX, without introducing expensive background polling or large listeners.

## Inputs (source of truth)
- Sync engine architecture (canonical): `40_features/sync_engine_spec.plan.md`
- Global sync UX (banner/toasts): `40_features/connectivity-and-sync-status/feature_spec.md`
- Web parity evidence:
  - Service worker orchestration: `public/sw-custom.js`
  - SW bridge + manual trigger + event bus: `src/services/serviceWorker.ts`
  - Outbox processing (delegated by SW): `src/services/operationQueue.ts`
  - Sync banner wiring: `src/components/SyncStatus.tsx`

## Outputs (this folder)
- `feature_spec.md`
- `acceptance_criteria.md`
- `plan.md`

