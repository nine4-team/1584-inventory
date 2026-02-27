# Feature: Create Items from Receipt List

## Problem
When purchasing many items (e.g. from HomeGoods/TJ Maxx), you get a receipt with dozens of line items. Currently each item must be created manually one at a time via "Create Item Manually." This is tedious for 40+ item receipts.

## Solution
Add a new menu option **"Create Items from List"** to the Add Item menu on the transaction detail page. It opens a modal with a text box where you paste an itemized receipt. On submit, each line is parsed and used to create items automatically.

---

## Receipt Format

Each line follows this pattern:
```
DEPT_NUM - DESCRIPTION SKU $PRICE T
```

Examples:
```
53 - ACCENT FURNISH 252972 $129.99 T
56 - EVERYDAY Q LIN 092626 $6.99 T
45 - FLORALS 924460 $229.99 T
```

**Parsed fields:**
| Receipt Token | Item Field | Example |
|---|---|---|
| `ACCENT FURNISH` | `name` | "ACCENT FURNISH" |
| `252972` | `sku` | "252972" |
| `$129.99` | `purchasePriceCents` + `projectPriceCents` | 12999 |

The department number (e.g. `53`) and trailing `T` are discarded.

Blank lines between groups are ignored.

---

## Parsing Logic

Regex per non-blank line:
```
/^\d+\s*-\s*(.+?)\s+(\d{4,})\s+\$(\d+\.\d{2})\s*T?\s*$/
```

Capture groups:
1. **Description** — trimmed → `name`
2. **SKU** — numeric string → `sku`
3. **Price** — parsed to cents → `purchasePriceCents` AND `projectPriceCents`

Lines that don't match are collected into a `skippedLines` array shown to the user after parsing.

---

## UI Flow

### 1. Menu Entry
In the `addMenuItems` array (transaction detail page, ~line 1060), insert a new option **before** "Create Item Manually":

```typescript
{
  key: 'from-list',
  label: 'Create Items from List',
  icon: 'receipt-long',
  onPress: () => {
    setAddMenuVisible(false);
    setTimeout(() => setListImportVisible(true), 300);
  },
}
```

### 2. Modal: `CreateItemsFromListModal`
A new modal component with:

- **Title:** "Create Items from List"
- **Text input:** Multi-line, large (fills most of the modal), placeholder: "Paste receipt lines here..."
- **Footer:** Cancel + "Create Items" button
- **"Create Items" button** is disabled when the text box is empty

### 3. On Submit
1. Parse the text → array of `{ name, sku, priceCents }`
2. Show a **preview** before creating:
   - List of parsed items with name, SKU, and price
   - Count: "42 items found"
   - If any lines were skipped, show: "3 lines could not be parsed" with expandable detail
3. User confirms → items are created

### 4. Item Creation
For each parsed line, call `createItem(accountId, payload)` where payload is:

```typescript
{
  name: parsedItem.name,
  sku: parsedItem.sku,
  purchasePriceCents: parsedItem.priceCents,
  projectPriceCents: parsedItem.priceCents,   // copy purchase → project
  projectId: transaction.projectId ?? null,
  transactionId: transaction.id,
  budgetCategoryId: transaction.budgetCategoryId ?? null,  // inherit from transaction (non-canonical only)
  spaceId: null,
  source: null,
}
```

This mirrors the existing `new.tsx` item creation logic, including:
- Inheriting `budgetCategoryId` from the transaction (only for non-canonical transactions)
- Setting both price fields to the same value
- Associating the item with the current transaction

### 5. After Creation
- Close the modal
- The transaction detail page's item list refreshes automatically (Firestore listener)
- Show a brief toast/confirmation: "Created 42 items"

---

## Files to Create/Modify

| File | Change |
|---|---|
| `ledger_mobile/src/utils/receiptListParser.ts` | **NEW** — pure parsing function + tests |
| `ledger_mobile/src/components/modals/CreateItemsFromListModal.tsx` | **NEW** — modal with text input, preview, and submit |
| `ledger_mobile/app/transactions/[id]/index.tsx` | Add menu option + state for modal visibility + render modal |

---

## Parser: `receiptListParser.ts`

```typescript
export type ParsedReceiptItem = {
  name: string;
  sku: string;
  priceCents: number;
};

export type ParseReceiptResult = {
  items: ParsedReceiptItem[];
  skippedLines: string[];
};

export function parseReceiptList(text: string): ParseReceiptResult
```

Pure function, no side effects — easy to test.

---

## Edge Cases

- **Duplicate lines** — create separate items (same receipt can have identical lines for multiple identical products, as shown in the examples)
- **Blank lines** — ignored (receipts have section breaks)
- **Missing `T` suffix** — still parse (the `T` just means taxable, regex makes it optional)
- **No `$` sign** — if price lacks `$`, still attempt to parse the numeric value
- **Empty input** — "Create Items" button is disabled
- **All lines fail parsing** — show error, don't create anything

---

## Out of Scope (for now)

- Quantity column (if receipt shows qty > 1 on a single line) — can add later
- Auto-detecting receipt format (Wayfair, Amazon, etc.) — existing parsers handle those
- Image attachment from receipt photo
- Editing parsed items before creation (preview is read-only confirmation)
