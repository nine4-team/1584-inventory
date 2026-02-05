import { TransactionCompleteness } from '@/types'
import { formatCurrency } from '@/utils/dateUtils'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

interface TransactionCompletenessPanelProps {
  completeness: TransactionCompleteness
  /**
   * Label for the subtotal line. Call sites can decide whether the subtotal is
   * explicit vs inferred/estimated.
   */
  subtotalLabel?: string
}

export function TransactionCompletenessPanel({
  completeness,
  subtotalLabel = 'Subtotal (pre-tax)'
}: TransactionCompletenessPanelProps) {
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

  const progressPercentage = Math.min(completeness.completenessRatio * 100, 100)

  // Dollar remaining (positive means remaining to reach subtotal; negative means over by)
  const remainingDollars = Math.round((completeness.transactionSubtotal - completeness.itemsNetTotal) * 100) / 100
  const remainingLabel =
    remainingDollars >= 0
      ? `${formatCurrency(remainingDollars.toString())} remaining`
      : `Over by ${formatCurrency(Math.abs(remainingDollars).toString())}`

  const itemsLabel = 'Associated items total (pre-tax)'
  const taxLabel = 'Calculated tax'

  return (
    <>
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
            {formatCurrency(completeness.itemsNetTotal.toString())} /{' '}
            {formatCurrency(completeness.transactionSubtotal.toString())}
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
              <div>
                {subtotalLabel}: {formatCurrency(completeness.transactionSubtotal.toString())}
              </div>
              <div>
                {itemsLabel}: {formatCurrency(completeness.itemsNetTotal.toString())}
              </div>
              {completeness.inferredTax !== undefined && (
                <div>
                  {taxLabel}: {formatCurrency(completeness.inferredTax.toString())}
                </div>
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
    </>
  )
}

