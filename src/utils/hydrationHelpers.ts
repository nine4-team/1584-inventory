/**
 * Shared hydration helpers for synchronously priming React Query caches from offlineStore
 * Prevents empty state flashes when reopening offline
 */

import { QueryClient } from '@tanstack/react-query'
import { offlineStore } from '../services/offlineStore'
import { unifiedItemsService } from '../services/inventoryService'
import type { Item } from '../types'

/**
 * Hydrate React Query cache for a single item from offlineStore
 * This should be called synchronously before rendering to prevent empty state flashes
 */
export async function hydrateItemCache(
  queryClient: QueryClient,
  accountId: string,
  itemId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedItem = await offlineStore.getItemById(itemId)
    if (cachedItem) {
      // Convert DBItem to Item format
      const item = unifiedItemsService._convertOfflineItem(cachedItem)
      // Prime the React Query cache
      queryClient.setQueryData(['item', accountId, itemId], item)
    }
  } catch (error) {
    console.warn('Failed to hydrate item cache:', error)
  }
}

/**
 * Hydrate React Query cache for project items from offlineStore
 */
export async function hydrateProjectItemsCache(
  queryClient: QueryClient,
  accountId: string,
  projectId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedItems = await offlineStore.getItems(projectId)
    if (cachedItems.length > 0) {
      // Convert DBItems to Items format
      const items = cachedItems
        .filter(item => !item.accountId || item.accountId === accountId)
        .map(item => unifiedItemsService._convertOfflineItem(item))
      // Prime the React Query cache
      queryClient.setQueryData(['project-items', accountId, projectId], items)
    }
  } catch (error) {
    console.warn('Failed to hydrate project items cache:', error)
  }
}

/**
 * Hydrate React Query cache for transaction items from offlineStore
 */
export async function hydrateTransactionItemsCache(
  queryClient: QueryClient,
  accountId: string,
  transactionId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedItems = await offlineStore.getAllItems()
    const transactionItems = cachedItems
      .filter(item => item.transactionId === transactionId)
      .filter(item => !item.accountId || item.accountId === accountId)
      .map(item => unifiedItemsService._convertOfflineItem(item))
    
    if (transactionItems.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['transaction-items', accountId, transactionId], transactionItems)
    }
  } catch (error) {
    console.warn('Failed to hydrate transaction items cache:', error)
  }
}

/**
 * Hydrate React Query cache for business inventory items from offlineStore
 */
export async function hydrateBusinessInventoryCache(
  queryClient: QueryClient,
  accountId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedItems = await offlineStore.getAllItems()
    const businessItems = cachedItems
      .filter(item => !item.projectId)
      .filter(item => !item.accountId || item.accountId === accountId)
      .map(item => unifiedItemsService._convertOfflineItem(item))
    
    if (businessItems.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['business-inventory', accountId], businessItems)
    }
  } catch (error) {
    console.warn('Failed to hydrate business inventory cache:', error)
  }
}
