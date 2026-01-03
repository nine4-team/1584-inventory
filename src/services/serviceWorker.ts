// Service Worker utilities for offline functionality

type SyncEventType = 'progress' | 'complete' | 'error'

export interface SyncEventPayload {
  source?: string
  pendingOperations?: number | null
  error?: string
  timestamp?: number
}

export interface BackgroundSyncRegistrationResult {
  enabled: boolean
  supported: boolean
  reason?: string
}

export interface RegisterBackgroundSyncOptions {
  tag?: string
  timeoutMs?: number
}

const BACKGROUND_SYNC_TAG = 'sync-operations'
const DEFAULT_BACKGROUND_SYNC_TIMEOUT_MS = 750

const syncEventListeners: Record<SyncEventType, Set<(payload: SyncEventPayload) => void>> = {
  progress: new Set(),
  complete: new Set(),
  error: new Set()
}

let syncEventsBound = false

const emitSyncEvent = (type: SyncEventType, payload: SyncEventPayload = {}): void => {
  const listeners = syncEventListeners[type]
  if (!listeners || listeners.size === 0) {
    return
  }

  const enrichedPayload = {
    timestamp: Date.now(),
    ...payload
  }

  listeners.forEach(listener => {
    try {
      listener(enrichedPayload)
    } catch (error) {
      console.warn('Sync event listener failed', error)
    }
  })
}

const handleServiceWorkerMessage = (event: MessageEvent): void => {
  const { type, payload } = event.data || {}
  switch (type) {
    case 'SYNC_PROGRESS':
      emitSyncEvent('progress', payload)
      break
    case 'SYNC_COMPLETE':
      emitSyncEvent('complete', payload)
      break
    case 'SYNC_ERROR':
      emitSyncEvent('error', payload)
      break
    default:
      break
  }
}

const ensureSyncEventListener = (): void => {
  if (!('serviceWorker' in navigator) || syncEventsBound) {
    return
  }
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
  syncEventsBound = true
}

const isBackgroundSyncApiSupported = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  if (!('serviceWorker' in navigator)) {
    return false
  }
  const registrationCtor = window.ServiceWorkerRegistration as typeof ServiceWorkerRegistration | undefined
  if (!registrationCtor || !registrationCtor.prototype) {
    return false
  }
  return 'sync' in (registrationCtor.prototype as any)
}

const waitForServiceWorkerReady = async (
  timeoutMs: number
): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return null
  }

  const readyPromise = navigator.serviceWorker.ready

  if (!timeoutMs || timeoutMs <= 0) {
    return readyPromise
  }

  return await Promise.race([
    readyPromise,
    new Promise<ServiceWorkerRegistration | null>(resolve => {
      const timer = typeof window === 'undefined' ? setTimeout : window.setTimeout
      timer(() => resolve(null), timeoutMs)
    })
  ])
}

export const onSyncEvent = (type: SyncEventType, listener: (payload: SyncEventPayload) => void): (() => void) => {
  ensureSyncEventListener()
  syncEventListeners[type].add(listener)
  return () => {
    syncEventListeners[type].delete(listener)
  }
}

export const offSyncEvent = (type: SyncEventType, listener: (payload: SyncEventPayload) => void): void => {
  syncEventListeners[type].delete(listener)
}

export const onSyncComplete = (callback: () => void): (() => void) => {
  return onSyncEvent('complete', () => callback())
}

export const registerBackgroundSync = async (
  options: RegisterBackgroundSyncOptions = {}
): Promise<BackgroundSyncRegistrationResult> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKGROUND_SYNC_TIMEOUT_MS
  const tag = options.tag ?? BACKGROUND_SYNC_TAG

  // Capability guard: check if background sync is supported
  if (!isBackgroundSyncApiSupported()) {
    return {
      enabled: false,
      supported: false,
      reason: 'unsupported'
    }
  }

  // Capability guard: check if service worker is available
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return {
      enabled: false,
      supported: false,
      reason: 'no-service-worker-api'
    }
  }

  // Capability guard: check if controller exists (non-blocking check)
  if (!navigator.serviceWorker.controller) {
    console.warn('[backgroundSync] Skipping registration — no active service worker controller')
    return {
      enabled: false,
      supported: true,
      reason: 'no-controller'
    }
  }

  try {
    // Use timeout to avoid blocking indefinitely
    const registration = await waitForServiceWorkerReady(timeoutMs)
    if (!registration) {
      console.warn('[backgroundSync] Registration timed out waiting for serviceWorker.ready')
      return {
        enabled: false,
        supported: true,
        reason: 'ready-timeout'
      }
    }

    await registration.sync.register(tag)
    console.log(`[backgroundSync] Registered sync tag "${tag}"`)
    return {
      enabled: true,
      supported: true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown-error'
    console.warn('[backgroundSync] Registration failed:', error)
    return {
      enabled: false,
      supported: true,
      reason: message
    }
  }
}

export const unregisterBackgroundSync = async (): Promise<void> => {
  if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
    try {
      // Use timeout to avoid blocking indefinitely
      const registration = await waitForServiceWorkerReady(1000)
      if (!registration) {
        console.warn('[backgroundSync] Unregistration timed out waiting for serviceWorker.ready')
        return
      }
      const tags = await registration.sync.getTags()
      for (const tag of tags) {
        await registration.sync.unregister(tag)
        console.log('✅ Unregistered background sync:', tag)
      }
    } catch (error) {
      console.warn('❌ Background sync unregistration failed:', error)
    }
  }
}

export const triggerManualSync = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      // Use timeout to avoid blocking indefinitely
      const registration = await waitForServiceWorkerReady(1000)
      if (!registration) {
        console.warn('[backgroundSync] Manual sync trigger timed out waiting for serviceWorker.ready')
        return
      }
      registration.active?.postMessage({ type: 'TRIGGER_SYNC' })
      console.log('📤 Manual sync triggered')
    } catch (error) {
      console.warn('❌ Manual sync trigger failed:', error)
    }
  }
}

interface SyncNotificationPayload {
  source?: string
  pendingOperations?: number | null
  error?: string
}

export const notifySyncStart = (payload: SyncNotificationPayload = {}): void => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'SYNC_START',
      payload: {
        source: payload.source ?? 'foreground',
        pendingOperations: payload.pendingOperations ?? null
      }
    })
  }
}

export const notifySyncComplete = (payload: SyncNotificationPayload = {}): void => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'SYNC_COMPLETE',
      payload: {
        source: payload.source ?? 'foreground',
        pendingOperations: payload.pendingOperations ?? null
      }
    })
  }
}

export const notifySyncError = (payload: SyncNotificationPayload = {}): void => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'SYNC_ERROR',
      payload: {
        source: payload.source ?? 'foreground',
        pendingOperations: payload.pendingOperations ?? null,
        error: payload.error ?? 'Sync failed'
      }
    })
  }
}