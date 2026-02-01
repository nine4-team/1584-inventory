# Prompt Pack — Spaces (A) List + create/edit/delete

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
- `40_features/spaces/README.md`
- `40_features/spaces/feature_spec.md`
- `40_features/spaces/acceptance_criteria.md`
- `40_features/spaces/ui/screens/ProjectSpacesList.md`
- `40_features/spaces/ui/screens/SpaceForm.md`

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/ProjectSpacesPage.tsx`
- `src/pages/SpaceNew.tsx`
- `src/pages/SpaceEdit.tsx`
- `src/components/spaces/SpacePreviewCard.tsx`

Related services/hooks:
- `src/utils/routes.ts` (`projectSpaces`, `projectSpaceNew`, `projectSpaceEdit`)
- `src/services/spaceService.ts`
- `src/contexts/ProjectRealtimeContext.tsx` (project refresh + spaces load)

## What to capture (required sections)
- Owned screens + routes
- Primary flows:
  - browse/search spaces
  - create space (template picker behavior included)
  - edit space (returnTo behavior)
  - delete space (confirm + warning)
- Entities touched:
  - `spaces` (name/notes/projectId/templateId/images/checklists)
  - `items` (space assignment semantics, only at a high level)
- Offline behavior:
  - local-first creates/edits/deletes
  - pending UI patterns
  - restart + reconnect behavior (link to sync engine spec)
- Collaboration expectations:
  - no large listeners; change-signal + delta

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence (file + component/function), OR
- Mark as an intentional change and explain why.

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; realtime must use change-signal + delta.
- Do not do pixel-perfect design specs.

