import { useState, useEffect, useMemo } from 'react'
import { Transaction, Item, TransactionCompleteness } from '@/types'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'
import { formatCurrency } from '@/utils/dateUtils'
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle, Plus } from 'lucide-react'
import { useToast } from './ToastContext'
import { useAccount } from '@/contexts/AccountContext'
import { projectItemEdit } from '@/utils/routes'

interface TransactionAuditProps {
  transaction: Transaction
  projectId: string
  transactionItems: Item[]
  onItemsUpdated: () => void
}

export default function TransactionAudit({
  transaction,
  projectId,
  transactionItems,
  onItemsUpdated
}: TransactionAuditProps) {
  const { currentAccountId } = useAccount()
  const { showError, showSuccess } = useToast()
  const [completeness, setCompleteness] = useState<TransactionCompleteness | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showSuggested, setShowSuggested] = useState(true)
  const [suggestedItems, setSuggestedItems] = useState<Item[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [suggestedSearch, setSuggestedSearch] = useState('')
  const transactionItemIds = useMemo(() => {
    const ids = new Set<string>()

    const canonicalIds = Array.isArray(transaction.itemIds) ? transaction.itemIds : []
    for (const id of canonicalIds) {
      if (typeof id === 'string' && id.length > 0) {
        ids.add(id)
      }
    }

    for (const item of transactionItems) {
      const id = item.itemId
      if (typeof id === 'string' && id.length > 0) {
        ids.add(id)
      }
    }

    return ids
  }, [transaction.itemIds, transactionItems])

  // Filter out transaction types that don't require item attribution
  const shouldShowAudit = transaction.transactionType !== 'Return' && 
                          transaction.transactionType !== 'Internal Transfer'
  
  if (!shouldShowAudit) {
    return null
  }

  // Load completeness metrics
  useEffect(() => {
    const loadCompleteness = async () => {
      if (!currentAccountId || !transaction.transactionId || !projectId) return

      setIsLoading(true)
      try {
        const metrics = await transactionService.getTransactionCompleteness(
          currentAccountId,
          projectId,
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
          missingTaxData: !transaction.taxRatePct && !transaction.subtotal,
          varianceDollars: 0,
          variancePercent: 0
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadCompleteness()
  }, [currentAccountId, projectId, transaction.transactionId, transactionItems, transaction.amount, transaction.taxRatePct, transaction.subtotal])

  // Load suggested items when status is yellow or red
  useEffect(() => {
    const loadSuggestions = async () => {
      if (!currentAccountId || !completeness) return
      if (completeness.completenessStatus === 'complete') {
        setSuggestedItems([])
        return
      }

      setIsLoadingSuggestions(true)
      try {
        const items = await transactionService.getSuggestedItemsForTransaction(
          currentAccountId,
          transaction.source,
          5
        )
        const dedupedItems = (items || []).filter(it => !it.itemId || !transactionItemIds.has(it.itemId))
        // Filter out items whose purchasePrice exceeds remaining amount (subtotal - items total)
        let filteredItems = dedupedItems
        if (completeness) {
          const remaining = completeness.transactionSubtotal - completeness.itemsNetTotal
          filteredItems = dedupedItems.filter(it => {
            const price = parseFloat((it.purchasePrice as any) || '0')
            // If price is NaN treat as 0 (include). Exclude only when price > remaining.
            if (isNaN(price)) return true
            return price <= remaining
          })
        }
        setSuggestedItems(filteredItems)
      } catch (error) {
        console.error('Error loading suggested items:', error)
      } finally {
        setIsLoadingSuggestions(false)
      }
    }

    loadSuggestions()
  }, [currentAccountId, transaction.source, completeness?.completenessStatus, transactionItemIds])

  useEffect(() => {
    setSuggestedItems(prev => prev.filter(item => !item.itemId || !transactionItemIds.has(item.itemId)))
  }, [transactionItemIds])

  const handleAddItemToTransaction = async (item: Item) => {
    if (!currentAccountId || !transaction.transactionId) return

    try {
      await unifiedItemsService.addItemToTransaction(
        currentAccountId,
        item.itemId,
        transaction.transactionId,
        item.purchasePrice || '0',
        transaction.transactionType as 'Purchase' | 'Sale' | 'To Inventory',
        'Manual',
        'Added via transaction audit'
      )
      showSuccess('Item added to transaction')
      // Optimistically remove the item from the suggested list so UI updates immediately
      setSuggestedItems(prev => prev.filter(si => si.itemId !== item.itemId))
      onItemsUpdated()

      // Refresh suggestions from server to ensure consistency (server filters on transaction_id = null)
      try {
        setIsLoadingSuggestions(true)
        const freshItems = await transactionService.getSuggestedItemsForTransaction(
          currentAccountId,
          transaction.source,
          5
        )
        const dedupedFreshItems = (freshItems || []).filter(it => !it.itemId || !transactionItemIds.has(it.itemId))
        // Apply the same remaining-price filter used by loadSuggestions
        let filteredItems = dedupedFreshItems
        if (completeness) {
          const remaining = completeness.transactionSubtotal - completeness.itemsNetTotal
          filteredItems = dedupedFreshItems.filter(it => {
            const price = parseFloat((it.purchasePrice as any) || '0')
            if (isNaN(price)) return true
            return price <= remaining
          })
        }
        setSuggestedItems(filteredItems)
      } catch (refreshError) {
        console.error('Error refreshing suggested items after add:', refreshError)
      } finally {
        setIsLoadingSuggestions(false)
      }
    } catch (error) {
      console.error('Error adding item to transaction:', error)
      showError('Failed to add item to transaction')
    }
  }

  const filteredSuggestedItems = useMemo(() => {
    const query = suggestedSearch.trim().toLowerCase()
    if (!query) return suggestedItems
    return suggestedItems.filter(item => {
      const description = item.description?.toLowerCase() ?? ''
      const sku = item.sku?.toLowerCase() ?? ''
      const price = item.purchasePrice?.toString().toLowerCase() ?? ''
      return description.includes(query) || sku.includes(query) || price.includes(query)
    })
  }, [suggestedItems, suggestedSearch])

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

  const getStatusColor = (status: TransactionCompleteness['completenessStatus']) => {
    switch (status) {
      case 'complete':
        return 'bg-green-500'
      case 'near':
        return 'bg-yellow-500'
      case 'incomplete':
      case 'over':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getStatusIcon = (status: TransactionCompleteness['completenessStatus']) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'near':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />
      case 'incomplete':
      case 'over':
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return null
    }
  }

  const getStatusLabel = (status: TransactionCompleteness['completenessStatus']) => {
    switch (status) {
      case 'complete':
        return 'Complete'
      case 'near':
        return 'Needs Review'
      case 'incomplete':
        return 'Incomplete'
      case 'over':
        return 'Over Budget'
      default:
        return 'Unknown'
    }
  }

  const itemsMissingPrice = transactionItems.filter(item => {
    const purchasePrice = item.purchasePrice
    return !purchasePrice || purchasePrice.trim() === '' || parseFloat(purchasePrice) === 0
  })

  const progressPercentage = Math.min(completeness.completenessRatio * 100, 100)
  // Labels: show explicit subtotal vs estimated subtotal and clarify item totals are pre-tax
  const subtotalLabel = transaction.subtotal ? 'Subtotal (pre-tax)' : 'Estimated subtotal (pre-tax)'
  const itemsLabel = 'Associated items total (pre-tax)'
  const taxLabel = 'Calculated tax'
  // Dollar remaining (positive means remaining to reach subtotal; negative means over by)
  const remainingDollars = Math.round((completeness.transactionSubtotal - completeness.itemsNetTotal) * 100) / 100
  const remainingLabel = remainingDollars >= 0
    ? `${formatCurrency(remainingDollars.toString())} remaining`
    : `Over by ${formatCurrency(Math.abs(remainingDollars).toString())}`

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Transaction Audit</h3>
        </div>
      </div>

      <div className="px-6 py-4">
        {/* Progress Tracker */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {getStatusIcon(completeness.completenessStatus)}
              <span className="text-base font-medium text-gray-900">
                {getStatusLabel(completeness.completenessStatus)}
              </span>
            </div>
            <span className="text-sm text-gray-500">
              {formatCurrency(completeness.itemsNetTotal.toString())} / {formatCurrency(completeness.transactionSubtotal.toString())}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="relative">
            <div className="w-full bg-gray-200 rounded-full h-3 mb-1">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${getStatusColor(completeness.completenessStatus)}`}
                style={{ width: `${Math.min(progressPercentage, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
              <span>{completeness.itemsCount} items</span>
              <span>{remainingLabel}</span>
            </div>
          </div>

          {/* Tooltip-like info */}
          <div className="mt-3 text-xs text-gray-600 space-y-1">
            {completeness.itemsCount === 0 ? (
              <div className="text-red-600 font-medium">No items linked yet</div>
            ) : (
              <>
            <div>{subtotalLabel}: {formatCurrency(completeness.transactionSubtotal.toString())}</div>
            <div>{itemsLabel}: {formatCurrency(completeness.itemsNetTotal.toString())}</div>
            {completeness.inferredTax !== undefined && (
              <div>{taxLabel}: {formatCurrency(completeness.inferredTax.toString())}</div>
            )}
                {completeness.itemsMissingPriceCount > 0 && (
                  <div className="text-yellow-600">
                    {completeness.itemsMissingPriceCount} items missing purchase price
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Missing Tax Data Warning */}
        {completeness.missingTaxData && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <strong>Tax rate not set.</strong> Set tax rate or transaction subtotal for accurate calculations.
              </div>
            </div>
          </div>
        )}

        {/* Missing Purchase Price */}
        {itemsMissingPrice.length > 0 && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">Missing Purchase Price</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {itemsMissingPrice.map((item) => (
                      <tr key={item.itemId}>
                        <td className="px-3 py-2 text-sm text-gray-900">{item.description}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{item.sku || '-'}</td>
                        <td className="px-3 py-2 text-sm">
                          <a
                            href={projectItemEdit(projectId, item.itemId)}
                            className="text-primary-600 hover:text-primary-800"
                          >
                            Edit Price
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Suggested Items toggle and list (moved out of details) */}
        {(completeness.completenessStatus === 'near' || completeness.completenessStatus === 'incomplete') && (
          <div className="mt-4 border-t border-gray-200 pt-4">
            <button
              onClick={() => setShowSuggested(!showSuggested)}
              className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-800"
            >
              {showSuggested ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide suggested items
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show suggested items to add
                </>
              )}
            </button>

            {showSuggested && (
              isLoadingSuggestions ? (
                <div className="text-sm text-gray-500 mt-3">Loading suggestions...</div>
              ) : suggestedItems.length > 0 ? (
                <div className="space-y-2 mt-3">
                  <div>
                    <input
                      type="search"
                      value={suggestedSearch}
                      onChange={event => setSuggestedSearch(event.target.value)}
                      placeholder="Search suggested items"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Search matches name, SKU, or price. Items without a source or price still appear.
                    </p>
                  </div>
                  {filteredSuggestedItems.length > 0 ? (
                    filteredSuggestedItems.map((item) => (
                    <div
                      key={item.itemId}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{item.description}</div>
                        <div className="text-xs text-gray-500">
                          {item.sku && `SKU: ${item.sku}`}
                          {item.purchasePrice && ` • ${formatCurrency(item.purchasePrice)}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddItemToTransaction(item)}
                        className="ml-4 inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </button>
                    </div>
                  ))
                  ) : (
                    <div className="text-sm text-gray-500">No suggested items match your search.</div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-500 mt-3">No unassociated items found for this vendor.</div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

