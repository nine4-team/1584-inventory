import { useMemo, useState } from 'react'
import SyncIssuesManager from './SyncIssuesManager'
import { offlineStore } from '@/services/offlineStore'
import { Button } from '@/components/ui/Button'
import type { DBContextRecord } from '@/services/offlineStore'

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
      await offlineStore.init()

      const offlineContext: DBContextRecord | null = await offlineStore.getContext().catch(() => null)
      const scopedAccountId = currentAccountId ?? offlineContext?.accountId ?? null

      const [items, operations, conflicts, transactions, projects] = await Promise.all([
        offlineStore.getAllItems().catch(() => []),
        offlineStore.getOperations(scopedAccountId ?? undefined).catch(() => []),
        offlineStore.getConflicts(scopedAccountId ?? undefined).catch(() => []),
        offlineStore.getAllTransactions().catch(() => []),
        offlineStore.getProjects().catch(() => [])
      ])

      const exportedAt = new Date().toISOString()
      const payload = {
        exportedAt,
        context: {
          currentUserId,
          currentAccountId,
          offlineContext
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
        projects
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

