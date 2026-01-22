# Transaction Submit: Business Inventory Routing Outline

## Goal
- Ensure transactions paid by the design business are created in business inventory, not the current project.

## Core Concept: "Who Pays" Gate
- Early, top-level choice determines save behavior and which controls appear.
- Two options:
  - **Project pays** → transaction saved under selected project.
  - **Business pays** → transaction saved in business inventory.

## UX Flow (High-Level)
### 1) Add Transaction Entry
- Step 1: **Who is paying?** (Project vs Business)
- If **Project pays**:
  - Step 2: **Select project** (single)
  - Step 3: Existing transaction fields (unchanged)
- If **Business pays**:
  - Step 2: **Intended for** (multi-select projects; optional)
  - Step 3: Existing transaction fields (unchanged)

## UI/Control Behavior
- "Who pays" appears before any project selection.
- **Project pays** path hides "Intended for".
- **Business pays** path shows "Intended for" multi-select.
- "Intended for" supports any number of projects, including none.

## Save Behavior
### Project Pays
- Create transaction under selected project (current behavior).

### Business Pays
- Create transaction in **business inventory**.
- Do **not** create a project transaction.
- Items created under this transaction can be assigned to projects later.

## Item Creation + Assignment
- Items created from a business-paid transaction support per-item project assignment.
- Default item assignment behavior (if any) should be defined.
- Item assignment can differ from "Intended for" selection.

## Data / Field Decisions
- Decide whether to rename or repurpose:
  - `payment_method` vs `who_pays` vs `buyer_type`
  - `intended_for` field naming and storage
- Confirm the field(s) used to route save logic.

## Validation Rules
- Project pays → project selection required.
- Business pays → no required project selection.
- "Intended for" supports 0+ projects.

## Open Questions
- How do we store "Intended for" (array of project IDs? join table? metadata)?
- Should "Intended for" influence defaults when creating items?
- How is this surfaced in transaction detail views?

## Implementation Work Areas (Skeleton)
- UI: Add transaction flow / modal / page
- State: Who pays gate + conditional fields
- Save logic: route to business inventory vs project
- Items: assignment UX + data flow
- Analytics/Audit: track business-paid routing

## Testing Plan (Skeleton)
- Project pays path: transaction lands in selected project.
- Business pays path: transaction lands in business inventory only.
- "Intended for" multi-select persists and edits.
- Item creation from business-paid transaction assigns projects correctly.
