import React, { useEffect, useState } from 'react'

interface QuantityPillProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  className?: string
  onSubmit?: () => void
  inputId?: string
}

export default function QuantityPill({
  value,
  onChange,
  min = 1,
  max,
  className = '',
  onSubmit,
  inputId
}: QuantityPillProps) {
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const clampValue = (next: number) => {
    const bounded = Math.max(min, Number.isFinite(max) ? Math.min(max, next) : next)
    return bounded
  }

  const handleInputChange = (nextValue: string) => {
    const sanitized = nextValue.replace(/[^\d]/g, '')
    setInputValue(sanitized)
    if (!sanitized) return
    const parsed = Number.parseInt(sanitized, 10)
    if (Number.isFinite(parsed)) {
      onChange(clampValue(parsed))
    }
  }

  const commitValue = () => {
    const parsed = Number.parseInt(inputValue, 10)
    if (!Number.isFinite(parsed)) {
      setInputValue(String(min))
      onChange(min)
      return
    }
    const next = clampValue(parsed)
    setInputValue(String(next))
    onChange(next)
  }

  return (
    <div
      className={`inline-flex items-center rounded-full border border-gray-300 bg-white shadow-sm ${className}`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onChange(clampValue(value - 1))
        }}
        disabled={value <= min}
        className="h-9 w-10 rounded-l-full text-lg font-medium text-gray-600 hover:text-gray-800 disabled:text-gray-300"
        aria-label="Decrease quantity"
      >
        -
      </button>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={inputValue}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onChange={(event) => handleInputChange(event.target.value)}
        onBlur={(event) => {
          event.preventDefault()
          event.stopPropagation()
          commitValue()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            commitValue()
            onSubmit?.()
          }
        }}
        className="h-9 w-14 bg-transparent text-center text-sm font-semibold text-gray-800 focus:outline-none"
        aria-label="Quantity"
      />
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onChange(clampValue(value + 1))
        }}
        disabled={Number.isFinite(max) ? value >= max : false}
        className="h-9 w-10 rounded-r-full text-lg font-medium text-gray-600 hover:text-gray-800 disabled:text-gray-300"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}
