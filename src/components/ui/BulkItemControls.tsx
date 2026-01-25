import { useState, useEffect, useRef } from 'react'
import { Receipt, MapPin, Tag, Trash2, X, MoreVertical } from 'lucide-react'
import { Transaction } from '@/types'
import { transactionService } from '@/services/inventoryService'
import { DISPOSITION_OPTIONS, displayDispositionLabel } from '@/utils/dispositionUtils'
import type { ItemDisposition } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { Combobox } from '@/components/ui/Combobox'
import SpaceSelector from '@/components/spaces/SpaceSelector'

interface BulkItemControlsProps {
  selectedItemIds: Set<string>
  projectId?: string
  onAssignToTransaction?: (transactionId: string) => Promise<void>
  onSetSpaceId?: (spaceId: string | null) => Promise<void>
  onSetDisposition?: (disposition: ItemDisposition) => Promise<void>
  onSetSku?: (sku: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClearSelection: () => void
  itemListContainerWidth?: number
  enableAssignToTransaction?: boolean
  enableLocation?: boolean
  enableDisposition?: boolean
  enableSku?: boolean
  enableDelete?: boolean
  deleteButtonLabel?: string
  placement?: 'fixed' | 'container'
}

export default function BulkItemControls({
  selectedItemIds,
  projectId,
  onAssignToTransaction,
  onSetSpaceId,
  onSetDisposition,
  onSetSku,
  onDelete,
  onClearSelection,
  itemListContainerWidth,
  enableAssignToTransaction = true,
  enableLocation = true,
  enableDisposition = true,
  enableSku = true,
  enableDelete = true,
  deleteButtonLabel = 'Delete',
  placement = 'fixed'
}: BulkItemControlsProps) {
  const { currentAccountId } = useAccount()
  const canAssign = enableAssignToTransaction && !!onAssignToTransaction
  const canSetLocation = enableLocation && !!onSetSpaceId
  const canSetDisposition = enableDisposition && !!onSetDisposition
  const canSetSku = enableSku && !!onSetSku
  const canDelete = enableDelete && !!onDelete
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [showLocationDialog, setShowLocationDialog] = useState(false)
  const [showDispositionDialog, setShowDispositionDialog] = useState(false)
  const [showSkuDialog, setShowSkuDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [spaceIdValue, setSpaceIdValue] = useState<string | null>(null)
  const [selectedDisposition, setSelectedDisposition] = useState<ItemDisposition | ''>('')
  const [skuValue, setSkuValue] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Load transactions when dialog opens
  useEffect(() => {
    if (!canAssign) return
    if (showTransactionDialog && currentAccountId && projectId && transactions.length === 0) {
      loadTransactions()
    }
  }, [showTransactionDialog, currentAccountId, canAssign, projectId, transactions.length])

  useEffect(() => {
    if (!showLocationDialog) return
    setSpaceIdValue(null)
  }, [showLocationDialog])

  const loadTransactions = async () => {
    if (!currentAccountId || !projectId) return
    setLoadingTransactions(true)
    try {
      const txs = await transactionService.getTransactions(currentAccountId, projectId)
      setTransactions(txs)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoadingTransactions(false)
    }
  }

  const getCanonicalTransactionTitle = (transaction: Transaction): string => {
    if (transaction.transactionId?.startsWith('INV_SALE_')) {
      return 'Design Business Inventory Sale'
    }
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      return 'Design Business Inventory Purchase'
    }
    return transaction.source
  }

  const handleAssignToTransaction = async () => {
    if (!canAssign || !onAssignToTransaction || !selectedTransactionId) return
    setIsProcessing(true)
    try {
      await onAssignToTransaction(selectedTransactionId)
      setShowTransactionDialog(false)
      setSelectedTransactionId('')
      onClearSelection()
    } catch (error) {
      console.error('Failed to assign items to transaction:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSetSpaceId = async () => {
    if (!canSetLocation || !onSetSpaceId) return
    setIsProcessing(true)
    try {
      await onSetSpaceId(spaceIdValue)
      setShowLocationDialog(false)
      setSpaceIdValue(null)
      onClearSelection()
    } catch (error) {
      console.error('Failed to set space:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSetDisposition = async () => {
    if (!canSetDisposition || !onSetDisposition || !selectedDisposition) return
    setIsProcessing(true)
    try {
      await onSetDisposition(selectedDisposition)
      setShowDispositionDialog(false)
      setSelectedDisposition('')
      onClearSelection()
    } catch (error) {
      console.error('Failed to set disposition:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSetSku = async () => {
    if (!canSetSku || !onSetSku) return
    setIsProcessing(true)
    try {
      await onSetSku(skuValue)
      setShowSkuDialog(false)
      setSkuValue('')
      onClearSelection()
    } catch (error) {
      console.error('Failed to set SKU:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDelete = async () => {
    if (!canDelete || !onDelete) return
    setIsProcessing(true)
    try {
      await onDelete()
      setShowDeleteConfirm(false)
      onClearSelection()
    } catch (error) {
      console.error('Failed to delete items:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  if (selectedItemIds.size === 0) {
    return null
  }

  const isFixedPlacement = placement === 'fixed'
  const containerClasses = isFixedPlacement
    ? 'fixed bottom-0 z-50 bg-white border-t border-gray-200 shadow-lg'
    : 'sticky bottom-0 z-40 bg-white border-t border-gray-200 shadow-lg'
  const containerStyle = isFixedPlacement
    ? {
        width: itemListContainerWidth ? `${itemListContainerWidth}px` : '100%',
        left: itemListContainerWidth ? '50%' : '0',
        transform: itemListContainerWidth ? `translateX(-50%)` : 'none',
        maxWidth: '100%'
      }
    : {
        width: '100%'
      }

  return (
    <>
      {/* Sticky Bulk Controls Container */}
      <div className={containerClasses} style={containerStyle}>
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={onClearSelection}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="Bulk actions"
            >
              Bulk Actions
              <MoreVertical className="h-4 w-4" />
            </button>

            {isMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50 overflow-hidden">
                <div className="py-1">
                  {canAssign && (
                    <button
                      onClick={() => {
                        setShowTransactionDialog(true)
                        setIsMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Receipt className="h-4 w-4" />
                      Assign to Transaction
                    </button>
                  )}

                  {canSetLocation && (
                    <button
                      onClick={() => {
                        setShowLocationDialog(true)
                        setIsMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <MapPin className="h-4 w-4" />
                      Set Space
                    </button>
                  )}

                  {canSetDisposition && (
                    <button
                      onClick={() => {
                        setShowDispositionDialog(true)
                        setIsMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Tag className="h-4 w-4" />
                      Set Disposition
                    </button>
                  )}

                  {canSetSku && (
                    <button
                      onClick={() => {
                        setShowSkuDialog(true)
                        setIsMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Tag className="h-4 w-4" />
                      Set SKU
                    </button>
                  )}

                  {canDelete && (
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(true)
                        setIsMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleteButtonLabel}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction Selection Dialog */}
      {canAssign && showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Assign {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} to Transaction
              </h3>
            </div>
            <div className="px-6 py-4">
              <Combobox
                label="Select Transaction"
                value={selectedTransactionId}
                onChange={setSelectedTransactionId}
                disabled={loadingTransactions || isProcessing}
                loading={loadingTransactions}
                placeholder={loadingTransactions ? "Loading transactions..." : "Select a transaction"}
                options={
                  loadingTransactions ? [] : [
                    { id: '', label: 'Select a transaction' },
                    ...transactions.map((transaction) => ({
                      id: transaction.transactionId,
                      label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${getCanonicalTransactionTitle(transaction)} - $${transaction.amount}`
                    }))
                  ]
                }
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTransactionDialog(false)
                  setSelectedTransactionId('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleAssignToTransaction}
                disabled={!selectedTransactionId || isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Space Selection Dialog */}
      {canSetLocation && showLocationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set Space for {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="px-6 py-4">
              {projectId ? (
                <SpaceSelector
                  projectId={projectId}
                  value={spaceIdValue}
                  onChange={(spaceId) => setSpaceIdValue(spaceId)}
                  placeholder="Select or create a space..."
                  allowCreate={Boolean(currentAccountId && projectId)}
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Space
                  </label>
                  <input
                    type="text"
                    placeholder="Select a project to choose spaces"
                    disabled
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-gray-500">Bulk space setting is only available for project items</p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowLocationDialog(false)
                  setSpaceIdValue(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleSetSpaceId}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Setting...' : 'Set Space'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disposition Selection Dialog */}
      {canSetDisposition && showDispositionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set Disposition for {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="px-6 py-4">
              <Combobox
                label="Disposition"
                value={selectedDisposition}
                onChange={(value) => setSelectedDisposition(value as ItemDisposition | '')}
                disabled={isProcessing}
                placeholder="Select a disposition"
                options={[
                  { id: '', label: 'Select a disposition' },
                  ...DISPOSITION_OPTIONS.map((disposition) => ({
                    id: disposition,
                    label: displayDispositionLabel(disposition)
                  }))
                ]}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDispositionDialog(false)
                  setSelectedDisposition('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleSetDisposition}
                disabled={!selectedDisposition || isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Setting...' : 'Set Disposition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SKU Input Dialog */}
      {canSetSku && showSkuDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set SKU for {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="px-6 py-4">
              <label htmlFor="sku-input" className="block text-sm font-medium text-gray-700 mb-2">
                SKU
              </label>
              <input
                id="sku-input"
                type="text"
                value={skuValue}
                onChange={(e) => setSkuValue(e.target.value)}
                placeholder="e.g., PILLOW-001, CHAIR-RED"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                disabled={isProcessing}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSkuDialog(false)
                  setSkuValue('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleSetSku}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Setting...' : 'Set SKU'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {canDelete && showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Confirm Delete</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-700">
                Are you sure you want to delete {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}? This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Deleting...' : deleteButtonLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
