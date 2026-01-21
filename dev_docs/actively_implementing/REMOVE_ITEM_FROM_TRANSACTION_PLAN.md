# Remove Item From Transaction (Unlink, Not Delete) Plan

## Goal
Enable users to **remove (unlink) an item from a transaction without deleting the item** itself, from three entry points:

- **Item preview card** (icon-only, compact)
- **Item detail** view
- **Edit item** (or edit-in-transaction context)

Key requirement: this is **always** a confirmed action via a **blocking confirmation dialog**.

## Core UX Concept + Language (Consistency)
This action is **unlinking** the relationship between transaction ↔ item. It is not deleting either record.

Use consistent wording everywhere:

- Primary label: **Remove from transaction**
- Clarifier (where space allows): **This won’t delete the item.**

Avoid:
- “Delete” (confusing / risky)
- “Remove item” (ambiguous)

## Proposed UX
### A) Transaction item preview cards (list/grid within a transaction)
- Add a small **icon button** on each item card (e.g., top-right / trailing).
- No full text on the card (to keep the card compact and consistent).
- **Accessibility label / tooltip**: “Remove from transaction”.
- **Hit target**: at least 44×44 (even if the visible icon is smaller).
- Tap opens the shared **blocking confirmation dialog** (see below).

#### Icon choice
Preferred: a **link-off / unlink** metaphor (best matches “detach from transaction”).

Fallbacks if link-off is not available in the icon set:
- **x-circle** (clear “remove from list”)
- **minus-circle** (clear “remove”)

### B) Item detail view (when viewing an item that is associated with a transaction context)
- Add an action row/button:
  - Label: **Remove from this transaction**
  - Subtext: “Does not delete the item.”
- Placement: in an “Actions” section near other transaction-scoped actions.
- Tap opens the shared **blocking confirmation dialog**.

### C) Edit item / Edit transaction item
- Add the same action:
  - Label: **Remove from this transaction**
- Placement: bottom “Actions” section.
- Unsaved changes behavior (keep consistent):
  - **Rule**: require the user to resolve unsaved changes first (save/cancel), then allow removal.
  - Rationale: reduces surprise data loss.
- Tap opens the shared **blocking confirmation dialog**.

## Confirmation Dialog (Blocking, Required Everywhere)
All entry points must use the same dialog component/config to prevent UX drift.

- **Title**: “Remove item from transaction?”
- **Body**:
  - “This will remove the item from this transaction.”
  - “The item will not be deleted.”
- **Buttons**:
  - Destructive primary: **Remove**
  - Secondary: **Cancel**

Blocking behavior:
- Must be explicitly dismissed via button tap.
- Backdrop click should be disabled (or treated as Cancel only if we explicitly decide that still counts as “clear dialog”; safest: disable).
- ESC / back-button behavior should be consistent across the app (recommend: maps to Cancel).

## Post-action Feedback
- Success: toast/snackbar: “Removed from transaction”.
- Failure: toast/snackbar: “Couldn’t remove item. Try again.”

## Behavioral Rules / Edge Cases
- **Offline**:
  - If offline operations are supported: queue the unlink and show “Pending sync” if applicable.
  - UI should reflect removal immediately (optimistic) if that matches existing patterns.
- **Permissions**:
  - If the user can’t edit the transaction, hide/disable the remove action consistently across all entry points.
- **Empty transaction after removal**:
  - Removing the last item should not delete the transaction. Show the “no items” empty state + add item CTA.
- **Audit trail** (if transaction audit exists):
  - Record an event like: “Item unlinked from transaction”.

## High-Level Technical Approach
Implement an explicit “unlink item from transaction” operation in the service layer (not delete).

- Shared handler invoked from:
  - card icon button
  - item detail action
  - edit screen action
- All flows:
  - open blocking confirm
  - on confirm: perform unlink
  - update local UI state + invalidate/refetch derived data (totals, inventory attribution, audit panels)

## Implementation Steps (Suggested Order)
1. **Service-layer unlink**: implement a single “remove item from transaction” function (no deletion).
2. **Shared confirmation dialog**: reusable confirm dialog with the copy above.
3. **Card icon affordance**: add icon button + a11y label to item preview cards.
4. **Detail view action**: add “Remove from this transaction” action that calls the same handler.
5. **Edit flow action**: add the same action with the unsaved-changes rule.
6. **State updates / cache invalidation**: ensure totals + audit + attribution update correctly.
7. **Polish**: consistent disabled states, error handling, and feedback.

## Testing Plan
### Manual
- Remove via **card icon** → confirm → item disappears from transaction; item still exists elsewhere.
- Remove via **detail action** → same behavior.
- Remove via **edit action** → same behavior; unsaved changes rule enforced.
- Offline behavior (if supported): removal queues and reflects expected UI state.

### Automated (optional / follow-up)
- Service test: unlink removes relationship only.
- UI test: confirmation dialog blocks and requires explicit confirm; cancel is no-op.
