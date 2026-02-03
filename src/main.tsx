import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext'
import { NavigationStackProvider } from './contexts/NavigationStackContext'
import { setGlobalQueryClient } from './utils/queryClient'
import { registerSW } from 'virtual:pwa-register'
import { isNetworkOnline } from './services/networkStatusService'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (was cacheTime)
      refetchOnWindowFocus: false,
      retry: (failureCount) => {
        // Don't retry on network errors when offline
        if (!isNetworkOnline() && failureCount >= 1) return false
        return failureCount < 3
      },
    },
  },
})

// Set global reference for services
setGlobalQueryClient(queryClient)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NavigationStackProvider>
          <App />
        </NavigationStackProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
)

const registerCustomServiceWorker = (): void => {
  if (import.meta.env.MODE === 'test') {
    return
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return
  }

  if (!('serviceWorker' in navigator)) {
    return
  }

  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister().catch(() => undefined)
      })
    })
    return
  }

  registerSW({
    immediate: true,
    onRegisteredSW(swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (import.meta.env.DEV) {
        const scope = registration?.scope ?? swUrl
        console.info('[sw] custom service worker registered', scope)
      }
    },
    onRegisterError(error: unknown) {
      console.error('[sw] custom service worker registration failed', error)
    }
  })
}

registerCustomServiceWorker()
