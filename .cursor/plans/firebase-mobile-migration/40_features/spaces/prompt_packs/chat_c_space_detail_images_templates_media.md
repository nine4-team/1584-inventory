# Prompt Pack — Spaces (C) Space detail: images + templates + offline media

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

If shared media behavior needs clarification, update:
- `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md` (only if this feature reveals gaps)

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/SpaceDetail.tsx` (Images tab + Save as Template action)
- `src/components/ui/ImagePreview.tsx` (image grid control surface)
- `src/components/spaces/SpacePreviewCard.tsx` (offline placeholder resolution on card)

Related services/hooks:
- `src/services/offlineAwareImageService.ts` (`uploadSpaceImage`)
- `src/services/offlineMediaService.ts` (local media blob storage)
- `src/services/spaceService.ts` (`removeSpaceImage`, `setSpacePrimaryImage`)
- `src/services/spaceTemplatesService.ts` (save template)
- `src/contexts/AccountContext.tsx` (`isAdmin` gate)

## What to capture (required sections)
- Images tab:
  - add images (multi-select; upload indicator)
  - placeholder URLs (`offline://`) and render semantics
  - set primary, remove image
  - max image count and UI constraints
- Save as template:
  - admin-only action
  - template form + name required
  - checklist normalization for templates (unchecked)
- Offline behavior:
  - local-first append/remove/primary operations
  - retry behavior for failed uploads and failed mutations
  - cleanup/orphan rules (object URLs, offline blobs)
- Collaboration expectations:
  - no large listeners; change-signal + delta

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence (file + component/function), OR
- Mark as an intentional change and explain why.

## Constraints / non-goals
- Don’t invent new media workflows; align with `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`.

