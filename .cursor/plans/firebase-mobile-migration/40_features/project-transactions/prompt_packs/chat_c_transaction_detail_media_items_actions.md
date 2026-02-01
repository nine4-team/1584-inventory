# Prompt Pack — Project Transactions (Chat C: Transaction detail — media + items + actions)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity specs for **TransactionDetail**: receipts + other images (gallery + pinning), itemization surface, and transaction actions (edit/move/delete), including offline placeholder semantics.

## Outputs (required)

Update or create the following docs:
- `40_features/project-transactions/feature_spec.md`
- `40_features/project-transactions/acceptance_criteria.md`
- `40_features/project-transactions/ui/screens/TransactionDetail.md`

If you need to update shared behavior:
- `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

If you discover additional shared contracts needed:
- create under `40_features/_cross_cutting/...` and link it from the feature docs.

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/TransactionDetail.tsx`
- `src/components/transactions/TransactionActionsMenu.tsx`
- `src/components/ui/ImageGallery.tsx`
- `src/components/ui/ImagePreview.tsx` (`TransactionImagePreview`)
- `src/components/TransactionItemsList.tsx`
- `src/components/ui/TransactionAudit.tsx`

Related services/hooks:
- `src/services/offlineTransactionService.ts`
- `src/services/offlineStore.ts`
- `src/services/offlineAwareImageService.ts`
- `src/services/offlineMediaService.ts`
- `src/hooks/useOfflineMediaTracker.ts`
- `src/utils/offlineUxFeedback.ts`
- `src/utils/transactionMovement.ts` (moved items grouping)
- `src/services/inventoryService.ts` (canonical transaction helpers, transaction service)

## What to capture (required sections)

For the screen contract and acceptance criteria, include:
- Section-by-section UI contract:
  - receipts vs other images sections (and when the “other images” section is shown)
  - upload indicators and sequential upload rules
  - offline placeholder behavior + queued update behavior
  - delete semantics (including offline blob cleanup)
  - gallery open/close/zoom + pin integration
- Transaction actions menu behavior:
  - edit
  - move constraints (canonical sale/purchase cannot move)
  - delete confirmation
- Itemization surface (TransactionItemsList integration):
  - when shown/hidden (itemization enabled vs existing items)
  - add existing items, create items, update, duplicate, delete, remove/unlink
  - bulk selection + bulk actions + location setting
  - cross-scope move/sell affordances (link to inventory-operations feature for invariants)
- States: loading/empty/error/offline/pending/permissions/quota
- Collaboration expectations consistent with change-signal + delta (no large listeners)

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide parity evidence: “Observed in …” with file + component/function, OR
- Mark as intentional change and justify it (platform/architecture requirement).

## Constraints / non-goals
- Do not prescribe large listeners; realtime is change-signal + delta.
- Do not do pixel-perfect design specs.
- Focus on contracts that prevent divergence (media lifecycle, itemization, actions).
