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

All shared components should accept a single “scope context” object (exact type naming is implementation-defined; this is the contract shape):

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

