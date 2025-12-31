import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { Button } from '@/components/ui/Button'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { useBusinessProfile } from '@/contexts/BusinessProfileContext'
import { projectItems, projectsRoot } from '@/utils/routes'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  if (typeof value === 'string') {
    const n = parseFloat(value || '0')
    return isNaN(n) ? 0 : n
  }
  return 0
}

export default function PropertyManagementSummary() {
  const { id, projectId } = useParams<{ id?: string; projectId?: string }>()
  const resolvedProjectId = projectId || id
  const stackedNavigate = useStackedNavigate()
  const { getBackDestination } = useNavigationContext()
  const { businessName, businessLogoUrl } = useBusinessProfile()
  const { project, items, isLoading, error } = useProjectRealtime(resolvedProjectId)

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), [])

  useEffect(() => {
    if (!resolvedProjectId) {
      stackedNavigate(projectsRoot())
    }
  }, [resolvedProjectId, stackedNavigate])

  const totalMarketValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const marketValue = toNumber(item.marketValue)
      return sum + marketValue
    }, 0)
  }, [items])

  const handlePrint = () => window.print()
  const handleBack = () => {
    const fallback = resolvedProjectId ? projectItems(resolvedProjectId) : projectsRoot()
    stackedNavigate(getBackDestination(fallback))
  }

  if (!resolvedProjectId) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading property management summary...</p>
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
            <h1 className="text-2xl font-bold text-gray-900">Property Management Summary</h1>
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
          {/* Summary */}
          <section>
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
              </div>
              <div className="px-4 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex items-center sm:flex-initial">
                    <span className="text-base font-medium text-gray-700">Total Items:</span>
                    <span className="ml-2 text-base font-semibold text-gray-900">{items.length}</span>
                  </div>
                  <div className="flex items-center sm:flex-1 sm:border-l sm:border-gray-100 sm:pl-4">
                    <span className="text-base font-medium text-gray-700">Total Market Value:</span>
                    <span className="ml-2 text-base font-semibold text-gray-900">{usd.format(totalMarketValue)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Items List */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Items</h2>
            </div>

            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="divide-y">
                {items.map((item) => {
                  const marketValue = toNumber(item.marketValue)
                  
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
                            {item.sku && (
                              <>
                                {item.source && <span className="text-xs text-gray-400">•</span>}
                                <span className="text-xs text-gray-500">SKU: {item.sku}</span>
                              </>
                            )}
                          </div>
                          {item.space && (
                            <div className="text-xs text-gray-500 mt-0.5">Space: {item.space}</div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-sm text-gray-700 font-medium">
                            {usd.format(marketValue)}
                          </div>
                          {marketValue === 0 && (
                            <div className="text-xs text-gray-400 mt-0.5">No market value set</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

