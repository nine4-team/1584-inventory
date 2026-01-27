# Migration docs roadmap (what docs exist vs what we plan to write)

This doc captures the **big picture** content that used to live in the old long `README.md`:

- **Directory layout conventions**
- **Feature folder template**
- **Cross-cutting conventions**
- **Minimum viable doc set** (roadmap of future docs to write)

This is **not** a second workflow/process doc. The workflow is `40_features/_authoring/feature_speccing_workflow.md`.

Practical note:
- You don’t need `ROADMAP.md` to run a feature prompt pack chat.
- You *do* use `ROADMAP.md` when planning the overall migration docs, deciding what to write next, or validating the directory structure.

---

## Directory layout conventions

We keep the doc set small and human-navigable by letting only `40_features/` “multiply”. Everything else stays compact.

### Recommended top-level layout

These folders exist now (even if some are currently empty), so the structure is visible and stable.

```
firebase-mobile-migration/
  10_architecture/
  20_data/
  30_app_skeleton/
  40_features/
  50_migration/
  60_testing/
  70_ops/
```

Notes:
- You can keep everything flat and prefix filenames with numbers; the key is **clear ownership and cross-linking**.
- `40_features/` is the only place that should expand significantly over time.

---

## Feature directory template (`40_features/<feature>/`)

Use this as the default kit. Small features can omit optional files; large features can add more under `ui/screens/*` and `flows/*` without changing the overall model.

```
40_features/<feature>/
  README.md
  feature_spec.md
  acceptance_criteria.md
  plan.md                       # optional: procedural work order
  prompt_packs/                 # feature-local prompt packs (copy/paste)
  ui/
    screens/
      <screen>.md               # optional: screen contract when ambiguity exists
  flows/
    <flow>.md                   # optional: multi-screen flows
  data/
    entities.md                 # optional: feature-scoped deltas to global model
    firestore_rules_notes.md    # optional: rules/membership implications
    indexes.md                  # optional: Firestore/SQLite index notes
    sync_notes.md               # optional: rare feature-specific sync notes
  tests/
    test_cases.md               # optional: detailed test cases traced to acceptance criteria
```

Where key UI artifacts live:
- **Screen contracts**: `40_features/<feature>/ui/screens/*`
- **User flows**: `40_features/<feature>/flows/*` (or inline when small)
- **Acceptance criteria**: `40_features/<feature>/acceptance_criteria.md` (canonical checklist)

---

## Cross-cutting conventions (`40_features/_cross_cutting/`)

If a user flow or UI behavior spans multiple features, put it in one explicit place to avoid duplicating the same rules across feature folders:

```
40_features/_cross_cutting/
  flows/
    <flow>.md
  ui/
    components/
      <pattern>.md
    screens/
      <screen>.md
```

Examples:
- “Capture receipt → upload → attach to transaction → link to item”
- “Invite member → accept invite → gain access to project”

Use the template: `40_features/_authoring/templates/cross_cutting_template.md`.

---

## Level of detail rule (keep this tractable)

Write down details when either of these is true:

1) **It changes the data model, sync correctness, security rules, or costs.**
2) **A dev/AI could reasonably implement it two different ways**, and one way would break UX, correctness, or budget.

Do not try to document every pixel. Instead, capture UI behavior as:
- **Screen contracts**
- **User flows**
- **Acceptance criteria**

If the old app exists and devs/AI can inspect it, usually you only need **deltas**:
- “Match existing behavior” + explicit exceptions/improvements.

---

## Minimum viable migration docs (roadmap)

These are the documents we expect to create over time. Many do not exist yet; this is a target structure to prevent ad hoc sprawl.

### 00_overview
If we need “overview” documents in the future, put them under `40_features/_authoring/` (process) or under the most relevant non-feature directory (e.g. `50_migration/`, `70_ops/`), rather than creating a new overview folder.

### 10_architecture
- `10_architecture/target_system_architecture.md`
  - Auth, Firestore, Storage, Functions, local DB, sync engine, observability.
- `10_architecture/security_model.md`
  - Roles, membership, Firestore rules principles, “who can write what”.
- `10_architecture/offline_first_principles.md`
  - UX invariants (local-first), background limitations, conflict UX stance.

### 20_data
- `20_data/firebase_data_model.md`
  - Collections/docs, required fields (`updatedAt`, `deletedAt`, `version`, `lastMutationId`, etc).
  - Relationship modeling choices.
- `20_data/local_sqlite_schema.md`
  - Tables, indexes (including search), migrations approach.
- `20_data/data_contracts.md`
  - Type-level contracts for each entity (TS types), including optionality rules.

### 30_app_skeleton
- `30_app_skeleton/app_skeleton_spec.md`
  - App bootstrap, navigation shell, local DB init/migrations, sync wiring, logging, error boundaries, offline banners, retry patterns.

### 40_features
- `40_features/<feature>/feature_spec.md` + `acceptance_criteria.md` + (contracts/flows as needed)

### 50_migration
- `50_migration/postgres_to_firestore_mapping.md`
  - Field mapping, IDs strategy, timestamps, tombstones.
- `50_migration/migration_runbook.md`
  - Export → transform → import → verify → rollback plan.
- `50_migration/verification_checklist.md`
  - Counts, spot checks, reconciliation reports, attachment validation.

### 60_testing
- `60_testing/test_plan.md`
  - Emulator testing + 2-device propagation + offline media tests.

### 70_ops
- `70_ops/observability_and_cost_guardrails.md`
  - Guardrails against accidental large listeners.
  - Dashboards: reads/writes, storage egress, function latency, crash-free.

---

## How the sync engine spec fits

Treat `sync_engine_spec.plan.md` as the **Sync Engine spec** (conceptually “10_architecture/sync_engine_spec.md”).
When adding other docs, **link to it** rather than duplicating its constraints/decisions.

---

## Suggested next steps (concrete)

1) Write any missing “big picture” docs in the most relevant non-feature directory (e.g. `50_migration/` for migration runbook, `70_ops/` for guardrails).
2) Write `30_app_skeleton/app_skeleton_spec.md` (the reusable foundation).
3) Write `20_data/firebase_data_model.md` + `20_data/local_sqlite_schema.md` (so features don’t invent schemas ad hoc).
4) Only then expand `40_features/*` specs.

