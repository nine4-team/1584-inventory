# Prompt Pack — Chat D: Define the “scope config object” contract for shared Items/Transactions UI

## Goal
Update the migration specs to include an explicit, implementation-ready contract for the **single scope config object** used by shared Items + Transactions UI across:
- **Project** context (`scope: 'project'`)
- **Business inventory** context (`scope: 'inventory'`)

This should remove ambiguity and prevent “prop sprawl” (lots of scattered booleans) by standardizing one config object with named fields, defaults, and examples.

## Outputs (required)
Update the following docs:

1) `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Add a dedicated section: **“Scope config object (contract)”**
- Include:
  - A concrete TypeScript-ish interface (doc-only) for the config object
  - Required vs optional fields
  - Defaults
  - Example objects for:
    - project scope
    - inventory scope
  - A short “rules of use” section:
    - wrappers own routing/params; shared components consume scope config
    - don’t add ad-hoc booleans; extend the config object deliberately

2) `40_features/business-inventory/ui/screens/BusinessInventoryItemsScopeConfig.md`
- Replace/augment the “Suggested derived toggles” with the exact fields from the new contract.
- Ensure every inventory-unique behavior is represented as a field/default in the contract (or explicitly out-of-scope).

3) `40_features/business-inventory/ui/screens/BusinessInventoryTransactionsScopeConfig.md`
- Same as above: align to the exact contract fields and defaults.

4) `40_features/business-inventory/ui/screens/BusinessInventoryHome.md`
- Add a short section that states: the home shell passes the scope config object into the shared Items/Transactions modules (no forked implementations).

(Optional but recommended if small/clean)
5) Add cross-links from:
- `40_features/project-items/README.md`
- `40_features/project-transactions/README.md`
…to the new “Scope config object (contract)” section, so it’s clearly the single source of truth.

## Source-of-truth code pointers (parity evidence)
Use these as references for what differs by scope today (web), but write the contract for **mobile Firebase shared UI**:
- Shared-module rule doc (already exists): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Business inventory workspace + list controls: `src/pages/BusinessInventory.tsx`
- Business inventory item detail/actions: `src/pages/BusinessInventoryItemDetail.tsx`
- Business inventory item create/edit: `src/pages/AddBusinessInventoryItem.tsx`, `src/pages/EditBusinessInventoryItem.tsx`
- Business inventory transaction create/edit: `src/pages/AddBusinessInventoryTransaction.tsx`, `src/pages/EditBusinessInventoryTransaction.tsx`
- Project transactions list/detail/form (canonical contracts already written): see `40_features/project-transactions/README.md`
- Project items list/detail (canonical contracts already written): see `40_features/project-items/README.md`

## Proposed contract shape (starting point — adjust as needed)
Add something like the following to the shared-module doc (doc-only; not code):

- `scope: 'project' | 'inventory'`
- `projectId?: string` (required iff `scope === 'project'`)
- **Capabilities (prefer “capability flags” over UI flags):**
  - `capabilities: {`
    - `canAllocateToProject: boolean` (inventory: true, project: false)
    - `canExportCsv: boolean` (project transactions: true; inventory transactions: false)
    - `canGenerateQr: boolean` (feature-flag gated)
    - `supportsInventoryOnlyStatusFilter: boolean` (inventory transactions: true; project: false)
    - `requiresBudgetCategoryOnCreate: boolean` (inventory transactions: true; project: depends on canonical rules)
  - `}`
- **Field visibility/labels (only when truly different by scope):**
  - `fields: { showBusinessInventoryLocation: boolean }`
- **Navigation/state glue (owned by wrappers; passed through only if necessary):**
  - keep this minimal; prefer wrappers to own URL/state concerns

Important: keep the contract **small**. If a field isn’t genuinely scope-dependent, it should not be in the config.

## Evidence rule (anti-hallucination)
For each non-obvious field/default in the contract:
- Provide **parity evidence** (“Observed in …” with file + component/function) OR
- Mark as an **intentional delta** (mobile Firebase architecture choice) with rationale.

## Constraints
- Must remain compatible with the offline-first invariants in `40_features/sync_engine_spec.plan.md`.
- Must not imply separate “project vs inventory” implementations of Items/Transactions UI.

