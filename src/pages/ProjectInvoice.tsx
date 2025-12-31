import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { Button } from '@/components/ui/Button'
import type { Item, Transaction } from '@/types'
import { formatDate } from '@/utils/dateUtils'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useBusinessProfile } from '@/contexts/BusinessProfileContext'
import {
  COMPANY_INVENTORY_SALE,
  COMPANY_INVENTORY_PURCHASE,
  CLIENT_OWES_COMPANY,
  COMPANY_OWES_CLIENT,
} from '@/constants/company'
import { projectTransactions, projectsRoot } from '@/utils/routes'

type InvoiceItemLine = {
  item: Item
  amount: number
  missingPrice: boolean
}

type InvoiceTransactionLine = {
  transaction: Transaction
  items: InvoiceItemLine[]
  hasItems: boolean
  lineTotal: number
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const getCanonicalTransactionTitle = (transaction: Transaction): string => {
  if (transaction.transactionId?.startsWith('INV_SALE_')) return COMPANY_INVENTORY_SALE
  if (transaction.transactionId?.startsWith('INV_PURCHASE_')) return COMPANY_INVENTORY_PURCHASE
  return transaction.source
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  if (typeof value === 'string') {
    const n = parseFloat(value || '0')
    return isNaN(n) ? 0 : n
  }
  return 0
}

export default function ProjectInvoice() {
  const { id, projectId } = useParams<{ id?: string; projectId?: string }>()
  const resolvedProjectId = projectId || id
  const stackedNavigate = useStackedNavigate()
  const { businessName, businessLogoUrl } = useBusinessProfile()
  const { getBackDestination } = useNavigationContext()
  const { project, transactions, items, isLoading, error } = useProjectRealtime(resolvedProjectId)

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), [])

  useEffect(() => {
    if (!resolvedProjectId) {
      stackedNavigate(projectsRoot())
    }
  }, [resolvedProjectId, stackedNavigate])

  const invoiceableTransactions = useMemo(() => {
    return transactions
      .filter(t => t.status !== 'canceled')
      .filter(t => t.reimbursementType === CLIENT_OWES_COMPANY || t.reimbursementType === COMPANY_OWES_CLIENT)
  }, [transactions])

  const invoiceLines = useMemo<InvoiceTransactionLine[]>(() => {
    if (!resolvedProjectId) return []
    return invoiceableTransactions.map(tx => {
      const txItems: Item[] = items.filter(item => item.transactionId === tx.transactionId)
      const itemLines: InvoiceItemLine[] = txItems.map(it => {
        const projectPriceValue = it.projectPrice
        const hasPrice = !!projectPriceValue && String(projectPriceValue).trim() !== ''
        const amount = hasPrice ? toNumber(projectPriceValue || '0') : 0
        return { item: it, amount, missingPrice: !hasPrice }
      })

      const hasItems = itemLines.length > 0
      const lineTotal = hasItems ? itemLines.reduce((sum, l) => sum + l.amount, 0) : toNumber(tx.amount)
      return { transaction: tx, items: itemLines, hasItems, lineTotal }
    })
  }, [invoiceableTransactions, items, resolvedProjectId])

  const clientOwesLines = useMemo(
    () =>
      invoiceLines
        .filter(line => line.transaction.reimbursementType === CLIENT_OWES_COMPANY)
        .sort((a, b) => (a.transaction.transactionDate || '').localeCompare(b.transaction.transactionDate || '')),
    [invoiceLines]
  )

  const creditLines = useMemo(
    () =>
      invoiceLines
        .filter(line => line.transaction.reimbursementType === COMPANY_OWES_CLIENT)
        .sort((a, b) => (a.transaction.transactionDate || '').localeCompare(b.transaction.transactionDate || '')),
    [invoiceLines]
  )

  const clientOwesSubtotal = useMemo(() => clientOwesLines.reduce((sum, l) => sum + l.lineTotal, 0), [clientOwesLines])
  const creditsSubtotal = useMemo(() => creditLines.reduce((sum, l) => sum + l.lineTotal, 0), [creditLines])
  const netDue = useMemo(() => clientOwesSubtotal - creditsSubtotal, [clientOwesSubtotal, creditsSubtotal])

  const handlePrint = () => window.print()
  const defaultBackTarget = resolvedProjectId ? projectTransactions(resolvedProjectId) : projectsRoot()
  const handleBack = () => {
    stackedNavigate(getBackDestination(defaultBackTarget))
  }

  if (!resolvedProjectId) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Building invoice...</p>
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

  const hasAnyLines = clientOwesLines.length > 0 || creditLines.length > 0

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
            <h1 className="text-2xl font-bold text-gray-900">Invoice</h1>
            <div className="mt-1 text-sm text-gray-600">
              <div className="font-medium text-gray-800">{project?.name || 'Project'}</div>
              {project?.clientName && <div>Client: {project.clientName}</div>}
              <div>Date: {today}</div>
            </div>
          </div>
        </div>
      </div>

      {!hasAnyLines && (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400">🧾</div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No invoiceable items</h3>
          <p className="mt-1 text-sm text-gray-500">There are no qualifying transactions for this project.</p>
        </div>
      )}

      {hasAnyLines && (
        <div className="space-y-10">
          {/* Client Owes section */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Project Charges</h2>
            </div>

            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="divide-y">
                {clientOwesLines.map(line => {
                const transactionTitle = getCanonicalTransactionTitle(line.transaction)
                const formattedDate = formatDate(
                  line.transaction.transactionDate,
                  '',
                  {
                    year: undefined,
                    month: 'short',
                    day: 'numeric'
                  }
                )

                return (
                  <div key={line.transaction.transactionId} className="py-4 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-900">
                          <span className="font-medium">{transactionTitle}</span>
                          {formattedDate && <span className="text-xs font-normal text-gray-500">{formattedDate}</span>}
                        </div>
                        {line.transaction.notes && (
                          <div className="text-sm text-gray-500">{line.transaction.notes}</div>
                        )}
                      </div>
                      <div className="text-right text-gray-700">{usd.format(line.lineTotal)}</div>
                    </div>

                    {line.hasItems && (
                      <div className="mt-2 ml-4">
                        <ul className="space-y-1">
                          {line.items.map((it) => (
                            <li key={it.item.itemId} className="flex items-start justify-between text-sm">
                              <div className="text-gray-700">
                                {it.item.description || 'Item'}
                                {it.missingPrice && (
                                  <span className="ml-2 text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-1">Missing project price</span>
                                )}
                              </div>
                              <div className="pr-4 text-right text-gray-600">{usd.format(it.amount)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })}
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-100">
                <span className="text-base font-semibold text-gray-900">Charges Total</span>
                <span className="text-base font-semibold text-gray-900">{usd.format(clientOwesSubtotal)}</span>
              </div>
            </div>
          </section>

          {/* Credits section */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Project Credits</h2>
            </div>

            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="divide-y">
                {creditLines.map(line => {
                const transactionTitle = getCanonicalTransactionTitle(line.transaction)
                const formattedDate = formatDate(
                  line.transaction.transactionDate,
                  '',
                  {
                    year: undefined,
                    month: 'short',
                    day: 'numeric'
                  }
                )

                return (
                  <div key={line.transaction.transactionId} className="py-4 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-900">
                          <span className="font-medium">{transactionTitle}</span>
                          {formattedDate && <span className="text-xs font-normal text-gray-500">{formattedDate}</span>}
                        </div>
                        {line.transaction.notes && (
                          <div className="text-sm text-gray-500">{line.transaction.notes}</div>
                        )}
                      </div>
                      <div className="text-right text-gray-700">{usd.format(line.lineTotal)}</div>
                    </div>

                    {line.hasItems && (
                      <div className="mt-2 ml-4">
                        <ul className="space-y-1">
                          {line.items.map((it) => (
                            <li key={it.item.itemId} className="flex items-start justify-between text-sm">
                              <div className="text-gray-700">
                                {it.item.description || 'Item'}
                                {it.missingPrice && (
                                  <span className="ml-2 text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-1">Missing project price</span>
                                )}
                              </div>
                              <div className="pr-4 text-right text-gray-600">{usd.format(it.amount)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })}
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-100">
                <span className="text-base font-semibold text-gray-900">Credits Total</span>
                <span className="text-base font-semibold text-gray-900">{usd.format(creditsSubtotal)}</span>
              </div>
            </div>
          </section>

          {/* Net Due */}
          <section className="border-t pt-4">
            <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-primary-600">Net Amount Due</h2>
          <div className="text-xl font-bold text-primary-600">{usd.format(netDue)}</div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}


