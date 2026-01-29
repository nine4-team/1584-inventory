# Prompt Pack — Reports + share/print (Chat C: Property management summary)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity-grade specs for the **Property Management Summary** report (totals + item list fields + share/print adaptation).

## Outputs (required)

Update or create the following docs:
- `40_features/reports-and-printing/feature_spec.md`
- `40_features/reports-and-printing/acceptance_criteria.md`
- `40_features/reports-and-printing/ui/screens/PropertyManagementSummary.md`

## Source-of-truth code pointers

Primary screen:
- `src/pages/PropertyManagementSummary.tsx`

Entry points + routing:
- `src/pages/ProjectLayout.tsx` (Accounting tab entrypoints)
- `src/utils/routes.ts` (`projectPropertyManagementSummary`)

## What to capture (required sections)

For the screen contract and acceptance criteria, include:
- Totals math (item count + total market value)
- Item list fields and conditional rendering:
  - source/sku/space labels when present
  - “No market value set” when market value is 0
- Performance requirements:
  - list virtualization for large projects
- Share/print adaptation (mobile: native share/print; offline)
- States: loading/empty/error/offline; pending media warning for business logo

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence: “Observed in …” with file + component/function, OR
- Mark as intentional change and justify it (platform/architecture requirement).

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; reports render from local DB.
- Do not do pixel-perfect design specs.

