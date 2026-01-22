# Offline Item Controls Runtime Verification

## Objective
Provide runtime, end-to-end verification that each item menu control behaves correctly while offline and synchronizes when back online.

## Environment
- Date: 2026-01-21
- App URL: `http://localhost:3000`
- Offline simulation: injected offline mock (fetch rejects + `navigator.onLine=false`)

## Pre-Flight Status
- [x] Authenticated test account available
- [x] Test project + business inventory available
- [x] Project item with real UUID and images
- [x] Business inventory item with real UUID
- [x] Existing project + BI transactions

## Test Data Used
- Project: Hawaii Apartment
- Project item: Beige Linen Sofa (`I-1766521509089-aw3v`)
- Project transaction: Amazon ($1,196.80)
- BI item: VINTAGE Botanical Wall Art (`I-1768705183733-5w08`)

## Blocking Issues
- None for offline-only checks.
- Online re-sync validation not completed (see Notes).

## Runtime Test Matrix (Action × Surface)
Status legend: **Not Run**, **Pass**, **Fail**, **Partial**, **Blocked**

### Surfaces
- Project inventory list
- Business inventory list
- Transaction items list (if applicable)
- Item detail (project route)
- Item detail (BI route)

### Actions
| Action | Project list | BI list | Transaction list | Item detail (project) | Item detail (BI) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Add To Transaction… | Pass | Not Run | Not Run | Not Run | Not Run | Assigned Beige Linen Sofa to Amazon while offline; item shows transaction link. |
| Make Copies… | Pass | Not Run | Not Run | Not Run | Not Run | Created 2 copies; list groups into “×2”. |
| Sell To Design Business | Fail | Fail (disabled) | Not Run | Fail (disabled) | Fail (disabled) | Sell options disabled while offline. |
| Sell To Project… | Fail | Fail (disabled) | Not Run | Fail (disabled) | Fail (disabled) | Sell options disabled while offline. |
| Move To Design Business | Fail | Fail (disabled) | Not Run | Fail (disabled) | Fail (disabled) | Move options disabled while offline. |
| Move To Project… | Fail | Fail (disabled) | Not Run | Fail (disabled) | Fail (disabled) | Move options disabled while offline. |
| Change Status | Pass | Not Run | Not Run | Pass | Not Run | Updated to “To Return” and reflected in list + detail. |
| Delete… | Not Run | Not Run | Not Run | Pass | Not Run | Deleted item from detail; returned to list. |
| Edit | Not Run | Not Run | Not Run | Pass | Not Run | Added “Offline test note” and saved. |

## Observability Notes
- Offline banner shown: “Offline - Changes will sync when reconnected”.
- Toast shown after offline actions: “Changes will sync when you're back online”.
- After returning online, “Syncing changes…” banner appeared (no server reconciliation confirmed).

## Gaps / Follow-Ups
- Validate online re-sync for all actions (especially delete, edit, add-to-transaction, copies).
- Investigate why Sell/Move actions are disabled while offline (contradicts plan expectations).
- Transaction items list: item menu shows Sell/Move/Delete disabled while offline; confirm if intended.

## Next Step to Complete Verification
Re-run with online sync validation to confirm queued operations persist server-side, and retest Sell/Move offline enablement in project/BI surfaces.

---

# Online Item Controls Runtime Verification

## Objective
Provide runtime, end-to-end verification that each item menu control behaves correctly while online and persists immediately across UI surfaces.

## Environment
- Date: 2026-01-21
- App URL: `http://localhost:3000`
- Network: Online (no offline banner)

## Test Data Used
- Project: Hawaii Apartment
- Project item: Beige Linen Sofa (`I-1766521509089-aw3v`)
- Project item: Ceramic vases (`I-1766005226000-c818`)
- BI item: Khaki Sectional with CHAISE (`I-1768699268645-4gpv`)

## Blocking Issues
- Add To Transaction… (project list) failed with “Failed to update transaction. Please try again.”

## Runtime Test Matrix (Action × Surface)
Status legend: **Not Run**, **Pass**, **Fail**, **Partial**, **Blocked**

### Surfaces
- Project inventory list
- Business inventory list
- Transaction items list (if applicable)
- Item detail (project route)
- Item detail (BI route)

### Actions
| Action | Project list | BI list | Transaction list | Item detail (project) | Item detail (BI) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Add To Transaction… | Fail | Not Run | Not Run | Not Run | Not Run | Failed with “Failed to update transaction. Please try again.” |
| Make Copies… | Pass | Not Run | Not Run | Not Run | Not Run | Created 2 copies of Beige Linen Sofa. |
| Sell To Design Business | Pass | Not Run | Not Run | Not Run | Not Run | Beige Linen Sofa moved to BI immediately. |
| Sell To Project… | Not Run | Blocked | Not Run | Not Run | Not Run | Disabled for Ceramic vases (project list). |
| Move To Design Business | Not Run | Not Run | Not Run | Not Run | Not Run | Covered via Sell To Design Business action above. |
| Move To Project… | Not Run | Pass (via bulk allocate) | Not Run | Not Run | Not Run | Khaki Sectional allocated to Hawaii Apartment; item appeared in project list immediately. |
| Change Status | Pass | Not Run | Not Run | Not Run | Not Run | Beige Linen Sofa set to “To Return” and reflected in list. |
| Delete… | Not Run | Not Run | Not Run | Not Run | Not Run | Not tested online. |
| Edit | Pass | Not Run | Not Run | Pass | Not Run | Ceramic vases renamed to “Ceramic vases - edited”; list + detail updated. |

## Observability Notes
- Online banner: none.
- Toasts/queue: none observed.
- Sync banner remained “Syncing changes…” during interactions.

## Gaps / Follow-Ups
- Retest Add To Transaction… online (error observed).
- Validate Sell To Project… and Move To Design Business (project list) explicitly.
- Verify Delete… online and confirm item detail URL is inaccessible post-delete.
- Cross-surface checks pending for transaction items list and BI item detail.
