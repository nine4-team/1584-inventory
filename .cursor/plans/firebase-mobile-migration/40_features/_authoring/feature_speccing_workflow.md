# Feature speccing workflow (canonical process)

This is the **canonical workflow/process doc** for producing `40_features/<feature>/` spec folders.

If guidance appears elsewhere, it should be merged here (or deleted).

## Human steering note (so you don’t have to read this)

If you’re “steering the boat”, you typically do **not** need this doc.

- Pick a feature from `../feature_list.md`
- Run the feature-local prompt packs in `40_features/<feature>/prompt_packs/`

You only come here when you want to create a *new* feature folder, create new prompt packs, or enforce consistency across multiple AI chats.

## Core inputs (canonical)

- **Feature inventory + parity details**: `../feature_list.md` (includes an appendix with the observed existing-app inventory)
- **Architecture constraints**: `../../sync_engine_spec.plan.md` (local-first, explicit outbox, delta sync, tiny change-signal; avoid large listeners)

## Outputs (per feature)

Each feature lives in `40_features/<feature>/` and should produce at minimum:

- `README.md` (scope/non-scope + links)
- `feature_spec.md` (behavior spec; references contracts/flows where needed)
- `acceptance_criteria.md` (testable checklist with parity evidence or intentional deltas)

Add only when needed:

- `ui/screens/<screen>.md` (screen contracts)
- `flows/<flow>.md` (multi-screen flows)
- `data/*.md` (schema/rules/indexes/sync notes)
- `tests/test_cases.md` (expanded test cases traced to acceptance criteria)

## Workflow (the assembly line)

### 1) Pick the feature and name it once

- Choose a feature slug from `../feature_list.md`.
- Use **kebab-case** for feature folder names (e.g. `project-transactions`).

### 2) Triage: decide where contracts are mandatory

- Use: `templates/triage_rubric.md`
- Rule: if a screen has multiple plausible implementations and one would break UX/correctness/cost, write a **screen contract**.

### 3) Create a lightweight work order (optional but recommended)

- Create `40_features/<feature>/plan.md` using: `templates/feature_plan_template.md`
- The plan is procedural (“what to produce next”), not a second spec source of truth.

### 4) Create prompt packs for parallel AI dev chats

- Use: `templates/prompt_pack_template.md`
- Put packs next to the feature: `40_features/<feature>/prompt_packs/`
- Slice big work into **2–4 chats**, e.g.:
  - shared UI behavior → `_cross_cutting`
  - media behaviors
  - lists/bulk actions
  - offline/retry/conflicts/collaboration expectations

Each prompt pack must specify:

- **exact output files** to create/update
- **source-of-truth code pointers** (file paths)
- the **evidence rule** (below)

### 5) Write shared behaviors once in `_cross_cutting`

If multiple features would otherwise duplicate a behavior/contract, create a single shared doc under:

`40_features/_cross_cutting/...`

Use: `templates/cross_cutting_template.md`

Then link to it from feature specs instead of rewriting the same behavior.

### 6) Apply the evidence rule (anti-hallucination)

For each **non-obvious** behavior or acceptance criterion, include one of:

- **Parity evidence**: “Observed in …” with file + component/function name in the existing codebase, or
- **Intentional delta**: explicitly state what changes and why.

### 7) Check “spec complete”

Use: `templates/definition_of_done.md`

## Templates (single home)

All reusable templates live next to this workflow doc in `templates/`:

- `templates/definition_of_done.md`
- `templates/triage_rubric.md`
- `templates/prompt_pack_template.md`
- `templates/feature_plan_template.md`
- `templates/screen_contract_template.md`
- `templates/cross_cutting_template.md`

