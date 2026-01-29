# Prompt Pack — Reports + share/print (Chat B: Client summary)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity-grade specs for the **Client Summary** report (rollups + category breakdown + receipt links), including required canonical attribution deltas.

## Outputs (required)

Update or create the following docs:
- `40_features/reports-and-printing/feature_spec.md`
- `40_features/reports-and-printing/acceptance_criteria.md`
- `40_features/reports-and-printing/ui/screens/ClientSummary.md`

## Source-of-truth code pointers

Primary screen:
- `src/pages/ClientSummary.tsx`

Entry points + routing:
- `src/pages/ProjectLayout.tsx` (Accounting tab entrypoints)
- `src/utils/routes.ts` (`projectClientSummary`, `projectInvoice`)

Category metadata (parity evidence):
- `src/components/CategorySelect.tsx` (`useCategories`)

Canonical attribution model (migration requirement):
- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- `40_features/project-items/flows/inherited_budget_category_rules.md`

## What to capture (required sections)

For the screen contract and acceptance criteria, include:
- Rollup math:
  - total spent overall from `item.projectPrice`
  - market value from `item.marketValue`
  - savings rule (`marketValue > 0` only)
- Category breakdown:
  - web parity is transaction `categoryId` → category name
  - mobile required delta uses `item.inheritedBudgetCategoryId` (and a safe fallback) so canonical transactions are attributed correctly
- Receipt link rule for each item:
  - canonical/invoiceable → link to invoice report
  - else receipt image URL → external link
  - else no link
- Share/print adaptation (mobile: native share/print; offline)
- States: loading/empty/error/offline; pending media warning for business logo

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence: “Observed in …” with file + component/function, OR
- Mark as intentional change and justify it (platform/architecture requirement).

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; reports render from local DB.
- Do not do pixel-perfect design specs.

