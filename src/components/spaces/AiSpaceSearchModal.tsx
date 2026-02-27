import { useState, useCallback, useMemo } from 'react'
import { Sparkles, X, CheckCircle2, Square, CheckSquare, AlertTriangle, Loader2 } from 'lucide-react'
import { searchItemsByDescription, type AiItemStub, type AiMatchResult } from '@/utils/aiSpaceSearch'

export type AiSpaceSearchModalProps = {
  /** All items in scope — both already-in-space and available. */
  allItems: AiItemStub[]
  /** IDs of items already assigned to this space. */
  spaceItemIds: Set<string>
  onAddItems: (itemIds: string[]) => Promise<void>
  onClose: () => void
}

type Step = 'input' | 'review'

type MatchRow = AiMatchResult & {
  name: string
  alreadyInSpace: boolean
  selected: boolean
}

export function AiSpaceSearchModal({
  allItems,
  spaceItemIds,
  onAddItems,
  onClose,
}: AiSpaceSearchModalProps) {
  const [step, setStep] = useState<Step>('input')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])

  const handleSearch = useCallback(async () => {
    if (!description.trim()) return
    setLoading(true)
    setError(null)

    try {
      const result = await searchItemsByDescription(description.trim(), allItems)
      const itemMap = new Map(allItems.map((i) => [i.id, i]))

      const matchRows: MatchRow[] = result.matches
        .filter((m) => itemMap.has(m.itemId))
        .map((m) => ({
          ...m,
          name: itemMap.get(m.itemId)!.name,
          alreadyInSpace: spaceItemIds.has(m.itemId),
          selected: !spaceItemIds.has(m.itemId),
        }))

      if (matchRows.length === 0 && result.unmatched.length === 0) {
        setError('No items matched. Try rephrasing your description.')
        setLoading(false)
        return
      }

      setMatches(matchRows)
      setUnmatched(result.unmatched)
      setStep('review')
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [description, allItems, spaceItemIds])

  const toggleMatch = useCallback((itemId: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.itemId === itemId ? { ...m, selected: !m.selected } : m)),
    )
  }, [])

  const handleAdd = useCallback(async () => {
    const ids = matches.filter((m) => m.selected && !m.alreadyInSpace).map((m) => m.itemId)
    if (ids.length === 0) return
    setSubmitting(true)
    try {
      await onAddItems(ids)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [matches, onAddItems, onClose])

  const alreadyInSpace = useMemo(() => matches.filter((m) => m.alreadyInSpace), [matches])
  const toAdd = useMemo(() => matches.filter((m) => !m.alreadyInSpace), [matches])
  const selectedCount = useMemo(() => toAdd.filter((m) => m.selected).length, [toAdd])

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg pointer-events-auto flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary-500" />
              <h2 className="text-base font-semibold text-gray-900">
                {step === 'input' ? 'AI Search' : 'Review Matches'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {step === 'input' ? (
            <>
              <div className="px-6 py-4 flex-1 flex flex-col gap-3">
                <p className="text-sm text-gray-500">
                  Describe what's in this room and AI will find matching items from your inventory.
                </p>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  rows={5}
                  placeholder="White linen sofa, oak coffee table, brass floor lamp…"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    if (error) setError(null)
                  }}
                  autoFocus
                />
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSearch}
                  disabled={!description.trim() || loading}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Searching…' : 'Find Items'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="overflow-y-auto flex-1">
                {/* Summary */}
                <div className="px-6 py-3 border-b border-gray-100">
                  <p className="text-sm text-gray-500">
                    {matches.length} match{matches.length !== 1 ? 'es' : ''} found
                    {unmatched.length > 0 ? `, ${unmatched.length} not recognized` : ''}
                  </p>
                </div>

                {/* Already in space */}
                {alreadyInSpace.length > 0 && (
                  <div className="px-6 py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Already in This Space
                    </p>
                    <div className="divide-y divide-gray-100">
                      {alreadyInSpace.map((m) => (
                        <div key={m.itemId} className="flex items-center gap-3 py-2.5">
                          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                          <span className="text-sm text-gray-400">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* To add */}
                {toAdd.length > 0 && (
                  <div className="px-6 py-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Add to Space
                    </p>
                    <div className="divide-y divide-gray-100">
                      {toAdd.map((m) => (
                        <button
                          key={m.itemId}
                          onClick={() => toggleMatch(m.itemId)}
                          className={`flex items-center gap-3 py-2.5 w-full text-left transition-opacity ${
                            !m.selected ? 'opacity-40' : ''
                          }`}
                        >
                          {m.selected
                            ? <CheckSquare className="h-5 w-5 text-primary-500 flex-shrink-0" />
                            : <Square className="h-5 w-5 text-gray-300 flex-shrink-0" />
                          }
                          <span className="text-sm text-gray-900">{m.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unmatched */}
                {unmatched.length > 0 && (
                  <div className="px-6 py-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Not Found
                    </p>
                    <div className="flex flex-col gap-2">
                      {unmatched.map((phrase, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50"
                        >
                          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                          <span className="text-sm text-amber-800 italic">"{phrase}"</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
                <button
                  onClick={() => setStep('input')}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={submitting}
                >
                  Back
                </button>
                <button
                  onClick={handleAdd}
                  disabled={selectedCount === 0 || submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {selectedCount === 0
                    ? 'No Items Selected'
                    : `Add ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
