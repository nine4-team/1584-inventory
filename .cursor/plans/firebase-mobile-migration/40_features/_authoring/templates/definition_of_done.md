# Definition of Done (Spec Complete)

A feature is “spec complete” only if:

- **Traceability**: every acceptance criterion is backed by either:
  - **parity evidence** (Observed in … file + component/function), or
  - an **intentional delta** (what changes + why).
- **Offline clarity**: create/edit/delete/search is explicit, including:
  - pending UI
  - retries + error states
  - app restart behavior
  - reconnect behavior
- **Collaboration clarity**: if collaborative:
  - propagation expectations while foregrounded are explicit
  - docs do not imply large listeners; they reference change-signal + delta.
- **Media clarity** (if applicable):
  - local placeholder behavior
  - upload progress UX
  - delete semantics
  - quota limits + cleanup/orphan rules
- **Cross-links**: feature docs link to:
  - required screen contracts
  - cross-cutting docs they depend on
  - sync engine spec (when relevant)

- **Shared-module reuse (when applicable)**:
  - If the feature touches Items or Transactions UI (lists/menus/details/forms), the spec explicitly states whether it uses the shared modules.
  - The spec must not introduce separate “project vs business inventory” implementations for Items/Transactions; it must reference:
    - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

