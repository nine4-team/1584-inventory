# Wayfair Invoice Fragment Troubleshooting Log

## Summary
- **Problem**: Multi-line Wayfair descriptions that contain parenthetical suffixes (e.g., `(Set of 2)`) are sometimes split by the PDF extractor so that fragments after the monetary row begin the next line item. Result: partial descriptions such as `Modern Upholstered Swivel Counter Stool...` losing the “For Kitchen Island, Coffee Bar (Set of 2)” tail, while the next item starts with `of 2)`.
- **Area**: `src/utils/wayfairInvoiceParser.ts`
- **Status**: Ongoing. Latest heuristics improved most cases but `Invoice_4381602086.pdf` still loses “For Kitchen Island...” in real imports; need exact normalized lines from the failing invoice to finish.

## Timeline & Attempts
| Date | Change | Result |
| --- | --- | --- |
| 2025-12-28 | Added `hasUnclosedParenthesis`, `isLikelyParentheticalContinuation`, and allowed bullet fragments to append after numeric rows. | Fixed trailing `of 2)` leakage but still dropped the preceding description lines. |
| 2025-12-28 (later) | Introduced soft-continuation heuristics (`CONTINUATION_LEADING_WORDS`, `allowLooseContinuationForPreviousItem`). | Helped when fragments immediately follow the parsed row, but only when the line began with `-`, `and`, etc. |
| 2025-12-28 night | Added `isLikelyParentheticalLead` and moved continuation check before SKU extraction; relaxed joiner spacing. | Local synthetic tests now keep full description, yet production parse report still missing “For Kitchen Island...” indicating extractor differences. |
| 2025-12-29 early | Preserved continuation flags when headers/summary lines reset buffers (e.g., `Shipping &` or `Subtotal` between description fragments). | Local reproduction that injects headers between fragments now passes, but production ingest of `Invoice_4381602086.pdf` still shows truncated description. Root cause unresolved. |

## Reproduction
1. Use the raw text excerpt from the parse report (`Invoice_4381602086.pdf`) – ideally the `normalizeLines` output for the affected block:
   ```
   Modern Upholstered Swivel
   Counter Stool With Wood
   Frame,Counter Height Bar Stool
   For Kitchen Island,Coffee Bar (Set
   of 2)
   W112013734
   Color/Pattern: Beige/Brown
   $265.99 4 $1,063.96 ...
   ```
2. Run `npx tsx tmp/checkWayfair.ts` (script captures the snippet and logs parser output).
3. Observe that locally the first item includes the entire parenthetical while the next item starts clean. Production still shows `"description": "Modern Upholstered Swivel Counter Stool With Wood Frame,Counter Height Bar Stool"` implying our test input differs.

## Current Hypotheses
- Normalizer may be merging the price row ahead of the description (money row preceding the multi-line name). My synthetic tests currently place the money row between the fragments; need to match the exact PDF ordering.
- Hidden characters (e.g., `\uf020`, non-breaking spaces) could keep `isLikelyParentheticalLead` from matching.
- There might be an attribute colon or slash inserted (`For Kitchen Island/Coffee Bar (Set`) causing the regex to treat it as an attribute line.

## Next Steps
1. **Capture exact normalized lines** from the failing run (enable debug logging or temporarily dump `normalizeLines` output for the 10 lines before/after `W112013734`). Without that we are guessing.
2. **Augment tests**: once we have the raw strings, add them to `tmp/checkWayfairFull.ts` (or a proper unit test) to lock in the behavior.
3. **Refine heuristic**:
   - If the fragment contains `Set` or `Pair` and no price tokens, always append when the previous line ended with a parenthesis imbalance.
   - Consider tracking when the monetary row was just parsed so the very next non-money, non-header line auto-attaches before attempting SKU extraction.
4. **Verify on real PDF**: rerun the importer against `Invoice_4381602086.pdf` after changes and confirm parse report matches expectation.

## Open Questions
- Does the extractor sometimes output the price row *before* the multi-line description? (Need example.)
- Are there other descriptors (e.g., `(Pack of 4)`, `(Set of 3 Pieces)`) that break current heuristics?
- Should we fall back to scanning the subsequent few lines for SKUs and only treat a line as a new item once both a description and monetary row appear?

## Temporary Mitigations
- Manual review of parsed invoices: watch for descriptions beginning with `of`, `set`, `pair`, or other continuation words and merge them in the UI before posting inventory.
- When in doubt, reference the raw PDF to confirm the intended line items until parser accuracy is improved.

---
*Log maintained by: GPT-5.1 Codex agent, 2025-12-28.*
