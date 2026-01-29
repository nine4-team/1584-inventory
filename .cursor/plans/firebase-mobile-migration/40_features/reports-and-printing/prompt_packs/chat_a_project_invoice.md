# Prompt Pack — Reports + share/print (Chat A: Project invoice)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity-grade specs for the **Project Invoice** report (invoiceable selection + itemized totals + share/print adaptation).

## Outputs (required)

Update or create the following docs:
- `40_features/reports-and-printing/feature_spec.md`
- `40_features/reports-and-printing/acceptance_criteria.md`
- `40_features/reports-and-printing/ui/screens/ProjectInvoice.md`

## Source-of-truth code pointers

Primary screen:
- `src/pages/ProjectInvoice.tsx`

Entry points + routing:
- `src/pages/ProjectLayout.tsx` (Accounting tab entrypoints)
- `src/utils/routes.ts` (`projectInvoice`)

Related shared contexts (parity evidence; mobile mechanism differs):
- `src/contexts/ProjectRealtimeContext.tsx` (web snapshot data shape)
- `src/contexts/BusinessProfileContext.tsx` (branding inputs)

## What to capture (required sections)

For the screen contract and acceptance criteria, include:
- Invoiceable selection rules (status + reimbursementType)
- Itemized totals rule:
  - link items by `item.transactionId`
  - missing project price behavior
  - fallback to `transaction.amount` when no items
- Charges vs credits sections, date sorting, subtotal and net due math
- Canonical transaction title mapping for `INV_*` ids
- Share/print adaptation:
  - web parity uses `window.print()`
  - mobile requirement uses native share/print and works offline (local DB only)
- States: loading/empty/error/offline, and “media pending upload” warning for business logo

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence: “Observed in …” with file + component/function, OR
- Mark as intentional change and justify it (platform/architecture requirement).

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; reports render from local DB and sync is owned by change-signal + delta.
- Do not do pixel-perfect design specs.

