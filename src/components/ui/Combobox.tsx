import { useState, Fragment, type ReactNode } from 'react'
import { Combobox as HeadlessCombobox, Transition } from '@headlessui/react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { clsx } from 'clsx'

interface ComboboxOption {
  id: string
  label: string
  disabled?: boolean
}

interface ComboboxProps {
  label?: string
  error?: string
  helperText?: ReactNode
  helperTextClassName?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  options: ComboboxOption[]
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  required?: boolean
  loading?: boolean
  allowCreate?: boolean
  onCreateOption?: (query: string) => Promise<string> | string
  createOptionLabel?: (query: string) => string
  isCreateOptionDisabled?: (query: string) => boolean
}

export function Combobox({
  label,
  error,
  helperText,
  helperTextClassName,
  size = 'md',
  className,
  options,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select an option...',
  required = false,
  loading = false,
  allowCreate = false,
  onCreateOption,
  createOptionLabel = (query: string) => `Add "${query}"`,
  isCreateOptionDisabled,
}: ComboboxProps) {
  const [query, setQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const selectedOption = value
    ? options.find(option => option.id === value) ?? null
    : null

  const filteredOptions = query === ''
    ? options
    : options.filter(option =>
        option.label.toLowerCase().includes(query.toLowerCase())
      )

  // Check if query exactly matches an existing option (case-insensitive)
  const hasExactMatch = query.trim() !== '' && filteredOptions.some(
    option => option.label.toLowerCase() === query.trim().toLowerCase()
  )

  // Determine if we should show create option
  const shouldShowCreateOption = allowCreate && 
    onCreateOption && 
    query.trim() !== '' && 
    !hasExactMatch &&
    (!isCreateOptionDisabled || !isCreateOptionDisabled(query.trim()))

  // Build options list with create option prepended if needed
  const displayOptions = shouldShowCreateOption
    ? [{ id: '__create__', label: createOptionLabel(query.trim()) }, ...filteredOptions]
    : filteredOptions

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base'
  }

  return (
    <div className="space-y-1">
      <div className={className}>
        <HeadlessCombobox
          value={selectedOption}
          onChange={async (option: ComboboxOption | null) => {
            if (!option) {
              onChange('')
              return
            }

            // Handle create option
            if (option.id === '__create__' && onCreateOption) {
              setIsCreating(true)
              try {
                const createdValue = await onCreateOption(query.trim())
                onChange(createdValue)
                setQuery('')
              } catch (error) {
                console.error('Failed to create option:', error)
                // Don't change selection on error
              } finally {
                setIsCreating(false)
              }
            } else {
              onChange(option.id)
            }
          }}
          disabled={disabled || loading || isCreating}
        >
          {label && (
            <HeadlessCombobox.Label className="block text-sm font-medium text-gray-700">
              {label}
              {required && <span className="text-red-500 ml-1">*</span>}
            </HeadlessCombobox.Label>
          )}
          <div className="relative">
            <HeadlessCombobox.Button as="div" className={clsx(
              'relative w-full cursor-default overflow-hidden rounded-md border bg-white text-left shadow-sm transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
              disabled || loading ? 'bg-gray-50 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer',
              error ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-300',
              sizeClasses[size]
            )}>
              <HeadlessCombobox.Input
                className={clsx(
                  'h-full w-full border-none py-0 pl-3 pr-10 text-sm leading-5 text-gray-900',
                  'focus:ring-0 focus:outline-none cursor-pointer',
                  disabled || loading || isCreating ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white cursor-pointer'
                )}
                autoComplete="off"
                displayValue={(option: ComboboxOption) => {
                  if (option) return option.label
                  // If value doesn't match any option, show the value itself (for creatable scenarios)
                  if (value && !selectedOption) return value
                  return ''
                }}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={loading ? 'Loading...' : isCreating ? 'Creating...' : placeholder}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <ChevronsUpDown
                  className="h-5 w-5 text-gray-400"
                  aria-hidden="true"
                />
              </div>
            </HeadlessCombobox.Button>
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
              afterLeave={() => setQuery('')}
            >
              <HeadlessCombobox.Options className={clsx(
                'absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm',
                'scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100'
              )}>
                {displayOptions.length === 0 && query !== '' ? (
                  <div className="relative cursor-default select-none py-2 px-4 text-gray-700">
                    Nothing found.
                  </div>
                ) : (
                  displayOptions.map((option) => {
                    const isCreateOption = option.id === '__create__'
                    return (
                      <HeadlessCombobox.Option
                        key={option.id}
                        className={({ active }) =>
                          clsx(
                            'relative cursor-default select-none py-2 pl-10 pr-4',
                            active ? 'bg-primary-600 text-white' : 'text-gray-900',
                            option.disabled && 'opacity-50 cursor-not-allowed',
                            isCreateOption && 'font-medium text-primary-600'
                          )
                        }
                        value={option}
                        disabled={option.disabled || isCreating}
                      >
                        {({ selected, active }) => (
                          <>
                            <span className={clsx('block truncate', selected ? 'font-medium' : 'font-normal')}>
                              {option.label}
                            </span>
                            {selected && !isCreateOption ? (
                                <span
                                  className={clsx(
                                    'absolute inset-y-0 left-0 flex items-center pl-3',
                                    active ? 'text-white' : 'text-primary-600'
                                  )}
                                >
                                  <Check className="h-5 w-5" aria-hidden="true" />
                                </span>
                            ) : null}
                          </>
                        )}
                      </HeadlessCombobox.Option>
                    )
                  })
                )}
              </HeadlessCombobox.Options>
            </Transition>
          </div>
        </HeadlessCombobox>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {helperText && !error && (
        <div className={clsx('text-sm text-gray-500', helperTextClassName)}>
          {helperText}
        </div>
      )}
    </div>
  )
}