import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'

import ContextBackLink from '@/components/ContextBackLink'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import TransactionAudit from '@/components/ui/TransactionAudit'
import { useAccount } from '@/contexts/AccountContext'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { lineageService } from '@/services/lineageService'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'
import type { Item, Transaction } from '@/types'
import { formatCurrency, formatDate } from '@/utils/dateUtils'
import { getItemizationEnabled } from '@/utils/categoryItemization'
import { projectTransactionDetail } from '@/utils/routes'
import { useNavigationContext } from '@/hooks/useNavigationContext'

export default function BusinessInventoryTransactionDetail() {
  const { transactionId } = useParams<{ transactionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const { buildContextUrl, getBackDestination } = useNavigationContext()

  const [isLoading, setIsLoading] = useState(true)
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [itemizationEnabled, setItemizationEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const backDestination = useMemo(() => {
    return getBackDestination('/business-inventory')
  }, [getBackDestination])

  const editTransactionHref = useMemo(() => {
    if (!transactionId) return '/business-inventory'
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return `/business-inventory/transaction/null/${transactionId}/edit?returnTo=${returnTo}`
  }, [transactionId, location.pathname, location.search])

  const load = useCallback(async () => {
    if (!currentAccountId || !transactionId) return

    setIsLoading(true)
    setError(null)
    try {
      const { transaction: tx } = await transactionService.getTransactionById(currentAccountId, transactionId)

      if (!tx) {
        setTransaction(null)
        setItems([])
        setError('Transaction not found.')
        return
      }

      // If this transaction was moved into a project, redirect to the canonical project route.
      if (tx.projectId) {
        navigate(buildContextUrl(projectTransactionDetail(tx.projectId, tx.transactionId)), { replace: true })
        return
      }

      setTransaction(tx)

      // Load category metadata to determine whether itemization (audit UI) is enabled.
      try {
        if (tx.categoryId) {
          const category = await budgetCategoriesService.getCategory(currentAccountId, tx.categoryId)
          setItemizationEnabled(getItemizationEnabled(category))
        } else {
          setItemizationEnabled(true)
        }
      } catch (categoryErr) {
        // Non-fatal: default to enabled for backward compatibility
        console.debug('BusinessInventoryTransactionDetail - failed to load category metadata:', categoryErr)
        setItemizationEnabled(true)
      }

      // Canonical item set for audit UI:
      // - items where items.transaction_id === transactionId
      // - plus moved-out items via lineage edges (excluding correction edges)
      const inTransactionItems = await unifiedItemsService.getItemsForTransaction(currentAccountId, '', transactionId)
      let combinedItems = inTransactionItems.slice()

      try {
        const edgesFromTransaction = await lineageService.getEdgesFromTransaction(transactionId, currentAccountId)
        const movedOutItemIds = Array.from(
          new Set(
            edgesFromTransaction
              .filter(edge => edge.movementKind !== 'correction')
              .map(edge => edge.itemId)
          )
        )

        const missingMovedItemIds = movedOutItemIds.filter(id => !combinedItems.some(it => it.itemId === id))
        if (missingMovedItemIds.length > 0) {
          const movedItems = await Promise.all(
            missingMovedItemIds.map(id => unifiedItemsService.getItemById(currentAccountId, id))
          )
          const validMovedItems = movedItems.filter(Boolean) as Item[]
          combinedItems = combinedItems.concat(validMovedItems)
        }
      } catch (edgeErr) {
        // Non-fatal: still show audit based on in-transaction items.
        console.debug('BusinessInventoryTransactionDetail - failed to load moved-out items:', edgeErr)
      }

      setItems(combinedItems)
    } catch (e) {
      console.error('BusinessInventoryTransactionDetail - failed to load transaction:', e)
      setError('Failed to load transaction. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [buildContextUrl, currentAccountId, navigate, transactionId])

  useEffect(() => {
    void load()
  }, [load])

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex items-center gap-3 mb-4">
          <ContextBackLink fallback={backDestination} className="text-primary-600 hover:text-primary-800">
            <span className="inline-flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </span>
          </ContextBackLink>
        </div>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-sm text-red-700">{error}</div>
          <div className="mt-4">
            <button
              onClick={() => void load()}
              className="px-4 py-2 rounded bg-primary-600 text-white hover:bg-primary-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!transaction) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <ContextBackLink fallback={backDestination} className="text-primary-600 hover:text-primary-800">
          <span className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </span>
        </ContextBackLink>
        <div className="mt-4 bg-white shadow rounded-lg p-6">
          <div className="text-sm text-gray-700">Transaction not found.</div>
        </div>
      </div>
    )
  }

  const getBizItemEditHref = (item: Item) => buildContextUrl(`/business-inventory/${item.itemId}/edit`)

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <ContextBackLink fallback={backDestination} className="text-primary-600 hover:text-primary-800">
          <span className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </span>
        </ContextBackLink>

        <Link
          to={buildContextUrl(editTransactionHref)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded bg-primary-600 text-white hover:bg-primary-700"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-medium text-gray-900">{transaction.source || 'Transaction'}</div>
            <div className="text-sm text-gray-600 mt-1">
              {transaction.transactionDate ? formatDate(transaction.transactionDate) : 'No date'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-gray-900">{formatCurrency(transaction.amount || '0')}</div>
            {transaction.needsReview === true && (
              <div className="mt-1 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                Needs review
              </div>
            )}
          </div>
        </div>
        {transaction.notes && (
          <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">{transaction.notes}</div>
        )}
      </div>

      {itemizationEnabled ? (
        <TransactionAudit
          transaction={transaction}
          projectId={null}
          transactionItems={items}
          getItemEditHref={getBizItemEditHref}
        />
      ) : (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-sm text-gray-700">
            Item tracking is disabled for this category, so the audit panel is hidden.
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Linked items</h3>
          </div>
          <div className="px-6 py-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map(item => (
                  <tr key={item.itemId}>
                    <td className="px-3 py-2 text-sm text-gray-900">{item.description}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{item.sku || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">
                      {item.purchasePrice ? formatCurrency(item.purchasePrice) : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <Link to={getBizItemEditHref(item)} className="text-primary-600 hover:text-primary-800">
                        Edit item
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

