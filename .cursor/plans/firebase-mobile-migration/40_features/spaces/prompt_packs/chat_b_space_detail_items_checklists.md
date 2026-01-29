# Prompt Pack — Spaces (B) Space detail: items assignment + checklists

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity specs grounded in the existing codebase (web) so an implementation team can reproduce behavior with the new architecture.

## Outputs (required)

Update or create the following docs:
- `40_features/spaces/feature_spec.md`
- `40_features/spaces/acceptance_criteria.md`
- `40_features/spaces/ui/screens/SpaceDetail.md`

If you find cross-cutting checklist conflict UX is needed, create:
- `40_features/_cross_cutting/flows/space_checklist_conflicts.md` (only if needed)

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/SpaceDetail.tsx` (Items tab + Checklists tab)
- `src/components/spaces/SpaceItemPicker.tsx` (Add existing items modal)
- `src/components/TransactionItemsList.tsx` (itemization surface used in “space” context)
- `src/utils/spaceItemFormMapping.ts` (mapping between item and form model)

Related services/hooks:
- `src/services/inventoryService.ts` (`unifiedItemsService`)
- `src/services/spaceService.ts` (space update for checklists)

## What to capture (required sections)
- Items tab:
  - create item in space (field defaults + image upload follow-up)
  - add existing items modal (search + select-all + grouping + add selected)
  - bulk remove/move semantics (spaceId set/clear)
- Checklists tab:
  - checklist CRUD (add/rename/delete)
  - checklist item CRUD (add/edit/delete + checked toggle)
  - commit semantics (blur/Enter/Escape) and rollback on failure
- Offline behavior:
  - local-first item updates and checklist updates
  - pending and retry UX
  - restart + reconnect behavior
- Collaboration expectations:
  - no large listeners; change-signal + delta

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence (file + component/function), OR
- Mark as an intentional change and explain why.

## Constraints / non-goals
- Do not spec full item CRUD here; link to `project-items`.
- Do not subscribe to all items; use change-signal + delta.

