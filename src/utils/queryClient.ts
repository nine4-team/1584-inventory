import { QueryClient } from '@tanstack/react-query'

// Global QueryClient instance for use in services
let globalQueryClient: QueryClient | null = null

export function setGlobalQueryClient(client: QueryClient) {
  globalQueryClient = client
}

export function getGlobalQueryClient(): QueryClient {
  if (!globalQueryClient) {
    throw new Error('QueryClient not initialized. Call setGlobalQueryClient first.')
  }
  return globalQueryClient
}