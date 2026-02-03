import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { operationQueue } from '../../services/operationQueue'
import { offlineStore, type DBItem } from '../../services/offlineStore'
import type { Operation } from '../../types/operations'
import { Button } from '../ui/Button'
import BlockingConfirmDialog from '../ui/BlockingConfirmDialog'
import { RetrySyncButton } from '../ui/RetrySyncButton'

type SyncIssueRow = {
  operation: Operation
  itemId: string
  item: DBItem | null
}

function isMissingItemIssue(operation: Operation): boolean {
  return operation.syncStatus === 'requires_intervention' && operation.interventionReason === 'missing_item_on_server'
}

function getItemIdForOperation(operation: Operation): string | null {
  switch (operation.type) {
    case 'UPDATE_ITEM':
    case 'DELETE_ITEM':
    case 'CREATE_ITEM':
      return operation.data.id
    case 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY':
    case 'ALLOCATE_ITEM_TO_PROJECT':
    case 'SELL_ITEM_TO_PROJECT':
      return operation.data.itemId
    default:
      return null
  }
}

function formatOperationType(operation: Operation): string {
  switch (operation.type) {
    case 'CREATE_ITEM':
      return 'Create'
    case 'UPDATE_ITEM':
      return 'Update'
    case 'DELETE_ITEM':
      return 'Delete'
    default:
      return operation.type.replaceAll('_', ' ')
  }
}

export default function SyncIssuesManager() {
  const [operations, setOperations] = useState<Operation[]>(() => {
    // Avoid hard dependency on newer operationQueue methods (service worker caches can
    // temporarily serve mixed versions of JS bundles during updates).
    try {
      const anyQueue = operationQueue as any
      if (typeof anyQueue?.getSnapshot === 'function') {
        return (anyQueue.getSnapshot()?.operations ?? []) as Operation[]
      }
      if (typeof anyQueue?.getPendingOperations === 'function') {
        return (anyQueue.getPendingOperations() ?? []) as Operation[]
      }
    } catch {
      // best-effort
    }
    return []
  })
  const [itemCache, setItemCache] = useState<Map<string, DBItem | null>>(() => new Map())
  const [selectedOperationIds, setSelectedOperationIds] = useState<Set<string>>(() => new Set())
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [isRecreating, setIsRecreating] = useState(false)

  useEffect(() => {
    const anyQueue = operationQueue as any
    if (typeof anyQueue?.subscribe !== 'function') {
      return
    }

    const unsubscribe = anyQueue.subscribe((snapshot: any) => {
      setOperations((snapshot?.operations ?? []) as Operation[])
    })
    return () => unsubscribe()
  }, [])

  const missingItemOps = useMemo(() => operations.filter(isMissingItemIssue), [operations])

  const rows: SyncIssueRow[] = useMemo(() => {
    return missingItemOps
      .map(op => {
        const itemId = getItemIdForOperation(op)
        if (!itemId) return null
        return {
          operation: op,
          itemId,
          item: itemCache.get(itemId) ?? null
        } satisfies SyncIssueRow
      })
      .filter((row): row is SyncIssueRow => Boolean(row))
  }, [missingItemOps, itemCache])

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      if (missingItemOps.length === 0) {
        if (!cancelled) {
          setItemCache(new Map())
          setSelectedOperationIds(new Set())
        }
        return
      }

      try {
        await offlineStore.init()
      } catch {
        // best-effort
      }

      const nextCache = new Map(itemCache)
      const itemIds = Array.from(
        new Set(
          missingItemOps
            .map(op => getItemIdForOperation(op))
            .filter((id): id is string => Boolean(id))
        )
      )

      await Promise.all(
        itemIds.map(async id => {
          if (nextCache.has(id)) return
          try {
            const item = await offlineStore.getItemById(id)
            nextCache.set(id, item)
          } catch {
            nextCache.set(id, null)
          }
        })
      )

      if (!cancelled) {
        setItemCache(nextCache)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingItemOps.map(op => op.id).join('|')])

  const selectedCount = selectedOperationIds.size
  const allSelected = rows.length > 0 && selectedCount === rows.length

  const toggleSelectAll = () => {
    if (rows.length === 0) return
    if (allSelected) {
      setSelectedOperationIds(new Set())
      return
    }
    setSelectedOperationIds(new Set(rows.map(row => row.operation.id)))
  }

  const toggleSelected = (operationId: string) => {
    setSelectedOperationIds(prev => {
      const next = new Set(prev)
      if (next.has(operationId)) {
        next.delete(operationId)
      } else {
        next.add(operationId)
      }
      return next
    })
  }

  const handleRecreate = async (operationId: string) => {
    await operationQueue.recreateMissingItemSyncIssue(operationId)
  }

  const handleRecreateSelected = async () => {
    if (selectedOperationIds.size === 0) return
    setIsRecreating(true)
    try {
      for (const opId of Array.from(selectedOperationIds)) {
        // eslint-disable-next-line no-await-in-loop
        await operationQueue.recreateMissingItemSyncIssue(opId)
      }
    } finally {
      setIsRecreating(false)
      setSelectedOperationIds(new Set())
    }
  }

  const handleDiscardSingle = async (operationId: string) => {
    setSelectedOperationIds(new Set([operationId]))
    setConfirmDiscardOpen(true)
  }

  const handleDiscardSelected = async () => {
    if (selectedOperationIds.size === 0) return
    setIsDiscarding(true)
    try {
      // Do sequentially to avoid fighting over queue persistence.
      for (const opId of Array.from(selectedOperationIds)) {
        // eslint-disable-next-line no-await-in-loop
        await operationQueue.discardMissingItemSyncIssue(opId)
      }
    } finally {
      setIsDiscarding(false)
      setConfirmDiscardOpen(false)
      setSelectedOperationIds(new Set())
    }
  }

  if (missingItemOps.length === 0) {
    return (
      <div className="bg-white overflow-hidden shadow rounded-lg">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Sync issues</h3>
              <p className="mt-1 text-sm text-gray-500">
                When an offline change can’t be applied to the server, it will show up here for manual review.
              </p>
            </div>
            <RetrySyncButton />
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            <span className="font-medium">All clear.</span>
            <span>No stuck item updates found.</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white overflow-hidden shadow rounded-lg">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <h3 className="text-lg font-medium text-gray-900">Sync issues</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {missingItemOps.length} item update{missingItemOps.length === 1 ? '' : 's'} couldn’t sync because the
                item is missing on the server. Choose to discard the local item or recreate it on the server.
              </p>
            </div>
            <RetrySyncButton />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleSelectAll}
              disabled={rows.length === 0}
            >
              {allSelected ? 'Clear selection' : 'Select all'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRecreateSelected}
              disabled={selectedOperationIds.size === 0 || isRecreating}
              className="inline-flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Recreate selected ({selectedCount})
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDiscardOpen(true)}
              disabled={selectedOperationIds.size === 0}
              className="inline-flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Discard selected ({selectedCount})
            </Button>
          </div>

          <div className="mt-4 border border-gray-200 rounded-md overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all sync issues"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Item
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Change
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Error
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rows.map(row => {
                    const op = row.operation
                    const selected = selectedOperationIds.has(op.id)
                    const itemLabel =
                      row.item?.name?.trim() ||
                      row.item?.description?.trim() ||
                      row.itemId

                    return (
                      <tr key={op.id} className={selected ? 'bg-amber-50' : undefined}>
                        <td className="px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelected(op.id)}
                            aria-label={`Select ${itemLabel}`}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm font-medium text-gray-900">{itemLabel}</div>
                          <div className="text-xs text-gray-500">{row.itemId}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-gray-700">{formatOperationType(op)}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-gray-700">Item not found on server</div>
                          {op.lastError && <div className="text-xs text-gray-500 mt-1">{op.lastError}</div>}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleRecreate(op.id)}
                              className="inline-flex items-center gap-2"
                              disabled={!row.item}
                              title={!row.item ? 'Item is missing locally' : 'Recreate item on server'}
                            >
                              <RotateCcw className="h-4 w-4" />
                              Recreate
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDiscardSingle(op.id)}
                              className="inline-flex items-center gap-2"
                            >
                              <Trash2 className="h-4 w-4" />
                              Discard
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Tip: “Recreate” turns the stuck update into a create, using your offline data. After the create succeeds,
            any related paused updates will resume automatically.
          </p>
        </div>
      </div>

      <BlockingConfirmDialog
        open={confirmDiscardOpen}
        title="Discard selected changes?"
        description={
          selectedOperationIds.size === 1
            ? 'This will remove the stuck operation and delete the local item so it matches the server.'
            : `This will remove ${selectedOperationIds.size} stuck operation(s) and delete the related local item(s) so they match the server.`
        }
        confirmLabel={selectedOperationIds.size === 1 ? 'Discard' : `Discard (${selectedOperationIds.size})`}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirming={isDiscarding}
        onCancel={() => {
          if (isDiscarding) return
          setConfirmDiscardOpen(false)
        }}
        onConfirm={handleDiscardSelected}
      />
    </>
  )
}

