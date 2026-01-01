// Service Worker utilities for offline functionality

type SyncEventType = 'progress' | 'complete' | 'error'

export interface SyncEventPayload {
  source?: string
  pendingOperations?: number | null
  error?: string
  timestamp?: number
}

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

export const registerBackgroundSync = async (): Promise<void> => {
  if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
    try {
      const registration = await navigator.serviceWorker.ready
      await registration.sync.register('sync-operations')
      console.log('✅ Background sync registered for operations')
    } catch (error) {
      console.warn('❌ Background sync registration failed:', error)
    }
  } else {
    console.log('ℹ️ Background Sync not supported, will use foreground sync only')
  }
}

export const unregisterBackgroundSync = async (): Promise<void> => {
  if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
    try {
      const registration = await navigator.serviceWorker.ready
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
      const registration = await navigator.serviceWorker.ready
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