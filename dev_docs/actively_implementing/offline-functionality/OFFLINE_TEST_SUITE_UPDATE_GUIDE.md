# Offline Test Suite Update Guide

> Purpose: give any follow-on model everything it needs to finish aligning our Vitest suites with the Rev 1 offline remediation. Use this as the authoritative instruction set before touching code.

---

## 1. Architectural delta you must account for

| Area | What changed | Implications for tests |
| --- | --- | --- |
| Network detection | `useNetworkState` is now a thin subscriber to `networkStatusService` (heartbeat + `/ping.json` + Supabase fallback). `navigator.onLine` is never read directly by services. | All unit tests that previously toggled `navigator.onLine` must instead mock `isNetworkOnline()` (and optionally `refreshNetworkStatus`). |
| Supabase request timeouts | `withNetworkTimeout` wraps async calls with `AbortController`. | When you need deterministic “online success” behaviour in tests, stub `withNetworkTimeout` to simply invoke the provided fn; for timeout branches, throw `NetworkTimeoutError`. |
| Operation queue | `operationQueue.add` relies on cached offline context (`offlineContext`), records `lastEnqueueAt`, and throws `OfflineContextError` if `userId` is missing while offline. | Tests must seed context via `updateOfflineContext` or by stubbing `getOfflineContext`. Scenarios expecting errors must explicitly keep `isNetworkOnline()` false and the context empty. |
| Item creation | `unifiedItemsService.createItem` returns a discriminated union `{ mode: 'online' | 'offline'; itemId; operationId? }`. | Every call site (tests and UI components) must read `.mode` when asserting offline queue behaviour instead of assuming a bare `itemId` string. |
| Offline storage errors | `offlineItemService` now throws `OfflineQueueUnavailableError` instead of a generic `OfflineStorageError` when IndexedDB cannot cache. | Any suite expecting the prior error type should assert on the new class. |
| Telemetry | `operationQueue` and `offlineItemService` log decisions when `import.meta.env.DEV`. | Tests should suppress/ignore logs (Vitest prints them, but no assertion should depend on them). |

---

## 2. Operation queue spec updates (`src/services/__tests__/operationQueue.test.ts`)

### 2.1. Mocking `networkStatusService`

Add a Vitest mock near the top:

```ts
vi.mock('../networkStatusService', () => {
  const isNetworkOnline = vi.fn(() => true)
  return {
    isNetworkOnline,
    withNetworkTimeout: vi.fn((fn: any) => fn(new AbortController().signal)),
    NetworkTimeoutError: class extends Error {}
  }
})

const mockedNetwork = vi.mocked(await import('../networkStatusService'))
```

- Toggle `mockedNetwork.isNetworkOnline.mockReturnValue(false)` for offline scenarios.
- Reset the mock inside `beforeEach`.

### 2.2. Seeding offline context

Operation queue now calls into `offlineContext` immediately. Update the `beforeEach` to:

```ts
const { updateOfflineContext } = await import('../offlineContext')
await updateOfflineContext({ userId: 'test-user', accountId: 'acc-123' })
```

For tests that expect an `OfflineContextError`, explicitly clear the context:

```ts
await updateOfflineContext({ userId: null, accountId: 'acc-123' })
mockedNetwork.isNetworkOnline.mockReturnValue(false)
await expect(operationQueue.add(operation)).rejects.toBeInstanceOf(OfflineContextError)
```

### 2.3. Online-only assertions

Tests such as “should process operations when online” must set `mockedNetwork.isNetworkOnline.mockReturnValue(true)` *before* adding operations so the queue actually attempts `executeOperation`.

### 2.4. Snapshot assertions

Use the new metadata:

```ts
const snapshot = operationQueue.getSnapshot()
expect(snapshot.lastOfflineEnqueueAt).toBeTruthy()
expect(snapshot.lastEnqueueError).toBeNull()
```

### 2.5. Auth-required test

The new error message is `OfflineContextError` with `.message = 'Sign in before working offline...'`. Update assertions accordingly.

---

## 3. Offline integration suite updates (`src/services/__tests__/offline-integration.test.ts`)

1. **Mock network service** exactly as in §2.1 so you can drive online/offline transitions without mutating `navigator.onLine`.
2. **Adjust item creation expectations**:
   ```ts
   const result = await unifiedItemsService.createItem(...)
   expect(result.mode).toBe('offline')
   expect(result.operationId).toBeTruthy()
   const queuedOps = operationQueue.getPendingOperations()
   ```
3. **Queue persistence** tests must initialize `offlineContext` before calling `createItem` (otherwise the queue rejects).
4. **Media upload queue**: `offlineMediaService.queueMediaUpload` consults `isNetworkOnline()`. Mock it to return `false` to assert `queued === true`.
5. **Conflict resolution** branch names changed: the resolver now returns the explicit strategy issued during resolution; update expected string (currently `'manual'` until the resolver work lands—document that the test should assert `'manual'` to stay green).
6. **Retry counters**: the queue now bails early when offline; to test retry increments, ensure `isNetworkOnline()` returns `true` so the queue actually calls Supabase, then stub `executeOperation` to fail.

---

## 4. UI + service test adjustments

Any spec referencing `unifiedItemsService.createItem` must:

```ts
const { mode, itemId, operationId } = await unifiedItemsService.createItem(...)
if (mode === 'offline') {
  expect(operationId).toBeDefined()
} else {
  expect(operationId).toBeUndefined()
}
```

Similarly, tests ensuring offline toasts appear should assert that their mock UI layer receives the new discriminated result instead of relying on navigator state.

---

## 5. Manual QA tracking

Document automated coverage in `OFFLINE_QA_MATRIX.md` (already updated) and list any remaining manual matrix items that still require hands-on runs after the suites are fixed:

- Long-lived offline sessions (multi-hour)
- Corrupt IndexedDB (simulate quota exceeded)
- Multi-device conflict flows

Keep the matrix in sync whenever you add or rename a test block—future models will read that table first.

---

## 6. Recommended workflow for the follow-on model

1. **Update operation queue tests** following §2; run `npx vitest run src/services/__tests__/operationQueue.test.ts`.
2. **Update offline integration tests** per §3; run `npx vitest run src/services/__tests__/offline-integration.test.ts`.
3. **Sweep UI/service specs** described in §4 (search for `.createItem(`). Fix and re-run targeted suites.
4. Once green, re-run `npx vitest run src/services/__tests__/networkStatusService.test.ts src/services/__tests__/operationQueue.test.ts src/services/__tests__/offline-integration.test.ts` to verify the critical path end-to-end.

Following these written steps keeps the remediation consistent no matter which model picks up the baton next.
