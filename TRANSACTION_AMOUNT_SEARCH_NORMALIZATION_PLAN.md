## Goal

Fix amount-based search in project transactions by normalizing search input and stored amounts at search time, so existing data works without a migration.

## Scope

- Project transactions list search in `src/pages/TransactionsList.tsx`.
- No changes to stored data or write paths in this phase.

## Trigger Rule

Only treat the query as an amount search when:

- It contains at least one digit, and
- It contains only characters valid in a dollar amount.

Allowed characters: digits, space, comma, dot, minus, parentheses, and `$`.

Regex gate:

- `hasDigit = /\d/.test(query)`
- `allowedOnly = /^[0-9\s,().$-]+$/.test(query)`
- Amount flow runs only when `hasDigit && allowedOnly`.

## Normalization Logic

Use the existing helper:

- `normalizeMoneyToTwoDecimalString()` from `src/utils/money.ts`.

Normalize both:

- The query string
- Each transaction’s `amount`

Then compare normalized values.

Suggested matching:

- Exact match on normalized strings for precision
- Optional fallback: partial match on normalized numeric string for convenience (decide in implementation)

## Implementation Steps

1. Import `normalizeMoneyToTwoDecimalString` in `src/pages/TransactionsList.tsx`.
2. Add the amount-query gate described above.
3. If gated:
   - Normalize query and amount.
   - Use normalized values in amount matching.
4. Keep the existing text matching behavior unchanged.

## Testing Ideas

- Search: `1200`, `$1,200`, `1,200.00`, `(1200)` should match the same amount.
- Search: `1200.5` should match `1200.50`.
- Search: `1200abc` should NOT run amount matching.
- Search: `Home Depot` should still work.

## Notes / Follow-ups

- This solves existing data inconsistencies without a migration.
- Optional later improvement: normalize on write or add `amount_cents` for stronger guarantees.
