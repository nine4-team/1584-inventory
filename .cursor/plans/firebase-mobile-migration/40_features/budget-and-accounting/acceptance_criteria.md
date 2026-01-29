# Budget + Accounting — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement / new model).

## Budget tab — budget progress

- [ ] **Renders budget progress inside a project** (Budget sub-tab), derived from local data only.  
  Observed entrypoint in `src/pages/ProjectLayout.tsx` (renders `BudgetProgress`).
- [ ] **Excludes canceled transactions** from all rollups.  
  Observed in `src/components/ui/BudgetProgress.tsx` (filters out `status === 'canceled'`).
- [ ] **Overall budget denominator is the sum of per-category budgets** (excluding design fee).  
  Observed in `src/components/ui/BudgetProgress.tsx` (`overallFromCategories`).
- [ ] **Purchases add and returns subtract** in spend totals.  
  Observed in `src/components/ui/BudgetProgress.tsx` (multiplier for `transactionType === 'Return'`).
- [ ] **Canonical sale transactions subtract** from spent totals.  
  Observed in `src/components/ui/BudgetProgress.tsx` (`INV_SALE_*` multiplier -1).

## Canonical attribution (required model; main intentional delta)

- [ ] **Canonical inventory transactions do not require a user-facing category** and are treated as uncategorized on the transaction row (recommended: `categoryId = null`).  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.  
  **Intentional delta** vs web: canonical rows may populate category fields (`src/services/inventoryService.ts`).
- [ ] **Non-canonical attribution is transaction-driven**: category attribution comes from `transaction.categoryId`.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.
- [ ] **Canonical attribution is item-driven**: canonical `INV_*` transactions are attributed by grouping linked items by `item.inheritedBudgetCategoryId`.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md` and `40_features/project-items/flows/inherited_budget_category_rules.md`.  
  **Intentional delta** vs web: budget rollups do not group canonical transactions by item categories (`src/components/ui/BudgetProgress.tsx`).
- [ ] **Canonical per-item value uses the same fallback as canonical totals**: `projectPrice ?? purchasePrice ?? marketValue ?? 0`.  
  Observed in `src/services/inventoryService.ts` (`computeCanonicalTransactionTotal`, canonical `INV_SALE` amount recompute).
- [ ] **Canonical transfer does not affect budget rollups** unless/until transfer semantics are explicitly defined.  
  **Intentional delta** (explicitly scoped rule for Firebase migration).

## Design fee tracker (special semantics)

- [ ] **Design fee progress is “received”, not “spent”**.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.
- [ ] **Design fee budget comes from `project.designFee`** (not from category budget map).  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.  
  Parity evidence: `src/components/ui/BudgetProgress.tsx` uses `designFee` prop for design fee budget.
- [ ] **Design fee is excluded from spent totals and category budget sums**.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.  
  Parity evidence: `src/components/ui/BudgetProgress.tsx` excludes design fee from overall spent and overall budget sum.
- [ ] **Design fee identity uses a stable identifier** (slug/metadata), not mutable display name matching.  
  **Intentional delta** vs web: web uses name heuristic (`isDesignFeeCategory`) in `src/components/ui/BudgetProgress.tsx`.

## Budget UI behavior (high-level parity)

- [ ] **Collapsed vs expanded categories**: default view shows primary category (“Furnishings” when present); “Show all budget categories” reveals full list and the “Overall Budget” row.  
  Observed in `src/components/ui/BudgetProgress.tsx` (toggle + furnishings default + overall budget appears only when expanded).
- [ ] **Project list preview mode**: project cards show a compact budget progress view (primary category or overall).  
  Observed in `src/pages/Projects.tsx` (uses `BudgetProgress` preview mode).

## Accounting tab — rollups + report entrypoints

- [ ] **Accounting rollups render inside the project budget section** (Accounting sub-tab).  
  Observed in `src/pages/ProjectLayout.tsx` (`budgetTabs`, `activeBudgetTab === 'accounting'`).
- [ ] **Owed to Design Business** equals sum of non-canceled transactions with `reimbursementType === CLIENT_OWES_COMPANY`.  
  Observed in `src/pages/ProjectLayout.tsx` (`owedTo1584`) and `src/constants/company.ts`.
- [ ] **Owed to Client** equals sum of non-canceled transactions with `reimbursementType === COMPANY_OWES_CLIENT`.  
  Observed in `src/pages/ProjectLayout.tsx` (`owedToClient`) and `src/constants/company.ts`.
- [ ] **Report buttons exist** for Invoice, Client Summary, and Property Management Summary.  
  Observed in `src/pages/ProjectLayout.tsx` (report buttons).  
  Note: report behavior is owned by `reports-and-printing`.

## Firebase/offline-first constraints

- [ ] **Rollups are computed from SQLite only** and render correctly offline (no network).  
  **Intentional delta** required by `sync_engine_spec.plan.md` (local source of truth).
- [ ] **No large listeners** are required to keep rollups fresh; changes arrive via `meta/sync` change-signal + delta sync.  
  **Intentional delta** required by `sync_engine_spec.plan.md`.
