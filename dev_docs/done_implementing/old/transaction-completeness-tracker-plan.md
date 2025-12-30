---
title: Transaction Completeness Tracker Plan
created: 2025-11-09
owner: Inventory & Finance Tooling
---

## Objective
- Surface an at-a-glance completion signal when a purchase transaction is missing item associations.
- Reuse the familiar progress tracker interaction pattern so the team immediately understands the indicator.
- Stop short of requiring 100% parity so tax, fees, or rounding edge cases do not block completion.

## Business Rules
- **Target metric**: compare the sum of associated item purchase prices to the transaction subtotal (pre-tax). When a stored subtotal is missing but a tax rate or tax total is present, infer `subtotal = transaction.total - inferredTax`, where `inferredTax = transaction.total * taxRate` (rounded to cents) or falls back to `transaction.tax_total` when available.
- **Tolerance bands**:
  - Green (`complete`) when the variance is within ±10%.
  - Yellow (`near`) between 10% and 20% variance to signal a quick review.
  - Red (`incomplete`) beyond 20% variance to highlight missing work.
  - Red (`over`) when totals exceed 120% to catch duplicate or mispriced items.
- **Tax handling**: show recorded tax values in details and clarify that progress is net-of-tax. When neither tax rate nor tax total is known, fall back to the gross total, display a warning glyph, and treat the tolerance checks as advisory.

## Data & API Updates
- Extend the transaction detail service (and underlying query layer) to return:
  - `itemsNetTotal`: sum of `item.purchasePrice` for associated items.
  - `itemsCount`: number of associated items.
  - `itemsMissingPriceCount`: number of associated items lacking a purchase price.
  - `transactionSubtotal`: stored or inferred pre-tax amount.
  - `completenessRatio`: `itemsNetTotal ÷ transactionSubtotal`.
  - `completenessStatus`: enum (`complete`, `near`, `incomplete`, `over`) derived from tolerance bands.
  - `missingTaxData`: boolean for UI warnings.
- Ensure batch association mutations (add/remove items) invalidate or recompute the completeness payload so UI updates immediately.
- If aggregation queries become expensive, evaluate a Supabase materialized view that rolls up item totals per transaction (optional future optimization).

## UI & UX Updates
- Integrate a combined “Transaction Audit” module into the transaction detail drawer (and optionally summary cards) that houses the progress tracker, audit checklist, and suggested actions, mirroring budget tracker styling.
- Include a tooltip or hover panel on the tracker showing:
  - Transaction net amount.
  - Associated item total.
  - Recorded tax amount.
  - Count of items missing purchase price.
- When status is yellow or red, surface an “Items to add” callout inside the audit module that lists unassociated inventory items sharing the same vendor and a null `transactionId`. Provide a one-click “Add to transaction” action per row; omit scoring/weighting for now and keep the list concise (e.g., top 5 results).
- Display a slim warning banner if tax data is unavailable.

## Audit Data Surface
- **Purpose**: give finance/ops a centralized checklist for transaction cleanup without scanning the entire item list.
- **Contents** (all housed within the audit module, alongside the tracker):
  - Progress tracker indicating completeness state.
  - `Missing purchase price` table listing item name, SKU, quantity, and quick action to edit price.
  - `Variance breakdown` chip showing how far the tracker is from the target in dollars and percent.
  - `Tax inference` note that explains whether the subtotal was stored or derived, including the rate used.
  - `Suggested items to add` list that mirrors the callout results and supports single-click association.
- **Interactions**:
  - Inline “Mark resolved” action when a missing price is updated.
  - Inline “Add to transaction” button for each suggested item (immediately persists and refreshes metrics).
  - Expandable drawer to keep the default UI compact while still making audit issues obvious.

## Edge Cases & Validation
- Transactions with zero associated items show 0% progress and a red “No items linked yet” label.
- Items lacking purchase price contribute 0 to totals until priced; highlight them in the tooltip and in the callout list.
- Ignore transaction types that do not require item attribution (returns, internal transfers) by filtering at the query layer.
- Respect transaction currency; if multi-currency scenarios exist, convert item totals using the transaction’s exchange rate before computing progress.

## Testing & Rollout
- Unit-test the helper that derives `completenessStatus`, covering boundaries at 90%, 110%, and 120%, plus missing-tax scenarios.
- Add Cypress (or Playwright) coverage to assert color states and tooltips for representative transactions.
- Generate a staging backfill report for recent transactions to validate completeness signals align with expectations.
- Prepare ops documentation describing how to interpret yellow vs. red states and the recommended reconciliation steps.


