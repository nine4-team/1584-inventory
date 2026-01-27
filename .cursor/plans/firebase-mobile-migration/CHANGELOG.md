# Changelog (doc set cleanup)

## 2026-01-26

### Goals
- Create **one clear entry point** and remove “which doc is current?” ambiguity.
- Remove duplicate/pointer docs.
- Put all reusable templates in **one place**.
- Keep important “big picture” guidance, but not inside a bloated README.

### Changes
- **Added** `README.md` as the canonical “start here” entry point (rewritten to be short and non-redundant).
- **Added** `40_features/_authoring/feature_speccing_workflow.md` as the **single** process/workflow doc (merged prior playbook/SOP guidance into one place).
- **Added** `ROADMAP.md` to preserve the prior “directory layout + minimum doc set” guidance without making `README.md` huge again.
- **Added** `40_features/_authoring/templates/` as the **only** authoring templates location:
  - `40_features/_authoring/templates/definition_of_done.md`
  - `40_features/_authoring/templates/triage_rubric.md`
  - `40_features/_authoring/templates/prompt_pack_template.md`
  - `40_features/_authoring/templates/feature_plan_template.md`
  - `40_features/_authoring/templates/screen_contract_template.md`
  - `40_features/_authoring/templates/cross_cutting_template.md`

### Removed / replaced
- Removed redundant “moved” pointer docs at the top level:
  - `prompt_pack_template.md`
  - `next_steps_work_order.md`
- Removed the old templates/toolkit folder under `40_features/_spec_toolkit/` after copying its reusable content into `40_features/_authoring/templates/`.

