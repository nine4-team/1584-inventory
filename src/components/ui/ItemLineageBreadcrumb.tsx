import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ContextLink from '@/components/ContextLink'
import { useAccount } from '@/contexts/AccountContext'
import { lineageService } from '@/services/lineageService'
import { transactionService } from '@/services/inventoryService'
import type { ItemLineageEdge } from '@/types'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { projectTransactionDetail } from '@/utils/routes'

interface ItemLineageBreadcrumbProps {
  itemId: string
  compact?: boolean
}

export default function ItemLineageBreadcrumb({ itemId, compact = true }: ItemLineageBreadcrumbProps) {
  const { currentAccountId } = useAccount()
  const { buildContextUrl } = useNavigationContext()
  const [edges, setEdges] = useState<ItemLineageEdge[]>([])
  const [resolvedProjectByTx, setResolvedProjectByTx] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!currentAccountId || !itemId) return

    let unsubscribed = false

    const load = async () => {
      try {
        const history = await lineageService.getItemLineageHistory(itemId, currentAccountId)
        if (unsubscribed) return
        setEdges(history)

        // Resolve any transaction -> project mappings we don't have yet
        const txIds = Array.from(new Set(history.flatMap(e => [e.fromTransactionId, e.toTransactionId]).filter(Boolean as any))) as string[]
        const toResolve = txIds.filter(tx => !resolvedProjectByTx[tx])
        if (toResolve.length > 0) {
          const results = await Promise.all(toResolve.map(async (txId) => {
            try {
              const res = await transactionService.getTransactionById(currentAccountId, txId)
              return { txId, projectId: res.projectId || null }
            } catch (err) {
              return { txId, projectId: null }
            }
          }))
          const newMap = { ...resolvedProjectByTx }
          results.forEach(r => { newMap[r.txId] = r.projectId })
          if (!unsubscribed) setResolvedProjectByTx(newMap)
        }
      } catch (err) {
        console.debug('ItemLineageBreadcrumb - failed to load history', err)
      }
    }

    load()

    // Use strict realtime subscription (no polling) for item-level edges.
    let unsubscribeFn: (() => void) | null = null
    try {
      unsubscribeFn = lineageService.subscribeToItemLineageForItem(currentAccountId, itemId, (edge) => {
        // Append new edge if not already present (guard by id)
        setEdges(prev => {
          if (prev.find(e => e.id === edge.id)) return prev
          return [...prev, edge].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        })
        // Try to resolve any transaction -> project mapping for the new edge nodes
        const txs = [edge.fromTransactionId, edge.toTransactionId].filter(Boolean) as string[]
        txs.forEach(async (txId) => {
          if (!resolvedProjectByTx[txId]) {
            try {
              const res = await transactionService.getTransactionById(currentAccountId, txId)
              setResolvedProjectByTx(prev => ({ ...prev, [txId]: res.projectId || null }))
            } catch (err) {
              setResolvedProjectByTx(prev => ({ ...prev, [txId]: null }))
            }
          }
        })
      })
    } catch (err) {
      console.debug('ItemLineageBreadcrumb - failed to subscribe to lineage events', err)
    }

    return () => {
      unsubscribed = true
      if (unsubscribeFn) unsubscribeFn()
    }
  }, [currentAccountId, itemId])

  if (!edges || edges.length === 0) {
    return null
  }

  // Build a simple path: start = first.fromTransactionId (may be null == Inventory), then append each toTransactionId
  const path: (string | null)[] = []
  if (edges.length > 0) {
    const first = edges[0]
    path.push(first.fromTransactionId ?? null)
    edges.forEach(e => path.push(e.toTransactionId ?? null))
  }

  // Remove consecutive duplicates
  const compactPath = path.filter((p, idx) => idx === 0 || p !== path[idx - 1])

  return (
    <nav aria-label="Item lineage" className={compact ? 'text-xs text-gray-600' : 'text-sm text-gray-700'}>
      <ol className="flex items-center gap-2">
        {compactPath.map((node, idx) => {
          const isInventory = !node
          const displayLabel = isInventory ? 'Inventory' : (node!.length > 12 ? `${node!.slice(0, 12)}…` : node)
          const projectId = node ? resolvedProjectByTx[node] : null
          const to = isInventory
            ? buildContextUrl('/business-inventory')
            : projectId
              ? buildContextUrl(projectTransactionDetail(projectId, node!), { project: projectId })
              : buildContextUrl('/projects')

          return (
            <li key={`${node ?? 'inventory'}-${idx}`} className="flex items-center">
              {idx > 0 && <span className="text-gray-300 mx-1">→</span>}
              {isInventory ? (
                <span className="text-gray-500">{displayLabel}</span>
              ) : (
                <ContextLink to={to} className="text-primary-600 hover:underline">
                  {displayLabel}
                </ContextLink>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}


