---
name: space-templates-settings
overview: Add a Settings-level Space Templates manager (account-scoped), backed by a dedicated `space_templates` table. Users can create spaces from templates and save modified spaces as new templates. Update the current Spaces implementation and creation flows accordingly.
todos:
  - id: add-space-templates-schema
    content: Add `space_templates` schema and optional `spaces.template_id` back-reference (migrations + RLS).
    status: pending
  - id: add-settings-space-templates-ui
    content: Add `SpaceTemplatesManager` to Settings → Presets (admin-only) with list/create/edit/archive/unarchive + show/hide archived, plus template detail/edit.
    status: pending
  - id: update-create-space-from-template
    content: Update `SpaceNew` to support optional Template picker; on submit, create a project space by cloning the template (and allow “start blank”).
    status: pending
  - id: add-save-as-template
    content: Add “Save as new template” action on `SpaceDetail` (or space edit UI) to create a template from an existing space.
    status: pending
  - id: card-styling-reuse
    content: Reuse/refactor `SpacePreviewCard` (or create template variant) for templates UI to keep consistent preview-card styling.
    status: pending
isProject: false
---

# Space Templates in Settings (account-scoped) — JR-proof plan

## Goal (what we’re building)

Add **Space Templates** that are **account-scoped definitions** managed in **Settings → Presets** (admin-only). Users can then:

- **Create a project space from a template** (clone template → new `spaces` row for the current project)
- **Save an existing space as a new template** (space → new `space_templates` row)

This is specifically designed to prevent reintroducing “account-wide spaces as sharing” behavior.

## Non-goals (explicitly out of scope for v1)

- Templates auto-updating existing spaces (no propagation)
- Template images / checklist content (future migrations; **not** v1)
- Enforcing “no account-wide spaces” at the DB layer (v1 relies on UI/app behavior; see “Deprecation”)

## Definitions (use these terms in code + UI)

- **Space**: an instantiated location **within a project** (`spaces.project_id = <projectId>`)
- **Legacy account-wide space**: a `spaces` row where `project_id IS NULL` (may exist historically, but **must not be creatable via UI after this change**)
- **Space template**: an account-scoped definition stored in `space_templates` (archivable)

## Current state (anchor points in THIS repo)

- `spaces` table exists and currently allows both project and “account-wide” via `project_id IS NULL` (see `supabase/migrations/20260124_create_spaces_and_item_space_id.sql`)
- `SpaceNew.tsx` currently has an “account-wide” checkbox that sets `projectId: null` on create
- `spaceService.listSpaces()` contains a bug: the “only account-wide spaces” branch is unreachable because it checks `projectId !== undefined` before `projectId === null`
- Settings “Presets” tab is already **admin-only** via `isAdmin` gate (see `src/pages/Settings.tsx`)

## Database changes (copy/paste SQL migrations)

### Migration: create `space_templates` + (optional) `spaces.template_id`

Create a new migration file:

- `supabase/migrations/20260124_create_space_templates_and_space_template_id.sql`

Copy/paste the following SQL (do not “interpret”; apply as-is):

```sql
-- Create space_templates table and (optional) spaces.template_id back-reference
-- Prereqs: can_access_account(uuid) and is_system_owner() must exist (same as spaces migration)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'can_access_account'
  ) THEN
    RAISE EXCEPTION 'Prerequisite migration missing: required RLS helper function can_access_account(uuid) not found.';
  END IF;
END
$$;

-- 1) Create table
CREATE TABLE space_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  version INT NOT NULL DEFAULT 1
);

-- 2) Indexes + uniqueness rules
CREATE INDEX idx_space_templates_account_id ON space_templates(account_id);
CREATE INDEX idx_space_templates_account_id_archived ON space_templates(account_id, is_archived);

-- Uniqueness (JR-proof rule):
-- - Active templates must have unique names per account (case-insensitive)
-- - Archived templates DO NOT block name reuse
CREATE UNIQUE INDEX space_templates_unique_active_name
  ON space_templates(account_id, lower(trim(name)))
  WHERE is_archived = false;

-- 3) Enable RLS + policies (mirror spaces policies)
ALTER TABLE space_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read space_templates in their account or owners can read all"
  ON space_templates FOR SELECT
  USING (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can create space_templates in their account or owners can create any"
  ON space_templates FOR INSERT
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can update space_templates in their account or owners can update any"
  ON space_templates FOR UPDATE
  USING (can_access_account(account_id) OR is_system_owner())
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can delete space_templates in their account or owners can delete any"
  ON space_templates FOR DELETE
  USING (can_access_account(account_id) OR is_system_owner());

-- 4) Optional provenance: spaces.template_id
ALTER TABLE spaces ADD COLUMN template_id UUID NULL REFERENCES space_templates(id) ON DELETE SET NULL;
CREATE INDEX idx_spaces_template_id ON spaces(template_id);

COMMENT ON TABLE space_templates IS 'Account-scoped definitions for creating project spaces. Archived templates are hidden from pickers.';
COMMENT ON COLUMN spaces.template_id IS 'Optional provenance back-reference: set when a space is created from a template.';
```

### Notes (important “sharp edges”)

- **Name uniqueness**: enforced **case-insensitively** on **active** templates only. Archiving frees the name for reuse.
- **`spaces.template_id` behavior**: nullable, and **`ON DELETE SET NULL`** so deleting a template never deletes spaces.

## Deprecation policy: “account-wide spaces”

We are **deprecating account-wide spaces as a creation option**.

- **DB**: `spaces.project_id IS NULL` will still be allowed for now (no constraint added in v1).
- **App**: after this change, **no UI path** may create spaces with `project_id IS NULL`.
- **Legacy rows**: if they exist, they may still render (and can be cleaned up later), but we do not create new ones.

## Clone contract (field-by-field, no ambiguity)

### Template → Space (Create Space “from template”)

When creating a new space from a selected template, the new `spaces` row MUST be:

- `account_id`: current account
- `project_id`: current project (never `NULL`)
- `template_id`: selected template id
- `name`: template `name` (user may edit before submit)
- `notes`: template `notes` (user may edit before submit)
- `images`: `[]` (always empty in v1; templates do not carry images)
- `is_archived`: `false`
- `metadata`: `{}`
- `version`: `1`
- `created_by` / `updated_by`: current user id

### Space → Template (Save space as new template)

When saving a space as a new template, the new `space_templates` row MUST be:

- `account_id`: current account
- `name`: default = space `name` (user can edit; required)
- `notes`: default = space `notes` (user can edit; optional)
- `is_archived`: `false`
- `metadata`: `{}`
- `version`: `1`
- `created_by` / `updated_by`: current user id

Explicitly NOT copied in v1:

- Space `images` (templates have no images)
- Space `project_id` (templates are account-scoped)
- Space `template_id` (irrelevant)

## App behavior (unambiguous UI states)

### Settings → Presets → Space Templates (admin-only)

Add a `SpaceTemplatesManager` panel next to existing managers.

- **Visibility**: only render for `isAdmin === true` (same as other Presets managers)
- **List defaults**:
  - show active templates only
  - sort by `name` asc
  - include a “Show archived” toggle; when enabled, include archived templates in the list
- **Row actions**:
  - Edit (name, notes)
  - Archive / Unarchive (soft toggle `is_archived`)
- **Create**:
  - “New template” button opens modal
  - fields: Name (required), Notes (optional)
  - on submit: create template, then refresh list
- **Delete**: do not implement hard delete in v1 (archive instead)

### Create Space modal (`src/pages/SpaceNew.tsx`)

Replace the “account-wide” checkbox with a template picker.

- **Default state**:
  - Template picker shows placeholder “Start blank” (no template selected)
  - Name + Notes are empty
- **Template picker contents**:
  - list **only** templates where `is_archived = false`
  - sorted by name asc
- **When selecting a template**:
  - immediately prefill `name` and `notes` from the template (overwrite current inputs)
  - user may edit after prefill
- **On submit**:
  - ALWAYS create a project space: `project_id = projectId` (never `NULL`)
  - if template selected, also set `template_id = selectedTemplateId`
- **Error behavior**:
  - if unique constraint error: show “A space with this name already exists” (existing behavior)

### Space detail (`src/pages/SpaceDetail.tsx`)

Add an admin-only action “Save as new template”.

- **Visibility**: only if `isAdmin === true`
- **Action flow**:
  - click opens modal:
    - Name (required, default = `space.name`)
    - Notes (optional, default = `space.notes`)
  - submit creates a new template via `spaceTemplatesService.createTemplate`
  - success toast: “Template created”

## Permissions (explicit)

- **Create spaces in a project**: any authenticated user (existing behavior)
- **Create/update/archive templates**: **admin-only via UI**
  - Note: RLS policies allow account members; enforcement is in app UI (consistent with other Presets managers)

## Integration checklist (exact files + edits)

### Database

- Add migration: `supabase/migrations/20260124_create_space_templates_and_space_template_id.sql` (SQL above)

### Types

- `src/types/index.ts`
  - Add `export interface SpaceTemplate { ... }` (camelCase fields mirroring `space_templates`)
  - Add `templateId?: string | null` to `Space` (maps to DB `template_id`)

### Services

- Add `src/services/spaceTemplatesService.ts`
  - `listTemplates({ accountId, includeArchived })`
  - `createTemplate({ accountId, name, notes }, createdBy?)`
  - `updateTemplate(accountId, templateId, updates, updatedBy?)`
  - `archiveTemplate(accountId, templateId, updatedBy?)` / `unarchiveTemplate(...)`
  - Mirror patterns from `src/services/spaceService.ts`:
    - `ensureAuthenticatedForDatabase()`
    - `handleSupabaseError()`
    - timestamp mapping via `convertTimestamps`

- Update `src/services/spaceService.ts`
  - Fix unreachable branch in `listSpaces()`:
    - check `projectId === null` BEFORE `projectId !== undefined`, or handle with explicit branching:
      - `projectId === undefined` → no project filter
      - `projectId === null` → only account-wide
      - `projectId` string → project + account-wide
  - Add support for `template_id` mapping in `mapSpaceRowToSpace()` and `createSpace()`/`updateSpace()` as needed

### UI

- `src/pages/Settings.tsx`
  - Import and mount `<SpaceTemplatesManager />` inside the `presets` tab, admin-only section

- Add `src/components/spaces/SpaceTemplatesManager.tsx`
  - Implement list/create/edit/archive/unarchive UI (see “Settings” rules above)
  - Use `spaceTemplatesService`

- `src/pages/SpaceNew.tsx`
  - Remove `isAccountWide` state + checkbox UI
  - Add template picker:
    - load templates via `spaceTemplatesService.listTemplates({ accountId, includeArchived: false })`
    - store `selectedTemplateId: string | null`
    - on change: prefill name/notes from selected template
  - On submit: `projectId` must always be the current `projectId` param (never `null`)
  - If template selected: set `templateId` on create

- `src/pages/SpaceDetail.tsx`
  - Read `isAdmin` from `useAccount()`
  - Add admin-only “Save as new template” button + modal
  - On confirm: call `spaceTemplatesService.createTemplate`

### Styling reuse (optional but recommended)

- Do **not** refactor `SpacePreviewCard` in v1. The templates list should use a simple list/card UI in Settings to reduce risk.

## Acceptance criteria (pass/fail, JR-proof)

- **AC1**: Creating a template in Settings makes it appear in the Create Space template picker immediately after refresh (no archived templates shown).
- **AC2**: Creating a space “from template” creates a `spaces` row with:
  - `project_id = <current project id>`
  - `template_id = <selected template id>`
  - `name/notes` prefilled from template unless user edits
- **AC3**: “Save as new template” from `SpaceDetail` creates a `space_templates` row that appears in Settings and in the picker.
- **AC4**: Archived templates do not appear in the picker; unarchiving restores them.
- **AC5**: After this change, **no path in UI creates `spaces.project_id IS NULL`** (account-wide checkbox removed).
- **AC6**: Space creation still works when “Start blank” is chosen.

## Manual test plan (minimum)

- As admin:
  - create template; verify it shows in Settings list and SpaceNew picker
  - archive template; verify it disappears from picker; toggle “Show archived” to confirm it exists
  - unarchive; verify it reappears in picker
  - open a space; “Save as new template”; verify appears in Settings + picker
- As non-admin:
  - cannot see Templates manager in Settings presets
  - can still create spaces, and can choose templates in SpaceNew (read-only consumption)

## Guardrails for juniors (things NOT to do)

- Do not “repurpose” `spaces.project_id IS NULL` as templates. Templates must be in `space_templates`.
- Do not copy space images into templates (v1 explicitly forbids this).
- Do not auto-update existing spaces when editing a template (v1 explicitly forbids this).