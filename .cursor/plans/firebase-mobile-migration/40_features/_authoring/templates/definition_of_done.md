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

