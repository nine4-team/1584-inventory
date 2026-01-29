# Prompt Pack — Chat A: Business inventory home (tabs + refresh + state restore)

## Goal
Produce a parity-grade spec pass for the **Business inventory home** screen (tab shell + refresh + list state persistence + scroll restoration), grounded in the existing web app, while noting Firebase mobile deltas.

## Outputs (required)
Update or create:
- `40_features/business-inventory/feature_spec.md` (home shell sections)
- `40_features/business-inventory/acceptance_criteria.md` (home shell criteria)
- `40_features/business-inventory/ui/screens/BusinessInventoryHome.md` (screen contract)

## Source-of-truth code pointers (parity evidence)
- Business inventory workspace shell + URL persistence + scroll restoration + refresh:
  - `src/pages/BusinessInventory.tsx`
- Business inventory snapshot lifecycle (web realtime/hydration concept):
  - `src/contexts/BusinessInventoryRealtimeContext.tsx`

## Cross-cutting constraints
- Offline-first + outbox + delta sync + change-signal (no large listeners): `40_features/sync_engine_spec.plan.md`
- Shared Items + Transactions modules (reuse rule): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## What to capture (minimum)
- URL/state persistence behavior (debounce timing, param keys)
- Scroll restoration behavior (how list → detail → back works)
- Refresh semantics (what it refreshes, error handling)
- Firebase delta: replace web realtime subscriptions with inventory `meta/sync` listener + delta fetch

