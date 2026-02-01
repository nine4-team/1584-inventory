# Shared Items + Transactions modules (Project + Business Inventory)

## Intent

Avoid the “two codepaths” drift from the current web app by requiring that **Items** and **Transactions** are implemented as **shared domain modules** and **shared UI components**, reused across:

- **Project workspace context**
- **Business inventory workspace context**

These shared components may:

- Render different controls per context (feature flags / scope config)
- Enforce different rules per context (e.g., allowed actions, required params)
- Display different copy/labels per context

…but they must not be forked into separate implementations that diverge over time.

## Requirement (non-negotiable)

For **Items** and **Transactions**:

- **One entity model**: the same underlying “Item” and “Transaction” entities exist across scopes; scoping differs (project-scoped vs inventory-scoped), but the shape and core behaviors should remain shared.
- **One set of UI primitives**: list rows/cards, actions menus, bulk controls, detail screens, and forms must be implemented as shared components with **scope-driven configuration**, not duplicated implementations per workspace.

## Scope model (recommended shape)

All shared components should accept a single **scope config object** (exact type naming is implementation-defined) so shared modules can branch by scope without “prop sprawl”.

## Scope config object (contract)

### Contract (doc-only TypeScript-ish interface)

```ts
/**
 * Contract for shared Items + Transactions UI modules.
 *
 * - Wrappers (Project shell / BusinessInventoryHome) CREATE this object.
 * - Shared modules CONSUME this object (and must not assume `projectId` exists).
 * - Keep this small: only include fields that genuinely vary by scope.
 */
export type ScopeConfig =
  | {
      scope: 'project'
      projectId: string
      capabilities?: ScopeCapabilities
      fields?: ScopeFields
    }
  | {
      scope: 'inventory'
      projectId?: never
      capabilities?: ScopeCapabilities
      fields?: ScopeFields
    }

export interface ScopeCapabilities {
  /**
   * Whether inventory-scoped items can be allocated into a project.
   * (Capability flag; the UI might show "Move to project", batch allocate, etc.)
   */
  canAllocateToProject?: boolean

  /** Whether the transactions module can export a CSV from the list screen. */
  canExportCsv?: boolean

  /** Whether the items module can generate QR codes (feature-flag gated). */
  canGenerateQr?: boolean

  /**
   * Whether the transactions list supports the inventory-only status filter
   * (e.g. `inventory-only` which filters `projectId == null` in web parity).
   */
  supportsInventoryOnlyStatusFilter?: boolean
}

export interface ScopeFields {
  /**
   * Whether to show/render business-inventory-only location fields for items.
   * (Example: `item.businessInventoryLocation` and related list filtering/search.)
   */
  showBusinessInventoryLocation?: boolean
}
```

### Defaults (applied by shared modules)

Shared modules must treat omitted objects/keys as defaults (do not require wrappers to pass a dozen flags).

- `capabilities.canAllocateToProject`: default `false`
- `capabilities.canExportCsv`: default `false`
- `capabilities.canGenerateQr`: default `false`
- `capabilities.supportsInventoryOnlyStatusFilter`: default `false`
- `fields.showBusinessInventoryLocation`: default `false`

### Example objects

**Project scope**

```ts
const projectScopeConfig: ScopeConfig = {
  scope: 'project',
  projectId,
  capabilities: {
    canAllocateToProject: false,
    canExportCsv: true,
    canGenerateQr: false,
    supportsInventoryOnlyStatusFilter: false,
  },
  fields: {
    showBusinessInventoryLocation: false,
  },
}
```

**Inventory scope (Business inventory)**

```ts
const inventoryScopeConfig: ScopeConfig = {
  scope: 'inventory',
  capabilities: {
    canAllocateToProject: true,
    canExportCsv: false,
    canGenerateQr: ENABLE_QR, // derived from feature flags
    supportsInventoryOnlyStatusFilter: true,
  },
  fields: {
    showBusinessInventoryLocation: true,
  },
}
```

### Rules of use (required)

- **Wrappers own routing/params; shared components consume scope config**: route params, deep links, and shell-level navigation concerns are owned by wrapper shells. Shared modules receive `ScopeConfig` + domain data and render behavior accordingly.
- **Don’t add ad-hoc booleans**: if a new behavior is truly scope-dependent, extend `ScopeConfig` deliberately (capability/field naming) rather than sprinkling one-off props through component trees.
- **Prefer capability flags over UI flags**: define “what is allowed” (`canExportCsv`) rather than “what to show” (`showExportButton`) so shared modules can keep UI consistent.

## List state + scroll restoration (required; Expo Router)

In the new React Native app we will use **Expo Router** (React Navigation). We therefore treat **navigation history** and **list UI state** as separate concerns:

- **Navigation history (“Back”)** is owned by React Navigation.
- **List UI state** (search/filter/sort/tab + scroll restoration) is owned by the shared list modules.

### Contract: `listStateKey` (minimal, stable)

Every long list screen must have a stable `listStateKey` that includes scope.

Doc-only examples:

```ts
// project scope
listStateKey = `project:${projectId}:items`
listStateKey = `project:${projectId}:transactions`

// inventory scope
listStateKey = `inventory:items`
listStateKey = `inventory:transactions`
```

### Contract: ListStateStore behavior

Shared list modules must:

- Persist search/filter/sort/tab to a local store keyed by `listStateKey` (debounced).
- When navigating list → detail:
  - record a restore hint keyed by `listStateKey`:
    - preferred: `anchorId` (the tapped entity id)
    - optional fallback: `scrollOffset`
- On returning to the list:
  - restore by `anchorId` first, then by `scrollOffset` best-effort
  - clear the restore hint after first attempt to avoid “jump loops”

### Source of truth

- Navigation + list restoration spec: `40_features/navigation-stack-and-context-links/feature_spec.md`

### Parity evidence (web)

The web app achieves similar outcomes via URL params + `restoreScrollY`:

- Project items list state + restore: `src/pages/InventoryList.tsx` (`itemSearch/itemFilter/itemSort`, `restoreScrollY`)
- Project transactions list state + restore: `src/pages/TransactionsList.tsx` (`tx*` params, `restoreScrollY`)
- Business inventory state persistence: `src/pages/BusinessInventory.tsx` (`biz*` params)

### Parity evidence / intentional deltas for non-obvious fields

- `capabilities.canExportCsv`
  - Project: **true**. Observed in `src/pages/TransactionsList.tsx` (`Export` button + `handleExportCsv`).
  - Inventory: **false**. Observed in `src/pages/BusinessInventory.tsx` (no CSV export control/handler in the inventory Transactions tab), and `src/pages/BusinessInventory.tsx` is the canonical BI list shell.
- `capabilities.canAllocateToProject`
  - Inventory: **true**. Observed in:
    - `src/pages/BusinessInventory.tsx` (`unifiedItemsService.batchAllocateItemsToProject(...)`)
    - `src/pages/BusinessInventoryItemDetail.tsx` (allocation modal + `unifiedItemsService.allocateItemToProject(...)`)
- `capabilities.canGenerateQr`
  - Feature-flag gated. Observed in `src/pages/BusinessInventory.tsx` (`ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'` and conditional QR button).
  - **Intentional delta for mobile**: the mobile Firebase app should gate this via remote config/feature flags rather than build-time env vars, but the capability is still modeled the same way.
- `capabilities.supportsInventoryOnlyStatusFilter`
  - Inventory: **true**. Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_STATUS_FILTER_MODES` includes `inventory-only`; filters `projectId === null`).
- `fields.showBusinessInventoryLocation`
  - Inventory: **true**. Observed in `src/pages/BusinessInventoryItemDetail.tsx`:
    - Search matches include `item.businessInventoryLocation`
    - Detail renders the “Location” field when present

### Intentionally not included in the scope config (keep it small)

- **Budget category required on manual transaction create** is **not scope-dependent** (both project + inventory create flows require category in current web parity):
  - Observed in `src/pages/AddTransaction.tsx` (validation: “Budget category is required”)
  - Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (validation: “Budget category is required”)
  - Therefore it is a shared Transactions contract rule, not a scope config toggle.

- `scope: 'project' | 'inventory'`
- `projectId?: string` (required when `scope === 'project'`; absent when `scope === 'inventory'`)
- Optional additional toggles derived from scope + permissions (e.g., `canExport`, `canMoveAcrossScopes`, `showAllocationActions`)

### Risk mitigation rules (required)

These rules exist to prevent the main real-world failure modes of “shared components” (god-components, scope leakage, and hidden route-param coupling).

- **Single config object, not scattered booleans**: shared components must derive behavior from one scope/config object rather than accumulating unrelated props over time.
- **Action registry (recommended)**: menus and bulk actions should be generated from a single action registry that is filtered/guarded by scope and permissions. Avoid “render everything then hide a few” patterns that leak actions across scopes.
- **Wrappers own routing; shared components own behavior**: project shell and business-inventory shell may provide different routes, but they should compose shared list/detail/form components rather than reimplementing list/menu logic.
- **No implicit `projectId` assumptions**: shared components must not assume `projectId` exists; they must branch explicitly on `scope`.

### Anti-patterns (avoid)

- Separate “ProjectX” and “BusinessInventoryX” versions of the same list/menu/detail when only scope differs.
- Copy/pasting list/menu logic to “get it shipped” (this is exactly the drift we’re preventing).
- Adding scope-driven behavior by sprinkling ad-hoc `if (isProject)` checks throughout; centralize in config/registry.

## Components that must be shared (examples)

The following are expected to be **shared implementations**:

- **Items**
  - Items list screen/component (search/filter/sort/group, selection, bulk actions)
  - Item list row/card + per-item actions menu
  - Item detail screen/component + item detail actions menu
  - Item create/edit form components (field rendering + validation), with scope-specific defaults
- **Transactions**
  - Transactions list screen/component (search/filter/sort, menus, export)
  - Transaction list row/card + transaction actions menu
  - Transaction detail screen/component (including itemization surface wiring)
  - Transaction create/edit form components

Wrappers (project shell vs business inventory shell) may be separate, but they must compose the shared module components rather than reimplementing them.

## How this applies to existing specs in `40_features/`

- Specs under `project-items/` and `project-transactions/` are written from the **project** entrypoints but define the **canonical shared behaviors/contracts** that business-inventory flows must reuse.
- Business-inventory-specific screens (workspace shell, tabs, navigation) may be spec’d elsewhere, but they must reference and reuse these shared Items/Transactions contracts rather than restating/duplicating them.

