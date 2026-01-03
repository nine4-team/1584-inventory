/**
 * Utility for offline services to notify ProjectRealtimeProvider
 * when IndexedDB mutations occur, so snapshots can be refreshed
 */

let snapshotRefreshCallback: ((projectId: string) => void) | null = null

/**
 * Register a callback that will be called when offline mutations occur
 * This should be called by ProjectRealtimeProvider during initialization
 */
export function registerSnapshotRefreshCallback(callback: (projectId: string) => void): void {
  snapshotRefreshCallback = callback
}

/**
 * Notify the realtime provider to refresh a project's snapshot from IndexedDB
 * This should be called by offline services after successful IndexedDB writes
 */
export function refreshProjectSnapshot(projectId: string | null | undefined): void {
  if (!projectId) return
  if (snapshotRefreshCallback) {
    snapshotRefreshCallback(projectId)
  }
}
