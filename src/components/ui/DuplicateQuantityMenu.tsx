import React, { useEffect, useRef, useState } from 'react'

interface DuplicateQuantityMenuProps {
  onDuplicate: (quantity: number) => void | Promise<void>
  buttonClassName: string
  buttonTitle: string
  buttonContent: React.ReactNode
  disabled?: boolean
}

const QUICK_OPTIONS = [1, 2, 3, 4, 5]

export default function DuplicateQuantityMenu({
  onDuplicate,
  buttonClassName,
  buttonTitle,
  buttonContent,
  disabled = false
}: DuplicateQuantityMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [customQty, setCustomQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (containerRef.current && !containerRef.current.contains(target)) {
        setIsOpen(false)
        setError(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleDuplicate = async (quantity: number) => {
    if (quantity < 1 || Number.isNaN(quantity)) {
      setError('Enter a quantity greater than 0.')
      return
    }

    setError(null)
    setIsOpen(false)
    setCustomQty('')
    await onDuplicate(quantity)
  }

  const handleCustomDuplicate = () => {
    const parsed = Number.parseInt(customQty, 10)
    void handleDuplicate(Number.isFinite(parsed) ? parsed : 0)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={buttonClassName}
        title={buttonTitle}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setIsOpen(prev => !prev)
          setError(null)
        }}
      >
        {buttonContent}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-60 rounded-lg border border-gray-200 bg-white p-3 shadow-lg z-50">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            How many do you have?
          </div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {QUICK_OPTIONS.map(value => (
              <button
                key={value}
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void handleDuplicate(value)
                }}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-700 hover:border-primary-300 hover:text-primary-700"
              >
                {value}
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
            Custom QTY
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={customQty}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onChange={(event) => {
                setCustomQty(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCustomDuplicate()
                }
              }}
              className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
              placeholder="Enter quantity"
            />
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void handleCustomDuplicate()
              }}
              className="rounded-md border border-primary-500 px-3 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              Create
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
