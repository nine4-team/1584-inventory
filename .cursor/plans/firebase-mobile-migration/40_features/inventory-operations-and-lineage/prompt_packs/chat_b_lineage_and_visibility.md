# Prompt Pack: Lineage edges + visibility cues

## Goal
Produce parity-grade specs for **lineage** (edges + pointers) used by inventory operations so the mobile Firebase implementation can preserve “where did this go?” behavior offline-first.

## Outputs (required)
Update/create only these docs:
- `40_features/inventory-operations-and-lineage/feature_spec.md` (lineage section only)
- `40_features/inventory-operations-and-lineage/acceptance_criteria.md` (lineage section only)
- `40_features/inventory-operations-and-lineage/flows/lineage_edges_and_pointers.md`

If cross-cutting docs are required (only if shared across many features), create under:
- `40_features/_cross_cutting/...` and link from the above docs.

## Source-of-truth code pointers
- Lineage service: `src/services/lineageService.ts`
  - `appendItemLineageEdge`
  - `updateItemLineagePointers`
  - `getItemLineageHistory`
  - subscription helpers
- Where lineage is emitted today:
  - `src/services/inventoryService.ts` (allocation/deallocation/move helpers call lineage service)

## What to capture (required)
- Edge schema (conceptual) + pointer fields and their semantics
- Required edges for each inventory operation
- Offline behavior policy for mobile (local DB + delta sync for lineage edges)
- Any UI expectations that depend on lineage (where displayed, fallback when missing)

## Evidence rule (anti-hallucination)
For each non-obvious behavior:
- Provide **parity evidence** (file + component/function), OR
- Mark as **intentional delta** with rationale.

## Constraints / non-goals
- Don’t invent a second lineage model; align with the existing service shape unless there is a necessary Firebase delta.
- Don’t attach large listeners; lineage changes propagate via change-signal + delta.
