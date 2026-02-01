# Offline media storage guardrails (quota warning + offline attachment gating)

## What this is
A shared **guardrail** for the app’s **offline media cache** (the local storage used to hold attachments captured/selected while offline), so “storage full” doesn’t turn into confusing attachment failures:

- A **global warning** when local/offline media storage is getting full.
- A consistent **upload gating** rule while offline (block adding attachments when we cannot safely store them locally).

This is cross-cutting and should be reused by any feature that captures/attaches images or other files.

## Where this fits
This is a **subcomponent** of the broader offline media lifecycle:
- `40_features/_cross_cutting/offline_media_lifecycle.md`

This doc only specifies the **warning + gating** slice.

## What this is NOT
- This is **not** “our storage system” as a whole.
- This is **not** a full offline-storage management UI (browse/delete blobs).
  - The only user-facing pieces defined here are: **(1) a global warning** and **(2) an offline attachment gating rule**.

## Where it’s used
- Global UI:
  - `src/components/ui/StorageQuotaWarning.tsx` (rendered in `src/App.tsx`)
- Attachment selection / upload UI:
  - `src/components/ui/ImageUpload.tsx` (quota gating while offline)
- Offline media storage + queueing:
  - `src/services/offlineMediaService.ts`
  - `src/services/offlineAwareImageService.ts`
  - `src/services/offlineStore.ts` (`media` + `mediaUploadQueue`)

## Behavior contract

### A) Global warning thresholds
- The app periodically checks storage usage and shows a banner when **usagePercent ≥ 80**.
- Severity:
  - **Warning**: \(80\% \le usage < 90\%\)
  - **Critical**: \(usage \ge 90\%\)
- Critical banner copy includes explicit guidance to delete media / free space before uploading more.
- The banner is **dismissible** and dismissal is **in-memory only** (resets on app restart).

### B) Sampling / initialization rules
- Storage status checks must not run until the local offline store is initialized.
- Check cadence: approximately **every 30 seconds** (plus an initial check on mount).
- If the storage system is not available (e.g. IndexedDB missing on web), fail silently (do not break the app).

### C) Upload gating while offline (consistent “canUpload” rule)
When offline, attachment selection must be validated against projected usage:

- Compute \(projectedUsage = usedBytes + incomingFileSize\).
- **Hard block** if \(projectedUsage > totalBytes\) (not enough space).
- **Hard block** if \(projectedUsage / totalBytes \ge 0.9\) (near-full guardrail).

This gating is intended to prevent a “user selects media” flow that cannot be safely stored locally for later upload.

### D) Error messages (user-facing)
When gating blocks an offline attachment:

- Prefer “Not enough storage space. Please delete some media files first.”
- Or “Storage quota nearly full (90%+). Please free up space before uploading.”

When file-size limits block an attachment:

- Prefer “File too large. Maximum size is 10MB.”

### E) Data + storage model notes (migration relevance)
- Web parity currently uses an estimated local media quota of **~50MB** (see `offlineStore.checkStorageQuota()`).
- For React Native, the implementation must use platform-appropriate storage accounting (do **not** assume a fixed 50MB), but the **threshold semantics** (80% warning, 90% hard gate) should remain consistent.

## Non-goals
- A full “manage offline storage” UI (browsing/deleting individual blobs) is not defined here.
- Background upload policies; this doc only defines what happens at **selection time** and via **global warning**.

## Parity evidence (web sources)
- Banner thresholds, cadence, dismissal:
  - Observed in `src/components/ui/StorageQuotaWarning.tsx` (`usagePercent < 80` return null; 80/90 thresholds; 30s interval; in-memory dismissal).
- Offline attachment gating:
  - Observed in `src/components/ui/ImageUpload.tsx` (calls `OfflineAwareImageService.canUpload()` while offline).
- Storage accounting + “near full” guardrail:
  - Observed in `src/services/offlineStore.ts` (`checkStorageQuota`, `saveMedia` \(>0.9\) guard).
  - Observed in `src/services/offlineMediaService.ts` (`saveMediaFile` checks projected usage and 0.9 guard).
  - Observed in `src/services/offlineAwareImageService.ts` (`canUpload` projected usage logic).

