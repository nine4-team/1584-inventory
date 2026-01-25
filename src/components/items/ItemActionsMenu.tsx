import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, MoreVertical, Check } from 'lucide-react'
import DuplicateQuantityMenu from '@/components/ui/DuplicateQuantityMenu'
import { displayDispositionLabel, dispositionsEqual } from '@/utils/dispositionUtils'
import { isCanonicalTransactionId } from '@/services/inventoryService'
import type { ItemDisposition } from '@/types'
import { useNetworkState } from '@/hooks/useNetworkState'

type SubmenuKey = 'sell' | 'move' | 'status'

type ItemActionsMenuProps = {
  itemId: string
  itemProjectId?: string | null
  itemTransactionId?: string | null
  disposition?: ItemDisposition | string | null
  isPersisted: boolean
  currentProjectId?: string | null
  triggerSize?: 'sm' | 'md'
  menuDirection?: 'auto' | 'top' | 'bottom'
  onEdit?: () => void
  onDuplicate?: (quantity: number) => void
  onAddToSpace?: () => void
  onAddToTransaction?: () => void
  onRemoveFromTransaction?: () => void
  onSellToBusiness?: () => void
  onSellToProject?: () => void
  onMoveToBusiness?: () => void
  onMoveToProject?: () => void
  onChangeStatus?: (status: ItemDisposition) => void
  onDelete?: () => void
}

const STATUS_OPTIONS: ItemDisposition[] = ['to purchase', 'purchased', 'to return', 'returned']

export default function ItemActionsMenu({
  itemId,
  itemProjectId,
  itemTransactionId,
  disposition,
  isPersisted,
  currentProjectId,
  triggerSize = 'sm',
  menuDirection = 'auto',
  onEdit,
  onDuplicate,
  onAddToSpace,
  onAddToTransaction,
  onRemoveFromTransaction,
  onSellToBusiness,
  onSellToProject,
  onMoveToBusiness,
  onMoveToProject,
  onChangeStatus,
  onDelete
}: ItemActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuContentRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuKey | null>(null)
  const [menuPosition, setMenuPosition] = useState<'bottom' | 'top'>('bottom')
  const { isOnline } = useNetworkState()

  const isInBusinessInventory = !itemProjectId
  const isTiedToTransaction = Boolean(itemTransactionId)
  const isCanonicalTransaction = isCanonicalTransactionId(itemTransactionId ?? null)
  const isUnpersisted = !isPersisted

  const transactionMoveDisabledReason = isCanonicalTransaction
    ? 'This item is tied to a Design Business Inventory transaction. Move is not available.'
    : 'This item is tied to a transaction. Move the transaction instead.'

  const sellToBusinessDisabledReason = useMemo(() => {
    if (isUnpersisted) return 'Save this item before selling.'
    if (isInBusinessInventory) return 'This item is already in business inventory.'
    return null
  }, [isInBusinessInventory, isUnpersisted])

  const moveToBusinessDisabledReason = useMemo(() => {
    if (isUnpersisted) return 'Save this item before moving.'
    if (isInBusinessInventory) return 'This item is already in business inventory.'
    if (isTiedToTransaction) return transactionMoveDisabledReason
    return null
  }, [isInBusinessInventory, isTiedToTransaction, isUnpersisted, transactionMoveDisabledReason])

  const moveToProjectDisabledReason = useMemo(() => {
    if (isUnpersisted) return 'Save this item before moving.'
    if (isTiedToTransaction) return transactionMoveDisabledReason
    return null
  }, [isTiedToTransaction, isUnpersisted, transactionMoveDisabledReason])

  const changeStatusDisabledReason = isUnpersisted ? 'Save this item before changing status.' : null

  const sellToProjectDisabledReason = useMemo(() => {
    if (isUnpersisted) return 'Save this item before selling.'
    if (isInBusinessInventory) return 'This item is already in business inventory. Use Move to Project.'
    return null
  }, [
    isUnpersisted,
    isInBusinessInventory
  ])

  const duplicateDisabledReason = useMemo(() => {
    if (!onDuplicate) return 'Not available in this context.'
    return null
  }, [onDuplicate])

  const addToSpaceDisabledReason = useMemo(() => {
    if (!onAddToSpace) return 'Not available in this context.'
    return null
  }, [onAddToSpace])

  const addToTransactionDisabledReason = useMemo(() => {
    if (!onAddToTransaction) return 'Not available in this context.'
    return null
  }, [onAddToTransaction])

  const removeFromTransactionDisabledReason = useMemo(() => {
    if (!onRemoveFromTransaction) return 'Not available in this context.'
    if (!isTiedToTransaction) return 'Item is not tied to a transaction.'
    return null
  }, [onRemoveFromTransaction, isTiedToTransaction])

  // Calculate menu position when it opens
  useEffect(() => {
    if (!isOpen || !triggerRef.current || !menuContentRef.current) return
    if (menuDirection !== 'auto') {
      setMenuPosition(menuDirection)
      return
    }

    const calculatePosition = () => {
      if (!triggerRef.current || !menuContentRef.current) return
      
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const menuHeight = menuContentRef.current.offsetHeight || 300 // fallback estimate
      const viewportHeight = window.innerHeight
      const spaceBelow = viewportHeight - triggerRect.bottom
      const spaceAbove = triggerRect.top
      const buffer = 16 // Add small buffer for better UX

      // If there's not enough space below but enough above, position menu above
      // Also check if space above is significantly more than space below
      if ((spaceBelow < menuHeight + buffer && spaceAbove > menuHeight + buffer) ||
          (spaceAbove > spaceBelow && spaceAbove > menuHeight + buffer)) {
        setMenuPosition('top')
      } else {
        setMenuPosition('bottom')
      }
    }

    // Calculate position after menu is rendered
    // Use requestAnimationFrame to ensure DOM is updated
    const rafId = requestAnimationFrame(() => {
      calculatePosition()
    })
    
    // Recalculate on scroll/resize
    window.addEventListener('scroll', calculatePosition, true)
    window.addEventListener('resize', calculatePosition)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', calculatePosition, true)
      window.removeEventListener('resize', calculatePosition)
    }
  }, [isOpen, menuDirection, openSubmenu])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !event.target) return
      const target = event.target as Element
      if (!menuRef.current.contains(target)) {
        setIsOpen(false)
        setOpenSubmenu(null)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        setOpenSubmenu(null)
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const closeMenus = () => {
    setIsOpen(false)
    setOpenSubmenu(null)
  }

  const handleAction = (action?: () => void) => {
    if (!action) return
    action()
    closeMenus()
  }

  const renderMenuItem = ({
    label,
    onClick,
    disabled,
    disabledReason,
    isDanger
  }: {
    label: string
    onClick?: () => void
    disabled?: boolean
    disabledReason?: string | null
    isDanger?: boolean
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        handleAction(onClick)
      }}
      className={`block w-full text-left px-3 py-2 text-sm transition-colors ${
        disabled
          ? 'text-gray-400 cursor-not-allowed'
          : isDanger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-gray-700 hover:bg-gray-50'
      }`}
      disabled={disabled}
      title={disabledReason || undefined}
    >
      {label}
    </button>
  )

  const renderSubmenuTrigger = ({
    label,
    submenuKey,
    isOpen,
    detail,
    disabled,
    disabledReason
  }: {
    label: string
    submenuKey: SubmenuKey
    isOpen: boolean
    detail?: string
    disabled?: boolean
    disabledReason?: string | null
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        setOpenSubmenu(prev => (prev === submenuKey ? null : submenuKey))
      }}
      className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
        disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
      }`}
      disabled={disabled}
      title={disabledReason || undefined}
      aria-expanded={isOpen}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2">
        {detail ? <span className="text-xs text-gray-500 truncate max-w-[10rem]">{detail}</span> : null}
        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </span>
    </button>
  )

  const hasActions = Boolean(
    onEdit ||
    onDuplicate ||
    onAddToSpace ||
    onAddToTransaction ||
    onRemoveFromTransaction ||
    onSellToBusiness ||
    onSellToProject ||
    onMoveToBusiness ||
    onMoveToProject ||
    onChangeStatus ||
    onDelete
  )

  if (!hasActions) return null

  const currentStatusLabel = disposition ? displayDispositionLabel(disposition as ItemDisposition) : 'Not set'

  const menuItems = (
    <div className="py-1">
      {renderMenuItem({ label: 'Edit', onClick: onEdit, disabled: !onEdit })}
      {duplicateDisabledReason ? (
        renderMenuItem({
          label: 'Make Copies…',
          disabled: true,
          disabledReason: duplicateDisabledReason
        })
      ) : (
        <DuplicateQuantityMenu
          onDuplicate={(quantity) => {
            onDuplicate?.(quantity)
            closeMenus()
          }}
          buttonClassName="block w-full text-left px-3 py-2 text-sm transition-colors text-gray-700 hover:bg-gray-50"
          buttonTitle="Make Copies"
          buttonContent="Make Copies…"
        />
      )}
      {renderMenuItem({
        label: 'Set Space…',
        onClick: onAddToSpace,
        disabled: Boolean(addToSpaceDisabledReason),
        disabledReason: addToSpaceDisabledReason
      })}
      {renderMenuItem({
        label: 'Associate with Transaction…',
        onClick: onAddToTransaction,
        disabled: Boolean(addToTransactionDisabledReason),
        disabledReason: addToTransactionDisabledReason
      })}
      {onRemoveFromTransaction
        ? renderMenuItem({
            label: 'Remove from Transaction…',
            onClick: onRemoveFromTransaction,
            disabled: Boolean(removeFromTransactionDisabledReason),
            disabledReason: removeFromTransactionDisabledReason,
            isDanger: true
          })
        : null}
      {renderSubmenuTrigger({
        label: 'Sell',
        submenuKey: 'sell',
        isOpen: openSubmenu === 'sell',
        disabled: !onSellToBusiness && !onSellToProject,
        disabledReason: !onSellToBusiness && !onSellToProject ? 'Not available in this context.' : null
      })}
      {openSubmenu === 'sell' && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="py-1 pl-3">
            {renderMenuItem({
              label: 'Sell to Design Business',
              onClick: onSellToBusiness,
              disabled: !onSellToBusiness || Boolean(sellToBusinessDisabledReason),
              disabledReason: sellToBusinessDisabledReason
            })}
            {renderMenuItem({
              label: 'Sell to Project…',
              onClick: onSellToProject,
              disabled: !onSellToProject || Boolean(sellToProjectDisabledReason),
              disabledReason: sellToProjectDisabledReason
            })}
          </div>
        </div>
      )}
      {renderSubmenuTrigger({
        label: 'Move',
        submenuKey: 'move',
        isOpen: openSubmenu === 'move',
        disabled: !onMoveToBusiness && !onMoveToProject,
        disabledReason: !onMoveToBusiness && !onMoveToProject ? 'Not available in this context.' : null
      })}
      {openSubmenu === 'move' && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="py-1 pl-3">
            {isTiedToTransaction && transactionMoveDisabledReason && (
               <div className="px-3 py-2 text-xs text-gray-500 italic">
                 {transactionMoveDisabledReason}
               </div>
            )}
            {renderMenuItem({
              label: 'Move to Design Business',
              onClick: onMoveToBusiness,
              disabled: !onMoveToBusiness || Boolean(moveToBusinessDisabledReason),
              disabledReason: moveToBusinessDisabledReason
            })}
            {renderMenuItem({
              label: 'Move to Project…',
              onClick: onMoveToProject,
              disabled: !onMoveToProject || Boolean(moveToProjectDisabledReason),
              disabledReason: moveToProjectDisabledReason
            })}
          </div>
        </div>
      )}
      {renderSubmenuTrigger({
        label: 'Status',
        submenuKey: 'status',
        isOpen: openSubmenu === 'status',
        detail: currentStatusLabel,
        disabled: !onChangeStatus,
        disabledReason: !onChangeStatus ? 'Not available in this context.' : changeStatusDisabledReason
      })}
      {openSubmenu === 'status' && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="py-1 pl-3">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!onChangeStatus || changeStatusDisabledReason) return
                  onChangeStatus(status)
                  closeMenus()
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
                  changeStatusDisabledReason
                    ? 'text-gray-400 cursor-not-allowed'
                    : dispositionsEqual(disposition, status)
                      ? 'bg-primary-50 text-primary-800 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                }`}
                disabled={Boolean(changeStatusDisabledReason)}
                title={changeStatusDisabledReason || undefined}
              >
                <span>{displayDispositionLabel(status)}</span>
                {dispositionsEqual(disposition, status) ? <Check className="h-4 w-4 text-primary-600" /> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {renderMenuItem({
        label: 'Delete…',
        onClick: onDelete,
        disabled: !onDelete || isUnpersisted,
        disabledReason: isUnpersisted ? 'Save this item before deleting.' : null,
        isDanger: true
      })}
    </div>
  )

  const triggerStyles = triggerSize === 'md'
    ? 'p-2 text-base'
    : 'p-1 text-sm'
  const iconSize = triggerSize === 'md'
    ? 'h-5 w-5'
    : 'h-4 w-4'

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(prev => !prev)
          setOpenSubmenu(null)
        }}
        className={`inline-flex items-center justify-center ${triggerStyles} font-medium text-primary-600 hover:text-primary-800 bg-transparent focus:outline-none transition-colors`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Item actions"
        title="More actions"
      >
        <MoreVertical className={iconSize} />
      </button>

      {isOpen && (
        <div
          ref={menuContentRef}
          className={`absolute right-0 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50 ${
            menuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {menuItems}
        </div>
      )}
    </div>
  )
}
