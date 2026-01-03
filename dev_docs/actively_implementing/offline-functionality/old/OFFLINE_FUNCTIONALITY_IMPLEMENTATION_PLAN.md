# Offline Functionality Implementation Plan

## Is This Feasible for a Web App?

**Yes, absolutely feasible.** Modern web technologies provide comprehensive APIs for offline functionality:

- **IndexedDB**: Local database for storing app data offline
- **Service Worker Background Sync**: Queues operations when offline, syncs when online
- **Cache API**: Already partially implemented for static assets
- **Web Storage APIs**: For simple data persistence
- **Network Information API**: Detects online/offline state

This inventory management app is particularly well-suited for offline functionality since it involves structured data operations (CRUD on items, transactions, projects) that can be queued and synchronized.

## Goal
Implement offline-first functionality so users can:
- View cached data when offline
- Make changes that queue locally
- Automatically sync when connection is restored
- Handle conflicts gracefully when data diverges

## Current State Analysis
- **PWA Ready**: Service worker configured but only caches static assets
- **No Local Storage**: All data operations require network connectivity
- **React Query**: In-memory caching only (5min stale time)
- **Error Handling**: Detects network errors but doesn't queue operations
- **Data Flow**: Direct Supabase operations with no offline layer

## High-Level Technical Approach

### Architecture Overview
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React App     │────│  Offline Layer   │────│   Supabase DB   │
│                 │    │                  │    │                 │
│ - UI Components │    │ - IndexedDB      │    │ - PostgreSQL    │
│ - React Query   │    │ - Operation Queue │    │ - Real-time    │
│ - Network State │    │ - Background Sync │    │ - RLS Policies │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Realtime Subscription Topology (Dec 2025)

1. **ProjectRealtimeProvider**
   - Mounted under `App` (inside `AccountProvider` / `BusinessProfileProvider`) so Supabase channels survive all route transitions.
   - Tracks reference counts per `projectId` and keeps a project's `projects`, `transactions`, `items`, and lineage subscriptions hot while at least one consumer calls `useProjectRealtime(projectId)`. A 15-second grace timer prevents needless teardown when navigating between layout and detail screens.
   - Exposes bound refresh helpers (`refreshProject`, `refreshTransactions`, `refreshItems`, `refreshCollections`) that pages can invoke after heavy writes or reconnect events.

2. **Route ownership**
   - `ProjectLayout`, transaction detail, invoice, property-management, client-summary, and business-inventory routes all invoke `useProjectRealtime`. Layout no longer wires Supabase manually; it renders provider snapshots. Detail routes rely on the URL `projectId` (or the transaction's resolved `projectId`) so layout-level channels remain mounted even when the layout unmounts.

3. **Write safety net**
   - `TransactionItemsList` duplicate/merge helpers, manual uploads, and other write-heavy flows call `refreshCollections` immediately after Supabase writes succeed. This guarantees duplicates and merges appear even if realtime payloads lag or the socket reconnects.

4. **Service worker bridge**
   - `public/sw-custom.js` now relays Background Sync events to foreground tabs via `PROCESS_OPERATION_QUEUE` messages. Windows listen for that message, execute `operationQueue.processQueue()`, and reply with `PROCESS_OPERATION_QUEUE_RESULT`, allowing the service worker to await completion before resolving the sync event.

5. **Regression coverage**
   - `src/contexts/__tests__/ProjectRealtimeContext.test.tsx` mocks realtime payloads to ensure duplicate/merge visibility updates propagate through the provider, and verifies that `refreshCollections({ includeProject: true })` exercises the reconnect fallback path.

This topology centralizes Supabase channel ownership, keeps UI routes lightweight, and gives the offline/queue layer deterministic hooks for manual refreshes and background sync.

### Key Components to Implement
1. **Offline Store**: IndexedDB wrapper for local data persistence
2. **Sync Manager**: Background sync service with conflict resolution
3. **Network Monitor**: Online/offline state detection and UI updates
4. **Operation Queue**: FIFO queue for pending mutations
5. **Conflict Resolver**: Last-write-wins with user notification for conflicts

## Implementation Phases

### Phase 1: Foundation (1-2 weeks)
**Goal**: Basic offline data storage and read operations

#### 1.1 IndexedDB Store Setup
- Create `src/services/offlineStore.ts` with IndexedDB wrapper
- Define schemas for: `items`, `transactions`, `projects`, `users`
- Implement basic CRUD operations with promise-based API
- Add data versioning for schema migrations

#### 1.2 Network State Detection
- Create `src/hooks/useNetworkState.ts` hook
- Detect online/offline using `navigator.onLine` + fetch ping
- Provide reactive network state to components
- Add offline UI indicators (status bar, disabled buttons)

#### 1.3 Read-Only Offline Mode
- Modify React Query to check local store when offline
- Cache successful API responses in IndexedDB
- Implement data hydration on app startup
- Add "last synced" timestamps to cached data

### Phase 2: Operation Queuing (1-2 weeks)
**Goal**: Queue write operations for background sync

#### 2.1 Operation Queue System
- Create `src/services/operationQueue.ts`
- Define operation types: `CREATE_ITEM`, `UPDATE_ITEM`, `DELETE_ITEM`, etc.
- Implement queue persistence in IndexedDB
- Add retry logic with exponential backoff

#### 2.2 Background Sync Service
- Extend service worker with Background Sync API
- Register sync events for queued operations
- Implement batch processing for efficiency
- Add sync status notifications

#### 2.3 Optimistic Updates
- Update local store immediately on user actions
- Show pending states in UI (loading spinners, "syncing" badges)
- Rollback on sync failures with user notification

### Phase 3: Conflict Resolution (1 week)
**Goal**: Handle data conflicts gracefully

#### 3.1 Conflict Detection
- Compare local vs server data on sync
- Detect conflicts using timestamps + version numbers
- Categorize conflicts: auto-resolvable vs user-required

#### 3.2 Resolution Strategies
- **Auto-resolve**: Last-write-wins for simple fields
- **User intervention**: Modal for conflicting changes
- **Merge logic**: Smart merging for compatible changes
- **Rollback**: Revert local changes when conflicts detected

#### 3.3 User Experience
- Clear conflict notifications
- Side-by-side comparison UI
- Manual resolution options (keep local, keep server, merge)

### Phase 4: Offline Experience Polish (1 week)
**Goal**: Make offline functionality robust, performant, and user-friendly

#### 4.1 Error Recovery & Resilience
- Smart retry strategies beyond exponential backoff (detect permanent failures)
- Partial sync recovery (resume interrupted syncs)
- Corruption detection & repair (rebuild corrupted IndexedDB data)
- Offline session recovery (restore state after browser crashes)

#### 4.2 User Experience Enhancements
- Sync progress indicators (show % complete, items remaining)
- Better conflict UI (diff view, preview of merged results)
- Offline action feedback (toast notifications for queued operations)
- Network quality indicators (connection speed, reliability hints)

#### 4.3 Performance & Storage Optimization
- Storage quota management (warn before hitting limits, cleanup strategies)
- Lazy loading & pagination (load data on-demand to reduce memory usage)
- Background maintenance (cleanup old data, optimize indexes)
- Memory leak prevention (proper cleanup of event listeners, cached data)

#### 4.4 Testing & Monitoring
- Comprehensive offline testing (simulated network conditions, chaos testing)
- Sync reliability metrics (success rates, failure patterns)
- Performance benchmarking (sync speed, memory usage, battery impact)
- Error tracking & reporting (log sync failures for debugging)

#### 4.5 Production Readiness
- Graceful degradation (fallback when IndexedDB fails)
- Cross-browser compatibility (handle Safari/Chrome/Firefox differences)
- Mobile optimization (touch interactions, battery considerations)
- Accessibility (screen reader support, keyboard navigation)

## Data Synchronization Strategy

### Sync Flow
```
Offline Action → Queue Operation → Background Sync → Conflict Check → Apply Changes → Update UI
```

### Conflict Resolution Rules
1. **Timestamps**: Server data wins if newer timestamp
2. **Version Numbers**: Higher version numbers win
3. **Field-Level**: Merge compatible changes (notes concatenation)
4. **User Choice**: Prompt for conflicting business logic

### Data Consistency
- **Eventual Consistency**: All devices converge to same state
- **Optimistic Locking**: Version numbers prevent lost updates
- **Audit Trail**: Log all sync operations for debugging

## User Experience Considerations

### Offline Indicators
- **Status Bar**: "Offline - Changes will sync when online"
- **Action States**: Disabled buttons with tooltips
- **Sync Status**: "Syncing 3 changes..." with progress
- **Conflict Alerts**: Toast notifications for resolution needed

### Error Handling
- **Graceful Degradation**: Read-only mode when offline
- **Retry Mechanisms**: Automatic retries with backoff
- **User Feedback**: Clear messages for sync failures
- **Recovery Options**: "Retry sync" buttons

### Performance Expectations
- **Startup**: <2 seconds to load cached data
- **Sync**: Background, non-blocking
- **Storage**: <50MB for typical usage
- **Battery**: Minimal impact on mobile devices

## Implementation Details

### Service Layer Changes
```typescript
// Before: Direct Supabase calls
const items = await itemService.getItems(projectId)

// After: Offline-aware calls
const items = await offlineItemService.getItems(projectId)
// Falls back to IndexedDB when offline, syncs when online
```

### React Query Integration
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
      networkMode: 'offlineFirst', // New: check local store first
    },
  },
})
```

### Service Worker Extensions
```typescript
// Register background sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-operations') {
    event.waitUntil(processOperationQueue())
  }
})
```

## Testing Strategy

### Unit Tests
- Offline store CRUD operations
- Operation queue management
- Conflict resolution logic
- Network state detection

### Integration Tests
- Full offline/online cycles
- Background sync functionality
- Conflict scenarios
- Data consistency verification

### Manual Testing Scenarios
1. **Offline Creation**: Create items offline, verify sync on reconnect
2. **Concurrent Edits**: Edit same item on two devices, test conflict resolution
3. **Network Interruption**: Simulate connection drops during operations
4. **Large Dataset**: Test with 1000+ items and transactions
5. **Auth Expiration**: Test token refresh and offline auth handling

### Performance Benchmarks
- **Cold Start**: App load time with cached data
- **Sync Time**: Time to sync 100 operations
- **Storage Size**: Memory usage for different data sizes
- **Battery Impact**: Power consumption during sync

## Migration Strategy

### Gradual Rollout
1. **Feature Flag**: Enable offline mode per user/account
2. **Staged Deployment**: Roll out to beta users first
3. **Fallback**: Always provide network-only fallback
4. **Monitoring**: Track sync success rates and conflicts

### Data Migration
- **Initial Hydration**: Sync existing data to local store
- **Progressive Loading**: Load data on-demand to avoid large initial sync
- **Cleanup**: Remove old data after successful migration

## Risk Assessment

### Technical Risks
- **IndexedDB Browser Support**: Fallback for older browsers
- **Storage Limits**: Handle quota exceeded errors
- **Background Sync Reliability**: Fallback to manual sync

### Business Risks
- **Data Conflicts**: Potential for lost user changes
- **Sync Failures**: Operations stuck in queue
- **Performance Issues**: Slow syncs on large datasets

### Mitigation Strategies
- **Progressive Enhancement**: App works without offline features
- **User Communication**: Clear offline limitations and expectations
- **Monitoring**: Comprehensive logging and error tracking
- **Rollback Plan**: Ability to disable offline features

## Success Metrics

### Technical Metrics
- **Sync Success Rate**: >99% of operations sync successfully
- **Conflict Rate**: <1% of operations result in conflicts
- **Offline Coverage**: 95% of read operations work offline
- **Performance**: <3 second app startup, <10 second sync

### User Experience Metrics
- **Offline Usage**: % of sessions with offline activity
- **User Satisfaction**: Reduced complaints about connectivity issues
- **Data Loss**: Zero instances of lost user data
- **Adoption**: % of users enabling offline mode

## Timeline and Resources

### Estimated Timeline
- **Phase 1**: 2 weeks (Foundation)
- **Phase 2**: 2 weeks (Operation Queuing)
- **Phase 3**: 1 week (Conflict Resolution)
- **Phase 4**: 1 week (Polish + Testing)
- **Total**: 6 weeks for MVP offline functionality

### Team Requirements
- **Frontend Developer**: 4 weeks (React/IndexedDB/Service Worker)
- **Backend Developer**: 1 week (Supabase schema versioning)
- **QA Engineer**: 2 weeks (Testing offline scenarios)
- **UX Designer**: 0.5 weeks (Offline UI/UX design)

### Dependencies
- **Browser Support**: Modern browsers with IndexedDB + Service Workers
- **Supabase Features**: Row versioning, audit trails
- **Network APIs**: Background Sync API support
- **Storage**: Sufficient local storage quota

This plan provides a comprehensive roadmap for implementing offline functionality while maintaining data integrity and user experience.