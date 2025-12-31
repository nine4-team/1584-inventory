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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Background Sync for offline operations
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag)

  if (event.tag === 'sync-operations') {
    event.waitUntil(processOperationQueue())
  }
})

// Function to process the operation queue by delegating to foreground clients
async function processOperationQueue(attempt = 0) {
  console.log('Processing operation queue in background sync', { attempt })

  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    if (clients.length === 0) {
      console.log('No active clients found to process the operation queue')
      return
    }

    const results = await Promise.all(
      clients.map(client => {
        return new Promise(resolve => {
          const messageChannel = new MessageChannel()
          let resolved = false

          messageChannel.port1.onmessage = event => {
            if (event.data?.type === 'PROCESS_OPERATION_QUEUE_RESULT') {
              resolved = true
              resolve(event.data.success)
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

    const anyClientProcessed = results.some(Boolean)

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
    } else {
      console.log('Background sync request dispatched to clients')
    }
  } catch (error) {
    console.error('Background sync failed:', error)
    throw error // Re-throw to mark sync as failed
  }
}

// Handle messages from the main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    event.waitUntil(processOperationQueue())
  }

  if (event.data && event.data.type === 'SYNC_COMPLETE') {
    // Notify clients that sync is complete
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_COMPLETE',
          timestamp: Date.now()
        })
      })
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