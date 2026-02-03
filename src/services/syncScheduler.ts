import { operationQueue } from './operationQueue'
import { registerBackgroundSync, notifySyncStart, notifySyncComplete, notifySyncError } from './serviceWorker'
import { isNetworkOnline } from './networkStatusService'

type SyncTrigger = 'init' | 'online' | 'visibility' | 'manual' | 'retry' | 'interval' | 'network' | 'queue-change'

export interface SyncSchedulerSnapshot {
  isRunning: boolean
  pendingOperations: number
  retryAttempt: number
  nextRunAt: number | null
  lastTrigger: SyncTrigger | null
  lastError: string | null
}

type SyncSchedulerListener = (snapshot: SyncSchedulerSnapshot) => void

const BASE_DELAY_MS = 2000
const MAX_DELAY_MS = 60000

class SyncScheduler {
  private initialized = false
  private isRunning = false
  private retryAttempt = 0
  private nextRunTimeout: number | null = null
  private monitorInterval: number | null = null
  private nextRunAt: number | null = null
  private lastTrigger: SyncTrigger | null = null
  private lastError: string | null = null
  private listeners = new Set<SyncSchedulerListener>()
  private unsubscribeQueueListener: (() => void) | null = null

  async init(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') {
      return
    }

    await operationQueue.init()
    if (!this.unsubscribeQueueListener) {
      this.unsubscribeQueueListener = operationQueue.subscribe(() => {
        this.notify()
        if (!isNetworkOnline()) {
          registerBackgroundSync().catch(() => {
            // Ignore unsupported environments
          })
        }
        void this.evaluateQueue('queue-change')
      })
    }

    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
    }

    this.monitorInterval = window.setInterval(() => {
      this.evaluateQueue('interval')
    }, 15000)

    this.initialized = true
    this.evaluateQueue('init')
  }

  subscribe(listener: SyncSchedulerListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): SyncSchedulerSnapshot {
    return {
      isRunning: this.isRunning,
      pendingOperations: operationQueue.getQueueLength(),
      retryAttempt: this.retryAttempt,
      nextRunAt: this.nextRunAt,
      lastTrigger: this.lastTrigger,
      lastError: this.lastError
    }
  }

  async forceForegroundSync(trigger: SyncTrigger = 'manual'): Promise<void> {
    this.retryAttempt = 0
    this.clearScheduledRun()
    await this.triggerSync(trigger)
  }

  reportNetworkStatus(isOnline: boolean): void {
    if (isOnline) {
      this.retryAttempt = 0
      this.clearScheduledRun()
      this.evaluateQueue('network')
    }
  }

  private handleOnline = () => {
    // Debounce online trigger to prevent rapid flapping
    setTimeout(() => {
      if (isNetworkOnline()) {
        this.retryAttempt = 0
        this.clearScheduledRun()
        void this.triggerSync('online')
      }
    }, 2000)
  }

  private handleOffline = () => {
    this.lastTrigger = 'network'
    // Being offline is a normal state, not an error. Clear any previous error and notify listeners
    this.lastError = null
    this.notify()
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.retryAttempt = 0
      this.evaluateQueue('visibility')
    }
  }

  private async evaluateQueue(trigger: SyncTrigger): Promise<void> {
    const pending = operationQueue.getQueueLength()
    if (pending === 0) {
      this.resetBackoff()
      return
    }

    if (this.isRunning) {
      return
    }

    if (this.nextRunTimeout && trigger === 'interval') {
      return
    }

    await this.triggerSync(trigger)
  }

  private async triggerSync(trigger: SyncTrigger): Promise<void> {
    if (this.isRunning) {
      return
    }

    const pending = operationQueue.getQueueLength()
    if (pending === 0) {
      this.resetBackoff()
      return
    }

    this.isRunning = true
    this.lastTrigger = trigger
    this.lastError = null
    this.notify()

    const source = trigger === 'manual' ? 'manual' : 'foreground'
    notifySyncStart({
      source,
      pendingOperations: pending
    })

    try {
      await operationQueue.processQueue()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Sync failed'
    } finally {
      this.isRunning = false
      const remaining = operationQueue.getQueueLength()
      if (remaining === 0) {
        this.resetBackoff()
        notifySyncComplete({ source, pendingOperations: 0 })
      } else {
        this.scheduleRetry()
        if (this.lastError) {
          notifySyncError({
            source,
            pendingOperations: remaining,
            error: this.lastError
          })
        }
      }
      this.notify()
    }
  }

  private scheduleRetry(): void {
    this.retryAttempt = Math.min(this.retryAttempt + 1, 10)
    const baseDelay = BASE_DELAY_MS * Math.pow(2, this.retryAttempt - 1)
    const cappedDelay = Math.min(baseDelay, MAX_DELAY_MS)
    const jitter = Math.random() * 0.25 * cappedDelay
    const delay = Math.round(cappedDelay + jitter)

    this.clearScheduledRun()
    this.nextRunAt = Date.now() + delay
    this.nextRunTimeout = window.setTimeout(() => {
      this.nextRunTimeout = null
      void this.triggerSync('retry')
    }, delay)

    registerBackgroundSync().catch(() => {
      // Background sync may not be supported; ignore errors
    })

    this.notify()
  }

  private resetBackoff(): void {
    this.retryAttempt = 0
    this.lastError = null
    this.clearScheduledRun()
    this.nextRunAt = null
    this.notify()
  }

  private clearScheduledRun(): void {
    if (this.nextRunTimeout) {
      window.clearTimeout(this.nextRunTimeout)
      this.nextRunTimeout = null
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot()
    this.listeners.forEach(listener => {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('Sync scheduler listener failed', error)
      }
    })
  }
}

const scheduler = new SyncScheduler()

export const initSyncScheduler = (): Promise<void> => scheduler.init()
export const subscribeToSyncScheduler = (listener: SyncSchedulerListener) => scheduler.subscribe(listener)
export const getSyncSchedulerSnapshot = (): SyncSchedulerSnapshot => scheduler.getSnapshot()
export const requestForegroundSync = (trigger: SyncTrigger = 'manual'): Promise<void> => scheduler.forceForegroundSync(trigger)
export const reportNetworkStatus = (isOnline: boolean): void => scheduler.reportNetworkStatus(isOnline)
