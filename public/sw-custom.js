// Custom service worker with offline functionality
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js')

// Skip waiting and claim clients immediately
workbox.core.skipWaiting()
workbox.core.clientsClaim()

// Precache static assets
workbox.precaching.precacheAndRoute(self.__WB_MANIFEST)

// Runtime caching for Supabase storage (images, etc.)
workbox.routing.registerRoute(
  /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
  new workbox.strategies.CacheFirst({
    cacheName: 'supabase-storage-cache',
    plugins: [
      new workbox.expiration.ExpirationPlugin({
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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
            broadcastSyncMessage('SYNC_COMPLETE', {
              source: SYNC_SOURCE_BACKGROUND,
              pendingOperations: result.pendingOperations
            })
            // Re-register sync if there are still pending operations
            if (result.pendingOperations && result.pendingOperations > 0) {
              self.registration.sync.register('sync-operations').catch(err => {
                console.warn('Failed to re-register background sync:', err)
              })
            }
          } else {
            console.warn('Background sync failed:', result.error)
            broadcastSyncMessage('SYNC_ERROR', {
              source: SYNC_SOURCE_BACKGROUND,
              error: result.error || 'Unknown sync failure'
            })
            // Re-register sync to retry later
            self.registration.sync.register('sync-operations').catch(err => {
              console.warn('Failed to re-register background sync after error:', err)
            })
          }
        })
        .catch(error => {
          console.error('Background sync error:', error)
          broadcastSyncMessage('SYNC_ERROR', {
            source: SYNC_SOURCE_BACKGROUND,
            error: error?.message || 'Background sync failed'
          })
          // Re-register sync to retry later
          self.registration.sync.register('sync-operations').catch(err => {
            console.warn('Failed to re-register background sync after exception:', err)
          })
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

      // Final fallback: try to re-register sync for another attempt later
      try {
        await self.registration.sync.register('sync-operations')
        console.log('Scheduled another background sync attempt because no clients responded')
      } catch (err) {
        console.warn('Failed to re-register background sync after missing clients', err)
      }

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