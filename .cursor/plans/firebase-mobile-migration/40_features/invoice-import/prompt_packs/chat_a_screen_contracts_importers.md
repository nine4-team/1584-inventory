# Goal
Produce/validate screen contracts for invoice import (Amazon + Wayfair) for the React Native + Firebase migration.

## Outputs (required)
Update or create:
- `40_features/invoice-import/feature_spec.md`
- `40_features/invoice-import/acceptance_criteria.md`
- `40_features/invoice-import/ui/screens/ImportAmazonInvoice.md`
- `40_features/invoice-import/ui/screens/ImportWayfairInvoice.md`

## Source-of-truth code pointers
Primary screens:
- `src/pages/ImportAmazonInvoice.tsx`
- `src/pages/ImportWayfairInvoice.tsx`

Routing/entrypoints:
- `src/App.tsx` (import routes)
- `src/pages/TransactionsList.tsx` (Add menu entrypoints)

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include parity evidence (file + function/component) OR mark as an intentional delta for RN/Firebase.

## Constraints / non-goals
- Do not prescribe large listeners; collaboration is change-signal + delta only.
- Focus on behaviors where multiple implementations would diverge (parsing states, draft mapping, validation, create semantics).

