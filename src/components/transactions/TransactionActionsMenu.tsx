import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, MoreVertical } from 'lucide-react'
import { isCanonicalSaleOrPurchaseTransactionId } from '@/services/inventoryService'

type SubmenuKey = 'move'

type TransactionActionsMenuProps = {
  transactionId: string
  projectId?: string | null
  onEdit?: () => void
  onMoveToProject?: () => void // Opens dialog, doesn't move directly
  onMoveToBusinessInventory?: () => void
  onDelete?: () => void
  canMoveToBusinessInventory?: boolean
  canMoveToProject?: boolean
  triggerSize?: 'sm' | 'md'
}

export default function TransactionActionsMenu({
  transactionId,
  onEdit,
  onMoveToProject,
  onMoveToBusinessInventory,
  onDelete,
  canMoveToBusinessInventory = false,
  canMoveToProject = false,
  triggerSize = 'sm'
}: TransactionActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuKey | null>(null)

  const isCanonicalSaleOrPurchase = isCanonicalSaleOrPurchaseTransactionId(transactionId)

  const moveDisabledReason = isCanonicalSaleOrPurchase
    ? 'This is a Design Business Inventory purchase/sale transaction. Move is not available.'
    : null

  const moveToBusinessInventoryDisabledReason = useMemo(() => {
    if (isCanonicalSaleOrPurchase) return moveDisabledReason
    if (!canMoveToBusinessInventory) return 'Transaction is already in business inventory.'
    return null
  }, [isCanonicalSaleOrPurchase, canMoveToBusinessInventory, moveDisabledReason])

  const moveToProjectDisabledReason = useMemo(() => {
    if (isCanonicalSaleOrPurchase) return moveDisabledReason
    if (!canMoveToProject) return 'No projects available.'
    return null
  }, [isCanonicalSaleOrPurchase, canMoveToProject, moveDisabledReason])

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
    disabled,
    disabledReason
  }: {
    label: string
    submenuKey: SubmenuKey
    isOpen: boolean
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
      <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
    </button>
  )

  const hasActions = Boolean(onEdit || onMoveToBusinessInventory || onMoveToProject || onDelete)

  if (!hasActions) return null

  const menuItems = (
    <div className="py-1">
      {renderMenuItem({ label: 'Edit', onClick: onEdit, disabled: !onEdit })}
      {!isCanonicalSaleOrPurchase && (
        <>
          {renderSubmenuTrigger({
            label: 'Move',
            submenuKey: 'move',
            isOpen: openSubmenu === 'move',
            disabled: !canMoveToBusinessInventory && !canMoveToProject,
            disabledReason: !canMoveToBusinessInventory && !canMoveToProject ? 'No destinations available.' : null
          })}
          {openSubmenu === 'move' && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="py-1 pl-3">
            {canMoveToBusinessInventory && (
              renderMenuItem({
                label: 'Move to Business Inventory',
                onClick: onMoveToBusinessInventory,
                disabled: Boolean(moveToBusinessInventoryDisabledReason),
                disabledReason: moveToBusinessInventoryDisabledReason
              })
            )}
            {canMoveToProject && (
              <>
                {canMoveToBusinessInventory && <div className="my-1 border-t border-gray-200" />}
                {renderMenuItem({
                  label: 'Move to Project…',
                  onClick: onMoveToProject,
                  disabled: Boolean(moveToProjectDisabledReason),
                  disabledReason: moveToProjectDisabledReason
                })}
              </>
            )}
            {!canMoveToProject && !canMoveToBusinessInventory && (
              <div className="px-3 py-2 text-sm text-gray-500">No destinations available.</div>
            )}
          </div>
        </div>
          )}
        </>
      )}
      {renderMenuItem({
        label: 'Delete…',
        onClick: onDelete,
        disabled: !onDelete,
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
        aria-label="Transaction actions"
        title="More actions"
      >
        <MoreVertical className={iconSize} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          {menuItems}
        </div>
      )}
    </div>
  )
}
