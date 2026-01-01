import { useState, useEffect } from 'react'
import { ConflictItem, Resolution } from '../types/conflicts'
import { conflictDetector } from '../services/conflictDetector'
import { conflictResolver } from '../services/conflictResolver'
import { offlineStore } from '../services/offlineStore'

export function useConflictResolution(accountId?: string, projectId?: string) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [isResolving, setIsResolving] = useState(false)
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null)

  // Load stored conflicts from IndexedDB on mount
  useEffect(() => {
    if (accountId) {
      loadStoredConflicts(accountId)
    }
  }, [accountId])

  const loadStoredConflicts = async (accountId: string) => {
    try {
      const storedConflicts = await offlineStore.getConflicts(accountId, false)
      const conflictItems: ConflictItem[] = storedConflicts.map(c => ({
        id: c.itemId,
        type: c.type,
        field: c.field || 'unknown',
        local: {
          data: c.local.data as Record<string, unknown>,
          timestamp: c.local.timestamp,
          version: c.local.version
        },
        server: {
          data: c.server.data as Record<string, unknown>,
          timestamp: c.server.timestamp,
          version: c.server.version
        }
      }))
      
      if (conflictItems.length > 0) {
        setConflicts(conflictItems)
        setCurrentConflict(conflictItems[0])
      }
    } catch (error) {
      console.error('Failed to load stored conflicts:', error)
    }
  }

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

    try {
      await conflictResolver.applyResolution(currentConflict, resolution)

      // Remove resolved conflict from IndexedDB
      if (accountId) {
        const storedConflicts = await offlineStore.getConflicts(accountId, false)
        const conflictToDelete = storedConflicts.find(c => c.itemId === currentConflict.id)
        if (conflictToDelete) {
          await offlineStore.deleteConflict(conflictToDelete.id)
        }
      }

      // Move to next conflict
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

  return {
    conflicts,
    currentConflict,
    isResolving,
    detectConflicts,
    resolveCurrentConflict,
    skipCurrentConflict,
    hasConflicts: conflicts.length > 0
  }
}