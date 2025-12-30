## Wayfair Invoice Item #32 Description Missing

- **Invoice**: `Invoice_4386128736.pdf`
- **SKU**: `W110704773`
- **Status**: Regression persists after spillover heuristics update (2025‑12‑29 manual test still reports blank description).

### What We Expected
The “Items to be Shipped” section should produce two separate line items:
1. `Tranquil Sepia Landscape With Tree And Hills` (SKU `W116993316`)
2. `"Vintage Landscape - DCXXXIV"` (SKU `W110704773`)

The second item’s description should contain the product title (`Vintage Landscape - DCXXXIV`) while the size line stays attached to the first item only.

### What Actually Happens
- The size attribute line extracted from the PDF (`Size: 138" L x 105.96" W " Vintage Landscape - DCXXXIV "`) still clings to the first item after parsing.
- The parser never emits a description buffer for the second item, so line item #32 winds up with an empty `description`.
- Manual import result from **2025‑12‑29 02:41 UTC** confirms the issue: item 32 shows `description: ""` but keeps the attribute line in its `attributeLines` array.

### Reproduction Steps
1. Open `Import Wayfair Invoice` in the app.
2. Upload `Invoice_4386128736.pdf`.
3. Scroll to “Items to be Shipped” and locate SKU `W110704773`. Its description field is blank in the parsed output.

### Hypothesis
- The current `splitAttributeSpillover` logic only splits when the descriptor is inside ASCII double quotes or immediately adjacent to the size measurement.
- In this PDF, the descriptor is surrounded by mixed unicode quotes *and* the size measurement itself contains quotes, so a simple trailing-match is insufficient.
- We probably need to treat `" Vintage Landscape - DCXXXIV "` as a **buffered description fragment** once the measurement segment finishes, instead of attempting to store it as an attribute spillover.

### Suggested Next Steps
1. Capture the exact normalized line emitted by `normalizeLines` around the failure and log it during parsing to verify spacing/quotes.
2. Teach `splitAttributeSpillover` to:
   - Detect when the “spillover” contains alphabetic tokens plus spaces, even if surrounded by multiple quote glyphs.
   - Return both the cleaned size value **and** emit the descriptor via `enqueueDescriptionFragment`, so the next SKU receives it as its description seed.
3. Re-run manual import (or unit test once allowed) to confirm SKU `W110704773` now has `Vintage Landscape - DCXXXIV` in its description.

### Notes
- Do **not** rely on automated tests for validation right now (per product request). Manual verification against `Invoice_4386128736.pdf` remains the acceptance gate.
