import { useMemo, useState } from 'react'
import SyncIssuesManager from './SyncIssuesManager'
import { offlineStore } from '@/services/offlineStore'
import { Button } from '@/components/ui/Button'

const CACHE_NOTE = 'Offline export is a dump of local cache; it may be incomplete or not match server state.'
const MAX_MISSING_REFS = 100
const MISSING_ACCOUNT_KEY = '__missing__'

type CountsByAccountId = Record<
  string,
  {
    items: number
    transactions: number
    projects: number
    operations: number
    conflicts: number
  }
>

function getAccountKey(accountId?: string | null) {
  return accountId ?? MISSING_ACCOUNT_KEY
}

function buildCountsByAccountId({
  items,
  transactions,
  projects,
  operations,
  conflicts
}: {
  items: Array<{ accountId?: string | null }>
  transactions: Array<{ accountId?: string | null }>
  projects: Array<{ accountId?: string | null }>
  operations: Array<{ accountId?: string | null }>
  conflicts: Array<{ accountId?: string | null }>
}): CountsByAccountId {
  const counts: CountsByAccountId = {}
  const ensure = (accountId?: string | null) => {
    const key = getAccountKey(accountId)
    if (!counts[key]) {
      counts[key] = { items: 0, transactions: 0, projects: 0, operations: 0, conflicts: 0 }
    }
    return counts[key]
  }

  items.forEach(item => {
    ensure(item.accountId).items += 1
  })
  transactions.forEach(tx => {
    ensure(tx.accountId).transactions += 1
  })
  projects.forEach(project => {
    ensure(project.accountId).projects += 1
  })
  operations.forEach(operation => {
    ensure(operation.accountId).operations += 1
  })
  conflicts.forEach(conflict => {
    ensure(conflict.accountId).conflicts += 1
  })

  return counts
}

function buildConsistencyReport({
  items,
  transactions,
  countsByAccountId
}: {
  items: Array<{ itemId: string; transactionId?: string | null }>
  transactions: Array<{ transactionId: string; itemIds?: string[] | null }>
  countsByAccountId: CountsByAccountId
}) {
  const itemIds = new Set(items.map(item => item.itemId))
  const transactionIds = new Set(transactions.map(tx => tx.transactionId))

  const missingItemIds = new Set<string>()
  const missingItemRefs: Array<{ transactionId: string; missingItemId: string }> = []

  transactions.forEach(tx => {
    const ids = tx.itemIds ?? []
    ids.forEach(itemId => {
      if (!itemIds.has(itemId)) {
        missingItemIds.add(itemId)
        if (missingItemRefs.length < MAX_MISSING_REFS) {
          missingItemRefs.push({ transactionId: tx.transactionId, missingItemId: itemId })
        }
      }
    })
  })

  const missingTransactionIds = new Set<string>()
  const missingTransactionRefs: Array<{ itemId: string; missingTransactionId: string }> = []

  items.forEach(item => {
    const txId = item.transactionId ?? null
    if (txId && !transactionIds.has(txId)) {
      missingTransactionIds.add(txId)
      if (missingTransactionRefs.length < MAX_MISSING_REFS) {
        missingTransactionRefs.push({ itemId: item.itemId, missingTransactionId: txId })
      }
    }
  })

  return {
    missingItemIds: Array.from(missingItemIds),
    missingItemRefs,
    missingTransactionIds: Array.from(missingTransactionIds),
    missingTransactionRefs,
    countsByAccountId
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type Props = {
  currentAccountId: string | null
  currentUserId: string | null
}

export default function TroubleshootingTab({ currentAccountId, currentUserId }: Props) {
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null)

  const scopeLabel = useMemo(() => {
    if (currentAccountId) return `account ${currentAccountId}`
    return 'all accounts (no active account detected)'
  }, [currentAccountId])

  const exportOfflineData = async () => {
    setIsExporting(true)
    setExportError(null)
    try {
      const scopedAccountId = currentAccountId ?? null
      const snapshot = await offlineStore.exportSnapshot({ accountId: scopedAccountId ?? undefined })
      const { items, operations, conflicts, transactions, projects, context, readFromStores } = snapshot
      const countsByAccountId = buildCountsByAccountId({ items, transactions, projects, operations, conflicts })
      const consistencyReport = buildConsistencyReport({ items, transactions, countsByAccountId })

      const exportedAt = new Date().toISOString()
      const payload = {
        exportedAt,
        snapshot: {
          scopedAccountId,
          readFromStores,
          exportedAt
        },
        note: CACHE_NOTE,
        context: {
          currentUserId,
          currentAccountId,
          offlineContext: context
        },
        counts: {
          items: items.length,
          operations: operations.length,
          conflicts: conflicts.length,
          transactions: transactions.length,
          projects: projects.length
        },
        items,
        operations,
        conflicts,
        transactions,
        projects,
        consistencyReport
      }

      const base = scopedAccountId ? `ledger-offline-export-${scopedAccountId}` : 'ledger-offline-export'
      downloadJson(`${base}-${exportedAt}.json`, payload)
      setLastExportedAt(exportedAt)
    } catch (e: any) {
      setExportError(e?.message || 'Failed to export offline data')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white overflow-hidden shadow rounded-lg">
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">Offline data export</h3>
          <p className="mt-1 text-sm text-gray-600">
            Downloads your local offline cache and queued operations as a JSON file for debugging and reconciliation.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Scope: {scopeLabel}. This file may contain item names/descriptions and other sensitive data—share it only with
            someone you trust.
          </p>

          {exportError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{exportError}</p>
            </div>
          )}

          {lastExportedAt && !exportError && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">Exported at {new Date(lastExportedAt).toLocaleString()}.</p>
            </div>
          )}

          <div className="mt-4">
            <Button onClick={exportOfflineData} disabled={isExporting}>
              {isExporting ? 'Exporting…' : 'Export offline data (JSON)'}
            </Button>
          </div>
        </div>
      </div>

      <SyncIssuesManager />
    </div>
  )
}

