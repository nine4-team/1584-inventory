# Prompt Pack: Presets managers (budget categories, vendors, tax, space templates)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity specs for the **Presets** tab managers, grounded in the existing web codebase.

---

## Outputs (required)

Update or create the following docs:
- `40_features/settings-and-admin/feature_spec.md` (presets sections)
- `40_features/settings-and-admin/acceptance_criteria.md` (presets criteria)

If you find ambiguity that risks divergence, update:
- `40_features/settings-and-admin/ui/screens/Settings.md` (presets sub-tab contract)

---

## Source-of-truth code pointers

Primary UI:
- `src/pages/Settings.tsx` (Presets sub-tabs + admin gating)
- `src/components/BudgetCategoriesManager.tsx`
- `src/components/VendorDefaultsManager.tsx`
- `src/components/TaxPresetsManager.tsx`
- `src/components/spaces/SpaceTemplatesManager.tsx`

Related services (parity reference only):
- `src/services/budgetCategoriesService.ts`
- `src/services/vendorDefaultsService.ts`
- `src/services/taxPresetsService.ts`
- `src/services/spaceTemplatesService.ts`
- `src/services/offlineStore.ts` (web caching for categories/tax/vendors; parity signal for “must cache on mobile”)

---

## What to capture (required sections)

For each preset manager:
- CRUD capabilities and validations
- Archive/unarchive behaviors (where applicable)
- Ordering / drag-and-drop behavior and persistence
- Success/error UX (auto-clear timing)
- Offline-read requirement and online-write policy

---

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide **parity evidence**: “Observed in …” with file + component/function, OR
- Mark as an **intentional change** and explain why.

---

## Constraints / non-goals

- Do not prescribe large listeners.
- Do not add new “preset toolkits” folders; keep changes within this feature’s docs.

