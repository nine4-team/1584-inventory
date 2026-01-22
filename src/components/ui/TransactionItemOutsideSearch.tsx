import { Plus, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

type TransactionItemOutsideSearchProps = {
  open: boolean
  title?: string
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  selectedCount: number
  isAdding: boolean
  onAddSelected: () => void
  onClose: () => void
  resultsCount: number
  isLoading: boolean
  children: ReactNode
}

export default function TransactionItemOutsideSearch({
  open,
  title = 'Outside items',
  searchQuery,
  onSearchQueryChange,
  selectedCount,
  isAdding,
  onAddSelected,
  onClose,
  resultsCount,
  isLoading,
  children
}: TransactionItemOutsideSearchProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500">Showing {resultsCount} result{resultsCount === 1 ? '' : 's'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center p-2 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Search outside items</label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search other projects and business inventory"
              className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {isLoading ? 'Searching...' : `${resultsCount} result${resultsCount === 1 ? '' : 's'} found`}
            </div>
            <button
              type="button"
              onClick={onAddSelected}
              disabled={selectedCount === 0 || isAdding}
              className={`inline-flex items-center px-3 py-2 border text-xs font-medium rounded ${
                selectedCount === 0 || isAdding
                  ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                  : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto space-y-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
