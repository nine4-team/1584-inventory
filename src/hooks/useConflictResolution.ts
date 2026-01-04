import { useState, useEffect, useCallback } from 'react'
import { ConflictItem, Resolution } from '../types/conflicts'
import { conflictDetector } from '../services/conflictDetector'
import { conflictResolver } from '../services/conflictResolver'
import { offlineStore } from '../services/offlineStore'

export function useConflictResolution(accountId?: string, projectId?: string) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [isResolving, setIsResolving] = useState(false)
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null)

  const loadStoredConflicts = useCallback(async (accountId: string, scopedProjectId?: string) => {
    try {
      const storedConflicts = await offlineStore.getConflicts(accountId, false)
      const conflictItems: ConflictItem[] = storedConflicts
        .map(conflict => {
          const trimmedItemId =
            typeof conflict.itemId === 'string' ? conflict.itemId.trim() : ''
          return { conflict, trimmedItemId }
        })
        .filter(({ conflict, trimmedItemId }) => conflict.entityType === 'item' && trimmedItemId.length > 0)
        .filter(({ conflict }) => {
          if (!scopedProjectId) return true
          return conflict.projectId === scopedProjectId
        })
        .map(({ conflict, trimmedItemId }) => ({
          id: trimmedItemId,
          entityType: 'item',
          type: conflict.type,
          field: conflict.field || 'unknown',
          local: {
            data: conflict.local.data as Record<string, unknown>,
            timestamp: conflict.local.timestamp,
            version: conflict.local.version
          },
          server: {
            data: conflict.server.data as Record<string, unknown>,
            timestamp: conflict.server.timestamp,
            version: conflict.server.version
          }
        }))
      
      if (conflictItems.length > 0) {
        setConflicts(conflictItems)
        setCurrentConflict(conflictItems[0])
      } else {
        setConflicts([])
        setCurrentConflict(null)
      }
    } catch (error) {
      console.error('Failed to load stored conflicts:', error)
    }
  }, [])

  // Load stored conflicts from IndexedDB on mount
  useEffect(() => {
    if (accountId) {
      loadStoredConflicts(accountId, projectId)
    } else {
      setConflicts([])
      setCurrentConflict(null)
    }
  }, [accountId, projectId, loadStoredConflicts])

  const detectConflicts = async (projectId: string) => {
    setIsResolving(true)
    try {
      const detectedConflicts = await conflictDetector.detectConflicts(projectId)
      
      // Merge with existing conflicts, avoiding duplicates
      setConflicts(prev => {
        const existingIds = new Set(prev.map(c => c.id))
        const newConflicts = detectedConflicts.filter(c => !existingIds.has(c.id))
        const merged = [...prev, ...newConflicts]
        
        if (merged.length > 0 && !currentConflict) {
          setCurrentConflict(merged[0])
        }
        
        return merged
      })
    } finally {
      setIsResolving(false)
    }
  }

  const resolveCurrentConflict = async (resolution: Resolution) => {
    if (!currentConflict) return
    if (currentConflict.entityType !== 'item') {
      console.warn('Skipping conflict resolution for unsupported entity type', {
        entityType: currentConflict.entityType,
        conflictId: currentConflict.id
      })
      return
    }

    try {
      await conflictResolver.applyResolution(currentConflict, resolution)

      // Delete all conflicts for this item (applyResolution already does this, but also clean up UI state)
      if (accountId) {
        await offlineStore.deleteConflictsForItems(accountId, [currentConflict.id])
      }

      // Move to next conflict - filter out ALL conflicts for this item
      const remainingConflicts = conflicts.filter(c => c.id !== currentConflict.id)
      setConflicts(remainingConflicts)
      setCurrentConflict(remainingConflicts.length > 0 ? remainingConflicts[0] : null)
    } catch (error) {
      console.error('Failed to resolve conflict:', error)
      throw error // Re-throw so UI can handle it
    }
  }

  const skipCurrentConflict = () => {
    const remainingConflicts = conflicts.filter(c => c.id !== currentConflict?.id)
    setConflicts(remainingConflicts)
    setCurrentConflict(remainingConflicts.length > 0 ? remainingConflicts[0] : null)
  }

  const resolveAllConflicts = async (defaultResolution: Resolution = { strategy: 'keep_server' }): Promise<void> => {
    if (!accountId || conflicts.length === 0) return

    setIsResolving(true)
    try {
      // Get unique item IDs to avoid resolving the same item multiple times
      const uniqueItemIds = Array.from(new Set(conflicts.map(c => c.id)))
      
      // Resolve each unique item conflict
      for (const itemId of uniqueItemIds) {
        // Find the first conflict for this item
        const conflictForItem = conflicts.find(c => c.id === itemId && c.entityType === 'item')
        if (!conflictForItem) continue

        try {
          // Use default resolution (keep_server) for all conflicts
          await conflictResolver.applyResolution(conflictForItem, defaultResolution)
          
          // Delete all conflicts for this item
          await offlineStore.deleteConflictsForItems(accountId, [itemId])
        } catch (error) {
          console.error(`Failed to resolve conflict for item ${itemId}:`, error)
          // Continue with other conflicts even if one fails
        }
      }

      // Clear resolved conflicts from state while leaving any non-item conflicts for future handling
      const remaining = conflicts.filter(c => c.entityType !== 'item')
      setConflicts(remaining)
      setCurrentConflict(remaining.length > 0 ? remaining[0] : null)
    } finally {
      setIsResolving(false)
    }
  }

  return {
    conflicts,
    currentConflict,
    isResolving,
    detectConflicts,
    resolveCurrentConflict,
    resolveAllConflicts,
    skipCurrentConflict,
    hasConflicts: conflicts.length > 0
  }
}