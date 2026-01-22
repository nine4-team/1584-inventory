# Collapse Item Controls into a Two-Tier Three-Dot Menu (Plan)

## Goal
Unify **all item-level actions** (currently scattered across icon buttons + ad-hoc dropdowns) into a consistent **three-dot (“kebab”) menu** with **two tiers**:

- **Top-level menu**
- **Second-tier submenus** for exactly **three** entries:
  - **Sell**
  - **Move**
  - **Change Status**

Keep the **bookmark button separate** and positioned next to the three-dot menu in:
- **Item preview** (cards/rows)
- **Item detail** (sticky header)

Apply this **everywhere items appear** (project inventory, business inventory, transaction item lists, item detail variants).

## Non-goals (for this pass)
- Completing missing backend workflows (notably **Sell → Project**). This plan includes *how the UI should behave* until the backend is ready.
- Redesigning selection/bulk actions (those can remain separate).

---

## Current State Inventory (What Exists Today)

### Item preview (lists/cards)
`src/components/items/ItemPreviewCard.tsx` shows a variable set of controls by context:
- Bookmark (icon)
- Edit (icon)
- Duplicate quantity (menu)
- Remove from transaction (icon in transaction context)
- “Disposition” badge + dropdown (ad-hoc dropdown)

`src/components/items/InventoryItemRow.tsx` wraps `ItemPreviewCard` for project/business-inventory lists.

### Item detail (project + business inventory)
`src/pages/ItemDetail.tsx` (project + BI routes) currently has:
- Bookmark button
- Edit button
- Duplicate quantity menu
- (Optional) QR
- “Disposition” badge dropdown
- “Associate with project” dropdown (project context)
- Transaction assign/change dialog + “Remove from transaction”
- Delete button

`src/pages/BusinessInventoryItemDetail.tsx` (BI detail) has:
- Allocate-to-project button (dollar icon)
- Edit
- Duplicate
- Delete

### Transaction detail (transaction-level actions)
`src/pages/TransactionDetail.tsx` has a “Move to project” dropdown for *transactions* (not items).

### Edit item screen
`src/pages/EditItem.tsx` already includes:
- Associate with project combobox (disabled with reason if tied to a transaction / canonical inventory tx)
- Associate with transaction combobox + remove-from-transaction confirm

---

## Target Menu Information Architecture

### Top-level menu (in this order)
- **Edit**
- **Make Copies…**
- **Add To Transaction…**
- **Sell ▸**
- **Move ▸**
- **Change Status ▸**
- **Delete…**

### Second-tier: Sell
- **Sell To Design Business** (means “sell to business inventory”)
- **Sell To Project…**

### Second-tier: Move
- **Move To Design Business** (means “move to business inventory”)
- **Move To Project…**

### Second-tier: Change Status
Statuses:
- **To Purchase**
- **Purchased**
- **To Return**
- **Returned**

> Note: the codebase currently also uses an `inventory` disposition value (especially for business inventory + deallocation flows). This plan assumes we **display only the four statuses above** in the “Change Status” submenu, and treats `inventory` as an internal/system state unless/until we decide otherwise.

---

## Disable / Grey-out Rules (Must Be Consistent Everywhere)

### Rule set A: Business inventory vs project location
Define “item location context” from the item record:
- **Business inventory item**: `item.projectId == null`
- **Project item**: `item.projectId` is a project id

**When item is in business inventory (`projectId == null`):**
- Disable **Sell → Sell To Design Business**
- Disable **Move → Move To Design Business**

**When item is in a project (`projectId != null`):**
- Sell/Move to business inventory are generally enabled (subject to Rule set B/C below).

### Rule set B: Project picker disabling “current project”
For actions that target a project (**Sell To Project…**, **Move To Project…**):
- When the project list is shown, the item’s **current project** should be **disabled** in the list.
- The label should remain visible (so users understand why it’s disabled).

### Rule set C: Items tied to transactions (important)
Existing behavior indicates you should not “move an item to another project” directly if it’s tied to a transaction:
- If `item.transactionId` exists:
  - **Move → Move To Project…** should be **disabled** (with reason: “This item is tied to a transaction. Move the transaction instead.”)
  - **Move → Move To Design Business** should be **disabled** if the same rule applies (depends on current backend support; safest: disable unless you have a dedicated flow that also updates transaction/item lineage correctly)

For canonical inventory transactions (IDs like `INV_SALE_`, `INV_PURCHASE_`):
- Mirror the existing guardrails used elsewhere:
  - Disable actions that would conflict with inventory allocation/deallocation rules, with reason: “This item is tied to a company inventory transaction. Use allocation/deallocation instead.”

### Rule set D: Context-specific availability
Some screens show items that may be drafts/temporary (e.g. transaction item forms with temp IDs):
- If an item is **not persisted** (temp id like `item-...`):
  - Disable actions requiring a persisted record: **Bookmark**, **Change Status**, **Sell**, **Move**, **Delete** (or hide, depending on current patterns).
  - Keep **Edit** (in-form edit) and **Make Copies** (duplicate form rows) available where they already work.

---

## Action Semantics (What Each Menu Item Does)

### Edit
- Navigate to the existing edit route for the current context:
  - Project context: `/project/:projectId/items/:itemId/edit`
  - BI context: `/business-inventory/:itemId/edit`
  - Generic: `/item/:itemId/edit` (fallback)

### Make Copies…
- Reuse the existing `DuplicateQuantityMenu` behavior (quantity picker).
- In transaction context, preserve the current “duplicate form rows” behavior for draft items.

### Add To Transaction…
Single menu item that opens a modal/dialog:
- If item is not currently in a transaction: “Assign To Transaction”
- If item is currently in a transaction: “Change Transaction” with ability to clear/unlink

Implementation note:
- Reuse the existing transaction picker logic in `ItemDetail.tsx` and `EditItem.tsx` (already supports selection + unlink patterns).

### Sell ▸
#### Sell To Design Business
Meaning: “sell to business inventory”.
- If item is already in business inventory: disabled.
- If item is in a project:
  - Preferred: call the existing business-inventory “sale” flow (if already implemented).
  - If backend incomplete: show disabled w/ reason until implemented.

#### Sell To Project…
Meaning: “sell item to another project”.
Backend gap acknowledged:
- Desired behavior (orchestration):
  - Step 1: Sell item to business inventory (creates canonical inventory sale; item moves to BI)
  - Step 2: Target project purchases the item from business inventory (creates canonical inventory purchase; item becomes allocated to target project)

UI plan until backend is complete:
- Show the option, but **disabled with a tooltip/reason**: “Not implemented yet.”
  - (Or: allow it and perform step 1 only, but that’s risky because it looks like it completed the full cross-project sale.)

### Move ▸
#### Move To Design Business
Meaning: “move item to business inventory” (not a sale).
- If already in business inventory: disabled.
- If tied to a transaction: disable (unless you have a safe, supported flow).
- Otherwise: call the existing “move to business inventory” operation (if present), ensuring:
  - item `projectId` becomes null
  - any necessary lineage pointers are updated

#### Move To Project…
Meaning: “move (reassign) item to another project” without selling.
- Disable if item is tied to a transaction (per Rule set C).
- Otherwise: update `item.projectId` to target project.
- In BI context, this is effectively “allocate to project” and should converge with `allocateItemToProject`.

### Change Status ▸
Meaning: update the item’s status field (currently implemented as `disposition` in several places).
- Menu displays only:
  - To Purchase
  - Purchased
  - To Return
  - Returned
- Selecting updates the persisted item.

### Delete…
Destructive confirm required (consistent copy across app).
- Standardize on `BlockingConfirmDialog` copy where possible (avoid `window.confirm` drift).

---

## UI Component Strategy (How We Build the Two-Tier Menu)

### Create a shared `ItemActionsMenu` component
Proposed new component:
- `src/components/items/ItemActionsMenu.tsx`

Responsibilities:
- Render **three-dot button**
- Render top-level menu
- Render second-tier submenus for Sell/Move/Change status
- Accept:
  - `context`: `'project' | 'businessInventory' | 'transaction' | 'detail'` (or similar)
  - `item` (persisted vs draft, projectId, transactionId, disposition/status, inventoryStatus)
  - `projectId` (current viewing project context, used for “disable current project”)
  - Handlers / callbacks for each action (or a single “action dispatcher”)
  - `disabledReason` strings per option for tooltips

Implementation approach:
- Follow the existing app pattern of ad-hoc dropdowns using `position: absolute` + click-outside close.
- Add minimal keyboard support (Esc closes; focus management if feasible).
- Two-tier behavior:
  - Hover or click to open a submenu panel to the right.
  - Ensure mobile works (tap to open submenu; back/close affordance if needed).

### Keep bookmark separate (per requirement)
In preview and detail headers:
- **Bookmark button** (left)
- **Three-dot menu** (right next to bookmark)

Other contexts (transaction list etc.) can either:
- Keep bookmark separate if it already exists, or
- Move bookmark into menu if it’s not required there (but requirement says preview + detail only must keep it separate).

---

## Integration Points (Where We Apply This)

### 1) Item preview cards/rows (project + BI + transaction)
Files:
- `src/components/items/ItemPreviewCard.tsx`
- `src/components/items/InventoryItemRow.tsx`
- `src/components/TransactionItemsList.tsx`

Plan:
- Replace the cluster of right-side icon buttons (edit/duplicate/disposition/remove) with:
  - Bookmark (still separate where required)
  - Three-dot menu (new)
- Keep “Remove from transaction” functionality available via **Add to transaction…** dialog (unlink option) rather than its own icon (to avoid adding a 4th submenu tier).

### 2) Item detail (project + BI route)
File:
- `src/pages/ItemDetail.tsx`

Plan:
- Replace discrete buttons (except bookmark) with the new menu:
  - Bookmark stays
  - Three-dot menu contains Edit / Make Copies / Add To Transaction / Sell / Move / Change Status / Delete
- “Associate with project” UI should be subsumed into **Move → Move To Project…** (and disabled under the same “tied to transaction” rules).

### 3) Business inventory item detail
File:
- `src/pages/BusinessInventoryItemDetail.tsx`

Plan:
- Replace allocate/edit/duplicate/delete buttons with the new menu.
- “Allocate to project” becomes **Move → Move To Project…** (and should open the same project picker UI).

### 4) Edit item screen (optional but recommended for consistency)
File:
- `src/pages/EditItem.tsx`

Plan:
- This page is form-driven, so it may not need the three-dot menu in the header.
- But ensure action parity (transaction assignment + unlink) matches the behavior behind **Add to transaction…**.

---

## Project/Transaction Pickers (Re-use, Don’t Re-invent)

### Project picker for Move/Sell to project
Preferred: a shared modal/dialog used by:
- Item detail (project + BI)
- Item preview action (can open modal)

Requirements:
- List all projects
- Disable current project
- Show disabled reason

### Transaction picker for Add to transaction…
Preferred: reuse the existing transaction dialog patterns:
- `ItemDetail.tsx` already has a “Change Transaction” dialog and unlink flow.

---

## Backend Gaps / Tech Notes

### Sell to project (missing)
Needs a backend/service method that performs the cross-project orchestration safely and atomically (or with compensation logic):
- Sell to BI
- Purchase from BI into project
- Update lineage + transaction item_ids arrays as needed

Until then, UI should keep “Sell To Project…” visible but disabled with a clear reason.

### Consistency with canonical inventory transactions
Where possible, re-use `isCanonicalTransactionId(...)` guards and existing error copy so users get the same rationale everywhere.

---

## Implementation Order (Suggested)

1. Add `ItemActionsMenu` component (top-level + 3 submenus).
2. Wire it into `ItemDetail.tsx` sticky header (keep bookmark separate).
3. Wire it into `ItemPreviewCard.tsx` (keep bookmark separate) and remove scattered controls.
4. Wire it into `BusinessInventoryItemDetail.tsx`.
5. Reconcile transaction-context behavior in `TransactionItemsList.tsx`:
   - ensure “Add to transaction…” supports unlink
   - ensure draft/persisted rules don’t break existing transaction item editing
6. Standardize delete confirms to `BlockingConfirmDialog` copy.

---

## Test Plan (Manual)

### Basic menu behavior
- Menu opens/closes reliably; click outside closes.
- Submenus open and close correctly; no accidental page navigation.

### Disable rules
- Business inventory item: “Sell to design business” and “Move to design business” disabled.
- Project item: project picker disables current project.
- Item tied to transaction: “Move to project…” disabled with correct reason.

### Actions
- Edit navigates correctly in each context.
- Make copies produces correct number of duplicates in each context.
- Add to transaction: assign/change/unlink works as expected.
- Change status updates the item and reflects immediately.
- Delete requires confirm and removes item from lists/detail.

