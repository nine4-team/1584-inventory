---
name: Per-category itemization toggle
overview: "Add a per-budget-category “Enable itemization” toggle that controls transaction item section visibility and the audit/review experience: hide items + audit UI when disabled (with a safe exception for already-itemized transactions), and ensure we never set a transaction’s “needs review” flag for categories with itemization disabled."
todos:
  - id: add-category-toggle
    content: Add `metadata.itemizationEnabled` toggle to `BudgetCategoriesManager` (with tooltip copy) and persist via existing update flow.
    status: pending
  - id: itemization-controls-items-forms
    content: In `AddTransaction` + `EditTransaction`, use category `itemizationEnabled` to hide/show the Transaction Items section; if the transaction already has items but itemization is off, show items with a warning + CTA.
    status: pending
  - id: itemization-controls-items-detail
    content: In `TransactionDetail`, hide/show Transaction Items based on category `itemizationEnabled`; if items exist but itemization is off, show items with a warning + CTA.
    status: pending
  - id: hide-audit-ui
    content: Hide the Needs Review/Audit section in forms + detail when category `itemizationEnabled=false` (itemization is the user-facing concept; audit is a dependent behavior).
    status: pending
  - id: enforce-needs-review-guard
    content: Add service-layer guard to never set `needsReview=true` for categories with `itemizationEnabled=false` (including any background/conflict paths if applicable).
    status: pending
  - id: seed-defaults
    content: Set seeded defaults so `furnishings` has `itemizationEnabled=true` and `install`, `design-fee`, `storage-receiving` have `itemizationEnabled=false` across onboarding + default seeding paths.
    status: pending
  - id: tests
    content: Add minimal tests covering toggle persistence, items/audit UI gating (including items-exist warning case), and needs-review enforcement.
    status: pending
isProject: false
---

# Per-category itemization toggle plan

## Goal

- Add a **per-category “Enable itemization”** setting.
- When itemization is OFF for a category:
- **Hide the Transaction Items section** (Add/Edit + Detail), unless the transaction already has items (then show with a warning + CTA).
- **Hide the Needs Review/Audit section** (Add/Edit + Detail).
- **Never assign “needs review”** to transactions in that category (force false in service layer).

## Terminology (important)

- **Itemization** = whether transactions in a category can/should have attached line-items.
- Audit/review is a downstream use of itemization; we don’t frame the toggle as “review/audit.”

## UX + copy (simple)

- In Settings → Presets → Budget Categories, add a toggle on each category:
- Label: **“Enable itemization”** (with an info tooltip)
- Tooltip: Explains what itemization does (controls items section visibility; disables needs-review/audit when off).
- Default for existing categories: **ON** (preserves current behavior; users explicitly opt out).
- Exception behavior: if a transaction already has items attached, we still show items with a warning even when itemization is OFF (see below).

## Data model (no migration)

- Use existing budget category `metadata` JSONB field (already supported by the view/service layer).
- Store a boolean like:
- `metadata.itemizationEnabled` (true/false)
- Treat missing as `true` (backward compatible).

## Seeded defaults (accounts start with categories)

- Ensure default seeded categories include sensible initial itemization values:
- `furnishings`: `itemizationEnabled=true`
- `install`: `itemizationEnabled=false`
- `design-fee`: `itemizationEnabled=false`
- `storage-receiving`: `itemizationEnabled=false`

## Implementation steps

### Settings: Budget category toggle

- Update [`src/components/BudgetCategoriesManager.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/components/BudgetCategoriesManager.tsx) to render the per-category toggle and persist via existing update flow.
- Ensure edits only touch `metadata.itemizationEnabled` and don’t disturb other metadata.

### Forms: Add/Edit Transaction

- In [`src/pages/AddTransaction.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/AddTransaction.tsx) and [`src/pages/EditTransaction.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/EditTransaction.tsx), derive `itemizationEnabled` from the selected category (missing defaults to `true`).
- Transaction Items visibility:
- If enabled: show normal items UI.
- If disabled and no items: hide items UI.
- If disabled but items already exist (Edit): show items UI with warning + CTA.
- Needs Review/Audit section visibility:
- Only render when `itemizationEnabled=true`.

### Detail: Transaction Detail

- In [`src/pages/TransactionDetail.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/TransactionDetail.tsx), apply the same items + audit gating rules.

### Service layer: needs-review enforcement

- Wherever `needsReview` can be set during create/update (and any background/conflict flows): if category `itemizationEnabled=false`, force `needsReview=false` (ignore attempts to set true).

## Test plan (minimal)

- Add/adjust tests around:
- Category metadata toggle persistence (one UI/service test).
- Transactions in a `itemizationEnabled=false` category:
- Items section hidden when no items.
- Items section shown with warning when items exist.
- Needs-review/audit section not rendered (form + detail).
- `needsReview` remains false after create/update even if other logic would set it.
- Seed defaults: furnishings is enabled; other seeded defaults are disabled.
- Likely in existing test areas under:
- [`src/services/__tests__`](/Users/benjaminmackenzie/Dev/ledger/src/services/__tests__)
- [`src/pages/__tests__`](/Users/benjaminmackenzie/Dev/ledger/src/pages/__tests__)

## Rollout notes

- Backwards compatible: missing metadata behaves as itemization enabled.
- No DB migration needed (uses existing JSON metadata).