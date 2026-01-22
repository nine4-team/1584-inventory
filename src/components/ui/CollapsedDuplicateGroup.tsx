import { useState, useRef, useEffect, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsedDuplicateGroupProps {
  /** Unique identifier for this group (used for expansion state persistence) */
  groupId: string
  /** Number of items in this group */
  count: number
  /** The summary content to show when collapsed (bottom row: image and text content) */
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
  /** Top row content (e.g., price) to display between checkbox and view all control */
  topRowContent?: ReactNode
}

export default function CollapsedDuplicateGroup({
  groupId,
  count,
  summary,
  children,
  defaultExpanded = false,
  microcopy = "View All",
  className = "",
  selectionState = 'unchecked',
  onToggleSelection,
  topRowContent
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
        <div className="p-4">
          {/* Top row: checkbox, price, controls (view all) */}
          <div className="flex items-center gap-4 mb-3">
            {onToggleSelection && (
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
            )}

            {/* Price and other top-row content */}
            {topRowContent && (
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {topRowContent}
              </div>
            )}

            {/* View all control - treated like control section in ungrouped cards */}
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
              {count > 1 && !isExpanded && (
                <>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                    ×{count}
                  </span>
                  <span className="text-xs text-gray-500 italic">
                    {microcopy}
                  </span>
                </>
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

          {/* Bottom row: Summary Content (image and text) */}
          <div className="flex gap-4">
            {summary}
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div
          id={`group-${groupId}-content`}
          className="border-l-2 border-gray-200 ml-2 pl-2 pt-3 space-y-3 sm:ml-4 sm:pl-4"
        >
          {children}
        </div>
      )}
    </div>
  )
}