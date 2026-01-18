import React, { useEffect, useRef, useState } from 'react'
import QuantityPill from './QuantityPill'

interface DuplicateQuantityMenuProps {
  onDuplicate: (quantity: number) => void | Promise<void>
  buttonClassName: string
  buttonTitle: string
  buttonContent: React.ReactNode
  disabled?: boolean
}

export default function DuplicateQuantityMenu({
  onDuplicate,
  buttonClassName,
  buttonTitle,
  buttonContent,
  disabled = false
}: DuplicateQuantityMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
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

  const handleDuplicate = async () => {
    if (quantity < 1 || Number.isNaN(quantity)) {
      setError('Enter a quantity greater than 0.')
      return
    }

    setError(null)
    setIsOpen(false)
    setQuantity(1)
    await onDuplicate(quantity)
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
        <div className="absolute top-full right-0 mt-2 w-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg z-50">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Number of copies
          </div>
          <div className="mt-2 flex items-center gap-2">
            <QuantityPill
              value={quantity}
              onChange={(next) => {
                setQuantity(next)
                setError(null)
              }}
              min={1}
              onSubmit={() => void handleDuplicate()}
              className="shrink-0"
            />
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void handleDuplicate()
              }}
              className="rounded-md border border-primary-500 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
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
