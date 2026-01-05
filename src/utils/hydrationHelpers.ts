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

    // Block stale hydrations from resurrecting ghosts - check if item still exists in IndexedDB
    const cachedItem = await offlineStore.getItemById(itemId).catch(() => null)
    if (!cachedItem) {
      console.info('Skipping hydration of deleted item (ghost prevention)', { itemId })
      return
    }

    // Convert DBItem to Item format
    const item = unifiedItemsService._convertOfflineItem(cachedItem)
    // Prime the React Query cache
    queryClient.setQueryData(['item', accountId, itemId], item)
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
      // Filter out items that no longer exist in IndexedDB (ghost prevention)
      const validItems = []
      for (const cachedItem of cachedItems) {
        if (!cachedItem.accountId || cachedItem.accountId === accountId) {
          // Double-check item still exists before including it
          try {
            const exists = await offlineStore.getItemById(cachedItem.itemId).catch(() => null)
            if (exists) {
              validItems.push(unifiedItemsService._convertOfflineItem(cachedItem))
            } else {
              console.info('Filtering out deleted item from project cache (ghost prevention)', {
                itemId: cachedItem.itemId,
                projectId
              })
            }
          } catch (error) {
            console.warn('Failed to verify item existence during hydration, excluding from cache', {
              itemId: cachedItem.itemId,
              error
            })
          }
        }
      }

      if (validItems.length > 0) {
        // Prime the React Query cache
        queryClient.setQueryData(['project-items', accountId, projectId], validItems)
      }
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

    // Filter out items that no longer exist in IndexedDB (ghost prevention)
    const validTransactionItems = []
    for (const cachedItem of cachedItems) {
      if (cachedItem.transactionId === transactionId && (!cachedItem.accountId || cachedItem.accountId === accountId)) {
        // Double-check item still exists before including it
        try {
          const exists = await offlineStore.getItemById(cachedItem.itemId).catch(() => null)
          if (exists) {
            validTransactionItems.push(unifiedItemsService._convertOfflineItem(cachedItem))
          } else {
            console.info('Filtering out deleted item from transaction cache (ghost prevention)', {
              itemId: cachedItem.itemId,
              transactionId
            })
          }
        } catch (error) {
          console.warn('Failed to verify item existence during transaction items hydration, excluding from cache', {
            itemId: cachedItem.itemId,
            error
          })
        }
      }
    }

    if (validTransactionItems.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['transaction-items', accountId, transactionId], validTransactionItems)
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

    // Filter out items that no longer exist in IndexedDB (ghost prevention)
    const validBusinessItems = []
    for (const cachedItem of cachedItems) {
      if ((!cachedItem.projectId) && (!cachedItem.accountId || cachedItem.accountId === accountId)) {
        // Double-check item still exists before including it
        try {
          const exists = await offlineStore.getItemById(cachedItem.itemId).catch(() => null)
          if (exists) {
            validBusinessItems.push(unifiedItemsService._convertOfflineItem(cachedItem))
          } else {
            console.info('Filtering out deleted item from business inventory cache (ghost prevention)', {
              itemId: cachedItem.itemId
            })
          }
        } catch (error) {
          console.warn('Failed to verify item existence during business inventory hydration, excluding from cache', {
            itemId: cachedItem.itemId,
            error
          })
        }
      }
    }

    if (validBusinessItems.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['business-inventory', accountId], validBusinessItems)
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

    // Block stale hydrations from resurrecting ghosts - check if transaction still exists in IndexedDB
    const cachedTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null)
    if (!cachedTransaction) {
      console.info('Skipping hydration of deleted transaction (ghost prevention)', { transactionId })
      return
    }

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
      // Convert DBProject to Project format - use all fields from cached project
      const project: Project = {
        id: cachedProject.id,
        accountId: cachedProject.accountId,
        name: cachedProject.name,
        description: cachedProject.description || '',
        clientName: cachedProject.clientName || '',
        budget: cachedProject.budget,
        designFee: cachedProject.designFee,
        budgetCategories: cachedProject.budgetCategories,
        defaultCategoryId: cachedProject.defaultCategoryId || undefined,
        mainImageUrl: cachedProject.mainImageUrl,
        createdAt: new Date(cachedProject.createdAt),
        updatedAt: new Date(cachedProject.updatedAt),
        createdBy: cachedProject.createdBy || '',
        settings: cachedProject.settings || undefined,
        metadata: cachedProject.metadata || undefined,
        itemCount: cachedProject.itemCount || 0,
        transactionCount: cachedProject.transactionCount || 0,
        totalValue: cachedProject.totalValue || 0
      }
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

/**
 * Hydrate React Query cache for all projects from offlineStore
 * This should be called before rendering project lists to prevent empty state flashes
 */
export async function hydrateProjectsListCache(
  queryClient: QueryClient,
  accountId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedProjects = await offlineStore.getProjects()
    const accountProjects = cachedProjects
      .filter(project => project.accountId === accountId)
      .map(cachedProject => {
        // Convert DBProject to Project format
        return {
          id: cachedProject.id,
          accountId: cachedProject.accountId,
          name: cachedProject.name,
          description: cachedProject.description || '',
          clientName: cachedProject.clientName || '',
          budget: cachedProject.budget,
          designFee: cachedProject.designFee,
          budgetCategories: cachedProject.budgetCategories,
          defaultCategoryId: cachedProject.defaultCategoryId || undefined,
          mainImageUrl: cachedProject.mainImageUrl,
          createdAt: new Date(cachedProject.createdAt),
          updatedAt: new Date(cachedProject.updatedAt),
          createdBy: cachedProject.createdBy || '',
          settings: cachedProject.settings || undefined,
          metadata: cachedProject.metadata || undefined,
          itemCount: cachedProject.itemCount || 0,
          transactionCount: cachedProject.transactionCount || 0,
          totalValue: cachedProject.totalValue || 0
        } as Project
      })
    
    if (accountProjects.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['projects', accountId], accountProjects)
    }
  } catch (error) {
    console.warn('Failed to hydrate projects list cache:', error)
  }
}

/**
 * Hydrate React Query cache for project transactions from offlineStore
 * This should be called before rendering transaction lists to prevent empty state flashes
 */
export async function hydrateProjectTransactionsCache(
  queryClient: QueryClient,
  accountId: string,
  projectId: string
): Promise<void> {
  try {
    await offlineStore.init()
    const cachedTransactions = await offlineStore.getTransactions(projectId)
    const projectTxIds = cachedTransactions
      .filter(tx => tx.accountId === accountId && tx.projectId === projectId)
      .map(tx => tx.transactionId)
    
    if (projectTxIds.length === 0) return
    
    // Convert each cached transaction using the service helper
    const { transactionService } = await import('../services/inventoryService')
    const transactions: Transaction[] = []

    for (const txId of projectTxIds) {
      try {
        // Double-check transaction still exists in IndexedDB before including it (ghost prevention)
        const exists = await offlineStore.getTransactionById(txId).catch(() => null)
        if (!exists) {
          console.info('Filtering out deleted transaction from project cache (ghost prevention)', {
            transactionId: txId,
            projectId
          })
          continue
        }

        const { transaction } = await transactionService._getTransactionByIdOffline(accountId, txId)
        if (transaction) {
          transactions.push(transaction)
        }
      } catch (error) {
        console.warn(`Failed to convert cached transaction ${txId}:`, error)
      }
    }
    
    if (transactions.length > 0) {
      // Prime the React Query cache
      queryClient.setQueryData(['project-transactions', accountId, projectId], transactions)
    }
  } catch (error) {
    console.warn('Failed to hydrate project transactions cache:', error)
  }
}

/**
 * Get cached project transactions from offlineStore
 * Returns empty array if cache is cold
 */
export async function getCachedProjectTransactions(
  accountId: string,
  projectId: string
): Promise<Transaction[]> {
  try {
    await offlineStore.init()
    const cachedTransactions = await offlineStore.getTransactions(projectId)
    const projectTxIds = cachedTransactions
      .filter(tx => tx.accountId === accountId && tx.projectId === projectId)
      .map(tx => tx.transactionId)
    
    if (projectTxIds.length === 0) return []
    
    const { transactionService } = await import('../services/inventoryService')
    const transactions: Transaction[] = []

    for (const txId of projectTxIds) {
      try {
        // Double-check transaction still exists in IndexedDB before including it (ghost prevention)
        const exists = await offlineStore.getTransactionById(txId).catch(() => null)
        if (!exists) {
          console.info('Filtering out deleted transaction from cached list (ghost prevention)', {
            transactionId: txId,
            projectId
          })
          continue
        }

        const { transaction } = await transactionService._getTransactionByIdOffline(accountId, txId)
        if (transaction) {
          transactions.push(transaction)
        }
      } catch (error) {
        console.warn(`Failed to convert cached transaction ${txId}:`, error)
      }
    }
    
    return transactions
  } catch (error) {
    console.warn('Failed to get cached project transactions:', error)
    return []
  }
}
