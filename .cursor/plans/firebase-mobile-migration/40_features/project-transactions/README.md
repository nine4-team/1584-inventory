# Project Transactions (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **Project Transactions** experience (transactions list + add/edit + detail), grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Browse project transactions (list/search/sort/filter, scroll restoration)
- Export project transactions to CSV
- Create a transaction (manual)
- Edit a transaction
- View transaction detail
- Manage transaction receipts + other images (including offline placeholders)
- Manage “itemization” (transaction items) where enabled

## Non-scope (for this feature folder)
- Invoice import parsers (Amazon/Wayfair) — separate feature (`invoice-import`)
- Deep semantics of cross-scope inventory operations (move/sell/deallocate, lineage) — `40_features/inventory-operations-and-lineage/README.md`
- Pixel-perfect UI design

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/TransactionsList.md`
  - `ui/screens/TransactionForm.md`
  - `ui/screens/TransactionDetail.md`

## Cross-cutting dependencies
- Sync architecture constraints (change-signal + delta, local-first): `40_features/sync_engine_spec.plan.md`
- Image gallery/lightbox behavior: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`
- Navigation/stacked back/scroll restoration parity: `40_features/feature_list.md` → `navigation-stack-and-context-links`
- Canonical transaction semantics + item-driven attribution: `40_features/project-items/feature_spec.md`

## Parity evidence (web sources)
- Transactions list (filters/sorts/search/export, canonical total self-heal, nav stack + scroll restore):
  - `src/pages/TransactionsList.tsx`
- Transaction create:
  - `src/pages/AddTransaction.tsx`
- Transaction edit:
  - `src/pages/EditTransaction.tsx`
- Transaction detail (media, gallery, itemization, actions menu, delete):
  - `src/pages/TransactionDetail.tsx`
- Image gallery/lightbox:
  - `src/components/ui/ImageGallery.tsx`
- Transaction image tile preview + offline placeholder resolution:
  - `src/components/ui/ImagePreview.tsx` (`TransactionImagePreview`, `offlineMediaService`)
- Transaction items list (itemization, selection/bulk operations, cross-scope actions):
  - `src/components/TransactionItemsList.tsx`
- Transaction actions menu (edit/move/delete constraints for canonical):
  - `src/components/transactions/TransactionActionsMenu.tsx`
