# `NetworkStatus` (global connectivity banner) — contract

## Purpose
Make connectivity state legible without blocking the UI.

## Inputs (state)
- `isOnline: boolean`
- `isSlowConnection: boolean`

Parity evidence:
- `src/components/NetworkStatus.tsx`
- `src/hooks/useNetworkState.ts`
- `src/services/networkStatusService.ts`

## Render rules
- If `!isOnline`: render a fixed top banner:
  - copy: **“Offline - Changes will sync when reconnected”**
- Else if `isSlowConnection`: render a fixed top banner:
  - copy: **“Slow connection detected”**
- Else: render nothing.

## Non-goals
- Do not display per-project “stale channel” telemetry in the UI (web computes it but does not render it).

