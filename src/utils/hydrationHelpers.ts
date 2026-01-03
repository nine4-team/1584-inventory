/**
 * Shared hydration helpers for synchronously priming React Query caches from offlineStore
 * Prevents empty state flashes when reopening offline
 */

import { QueryClient } from '@tanstack/react-query'
import { offlineStore } from '../services/offlineStore'
import { unifiedItemsService, transactionService, projectService } from '../services/inventoryService'
import type { Item, Transaction, Project } from '../types'

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

/**
 * Hydrate optimistic item into React Query cache immediately after creation
 * This makes the item appear in lists before sync completes
 * 
 * @param accountId - Account ID
 * @param itemId - Optimistic item ID
 * @param itemData - Item data that was just created
 */
export async function hydrateOptimisticItem(
  accountId: string,
  itemId: string,
  itemData: Omit<Item, 'itemId' | 'dateCreated' | 'lastUpdated'>
): Promise<void> {
  try {
    const { getGlobalQueryClient } = await import('./queryClient')
    const queryClient = getGlobalQueryClient()
    
    // Convert itemData to full Item format
    const now = new Date().toISOString()
    const optimisticItem: Item = {
      ...itemData,
      itemId,
      accountId,
      dateCreated: itemData.dateCreated || now,
      lastUpdated: itemData.lastUpdated || now,
    }
    
    // Update single item cache
    queryClient.setQueryData(['item', accountId, itemId], optimisticItem)
    
    // Update project items cache if projectId exists
    if (itemData.projectId) {
      queryClient.setQueryData(['project-items', accountId, itemData.projectId], (old: Item[] | undefined) => {
        if (!old) return [optimisticItem]
        // Check if item already exists (shouldn't happen, but be safe)
        const exists = old.some(item => item.itemId === itemId)
        if (exists) {
          return old.map(item => item.itemId === itemId ? optimisticItem : item)
        }
        return [optimisticItem, ...old]
      })
    } else {
      // Update business inventory cache if no projectId
      queryClient.setQueryData(['business-inventory', accountId], (old: Item[] | undefined) => {
        if (!old) return [optimisticItem]
        const exists = old.some(item => item.itemId === itemId)
        if (exists) {
          return old.map(item => item.itemId === itemId ? optimisticItem : item)
        }
        return [optimisticItem, ...old]
      })
    }
    
    // Update transaction items cache if transactionId exists
    if (itemData.transactionId) {
      queryClient.setQueryData(['transaction-items', accountId, itemData.transactionId], (old: Item[] | undefined) => {
        if (!old) return [optimisticItem]
        const exists = old.some(item => item.itemId === itemId)
        if (exists) {
          return old.map(item => item.itemId === itemId ? optimisticItem : item)
        }
        return [optimisticItem, ...old]
      })
    }
  } catch (error) {
    console.warn('Failed to hydrate optimistic item into React Query cache:', error)
    // Don't throw - this is a performance optimization, not critical
  }
}

/**
 * Hydrate React Query cache for a single transaction from offlineStore
 * This should be called synchronously before rendering to prevent empty state flashes
 */
export async function hydrateTransactionCache(
  queryClient: QueryClient,
  accountId: string,
  transactionId: string
): Promise<void> {
  try {
    await offlineStore.init()
    // Use the existing offline method which handles conversion and enrichment
    const { transaction } = await transactionService._getTransactionByIdOffline(accountId, transactionId)
    if (transaction) {
      // Prime the React Query cache
      queryClient.setQueryData(['transaction', accountId, transactionId], transaction)
    }
  } catch (error) {
    console.warn('Failed to hydrate transaction cache:', error)
  }
}

/**
 * Hydrate React Query cache for a single project from offlineStore
 * This should be called synchronously before rendering to prevent empty state flashes
 */
export async function hydrateProjectCache(
  queryClient: QueryClient,
  accountId: string,
  projectId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedProject = await offlineStore.getProjectById(projectId)
    if (cachedProject) {
      // Convert DBProject to Project format using projectService converter
      const project = projectService._convertProjectFromDb({
        id: cachedProject.id,
        account_id: accountId,
        name: cachedProject.name,
        description: cachedProject.description,
        client_name: cachedProject.clientName,
        budget: cachedProject.budget,
        design_fee: cachedProject.designFee,
        main_image_url: cachedProject.mainImageUrl,
        created_at: cachedProject.createdAt,
        updated_at: cachedProject.updatedAt,
        created_by: cachedProject.createdBy,
        settings: undefined,
        metadata: undefined,
        item_count: 0,
        transaction_count: 0,
        total_value: 0
      })
      // Prime the React Query cache
      queryClient.setQueryData(['project', accountId, projectId], project)
    }
  } catch (error) {
    console.warn('Failed to hydrate project cache:', error)
  }
}

/**
 * Hydrate optimistic transaction into React Query cache immediately after creation
 * This makes the transaction appear in lists before sync completes
 * 
 * @param accountId - Account ID
 * @param transactionId - Optimistic transaction ID
 * @param transactionData - Transaction data that was just created
 */
export async function hydrateOptimisticTransaction(
  accountId: string,
  transactionId: string,
  transactionData: Omit<Transaction, 'transactionId' | 'createdAt'>
): Promise<void> {
  try {
    const { getGlobalQueryClient } = await import('./queryClient')
    const queryClient = getGlobalQueryClient()
    
    // Convert transactionData to full Transaction format
    const now = new Date().toISOString()
    const optimisticTransaction: Transaction = {
      ...transactionData,
      transactionId,
      createdAt: transactionData.createdAt || now,
    }
    
    // Update single transaction cache
    queryClient.setQueryData(['transaction', accountId, transactionId], optimisticTransaction)
    
    // Update project transactions cache if projectId exists
    if (transactionData.projectId) {
      queryClient.setQueryData(['project-transactions', accountId, transactionData.projectId], (old: Transaction[] | undefined) => {
        if (!old) return [optimisticTransaction]
        // Check if transaction already exists (shouldn't happen, but be safe)
        const exists = old.some(tx => tx.transactionId === transactionId)
        if (exists) {
          return old.map(tx => tx.transactionId === transactionId ? optimisticTransaction : tx)
        }
        return [optimisticTransaction, ...old]
      })
    }
    
    // Update all transactions cache
    queryClient.setQueryData(['transactions', accountId], (old: Transaction[] | undefined) => {
      if (!old) return [optimisticTransaction]
      const exists = old.some(tx => tx.transactionId === transactionId)
      if (exists) {
        return old.map(tx => tx.transactionId === transactionId ? optimisticTransaction : tx)
      }
      return [optimisticTransaction, ...old]
    })
  } catch (error) {
    console.warn('Failed to hydrate optimistic transaction into React Query cache:', error)
    // Don't throw - this is a performance optimization, not critical
  }
}

/**
 * Hydrate optimistic project into React Query cache immediately after creation
 * This makes the project appear in lists before sync completes
 * 
 * @param accountId - Account ID
 * @param projectId - Optimistic project ID
 * @param projectData - Project data that was just created
 */
export async function hydrateOptimisticProject(
  accountId: string,
  projectId: string,
  projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  try {
    const { getGlobalQueryClient } = await import('./queryClient')
    const queryClient = getGlobalQueryClient()
    
    // Convert projectData to full Project format
    const now = new Date()
    const optimisticProject: Project = {
      ...projectData,
      id: projectId,
      accountId,
      createdAt: projectData.createdAt || now,
      updatedAt: projectData.updatedAt || now,
    }
    
    // Update single project cache
    queryClient.setQueryData(['project', accountId, projectId], optimisticProject)
    
    // Update projects list cache
    queryClient.setQueryData(['projects', accountId], (old: Project[] | undefined) => {
      if (!old) return [optimisticProject]
      // Check if project already exists (shouldn't happen, but be safe)
      const exists = old.some(p => p.id === projectId)
      if (exists) {
        return old.map(p => p.id === projectId ? optimisticProject : p)
      }
      return [optimisticProject, ...old]
    })
  } catch (error) {
    console.warn('Failed to hydrate optimistic project into React Query cache:', error)
    // Don't throw - this is a performance optimization, not critical
  }
}
