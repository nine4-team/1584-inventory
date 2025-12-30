import { useState, useRef, useEffect, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsedDuplicateGroupProps {
  /** Unique identifier for this group (used for expansion state persistence) */
  groupId: string
  /** Number of items in this group */
  count: number
  /** The summary content to show when collapsed */
  summary: ReactNode
  /** The expanded content (individual items) */
  children: ReactNode
  /** Whether to start expanded by default */
  defaultExpanded?: boolean
  /** Microcopy to show when collapsed */
  microcopy?: string
  /** Additional CSS classes */
  className?: string
  /** Selection state for the group checkbox */
  selectionState?: 'checked' | 'unchecked' | 'indeterminate'
  /** Handler when the checkbox toggles selection */
  onToggleSelection?: (checked: boolean) => void
}

export default function CollapsedDuplicateGroup({
  groupId,
  count,
  summary,
  children,
  defaultExpanded = false,
  microcopy = "Expand to view all items",
  className = "",
  selectionState = 'unchecked',
  onToggleSelection
}: CollapsedDuplicateGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const checkboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = selectionState === 'indeterminate'
    }
  }, [selectionState])

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div className={`space-y-0 ${className}`}>
      {/* Group Header - Clickable */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full text-left cursor-pointer bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors duration-200 focus:outline-none"
        aria-expanded={isExpanded}
        aria-controls={`group-${groupId}-content`}
        aria-label={`Expand group: ${count} items`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleExpanded()
          }
        }}
      >
        <div className="flex items-start justify-between p-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {onToggleSelection && (
              <div className="pt-1">
                <input
                  ref={checkboxRef}
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-600 h-4 w-4 flex-shrink-0"
                  checked={selectionState === 'checked'}
                  onChange={(e) => {
                    e.stopPropagation()
                    onToggleSelection(e.target.checked)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select group of ${count} items`}
                />
              </div>
            )}

            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Summary Content */}
              <div className="flex-1 min-w-0">
                {summary}
              </div>
            </div>
          </div>

          {/* Chevron and Microcopy */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {count > 1 && !isExpanded && (
              <span className="text-xs text-gray-500 italic">
                {microcopy}
              </span>
            )}
            <div className="text-gray-400">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div
          id={`group-${groupId}-content`}
          className="border-l-2 border-gray-200 ml-4 pl-4 pt-3 space-y-3"
        >
          {children}
        </div>
      )}
    </div>
  )
}