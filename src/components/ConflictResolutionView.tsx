import React, { useEffect, useMemo, useState } from 'react'
import { useConflictResolution } from '../hooks/useConflictResolution'
import { ConflictModal } from './ConflictModal'
import { offlineStore } from '../services/offlineStore'
import { ConflictItem } from '../types/conflicts'
import { Button } from './ui/Button'
import { AlertTriangle, CheckCircle } from 'lucide-react'

interface ConflictResolutionViewProps {
  accountId: string
  projectId?: string
  onConflictsResolved?: () => void
}

export function ConflictResolutionView({ accountId, projectId, onConflictsResolved }: ConflictResolutionViewProps) {
  const [storedConflicts, setStoredConflicts] = useState<ConflictItem[]>([])
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const {
    conflicts: detectedConflicts,
    currentConflict,
    isResolving,
    detectConflicts,
    resolveCurrentConflict,
    resolveAllConflicts,
    skipCurrentConflict,
    hasConflicts
  } = useConflictResolution(accountId, projectId)

  useEffect(() => {
    loadStoredConflicts()
  }, [accountId])

  // Also load stored conflicts when useConflictResolution loads them
  useEffect(() => {
    if (detectedConflicts.length > 0) {
      // Merge detected conflicts with stored ones
      loadStoredConflicts()
    }
  }, [detectedConflicts.length])

  const loadStoredConflicts = async () => {
    try {
      const conflicts = await offlineStore.getConflicts(accountId, false)
      const conflictItems: ConflictItem[] = conflicts
        .map(conflict => {
          const trimmedItemId =
            typeof conflict.itemId === 'string' ? conflict.itemId.trim() : ''
          return { conflict, trimmedItemId }
        })
        .filter(({ conflict, trimmedItemId }) => conflict.entityType === 'item' && trimmedItemId.length > 0)
        .filter(({ conflict }) => {
          if (!projectId) return true
          return conflict.projectId === projectId
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
      setStoredConflicts(conflictItems)
    } catch (error) {
      console.error('Failed to load stored conflicts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResolve = async (resolution: any) => {
    if (!currentConflict) return

    try {
      await resolveCurrentConflict(resolution)
      setShowModal(false)

      // Reload stored conflicts
      await loadStoredConflicts()

      // Check if all conflicts are resolved
      const remainingConflicts = await offlineStore.getConflicts(accountId, false)
      if (remainingConflicts.length === 0 && onConflictsResolved) {
        onConflictsResolved()
      }
    } catch (error) {
      console.error('Failed to resolve conflict:', error)
    }
  }

  const handleSkip = () => {
    skipCurrentConflict()
    setShowModal(false)
  }

  const allConflicts = useMemo(() => {
    const seen = new Set<string>()
    const merged: ConflictItem[] = []

    for (const conflict of [...detectedConflicts, ...storedConflicts]) {
      const key = `${conflict.id}-${conflict.field}-${conflict.type}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(conflict)
    }

    return merged
  }, [detectedConflicts, storedConflicts])
  const hasAnyConflicts = allConflicts.length > 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!hasAnyConflicts) {
    return null
  }

  return (
    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-yellow-600" />
        <h3 className="font-medium text-yellow-800">Data Conflicts Detected</h3>
      </div>

      <p className="text-sm text-yellow-700 mb-4">
        Some items have been modified both locally and on the server. Please resolve these conflicts to continue syncing.
      </p>

      <div className="space-y-2 mb-4">
        {allConflicts.slice(0, 3).map((conflict, index) => (
          <div key={`${conflict.id}-${index}`} className="flex items-center justify-between p-3 bg-white rounded border">
            <div>
              <div className="font-medium text-sm">Item: {conflict.local.data.name}</div>
              <div className="text-xs text-gray-600">
                Conflict in: {conflict.field} ({conflict.type})
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                // Set current conflict and show modal
                if (detectedConflicts.includes(conflict)) {
                  setShowModal(true)
                }
              }}
              disabled={isResolving}
            >
              Resolve
            </Button>
          </div>
        ))}

        {allConflicts.length > 3 && (
          <div className="text-sm text-gray-600 text-center">
            +{allConflicts.length - 3} more conflicts
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => projectId && detectConflicts(projectId)}
          disabled={isResolving}
        >
          {isResolving ? 'Detecting...' : 'Detect Conflicts'}
        </Button>

        {hasAnyConflicts && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                // Resolve all conflicts using keep_server strategy (server wins)
                await resolveAllConflicts({ strategy: 'keep_server' })
                // Reload stored conflicts to update UI
                await loadStoredConflicts()
                // Check if all conflicts are resolved
                const remainingConflicts = await offlineStore.getConflicts(accountId, false)
                if (remainingConflicts.length === 0 && onConflictsResolved) {
                  onConflictsResolved()
                }
              } catch (error) {
                console.error('Failed to resolve all conflicts:', error)
              }
            }}
            disabled={isResolving || allConflicts.length === 0}
          >
            <CheckCircle className="w-4 h-4 mr-1" />
            {isResolving ? 'Resolving...' : `Resolve All (${allConflicts.length})`}
          </Button>
        )}
      </div>

      {currentConflict && showModal && (
        <ConflictModal
          conflict={currentConflict}
          onResolve={handleResolve}
          onCancel={handleSkip}
        />
      )}
    </div>
  )
}