# Triage rubric: when to require a screen contract and how to slice work

## When a screen contract is mandatory

Mark a screen as **contract required** if any of these are true:
- **Media**: uploads, previews, lightbox/gallery, delete semantics, placeholders, quota limits.
- **Offline-first mutations**: optimistic UI, pending state, retry, restart/reconnect behavior.
- **Collaboration**: two-device propagation expectations, conflict UX, “stale vs fresh” rules.
- **High branching**: multiple menus, modals, bulk actions, complex filtering/sorting/grouping.
- **Multi-entity correctness**: one user action touches multiple entities (allocation/sell/deallocate/linking).

Mark as **optional** if the screen is mostly presentational and only consumes already-defined patterns.

## How to slice a large screen into multiple AI chats

Prefer 2–4 slices, each producing one coherent doc section:
- **Slice A (shared UI)**: reusable components/patterns → `_cross_cutting`
- **Slice B (media)**: upload/preview/delete/lightbox integration
- **Slice C (lists + bulk)**: search/filter/sort/group/selection/bulk actions
- **Slice D (offline/collab/conflicts)**: pending/retry/conflict resolution + propagation expectations

## Evidence expectation

For each slice:
- Every non-obvious rule gets “Observed in … file + component/function”.
- If you can’t find parity evidence, treat it as a delta and justify it.

