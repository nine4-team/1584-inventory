import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import ContextLink from '@/components/ContextLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { Button } from '@/components/ui/Button'
import type { Item, Transaction } from '@/types'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useBusinessProfile } from '@/contexts/BusinessProfileContext'
import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { useCategories } from '@/components/CategorySelect'
import { projectItems, projectInvoice, projectsRoot } from '@/utils/routes'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  if (typeof value === 'string') {
    const n = parseFloat(value || '0')
    return isNaN(n) ? 0 : n
  }
  return 0
}

export default function ClientSummary() {
  const { id, projectId } = useParams<{ id?: string; projectId?: string }>()
  const resolvedProjectId = projectId || id
  const stackedNavigate = useStackedNavigate()
  const { businessName, businessLogoUrl } = useBusinessProfile()
  const { categories: accountCategories } = useCategories(false)
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  const { project, items, transactions, isLoading, error } = useProjectRealtime(resolvedProjectId)

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), [])

  useEffect(() => {
    if (!resolvedProjectId) {
      stackedNavigate(projectsRoot())
    }
  }, [resolvedProjectId, stackedNavigate])

  // Create a map of categoryId -> category name for quick lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>()
    accountCategories.forEach(cat => {
      map.set(cat.id, cat.name)
    })
    return map
  }, [accountCategories])

  // Calculate summary values
  const summary = useMemo(() => {
    // Total spent overall (sum of projectPrice for all items)
    const totalSpent = items.reduce((sum, item) => {
      const projectPrice = toNumber(item.projectPrice)
      return sum + projectPrice
    }, 0)

    // Breakdown by budget categories (sum of item project prices by categoryId from their transactions)
    const categoryBreakdown: Record<string, number> = {}
    // Create a map of transactionId -> categoryName for quick lookup
    const transactionCategoryMap = new Map<string, string>()
    transactions.forEach(transaction => {
      if (transaction.categoryId && transaction.transactionId) {
        const categoryName = categoryMap.get(transaction.categoryId)
        if (categoryName) {
          transactionCategoryMap.set(transaction.transactionId, categoryName)
        }
      }
    })
    // Sum item project prices by their transaction's budget category
    items.forEach(item => {
      if (item.transactionId) {
        const categoryName = transactionCategoryMap.get(item.transactionId)
        if (categoryName) {
          const projectPrice = toNumber(item.projectPrice)
          categoryBreakdown[categoryName] = (categoryBreakdown[categoryName] || 0) + projectPrice
        }
      }
    })

    // Value of furnishings in home (sum of marketValue for all items)
    const totalMarketValue = items.reduce((sum, item) => {
      const marketValue = toNumber(item.marketValue)
      return sum + marketValue
    }, 0)

    // What they saved (sum of differences between marketValue and projectPrice for each item)
    // If marketValue is not set, difference is zero
    const totalSaved = items.reduce((sum, item) => {
      const marketValue = toNumber(item.marketValue)
      const projectPrice = toNumber(item.projectPrice)
      // Only count savings if marketValue is set (greater than 0)
      if (marketValue > 0) {
        return sum + (marketValue - projectPrice)
      }
      return sum
    }, 0)

    return {
      totalSpent,
      categoryBreakdown,
      totalMarketValue,
      totalSaved
    }
  }, [items, transactions, categoryMap])

  const handlePrint = () => window.print()
  const handleBack = () => {
    const fallback = resolvedProjectId ? projectItems(resolvedProjectId) : projectsRoot()
    stackedNavigate(getBackDestination(fallback))
  }

  // Helper to get receipt link for an item.
  // Behavior:
  // - If the item has a transactionId, prefer linking to that transaction page.
  // - If that transaction is canonical/invoiceable (INV_* canonical id or invoiceable reimbursementType),
  //   use the project invoice as the receipt link instead of the transaction page.
  // - No fallback searching other transactions for this item — return null when no transactionId.
  const getReceiptLink = (item: Item): { href: string; isInternal: boolean } | null => {
    if (!resolvedProjectId) return null

    if (item.transactionId) {
      const tx = transactions.find((t) => t.transactionId === item.transactionId)

      if (!tx) {
        return null
      }

      const isCanonicalById = tx.transactionId?.startsWith('INV_SALE_') || tx.transactionId?.startsWith('INV_PURCHASE_')

      const isInvoiceableByType =
        tx.reimbursementType === CLIENT_OWES_COMPANY || tx.reimbursementType === COMPANY_OWES_CLIENT

      if (isCanonicalById || isInvoiceableByType) {
        return { href: projectInvoice(resolvedProjectId), isInternal: true }
      }

      const receiptImageUrl = tx.receiptImages?.[0]?.url

      if (receiptImageUrl) {
        return { href: receiptImageUrl, isInternal: false }
      }

      return null
    }

    // No transactionId -> no receipt link (no fallback)
    return null
  }

  if (!resolvedProjectId) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading client summary...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto h-12 w-12 text-red-400">⚠️</div>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Error</h3>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
        <div className="mt-6">
          <Button onClick={handleBack}>Back</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-8 print:shadow-none print:p-0">
      {/* Action bar */}
      <div className="flex justify-end space-x-3 mb-6 print:hidden">
        <Button variant="secondary" onClick={handleBack}>Back</Button>
        <Button onClick={handlePrint}>Print</Button>
      </div>

      {/* Header */}
      <div className="border-b pb-4 mb-6">
        <div className="flex items-start gap-4">
          {businessLogoUrl && (
            <img
              src={businessLogoUrl}
              alt={businessName}
              className="h-24 w-auto object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Client Summary</h1>
            <div className="mt-1 text-sm text-gray-600">
              <div className="font-medium text-gray-800">{project?.name || 'Project'}</div>
              {project?.clientName && <div>Client: {project.clientName}</div>}
              <div>Date: {today}</div>
            </div>
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400">📦</div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No items found</h3>
          <p className="mt-1 text-sm text-gray-500">There are no items associated with this project.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-6">
          {/* Summary Fields */}
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Total Spend Card */}
              <div className="rounded-lg border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900">Project Overview</h2>
                </div>
                <div className="px-4 py-4 space-y-4">
                  {/* Total Spent Overall */}
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-gray-700">Total Spent Overall</span>
                    <span className="text-base font-semibold text-gray-900">{usd.format(summary.totalSpent)}</span>
                  </div>

                  {/* Breakdown by Budget Categories */}
                  {Object.keys(summary.categoryBreakdown).length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <div className="space-y-2">
                        {Object.entries(summary.categoryBreakdown)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([category, amount]) => (
                            <div key={category} className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">{category}</span>
                              <span className="text-gray-900 font-medium">{usd.format(amount)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Savings Card */}
              <div className="rounded-lg border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900">Furnishing Savings</h2>
                </div>
                <div className="px-4 py-4 space-y-4">
                  {/* Market Value */}
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-gray-700">Market Value</span>
                    <span className="text-base font-semibold text-gray-900">{usd.format(summary.totalMarketValue)}</span>
                  </div>

                  {/* What They Spent */}
                  <div className="pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-medium text-gray-700">What You Spent</span>
                      <span className="text-base font-semibold text-gray-900">{usd.format(summary.totalSpent)}</span>
                    </div>
                  </div>

                  {/* What They Saved */}
                  <div className="pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-medium text-green-600">What You Saved</span>
                      <span className="text-base font-semibold text-green-600">{usd.format(summary.totalSaved)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Items List */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Furnishings</h2>
            </div>

            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="divide-y">
                {items.map((item) => {
                  const projectPrice = toNumber(item.projectPrice)
                  const receiptLink = getReceiptLink(item)
                  
                  return (
                    <div key={item.itemId} className="py-2 px-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-sm text-gray-900 font-medium">
                            {item.description || 'Item'}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {item.source && (
                              <span className="text-xs text-gray-500">Source: {item.source}</span>
                            )}
                            {receiptLink && (
                              <>
                                {item.source && <span className="text-xs text-gray-400">•</span>}
                                {receiptLink.isInternal ? (
                                  <ContextLink
                                    to={buildContextUrl(receiptLink.href)}
                                    className="text-xs text-primary-600 hover:text-primary-700 underline print:hidden"
                                  >
                                    View Receipt
                                  </ContextLink>
                                ) : (
                                  <a
                                    href={receiptLink.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary-600 hover:text-primary-700 underline print:hidden"
                                  >
                                    View Receipt
                                  </a>
                                )}
                                <span className="text-xs text-primary-600 print:inline hidden">
                                  Receipt available
                                </span>
                              </>
                            )}
                          </div>
                          {item.space && (
                            <div className="text-xs text-gray-500 mt-0.5">Space: {item.space}</div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-sm text-gray-700 font-medium">
                            {usd.format(projectPrice)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-gray-100">
                <span className="text-sm font-semibold text-gray-900">Furnishings Total</span>
                <span className="text-sm font-semibold text-gray-900">{usd.format(summary.totalSpent)}</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

