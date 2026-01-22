import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, MoreVertical } from 'lucide-react'
import { displayDispositionLabel, dispositionsEqual } from '@/utils/dispositionUtils'
import { isCanonicalTransactionId } from '@/services/inventoryService'
import type { ItemDisposition } from '@/types'

type SubmenuKey = 'sell' | 'move' | 'status'

type ItemActionsMenuProps = {
  itemId: string
  itemProjectId?: string | null
  itemTransactionId?: string | null
  disposition?: ItemDisposition | string | null
  isPersisted: boolean
  currentProjectId?: string | null
  onEdit?: () => void
  onDuplicate?: () => void
  onAddToTransaction?: () => void
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
  onEdit,
  onDuplicate,
  onAddToTransaction,
  onSellToBusiness,
  onSellToProject,
  onMoveToBusiness,
  onMoveToProject,
  onChangeStatus,
  onDelete
}: ItemActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuKey | null>(null)

  const isInBusinessInventory = !itemProjectId
  const isTiedToTransaction = Boolean(itemTransactionId)
  const isCanonicalTransaction = isCanonicalTransactionId(itemTransactionId ?? null)
  const isUnpersisted = !isPersisted

  const transactionMoveDisabledReason = isCanonicalTransaction
    ? 'This item is tied to a Company Inventory transaction. Use allocation/deallocation instead.'
    : 'This item is tied to a transaction. Move the transaction instead.'

  const sellToBusinessDisabledReason = useMemo(() => {
    if (isUnpersisted) return 'Save this item before selling.'
    if (isInBusinessInventory) return 'This item is already in business inventory.'
    if (isTiedToTransaction) return transactionMoveDisabledReason
    return null
  }, [isInBusinessInventory, isTiedToTransaction, isUnpersisted, transactionMoveDisabledReason])

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

  const sellToProjectDisabledReason = isUnpersisted
    ? 'Save this item before selling.'
    : 'Not implemented yet.'

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
    disabled,
    disabledReason
  }: {
    label: string
    submenuKey: SubmenuKey
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
      onMouseEnter={() => {
        if (disabled) return
        setOpenSubmenu(submenuKey)
      }}
      className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
        disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
      }`}
      disabled={disabled}
      title={disabledReason || undefined}
    >
      <span>{label}</span>
      <ChevronRight className="h-4 w-4 text-gray-400" />
    </button>
  )

  const hasActions = Boolean(
    onEdit ||
    onDuplicate ||
    onAddToTransaction ||
    onSellToBusiness ||
    onSellToProject ||
    onMoveToBusiness ||
    onMoveToProject ||
    onChangeStatus ||
    onDelete
  )

  if (!hasActions) return null

  const menuItems = (
    <div className="py-1">
      {renderMenuItem({ label: 'Edit', onClick: onEdit, disabled: !onEdit })}
      {renderMenuItem({ label: 'Make Copies…', onClick: onDuplicate, disabled: !onDuplicate })}
      {renderMenuItem({
        label: 'Add To Transaction…',
        onClick: onAddToTransaction,
        disabled: !onAddToTransaction,
        disabledReason: !onAddToTransaction ? 'Not available in this context.' : null
      })}
      {renderSubmenuTrigger({
        label: 'Sell',
        submenuKey: 'sell',
        disabled: !onSellToBusiness && !onSellToProject,
        disabledReason: !onSellToBusiness && !onSellToProject ? 'Not available in this context.' : null
      })}
      {renderSubmenuTrigger({
        label: 'Move',
        submenuKey: 'move',
        disabled: !onMoveToBusiness && !onMoveToProject,
        disabledReason: !onMoveToBusiness && !onMoveToProject ? 'Not available in this context.' : null
      })}
      {renderSubmenuTrigger({
        label: 'Change Status',
        submenuKey: 'status',
        disabled: !onChangeStatus,
        disabledReason: !onChangeStatus ? 'Not available in this context.' : changeStatusDisabledReason
      })}
      {renderMenuItem({
        label: 'Delete…',
        onClick: onDelete,
        disabled: !onDelete || isUnpersisted,
        disabledReason: isUnpersisted ? 'Save this item before deleting.' : null,
        isDanger: true
      })}
    </div>
  )

  const submenuBase = 'absolute top-0 left-full ml-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50'

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(prev => !prev)
          setOpenSubmenu(null)
        }}
        className="inline-flex items-center justify-center p-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-transparent focus:outline-none transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Item actions"
        title="More actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          {menuItems}

          {openSubmenu === 'sell' && (
            <div className={submenuBase}>
              <div className="py-1">
                {renderMenuItem({
                  label: 'Sell To Design Business',
                  onClick: onSellToBusiness,
                  disabled: !onSellToBusiness || Boolean(sellToBusinessDisabledReason),
                  disabledReason: sellToBusinessDisabledReason
                })}
                {renderMenuItem({
                  label: 'Sell To Project…',
                  onClick: onSellToProject,
                  disabled: true,
                  disabledReason: sellToProjectDisabledReason
                })}
              </div>
            </div>
          )}

          {openSubmenu === 'move' && (
            <div className={submenuBase}>
              <div className="py-1">
                {renderMenuItem({
                  label: 'Move To Design Business',
                  onClick: onMoveToBusiness,
                  disabled: !onMoveToBusiness || Boolean(moveToBusinessDisabledReason),
                  disabledReason: moveToBusinessDisabledReason
                })}
                {renderMenuItem({
                  label: 'Move To Project…',
                  onClick: onMoveToProject,
                  disabled: !onMoveToProject || Boolean(moveToProjectDisabledReason),
                  disabledReason: moveToProjectDisabledReason
                })}
              </div>
            </div>
          )}

          {openSubmenu === 'status' && (
            <div className={submenuBase}>
              <div className="py-1">
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
                    className={`block w-full text-left px-3 py-2 text-sm transition-colors ${
                      changeStatusDisabledReason
                        ? 'text-gray-400 cursor-not-allowed'
                        : dispositionsEqual(disposition, status)
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                    disabled={Boolean(changeStatusDisabledReason)}
                    title={changeStatusDisabledReason || undefined}
                  >
                    {displayDispositionLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
