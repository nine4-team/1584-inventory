// Custom service worker with offline functionality (ES module)
import { clientsClaim, skipWaiting } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Skip waiting and claim clients immediately
skipWaiting()
clientsClaim()

// Precache static assets
precacheAndRoute(self.__WB_MANIFEST)

// Runtime caching for offline service modules (no hard-coded precache list)
registerRoute(
  ({ request, url }) => {
    return request.destination === 'script' && url.pathname.includes('offline') && url.pathname.endsWith('.js')
  },
  new CacheFirst({
    cacheName: 'offline-services-v1'
  })
)

// Cache script/style assets to support offline navigation
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new CacheFirst({
    cacheName: 'asset-chunks-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
      })
    ]
  })
)

// Runtime caching for Supabase storage (images, etc.)
registerRoute(
  /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
  new CacheFirst({
    cacheName: 'supabase-storage-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 // 24 hours
      })
    ]
  })
)

const MAX_CLIENT_RETRIES = 3
const RETRY_BASE_DELAY_MS = 2000
const SYNC_SOURCE_BACKGROUND = 'background-sync'
const SYNC_SOURCE_MANUAL = 'manual'
const SYNC_SOURCE_FOREGROUND = 'foreground'

// Exponential backoff tracking for background sync re-registration
let reRegistrationAttempts = 0
let lastReRegistrationAt = 0
let lastSuccessfulSyncAt = 0
let lastPendingCount = null
let consecutiveSameCountSyncs = 0
const MAX_RE_REGISTRATION_DELAY_MS = 60000 // 1 minute max delay
const RE_REGISTRATION_BASE_DELAY_MS = 2000 // 2 seconds base delay
const SYNC_COOLDOWN_MS = 10000 // 10 seconds cooldown after successful sync
const MAX_CONSECUTIVE_SAME_COUNT = 3 // Max consecutive syncs with same count before stopping

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Check if network is online (service worker context)
function isNetworkOnline() {
  if (typeof navigator === 'undefined') {
    return true // Assume online if navigator unavailable
  }
  return navigator.onLine
}

// Calculate exponential backoff delay for re-registration
function getReRegistrationDelay() {
  if (reRegistrationAttempts === 0) {
    return 0 // No delay for first attempt
  }
  const baseDelay = RE_REGISTRATION_BASE_DELAY_MS * Math.pow(2, reRegistrationAttempts - 1)
  const cappedDelay = Math.min(baseDelay, MAX_RE_REGISTRATION_DELAY_MS)
  const jitter = Math.random() * 0.25 * cappedDelay
  return Math.round(cappedDelay + jitter)
}

// Re-register background sync with exponential backoff, offline check, and cooldown
async function reRegisterBackgroundSync(pendingOperations) {
  // Skip re-registration if offline
  if (!isNetworkOnline()) {
    console.log('[backgroundSync] Skipping re-registration — network offline')
    broadcastSyncMessage('SYNC_ERROR', {
      source: SYNC_SOURCE_BACKGROUND,
      error: 'Network offline — sync will resume when connection is restored',
      pendingOperations
    })
    return
  }

  const now = Date.now()
  
  // Check cooldown period after last successful sync
  const timeSinceLastSuccess = now - lastSuccessfulSyncAt
  if (timeSinceLastSuccess < SYNC_COOLDOWN_MS) {
    const remainingCooldown = SYNC_COOLDOWN_MS - timeSinceLastSuccess
    console.log(`[backgroundSync] In cooldown period — waiting ${remainingCooldown}ms before re-registration`)
    await delay(remainingCooldown)
  }

  // Detect if we're stuck in a loop (same pending count multiple times)
  if (pendingOperations !== null && pendingOperations === lastPendingCount) {
    consecutiveSameCountSyncs++
    if (consecutiveSameCountSyncs >= MAX_CONSECUTIVE_SAME_COUNT) {
      console.warn(`[backgroundSync] Stopping re-registration — ${consecutiveSameCountSyncs} consecutive syncs with same count (${pendingOperations})`)
      // Reset counters and let the foreground sync scheduler handle it
      consecutiveSameCountSyncs = 0
      lastPendingCount = null
      return
    }
  } else {
    // Count changed, reset consecutive counter
    consecutiveSameCountSyncs = 0
    lastPendingCount = pendingOperations
  }

  // Check if we should wait due to exponential backoff
  const timeSinceLastAttempt = Date.now() - lastReRegistrationAt
  const requiredDelay = getReRegistrationDelay()

  if (timeSinceLastAttempt < requiredDelay) {
    const remainingDelay = requiredDelay - timeSinceLastAttempt
    console.log(`[backgroundSync] Waiting ${remainingDelay}ms before re-registration (exponential backoff)`)
    await delay(remainingDelay)
  }

  try {
    await self.registration.sync.register('sync-operations')
    console.log('[backgroundSync] Re-registered sync tag after backoff')
    reRegistrationAttempts = 0 // Reset on success
    lastReRegistrationAt = Date.now()
  } catch (err) {
    reRegistrationAttempts++
    lastReRegistrationAt = Date.now()
    console.warn('[backgroundSync] Failed to re-register background sync:', err)
    broadcastSyncMessage('SYNC_ERROR', {
      source: SYNC_SOURCE_BACKGROUND,
      error: `Background sync registration failed: ${err.message || 'Unknown error'}`,
      pendingOperations
    })
  }
}

function broadcastSyncMessage(type, payload = {}) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type,
        payload: {
          timestamp: Date.now(),
          ...payload
        }
      })
    })
  })
}

// Background Sync for offline operations
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag)

  if (event.tag === 'sync-operations') {
    console.log('Processing sync-operations queue via Background Sync')
    broadcastSyncMessage('SYNC_PROGRESS', { source: SYNC_SOURCE_BACKGROUND })
    event.waitUntil(
      processOperationQueue()
        .then(result => {
          if (result.success) {
            console.log('Background sync completed successfully', { pendingOperations: result.pendingOperations })
            lastSuccessfulSyncAt = Date.now()
            broadcastSyncMessage('SYNC_COMPLETE', {
              source: SYNC_SOURCE_BACKGROUND,
              pendingOperations: result.pendingOperations
            })
            // Re-register sync if there are still pending operations (with offline check, backoff, and cooldown)
            if (result.pendingOperations && result.pendingOperations > 0) {
              void reRegisterBackgroundSync(result.pendingOperations)
            } else {
              // Reset all counters when queue is empty
              reRegistrationAttempts = 0
              consecutiveSameCountSyncs = 0
              lastPendingCount = null
            }
          } else {
            console.warn('Background sync failed:', result.error)
            // Reset consecutive counter on failure (might be a different issue)
            consecutiveSameCountSyncs = 0
            lastPendingCount = null
            broadcastSyncMessage('SYNC_ERROR', {
              source: SYNC_SOURCE_BACKGROUND,
              error: result.error || 'Unknown sync failure'
            })
            // Re-register sync to retry later (with offline check and backoff)
            void reRegisterBackgroundSync(null)
          }
        })
        .catch(error => {
          console.error('Background sync error:', error)
          // Reset consecutive counter on error (might be a different issue)
          consecutiveSameCountSyncs = 0
          lastPendingCount = null
          broadcastSyncMessage('SYNC_ERROR', {
            source: SYNC_SOURCE_BACKGROUND,
            error: error?.message || 'Background sync failed'
          })
          // Re-register sync to retry later (with offline check and backoff)
          void reRegisterBackgroundSync(null)
        })
    )
  }
})

// Function to process the operation queue by delegating to foreground clients
async function processOperationQueue(attempt = 0) {
  console.log('Processing operation queue in background sync', { attempt })

  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    if (clients.length === 0) {
      console.log('No active clients found to process the operation queue')
      return {
        success: false,
        error: 'No active clients'
      }
    }

    const results = await Promise.all(
      clients.map(client => {
        return new Promise(resolve => {
          const messageChannel = new MessageChannel()
          let resolved = false

          messageChannel.port1.onmessage = event => {
            if (event.data?.type === 'PROCESS_OPERATION_QUEUE_RESULT') {
              resolved = true
              resolve({
                success: event.data.success,
                pendingOperations: event.data.pendingOperations ?? null,
                error: event.data.error
              })
            }
          }

          client.postMessage(
            {
              type: 'PROCESS_OPERATION_QUEUE'
            },
            [messageChannel.port2]
          )

          // Fallback in case the client doesn't respond
          setTimeout(() => {
            if (!resolved) {
              resolved = true
              resolve(false)
            }
          }, 5000)
        })
      })
    )

    const successfulClients = results.filter(result => result?.success)
    const anyClientProcessed = successfulClients.length > 0

    if (!anyClientProcessed) {
      console.warn('No clients responded to PROCESS_OPERATION_QUEUE', { attempt })
      if (attempt < MAX_CLIENT_RETRIES) {
        const backoff = Math.min(15000, RETRY_BASE_DELAY_MS * Math.pow(2, attempt))
        console.log(`Retrying operation queue in ${backoff}ms`)
        await delay(backoff)
        return processOperationQueue(attempt + 1)
      }

      // Final fallback: try to re-register sync for another attempt later (with offline check and backoff)
      void reRegisterBackgroundSync(null)

      return {
        success: false,
        error: 'No clients acknowledged the sync request'
      }
    } else {
      console.log('Background sync request dispatched to clients')
      const pendingCounts = successfulClients
        .map(result => result.pendingOperations)
        .filter(value => typeof value === 'number')
      const pendingOperations = pendingCounts.length > 0 ? Math.min(...pendingCounts) : null
      return {
        success: true,
        pendingOperations
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error)
    return {
      success: false,
      error: error?.message || 'Background sync failed'
    }
  }
}

// Handle messages from the main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    broadcastSyncMessage('SYNC_PROGRESS', { source: SYNC_SOURCE_MANUAL })
    event.waitUntil(
      processOperationQueue().then(result => {
        if (result.success) {
          broadcastSyncMessage('SYNC_COMPLETE', {
            source: SYNC_SOURCE_MANUAL,
            pendingOperations: result.pendingOperations
          })
        } else {
          broadcastSyncMessage('SYNC_ERROR', {
            source: SYNC_SOURCE_MANUAL,
            error: result.error || 'Manual sync failed'
          })
        }
      })
    )
  }

  if (event.data && event.data.type === 'SYNC_START') {
    broadcastSyncMessage('SYNC_PROGRESS', {
      source: event.data.payload?.source || SYNC_SOURCE_FOREGROUND,
      pendingOperations: event.data.payload?.pendingOperations ?? null
    })
  }

  if (event.data && event.data.type === 'SYNC_COMPLETE') {
    broadcastSyncMessage('SYNC_COMPLETE', {
      source: event.data.payload?.source || SYNC_SOURCE_FOREGROUND,
      pendingOperations: event.data.payload?.pendingOperations ?? null
    })
  }

  if (event.data && event.data.type === 'SYNC_ERROR') {
    broadcastSyncMessage('SYNC_ERROR', {
      source: event.data.payload?.source || SYNC_SOURCE_FOREGROUND,
      error: event.data.payload?.error || 'Unknown foreground sync error',
      pendingOperations: event.data.payload?.pendingOperations ?? null
    })
  }
})

// Periodic cleanup of expired cache entries
self.addEventListener('activate', event => {
  event.waitUntil(
    // Clean up old caches
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('workbox-') && !cacheName.includes('supabase-storage-cache')) {
            console.log('Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
})