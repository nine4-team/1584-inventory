import type { Item } from '@/types'
import type { ReactNode } from 'react'

interface MissingPriceListProps {
  items: Item[]
  title?: string
  actionLabel?: string
  /**
   * Simple injection option when the action is just a link.
   */
  getItemEditHref?: (item: Item) => string
  /**
   * Advanced injection option for the whole action cell (e.g. react-router <Link/>).
   * If provided, this takes precedence over getItemEditHref.
   */
  renderAction?: (item: Item) => ReactNode
}

export function MissingPriceList({
  items,
  title = 'Missing Purchase Price',
  actionLabel = 'Edit Price',
  getItemEditHref,
  renderAction
}: MissingPriceListProps) {
  if (items.length === 0) return null

  const hasAction = Boolean(renderAction || getItemEditHref)

  return (
    <div className="space-y-4 border-t border-gray-200 pt-4">
      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-2">{title}</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                {hasAction && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item) => {
                const action =
                  renderAction?.(item) ??
                  (getItemEditHref ? (
                    <a href={getItemEditHref(item)} className="text-primary-600 hover:text-primary-800">
                      {actionLabel}
                    </a>
                  ) : null)

                return (
                  <tr key={item.itemId}>
                    <td className="px-3 py-2 text-sm text-gray-900">{item.description}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{item.sku || '-'}</td>
                    {hasAction && <td className="px-3 py-2 text-sm">{action}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

