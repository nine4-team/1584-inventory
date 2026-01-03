import { offlineStore, type DBProject } from './offlineStore'
import { operationQueue } from './operationQueue'
import type { Project } from '../types'
import type { Operation } from '../types/operations'
import { isNetworkOnline } from './networkStatusService'

export interface OfflineOperationResult {
  operationId: string
  wasQueued: boolean
  projectId?: string
}

export class OfflineStorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'OfflineStorageError'
  }
}

export class OfflineQueueUnavailableError extends OfflineStorageError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'OfflineQueueUnavailableError'
  }
}

export class OfflineProjectService {
  /**
   * Create a project offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async createProject(
    accountId: string,
    projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<OfflineOperationResult> {
    try {
      await offlineStore.init()
    } catch (error) {
      console.error('Offline storage unavailable during createProject:', error)
      throw new OfflineQueueUnavailableError(
        'Offline storage is unavailable. Please refresh or try again online.',
        error
      )
    }

    const timestamp = new Date().toISOString()
    const projectId = `P-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

    // Convert project data to DB format
    const tempProject: DBProject = {
      id: projectId,
      accountId,
      name: projectData.name || '',
      description: projectData.description || '',
      clientName: projectData.clientName || '',
      budget: projectData.budget,
      designFee: projectData.designFee,
      budgetCategories: projectData.budgetCategories ?? {},
      defaultCategoryId: projectData.defaultCategoryId ?? null,
      mainImageUrl: projectData.mainImageUrl,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: projectData.createdBy || '',
      settings: projectData.settings ?? {},
      metadata: projectData.metadata ?? {},
      itemCount: projectData.itemCount ?? 0,
      transactionCount: projectData.transactionCount ?? 0,
      totalValue: projectData.totalValue ?? 0,
      version: 1,
      last_synced_at: null // Not synced yet
    }

    try {
      await offlineStore.saveProjects([tempProject])
      console.debug('Persisted optimistic offline project before queueing create', {
        projectId
      })
    } catch (error) {
      console.error('Failed to cache optimistic project before queueing CREATE operation', error)
      throw new OfflineQueueUnavailableError(
        'Unable to cache the project for offline sync. Free some storage or retry online.',
        error
      )
    }

    // Convert Project to operation format
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'CREATE_PROJECT',
      data: {
        id: projectId,
        accountId
      }
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: 1,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue CREATE_PROJECT operation after caching optimistic data', error)
      // Attempt to roll back local cache entry so we do not keep orphaned projects
      try {
        await offlineStore.deleteProject(projectId)
      } catch (rollbackError) {
        console.warn('Unable to roll back optimistic project after queue failure', rollbackError)
      }
      throw error
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    if (import.meta.env.DEV) {
      console.info('[offlineProjectService] queued CREATE_PROJECT for offline sync', {
        accountId,
        projectId,
        operationId
      })
    }

    return { operationId, wasQueued: true, projectId }
  }

  /**
   * Update a project offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async updateProject(
    accountId: string,
    projectId: string,
    updates: Partial<Project>
  ): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const projectToUpdate = await offlineStore.getProjectById(projectId).catch(() => null) as DBProject | null
    
    if (!projectToUpdate) {
      throw new Error(`Project ${projectId} not found in offline store`)
    }
    
    const nextVersion = (projectToUpdate.version ?? 0) + 1
    const timestamp = new Date().toISOString()

    // Convert Project updates to operation format
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'UPDATE_PROJECT',
      data: {
        id: projectId,
        accountId,
        updates: {
          name: updates.name,
          budget: updates.budget,
          description: updates.description,
          clientName: updates.clientName,
          designFee: updates.designFee,
          budgetCategories: updates.budgetCategories,
          defaultCategoryId: updates.defaultCategoryId,
          mainImageUrl: updates.mainImageUrl,
          settings: updates.settings,
          metadata: updates.metadata,
          itemCount: updates.itemCount,
          transactionCount: updates.transactionCount,
          totalValue: updates.totalValue
        }
      }
    }

    const operationId = await operationQueue.add(operation, {
      accountId,
      version: nextVersion,
      timestamp
    })

    // Optimistically update local store
    const optimisticProject: DBProject = {
      ...projectToUpdate,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.clientName !== undefined && { clientName: updates.clientName }),
      ...(updates.budget !== undefined && { budget: updates.budget }),
      ...(updates.designFee !== undefined && { designFee: updates.designFee }),
      ...(updates.budgetCategories !== undefined && { budgetCategories: updates.budgetCategories ?? {} }),
      ...(updates.defaultCategoryId !== undefined && { defaultCategoryId: updates.defaultCategoryId ?? null }),
      ...(updates.mainImageUrl !== undefined && { mainImageUrl: updates.mainImageUrl }),
      ...(updates.settings !== undefined && { settings: updates.settings ?? {} }),
      ...(updates.metadata !== undefined && { metadata: updates.metadata ?? {} }),
      ...(updates.itemCount !== undefined && { itemCount: updates.itemCount }),
      ...(updates.transactionCount !== undefined && { transactionCount: updates.transactionCount }),
      ...(updates.totalValue !== undefined && { totalValue: updates.totalValue }),
      updatedAt: timestamp,
      version: nextVersion
    }
    
    await offlineStore.saveProjects([optimisticProject])

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    return { operationId, wasQueued: true, projectId }
  }

  /**
   * Delete a project offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async deleteProject(accountId: string, projectId: string): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const existingProject = await offlineStore.getProjectById(projectId).catch(() => null) as DBProject | null
    
    if (!existingProject) {
      throw new Error(`Project ${projectId} not found in offline store`)
    }
    
    const timestamp = new Date().toISOString()

    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'DELETE_PROJECT',
      data: { id: projectId, accountId }
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: existingProject.version ?? 1,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue DELETE_PROJECT operation', {
        accountId,
        projectId,
        error
      })
      throw error
    }

    try {
      await offlineStore.deleteProject(projectId)
    } catch (cleanupError) {
      console.warn('Failed to purge project from offline store after enqueueing delete (non-fatal)', {
        projectId,
        cleanupError
      })
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    return { operationId, wasQueued: true, projectId }
  }
}

export const offlineProjectService = new OfflineProjectService()
