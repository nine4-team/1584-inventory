# Offline Functionality Manual QA Matrix

This document provides a comprehensive testing checklist for offline functionality. Use this matrix to verify that all offline features work correctly across different scenarios.

## Test Environment Setup

### Automation Coverage (2026-01-02)

| Scenario | Coverage | Notes |
| --- | --- | --- |
| Offline item creation (Add Item / unifiedItemsService) | ✅ Automated (`offline-integration.test.ts`) | Verifies offline enqueue, IndexedDB cache, and absence of Supabase calls when offline. |
| Operation queue context handling | ✅ Automated (`operationQueue.test.ts`) | Ensures cached offline context bypasses auth calls and missing context errors bubble immediately. |
| Network timeout handling | ✅ Automated (`networkStatusService.test.ts`) | Validates `withNetworkTimeout` abort behavior for slow Supabase calls. |

### Prerequisites
- Chrome DevTools Network tab (to simulate offline mode)
- Multiple browser tabs/windows (for conflict scenarios)
- Test account with sample projects/items
- Mobile device (for real-world offline testing)

### Browser Support Notes
- **Background Sync**: Not available on iOS Safari (must rely on foreground/manual sync)
- **IndexedDB**: Supported in all modern browsers
- **Service Worker**: Supported in all modern browsers

---

## 1. Cold Start Offline

**Scenario**: User opens the app for the first time while offline (no previous sync)

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 1.1 App loads offline | 1. Go offline<br>2. Open app in new incognito window<br>3. Navigate to projects page | App loads, shows empty state or cached data if available. No errors in console. | ⬜ |
| 1.2 No cached data | 1. Clear IndexedDB<br>2. Go offline<br>3. Open app | App shows appropriate "offline" or "no data" message. Network status indicator shows offline. | ⬜ |
| 1.3 Cached data loads | 1. Sync data while online<br>2. Go offline<br>3. Refresh page | Previously synced projects/items/transactions load from cache. UI is responsive. | ⬜ |
| 1.4 Auth state persists | 1. Log in while online<br>2. Go offline<br>3. Refresh page | User remains logged in. Auth state persisted in IndexedDB. | ⬜ |

---

## 2. Long-Lived Offline Edits

**Scenario**: User works offline for extended period (hours/days), making multiple changes

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 2.1 Multiple item creates | 1. Go offline<br>2. Create 10+ items<br>3. Verify all appear in UI | All items appear optimistically. All operations queued. Queue length matches operations. | ⬜ |
| 2.2 Multiple item updates | 1. Go offline<br>2. Update existing items multiple times<br>3. Verify changes persist | Changes persist in local cache. Each update creates queue entry. Version numbers increment correctly. | ⬜ |
| 2.3 Mixed operations | 1. Go offline<br>2. Create, update, delete items<br>3. Check queue | All operations queued in correct order. Queue persists after page refresh. | ⬜ |
| 2.4 Queue persistence | 1. Go offline<br>2. Queue operations<br>3. Close browser<br>4. Reopen while offline | Queue persists. Operations still visible. Can continue editing. | ⬜ |
| 2.5 Storage quota handling | 1. Fill IndexedDB with media<br>2. Try to create items offline<br>3. Check warnings | Storage quota warnings appear. Operations still queue but media uploads blocked if quota exceeded. | ⬜ |

---

## 3. Offline to Online Transition

**Scenario**: User makes changes offline, then comes back online

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 3.1 Automatic sync | 1. Go offline<br>2. Create item<br>3. Go online | Sync starts automatically. Item appears on server. Queue clears. Sync status shows success. | ⬜ |
| 3.2 Manual sync trigger | 1. Go offline<br>2. Create item<br>3. Go online<br>4. Click "Retry sync" | Sync processes immediately. Queue clears. Status updates. | ⬜ |
| 3.3 Multiple operations sync | 1. Go offline<br>2. Create 5 items<br>3. Go online | All 5 items sync successfully. Queue processes in order. All items appear on server. | ⬜ |
| 3.4 Partial sync failure | 1. Go offline<br>2. Create 3 items<br>3. Go online<br>4. Mock server error for item 2 | Items 1 and 3 sync. Item 2 remains queued with retry count. Error shown in sync status. | ⬜ |
| 3.5 Background sync | 1. Go offline<br>2. Queue operations<br>3. Close browser<br>4. Go online (browser closed) | Background Sync processes queue when browser reopens (if supported). Queue cleared. | ⬜ |
| 3.6 Media upload sync | 1. Go offline<br>2. Upload images<br>3. Go online | Images upload to Supabase Storage. Queue entries removed. Images visible in UI. | ⬜ |

---

## 4. Conflict Scenarios

**Scenario**: Data diverges between local and server (e.g., same item edited offline and online)

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 4.1 Version conflict | 1. Edit item offline (v1→v2)<br>2. Edit same item online in another tab (v1→v3)<br>3. Sync offline changes | Conflict detected. Conflict modal appears. Can resolve (server wins by default for version conflicts). | ⬜ |
| 4.2 Timestamp conflict | 1. Edit item offline<br>2. Edit same item online (newer timestamp)<br>3. Sync | Conflict detected. Server wins if significantly newer (>5 min). Conflict modal shows both versions. | ⬜ |
| 4.3 Content conflict | 1. Change item name offline<br>2. Change item description online<br>3. Sync | Conflict detected. Field-level conflict shown. Can choose local or server for each field. | ⬜ |
| 4.4 Multiple conflicts | 1. Create multiple conflicts<br>2. Sync | All conflicts detected. Conflict modal shows all. Can resolve individually or in bulk. | ⬜ |
| 4.5 Conflict persistence | 1. Create conflict<br>2. Refresh page while offline | Conflict persists in IndexedDB. Conflict modal reappears on refresh. | ⬜ |
| 4.6 Conflict resolution | 1. Detect conflict<br>2. Choose "keep local"<br>3. Sync | Local version written to server. Local cache updated. Conflict removed from queue. | ⬜ |
| 4.7 Conflict resolution - server | 1. Detect conflict<br>2. Choose "keep server"<br>3. Sync | Server version written to local cache. Conflict resolved. Local changes discarded. | ⬜ |

---

## 5. Auth Expiration Mid-Sync

**Scenario**: Auth token expires while offline or during sync

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 5.1 Token expires offline | 1. Go offline<br>2. Wait for token expiration<br>3. Try to sync | Sync attempts refresh token. If refresh fails, shows "re-authentication required" message. Queue preserved. | ⬜ |
| 5.2 Token expires during sync | 1. Queue operations<br>2. Expire token<br>3. Start sync | Sync refreshes token automatically. Operations continue. If refresh fails, operations remain queued. | ⬜ |
| 5.3 Re-auth flow | 1. Token expires<br>2. User logs in again<br>3. Sync queue | Queue processes with new token. All operations sync successfully. | ⬜ |
| 5.4 User mismatch | 1. User A queues operations<br>2. User B logs in<br>3. Try to sync | Operations rejected (user mismatch). Error shown. Queue cleared or marked invalid. | ⬜ |

---

## 6. Media & Large Payloads

**Scenario**: Handling images and large files offline

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 6.1 Image upload offline | 1. Go offline<br>2. Upload image<br>3. Check storage | Image stored in IndexedDB. Upload queued. Storage quota checked. | ⬜ |
| 6.2 Storage quota warning | 1. Fill IndexedDB to 80%<br>2. Try to upload image | Warning banner appears. Upload still allowed but warned. | ⬜ |
| 6.3 Storage quota exceeded | 1. Fill IndexedDB to 95%<br>2. Try to upload large image | Upload blocked. Error message shown. User must free space. | ⬜ |
| 6.4 Multiple image uploads | 1. Go offline<br>2. Upload 5 images<br>3. Check queue | All images stored locally. All queued for upload. Queue shows 5 entries. | ⬜ |
| 6.5 Image cleanup | 1. Upload images with expiration<br>2. Wait for expiration<br>3. App restart | Expired images cleaned up on app start. Storage freed. Queue updated. | ⬜ |
| 6.6 Large file handling | 1. Try to upload 15MB file<br>2. Check error | File size validation works. Error shown if exceeds 10MB limit. | ⬜ |
| 6.7 Media sync on reconnect | 1. Upload images offline<br>2. Go online | Images upload to Supabase Storage. Queue entries removed. Images visible. | ⬜ |

---

## 7. Edge Cases & Error Handling

**Scenario**: Unusual conditions and error scenarios

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 7.1 Rapid online/offline toggle | 1. Toggle network rapidly<br>2. Create items during transitions | No data loss. Operations queue correctly. Sync resumes when stable online. | ⬜ |
| 7.2 Slow connection | 1. Throttle network to "Slow 3G"<br>2. Sync operations | Operations sync slowly. Progress indicators show. No timeouts. | ⬜ |
| 7.3 Intermittent connection | 1. Simulate packet loss<br>2. Sync operations | Failed operations retry. Exponential backoff works. Eventually syncs. | ⬜ |
| 7.4 Max retries exceeded | 1. Queue operation<br>2. Mock persistent server error<br>3. Retry 5 times | Operation removed from queue after max retries. Error logged. User notified. | ⬜ |
| 7.5 Concurrent edits | 1. Open same item in 2 tabs<br>2. Edit offline in both<br>3. Sync both | Conflicts detected. Resolution flow works. No data corruption. | ⬜ |
| 7.6 IndexedDB full | 1. Fill IndexedDB completely<br>2. Try to create item | Error shown. User must free space. Operations blocked until space available. | ⬜ |
| 7.7 Service worker update | 1. Update service worker<br>2. Queue operations during update | Operations preserved. New SW handles queue correctly. No data loss. | ⬜ |

---

## 8. Performance & UX

**Scenario**: Ensuring offline functionality doesn't degrade user experience

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 8.1 UI responsiveness | 1. Go offline<br>2. Create/update items rapidly | UI remains responsive. No lag. Optimistic updates appear immediately. | ⬜ |
| 8.2 Large dataset | 1. Cache 1000+ items<br>2. Load offline | Items load quickly (<2s). Pagination/virtualization works. No UI freeze. | ⬜ |
| 8.3 Queue processing | 1. Queue 50 operations<br>2. Go online | Queue processes efficiently. Progress shown. No blocking. | ⬜ |
| 8.4 Storage cleanup | 1. Fill storage<br>2. Trigger cleanup | Cleanup runs quickly. UI remains responsive. Storage freed. | ⬜ |
| 8.5 Network status indicator | 1. Toggle network<br>2. Check indicator | Indicator updates immediately. Shows offline/online/retrying states. | ⬜ |
| 8.6 Sync status | 1. Queue operations<br>2. Sync | Status shows pending count, progress, errors. Updates in real-time. | ⬜ |

---

## 9. Cross-Device Scenarios

**Scenario**: Using app on multiple devices

### Test Cases

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| 9.1 Device A offline, Device B online | 1. Edit item on Device A offline<br>2. Edit same item on Device B online<br>3. Sync Device A | Conflicts detected. Resolution flow works. Both devices eventually consistent. | ⬜ |
| 9.2 Both devices offline | 1. Edit item on Device A offline<br>2. Edit same item on Device B offline<br>3. Both sync | Conflicts detected when both sync. Resolution required. | ⬜ |

---

## 10. Browser-Specific Testing

### Chrome/Edge
- ✅ Background Sync supported
- ✅ IndexedDB quota: ~50MB
- ✅ Service Worker supported

### Firefox
- ✅ Background Sync supported
- ✅ IndexedDB quota: ~50MB
- ✅ Service Worker supported

### Safari (Desktop)
- ⚠️ Background Sync: Not supported (must use foreground sync)
- ✅ IndexedDB quota: ~50MB
- ✅ Service Worker supported

### Safari (iOS)
- ❌ Background Sync: Not supported (must use foreground sync)
- ✅ IndexedDB quota: ~50MB (may vary by device)
- ✅ Service Worker supported (iOS 11.3+)

---

## Test Execution Checklist

- [ ] All test cases executed
- [ ] Bugs logged with reproduction steps
- [ ] Performance metrics recorded
- [ ] Browser compatibility verified
- [ ] Mobile device testing completed
- [ ] Edge cases tested
- [ ] Error scenarios verified

---

## Success Criteria

✅ **All critical test cases pass**
- Cold start offline works
- Long-lived offline edits persist
- Offline-to-online sync works automatically
- Conflicts detected and resolved correctly
- Media uploads queue and sync properly
- No data loss in any scenario

✅ **Performance acceptable**
- UI remains responsive
- Sync completes within reasonable time
- Storage cleanup efficient

✅ **Error handling robust**
- Errors shown clearly to users
- Operations retry appropriately
- No silent failures

---

## Known Limitations

1. **iOS Safari**: Background Sync not supported - users must manually trigger sync or keep app open
2. **Storage Quota**: Varies by device/browser - 50MB is conservative estimate
3. **Auth Expiration**: Long offline sessions may require re-authentication
4. **Large Media**: Files >10MB may fail even if quota allows

---

## Reporting Issues

When reporting bugs, include:
1. Test case number
2. Browser and version
3. Device/OS
4. Steps to reproduce
5. Expected vs actual behavior
6. Console errors (if any)
7. Screenshots/videos
