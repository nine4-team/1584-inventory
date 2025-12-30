import { useState } from 'react'
import { ConflictItem, Resolution } from '../types/conflicts'
import { conflictDetector } from '../services/conflictDetector'
import { conflictResolver } from '../services/conflictResolver'

export function useConflictResolution() {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [isResolving, setIsResolving] = useState(false)
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null)

  const detectConflicts = async (projectId: string) => {
    setIsResolving(true)
    try {
      const detectedConflicts = await conflictDetector.detectConflicts(projectId)
      setConflicts(detectedConflicts)

      if (detectedConflicts.length > 0) {
        setCurrentConflict(detectedConflicts[0])
      }
    } finally {
      setIsResolving(false)
    }
  }

  const resolveCurrentConflict = async (resolution: Resolution) => {
    if (!currentConflict) return

    try {
      await conflictResolver.applyResolution(currentConflict, resolution)

      // Move to next conflict
      const remainingConflicts = conflicts.filter(c => c.id !== currentConflict.id)
      setConflicts(remainingConflicts)
      setCurrentConflict(remainingConflicts.length > 0 ? remainingConflicts[0] : null)
    } catch (error) {
      console.error('Failed to resolve conflict:', error)
      // Handle resolution failure
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