# Prompt Pack — Project Transactions (Chat A: Transactions list + filters + export)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity-grade specs for the **project transactions list** (search/filter/sort/state persistence/scroll restoration + CSV export).

## Outputs (required)

Update or create the following docs:
- `40_features/project-transactions/feature_spec.md`
- `40_features/project-transactions/acceptance_criteria.md`
- `40_features/project-transactions/ui/screens/TransactionsList.md`

If you discover a shared contract that belongs in `_cross_cutting`, put it there and link it:
- `40_features/_cross_cutting/...`

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/ProjectTransactionsPage.tsx`
- `src/pages/TransactionsList.tsx`

Related services/hooks:
- `src/hooks/useStackedNavigate.ts`
- `src/hooks/useNavigationContext.ts`
- `src/contexts/NavigationStackContext.tsx`
- `src/utils/navigationReturnTo.ts`
- `src/utils/hydrationHelpers.ts` (transactions cache hydration)
- `src/services/inventoryService.ts` (transaction service + canonical id helpers)

## What to capture (required sections)

For the list contract and acceptance criteria, include:
- Owned routes/entrypoints (project + business inventory scopes; shared Transactions module component configured by scope)
- List controls:
  - search match rules
  - filter modes (including nested submenu behavior)
  - sort modes
  - state persistence + restoration rules
  - scroll restoration rules
- CSV export:
  - columns
  - filename rules
  - mobile share adaptation
- Canonical transaction behaviors:
  - display title mapping
  - computed totals and any self-heal behavior (explicitly call out whether it is retained on mobile)
- Offline behavior:
  - renders from local DB offline
  - handling stale/partial metadata (category names)
- Collaboration needs:
  - change-signal + delta expectations; no large listeners
- Error/empty/loading states

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence: “Observed in …” with file + component/function, OR
- Mark as intentional change and justify it (platform/architecture requirement).

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; realtime must use change-signal + delta.
- Do not do pixel-perfect design specs.
- Focus on behaviors where multiple implementations would diverge.
