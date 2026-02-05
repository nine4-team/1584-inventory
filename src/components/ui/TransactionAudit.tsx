import { useState, useEffect } from 'react'
import { Transaction, Item, TransactionCompleteness } from '@/types'
import { transactionService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { projectItemEdit } from '@/utils/routes'
import { TransactionCompletenessPanel } from '@/components/ui/TransactionCompletenessPanel'
import { MissingPriceList } from '@/components/ui/MissingPriceList'

interface TransactionAuditProps {
  transaction: Transaction
  /**
   * Optional project scope for completeness computation.
   *
   * Business Inventory transactions have `projectId = null`; in that case we pass an empty
   * project scope down to the service layer (which is account + transaction scoped).
   */
  projectId?: string | null
  transactionItems: Item[]
  /**
   * Override the "edit item" link. Useful for non-project routes.
   */
  getItemEditHref?: (item: Item) => string
}

export default function TransactionAudit({
  transaction,
  projectId,
  transactionItems,
  getItemEditHref
}: TransactionAuditProps) {
  const { currentAccountId } = useAccount()
  const [completeness, setCompleteness] = useState<TransactionCompleteness | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load completeness metrics
  useEffect(() => {
    const loadCompleteness = async () => {
      if (!currentAccountId || !transaction.transactionId) return

      setIsLoading(true)
      try {
        const projectScope = projectId ?? ''
        const metrics = await transactionService.getTransactionCompleteness(
          currentAccountId,
          projectScope,
          transaction.transactionId
        )
        setCompleteness(metrics)
      } catch (error) {
        console.error('Error loading completeness metrics:', error)
        // Set default completeness for error cases
        setCompleteness({
          itemsNetTotal: 0,
          itemsCount: transactionItems.length,
          itemsMissingPriceCount: transactionItems.filter(item => !item.purchasePrice || item.purchasePrice.trim() === '').length,
          transactionSubtotal: parseFloat(transaction.amount || '0'),
          completenessRatio: 0,
          completenessStatus: transactionItems.length === 0 ? 'incomplete' : 'complete',
          missingTaxData:
            (transaction.taxRatePct === null || transaction.taxRatePct === undefined) &&
            !transaction.subtotal,
          varianceDollars: 0,
          variancePercent: 0
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadCompleteness()
  }, [
    currentAccountId,
    projectId,
    transaction.transactionId,
    transactionItems,
    transaction.amount,
    transaction.taxRatePct,
    transaction.subtotal
  ])

  if (isLoading || !completeness) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-2 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    )
  }

  const itemsMissingPrice = transactionItems.filter(item => {
    const purchasePrice = item.purchasePrice
    return !purchasePrice || purchasePrice.trim() === '' || parseFloat(purchasePrice) === 0
  })

  // Labels: show explicit subtotal vs estimated subtotal and clarify item totals are pre-tax
  const subtotalLabel = transaction.subtotal ? 'Subtotal (pre-tax)' : 'Estimated subtotal (pre-tax)'
  const resolvedGetItemEditHref =
    getItemEditHref ??
    (projectId ? ((item: Item) => projectItemEdit(projectId, item.itemId)) : undefined)

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Transaction Audit</h3>
        </div>
      </div>

      <div className="px-6 py-4">
        <TransactionCompletenessPanel completeness={completeness} subtotalLabel={subtotalLabel} />
        <MissingPriceList items={itemsMissingPrice} getItemEditHref={resolvedGetItemEditHref} />

      </div>
    </div>
  )
}

