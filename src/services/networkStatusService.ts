import { getSyncSchedulerSnapshot, reportNetworkStatus } from './syncScheduler'

export interface NetworkStatusSnapshot {
  isOnline: boolean
  isSlowConnection: boolean
  lastOnline: Date | null
  connectionType: string
  isRetrying: boolean
  lastCheckedAt: number
  lastOfflineReason: string | null
}

type NetworkStatusListener = (snapshot: NetworkStatusSnapshot) => void
type ConnectivityCheckReason = 'init' | 'interval' | 'manual' | 'online-event' | 'retry'

const REMOTE_HEALTH_URL = 'https://www.gstatic.com/generate_204'

let snapshot: NetworkStatusSnapshot = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  isSlowConnection: false,
  lastOnline: typeof navigator === 'undefined' || navigator.onLine ? new Date() : null,
  connectionType: 'unknown',
  isRetrying: false,
  lastCheckedAt: Date.now(),
  lastOfflineReason: null
}

const listeners = new Set<NetworkStatusListener>()
let initialized = false
let connectivityIntervalId: number | null = null
let retryIntervalId: number | null = null

export class NetworkTimeoutError extends Error {
  constructor(message = 'Network request timed out') {
    super(message)
    this.name = 'NetworkTimeoutError'
  }
}

export async function initNetworkStatusService(): Promise<void> {
  if (initialized) return
  if (typeof window === 'undefined') {
    initialized = true
    return
  }

  initialized = true
  window.addEventListener('online', handleNavigatorOnline)
  window.addEventListener('offline', handleNavigatorOffline)

  await runConnectivityCheck('init')
  startConnectivityPolling()
  startRetryPolling()
}

export function subscribeToNetworkStatus(listener: NetworkStatusListener): () => void {
  listeners.add(listener)
  listener(getNetworkStatusSnapshot())
  void initNetworkStatusService()
  return () => {
    listeners.delete(listener)
  }
}

export function getNetworkStatusSnapshot(): NetworkStatusSnapshot {
  return {
    ...snapshot,
    lastOnline: snapshot.lastOnline ? new Date(snapshot.lastOnline) : null
  }
}

export function isNetworkOnline(): boolean {
  return snapshot.isOnline
}

export function refreshNetworkStatus(reason: ConnectivityCheckReason = 'manual'): Promise<void> {
  return runConnectivityCheck(reason)
}

export interface WithNetworkTimeoutOptions {
  timeoutMs?: number
  onTimeout?: () => void
  signal?: AbortSignal
}

export async function withNetworkTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: WithNetworkTimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2000

  if (typeof AbortController === 'undefined') {
    return operation(options.signal ?? ({} as AbortSignal))
  }

  const controller = new AbortController()
  const { signal } = controller
  let timedOut = false

  const setTimer = typeof window === 'undefined' ? setTimeout : window.setTimeout
  const clearTimer = typeof window === 'undefined' ? clearTimeout : window.clearTimeout
  let timeoutHandle: number | null = null
  const clearExistingTimeout = () => {
    if (timeoutHandle !== null) {
      clearTimer(timeoutHandle)
      timeoutHandle = null
    }
  }

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const operationPromise = operation(signal)
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimer(() => {
      timedOut = true
      controller.abort()
      options.onTimeout?.()
      reject(new NetworkTimeoutError())
    }, timeoutMs) as unknown as number
  })

  try {
    return await Promise.race([operationPromise, timeoutPromise])
  } catch (error) {
    if (timedOut || error instanceof NetworkTimeoutError) {
      throw new NetworkTimeoutError()
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkTimeoutError()
    }
    throw error
  } finally {
    clearExistingTimeout()
  }
}

async function runConnectivityCheck(reason: ConnectivityCheckReason): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  const navigatorOnline = navigator.onLine
  let actualOnline = navigatorOnline
  let connectionType = 'unknown'
  let isSlowConnection = false
  let lastOfflineReason: string | null = snapshot.lastOfflineReason

  if ('connection' in navigator) {
    const conn = (navigator as any).connection
    connectionType = conn.effectiveType || 'unknown'
    isSlowConnection = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
  }

  if (navigatorOnline) {
    const remotePingUrl = `${REMOTE_HEALTH_URL}?cb=${Date.now()}`
    try {
      const response = await fetch(remotePingUrl, {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors',
        signal: AbortSignal.timeout(5000)
      })
      const pingSucceeded = response.type === 'opaque' || response.ok
      actualOnline = pingSucceeded
      lastOfflineReason = pingSucceeded ? null : 'remote-health-failed'
    } catch {
      actualOnline = false
      lastOfflineReason = 'remote-health-exception'
    }
  } else {
    lastOfflineReason = 'navigator-offline'
  }

  const nextSnapshot: NetworkStatusSnapshot = {
    isOnline: actualOnline,
    isSlowConnection,
    lastOnline: actualOnline ? new Date() : snapshot.lastOnline,
    connectionType,
    isRetrying: computeRetryState(actualOnline),
    lastCheckedAt: Date.now(),
    lastOfflineReason
  }

  const statusChanged = nextSnapshot.isOnline !== snapshot.isOnline
  snapshot = nextSnapshot
  notifyListeners()

  if (statusChanged) {
    reportNetworkStatus(nextSnapshot.isOnline)
  }
}

function computeRetryState(isOnline: boolean): boolean {
  if (isOnline) return false
  const syncSnapshot = getSyncSchedulerSnapshot()
  return syncSnapshot.pendingOperations > 0 && syncSnapshot.isRunning
}

function notifyListeners(): void {
  const currentSnapshot = getNetworkStatusSnapshot()
  listeners.forEach(listener => {
    try {
      listener(currentSnapshot)
    } catch (error) {
      console.warn('[networkStatusService] listener failed', error)
    }
  })
}

function handleNavigatorOnline() {
  void runConnectivityCheck('online-event')
}

function handleNavigatorOffline() {
  snapshot = {
    ...snapshot,
    isOnline: false,
    lastOfflineReason: 'navigator-offline',
    lastCheckedAt: Date.now(),
    isRetrying: computeRetryState(false)
  }
  notifyListeners()
  reportNetworkStatus(false)
}

function startConnectivityPolling() {
  if (connectivityIntervalId || typeof window === 'undefined') return
  connectivityIntervalId = window.setInterval(() => {
    void runConnectivityCheck('interval')
  }, 30000)
}

function startRetryPolling() {
  if (retryIntervalId || typeof window === 'undefined') return
  retryIntervalId = window.setInterval(() => {
    const isRetrying = computeRetryState(snapshot.isOnline)
    if (isRetrying !== snapshot.isRetrying) {
      snapshot = {
        ...snapshot,
        isRetrying,
        lastCheckedAt: Date.now()
      }
      notifyListeners()
    }
  }, 5000)
}
