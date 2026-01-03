# Offline Functionality - Phase 3: Conflict Resolution Implementation

## Overview
Implement conflict detection and resolution for data synchronization. This phase adds the ability to detect when local and server data diverge and provides strategies to resolve conflicts.

## Goals
- Detect data conflicts during sync
- Provide user-friendly conflict resolution UI
- Implement auto-resolution for simple cases
- Ensure data consistency across devices

## Prerequisites
- Phase 1 (Foundation) and Phase 2 (Operation Queue) must be complete
- Background sync working
- Optimistic updates functional

## Implementation Scope
**Focus on this phase:**
- Conflict detection using timestamps and versions
- Simple auto-resolution (last-write-wins)
- User-mediated resolution for complex conflicts

**DO NOT implement in this phase:**
- Advanced merge strategies
- Multi-device conflict resolution
- Complex business logic conflicts

## Step 1: Conflict Detection Types

### Create `/src/types/conflicts.ts`

```typescript
export interface ConflictItem {
  id: string
  local: {
    data: any
    timestamp: string
    version: number
  }
  server: {
    data: any
    timestamp: string
    version: number
  }
  field: string // Which field conflicts
  type: 'timestamp' | 'version' | 'content'
}

export interface Resolution {
  strategy: 'keep_local' | 'keep_server' | 'merge' | 'manual'
  resolvedData?: any
  userChoice?: 'local' | 'server'
}

export interface ConflictResolution {
  itemId: string
  resolution: Resolution
  timestamp: string
}
```

### Update `/src/services/offlineStore.ts` to include version tracking

```typescript
// Add to existing DBItem interface
interface DBItem {
  // ... existing fields ...
  version: number
  last_synced_at?: string // Track when this was last synced
}

// Update saveItems to handle versioning
async saveItems(items: DBItem[]): Promise<void> {
  // ... existing implementation ...
  // Add version increment logic
  for (const item of items) {
    if (!item.version) {
      item.version = 1
    }
    item.last_synced_at = new Date().toISOString()
  }
  // ... rest of implementation ...
}
```

## Step 2: Conflict Detection Service

### Create `/src/services/conflictDetector.ts`

```typescript
import { ConflictItem } from '../types/conflicts'
import { offlineStore, type DBItem } from './offlineStore'
import { supabase } from '../lib/supabase'

export class ConflictDetector {
  async detectConflicts(projectId: string): Promise<ConflictItem[]> {
    const conflicts: ConflictItem[] = []

    try {
      // Get local items
      const localItems = await offlineStore.getItems(projectId)

      // Get server items
      const { data: serverItems, error } = await supabase
        .from('items')
        .select('*')
        .eq('project_id', projectId)

      if (error) throw error

      // Compare each local item with server version
      for (const localItem of localItems) {
        const serverItem = serverItems.find(item => item.id === localItem.id)

        if (!serverItem) {
          // Item exists locally but not on server - this is a create operation, not a conflict
          continue
        }

        const conflict = this.compareItems(localItem, serverItem)
        if (conflict) {
          conflicts.push(conflict)
        }
      }
    } catch (error) {
      console.error('Error detecting conflicts:', error)
    }

    return conflicts
  }

  private compareItems(localItem: DBItem, serverItem: any): ConflictItem | null {
    // Check if versions differ significantly
    if (localItem.version !== (serverItem.version || 1)) {
      return {
        id: localItem.id,
        local: {
          data: localItem,
          timestamp: localItem.updated_at,
          version: localItem.version
        },
        server: {
          data: serverItem,
          timestamp: serverItem.updated_at,
          version: serverItem.version || 1
        },
        field: 'version',
        type: 'version'
      }
    }

    // Check timestamps (server is newer)
    const localTime = new Date(localItem.updated_at).getTime()
    const serverTime = new Date(serverItem.updated_at).getTime()

    if (serverTime > localTime + 5000) { // 5 second buffer for clock skew
      return {
        id: localItem.id,
        local: {
          data: localItem,
          timestamp: localItem.updated_at,
          version: localItem.version
        },
        server: {
          data: serverItem,
          timestamp: serverItem.updated_at,
          version: serverItem.version || 1
        },
        field: 'timestamp',
        type: 'timestamp'
      }
    }

    // Check for content differences in key fields
    const keyFields = ['name', 'quantity', 'unit_cost']
    for (const field of keyFields) {
      if (localItem[field] !== serverItem[field]) {
        return {
          id: localItem.id,
          local: {
            data: localItem,
            timestamp: localItem.updated_at,
            version: localItem.version
          },
          server: {
            data: serverItem,
            timestamp: serverItem.updated_at,
            version: serverItem.version || 1
          },
          field,
          type: 'content'
        }
      }
    }

    return null // No conflict
  }
}

export const conflictDetector = new ConflictDetector()
```

## Step 3: Conflict Resolution Service

### Create `/src/services/conflictResolver.ts`

```typescript
import { ConflictItem, Resolution, ConflictResolution } from '../types/conflicts'
import { offlineStore } from './offlineStore'
import { supabase } from '../lib/supabase'

export class ConflictResolver {
  async resolveConflicts(conflicts: ConflictItem[]): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = []

    for (const conflict of conflicts) {
      const resolution = await this.resolveConflict(conflict)
      resolutions.push({
        itemId: conflict.id,
        resolution,
        timestamp: new Date().toISOString()
      })
    }

    return resolutions
  }

  private async resolveConflict(conflict: ConflictItem): Promise<Resolution> {
    // Strategy 1: Auto-resolve version conflicts (server wins)
    if (conflict.type === 'version') {
      return {
        strategy: 'keep_server',
        resolvedData: conflict.server.data
      }
    }

    // Strategy 2: Auto-resolve timestamp conflicts (server wins if significantly newer)
    if (conflict.type === 'timestamp') {
      const localTime = new Date(conflict.local.timestamp).getTime()
      const serverTime = new Date(conflict.server.timestamp).getTime()
      const diffMinutes = (serverTime - localTime) / (1000 * 60)

      if (diffMinutes > 5) { // Server is more than 5 minutes newer
        return {
          strategy: 'keep_server',
          resolvedData: conflict.server.data
        }
      }
    }

    // Strategy 3: For content conflicts in non-critical fields, keep local
    if (conflict.field === 'description') {
      return {
        strategy: 'keep_local',
        resolvedData: conflict.local.data
      }
    }

    // Strategy 4: For critical conflicts, require manual resolution
    return {
      strategy: 'manual'
    }
  }

  async applyResolution(conflict: ConflictItem, resolution: Resolution): Promise<void> {
    let finalData: any

    switch (resolution.strategy) {
      case 'keep_local':
        finalData = conflict.local.data
        break
      case 'keep_server':
        finalData = conflict.server.data
        // Update local store
        await offlineStore.saveItems([{
          ...conflict.server.data,
          version: conflict.server.version,
          last_synced_at: new Date().toISOString()
        }])
        return
      case 'merge':
        // Simple merge strategy (server wins, but keep local description if server lacks one)
        finalData = {
          ...conflict.server.data,
          description: conflict.server.data.description || conflict.local.data.description
        }
        break
      case 'manual':
        if (resolution.userChoice === 'local') {
          finalData = conflict.local.data
        } else {
          finalData = conflict.server.data
        }
        break
      default:
        throw new Error(`Unknown resolution strategy: ${resolution.strategy}`)
    }

    // Update server with resolved data
    const { error } = await supabase
      .from('items')
      .update(finalData)
      .eq('id', conflict.id)

    if (error) throw error

    // Update local store
    await offlineStore.saveItems([{
      ...finalData,
      version: Math.max(conflict.local.version, conflict.server.version) + 1,
      last_synced_at: new Date().toISOString()
    }])
  }
}

export const conflictResolver = new ConflictResolver()
```

## Step 4: Conflict Resolution UI

### Create `/src/components/ConflictModal.tsx`

```typescript
import React, { useState } from 'react'
import { ConflictItem, Resolution } from '../types/conflicts'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

interface ConflictModalProps {
  conflict: ConflictItem
  onResolve: (resolution: Resolution) => void
  onCancel: () => void
}

export function ConflictModal({ conflict, onResolve, onCancel }: ConflictModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<'local' | 'server' | null>(null)

  const handleResolve = () => {
    if (!selectedChoice) return

    onResolve({
      strategy: 'manual',
      userChoice: selectedChoice
    })
  }

  const renderFieldComparison = (field: string) => {
    const localValue = conflict.local.data[field]
    const serverValue = conflict.server.data[field]

    return (
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">{field}</label>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-red-50 rounded border">
            <div className="text-xs text-red-600 mb-1">Your local change</div>
            <div className="font-mono text-sm">{String(localValue)}</div>
          </div>
          <div className="p-3 bg-blue-50 rounded border">
            <div className="text-xs text-blue-600 mb-1">Server version</div>
            <div className="font-mono text-sm">{String(serverValue)}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl mx-4">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Data Conflict Detected</h2>
          </div>

          <p className="text-gray-600 mb-6">
            The item "{conflict.local.data.name}" has been modified both locally and on the server.
            Please choose which version to keep.
          </p>

          {renderFieldComparison(conflict.field)}

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Choose resolution:</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="choice"
                  value="local"
                  checked={selectedChoice === 'local'}
                  onChange={(e) => setSelectedChoice(e.target.value as 'local')}
                  className="text-blue-600"
                />
                <span>Keep my local changes</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="choice"
                  value="server"
                  checked={selectedChoice === 'server'}
                  onChange={(e) => setSelectedChoice(e.target.value as 'server')}
                  className="text-blue-600"
                />
                <span>Use server version (discard my changes)</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onCancel}>
              Cancel Sync
            </Button>
            <Button
              onClick={handleResolve}
              disabled={!selectedChoice}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Apply Resolution
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
```

### Create `/src/hooks/useConflictResolution.ts`

```typescript
import { useState } from 'react'
import { ConflictItem, ConflictResolution } from '../types/conflicts'
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

  const resolveCurrentConflict = async (resolution: any) => {
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
```

## Step 5: Integrate Conflict Resolution into Sync

### Update `/src/services/operationQueue.ts`

```typescript
// Add conflict resolution to the processQueue method
private async executeOperation(operation: Operation): Promise<boolean> {
  try {
    // Check for conflicts before executing
    const conflicts = await conflictDetector.detectConflicts(operation.data.project_id || '')

    if (conflicts.length > 0) {
      // For now, log conflicts and skip execution
      // In Phase 4, we'll integrate with UI for resolution
      console.warn('Conflicts detected, skipping operation:', conflicts)
      return false
    }

    // ... rest of operation execution ...
  } catch (error) {
    // ... existing error handling ...
  }
}
```

## Testing Criteria

### Unit Tests
- [ ] Conflict detection identifies version differences
- [ ] Conflict detection identifies timestamp differences
- [ ] Auto-resolution works for version conflicts (server wins)
- [ ] Auto-resolution works for timestamp conflicts
- [ ] Manual resolution UI displays conflicts correctly

### Integration Tests
- [ ] Sync process detects conflicts before applying changes
- [ ] Conflict modal appears when manual resolution needed
- [ ] Resolving conflicts updates both local and server data
- [ ] Skipping conflicts moves to next conflict

### Manual Testing
- [ ] Create conflicting changes on two devices
- [ ] Sync detects conflicts
- [ ] Resolve conflicts through UI
- [ ] Verify data consistency after resolution

## Success Metrics
- Conflicts are detected reliably during sync
- Auto-resolution handles >80% of conflicts
- Manual resolution UI is intuitive
- Resolved conflicts maintain data integrity
- No data loss during conflict resolution

## Next Steps
After this phase is complete and tested, proceed to Phase 4: Advanced Features (selective sync, performance optimizations).