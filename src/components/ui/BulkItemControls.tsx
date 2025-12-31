import { useState, useEffect } from 'react'
import { Receipt, MapPin, Tag, Trash2, X } from 'lucide-react'
import { Transaction } from '@/types'
import { transactionService } from '@/services/inventoryService'
import { DISPOSITION_OPTIONS, displayDispositionLabel } from '@/utils/dispositionUtils'
import type { ItemDisposition } from '@/types'
import { useAccount } from '@/contexts/AccountContext'

interface BulkItemControlsProps {
  selectedItemIds: Set<string>
  projectId: string
  onAssignToTransaction: (transactionId: string) => Promise<void>
  onSetLocation: (location: string) => Promise<void>
  onSetDisposition: (disposition: ItemDisposition) => Promise<void>
  onDelete: () => Promise<void>
  onClearSelection: () => void
  itemListContainerWidth?: number
}

export default function BulkItemControls({
  selectedItemIds,
  projectId,
  onAssignToTransaction,
  onSetLocation,
  onSetDisposition,
  onDelete,
  onClearSelection,
  itemListContainerWidth
}: BulkItemControlsProps) {
  const { currentAccountId } = useAccount()
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [showLocationDialog, setShowLocationDialog] = useState(false)
  const [showDispositionDialog, setShowDispositionDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [locationValue, setLocationValue] = useState('')
  const [selectedDisposition, setSelectedDisposition] = useState<ItemDisposition | ''>('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Load transactions when dialog opens
  useEffect(() => {
    if (showTransactionDialog && currentAccountId && transactions.length === 0) {
      loadTransactions()
    }
  }, [showTransactionDialog, currentAccountId])

  const loadTransactions = async () => {
    if (!currentAccountId) return
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
      return 'Company Inventory Sale'
    }
    if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      return 'Company Inventory Purchase'
    }
    return transaction.source
  }

  const handleAssignToTransaction = async () => {
    if (!selectedTransactionId) return
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

  const handleSetLocation = async () => {
    setIsProcessing(true)
    try {
      await onSetLocation(locationValue)
      setShowLocationDialog(false)
      setLocationValue('')
      onClearSelection()
    } catch (error) {
      console.error('Failed to set location:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSetDisposition = async () => {
    if (!selectedDisposition) return
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

  const handleDelete = async () => {
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

  return (
    <>
      {/* Sticky Bulk Controls Container */}
      <div
        className="fixed bottom-0 z-50 bg-white border-t border-gray-200 shadow-lg"
        style={{
          width: itemListContainerWidth ? `${itemListContainerWidth}px` : '100%',
          left: itemListContainerWidth ? '50%' : '0',
          transform: itemListContainerWidth ? `translateX(-50%)` : 'none',
          maxWidth: '100%'
        }}
      >
        <div className="px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
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

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* Assign to Transaction */}
            <button
              onClick={() => setShowTransactionDialog(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Receipt className="h-4 w-4" />
              Assign to Transaction
            </button>

            {/* Set Location */}
            <button
              onClick={() => setShowLocationDialog(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <MapPin className="h-4 w-4" />
              Set Location
            </button>

            {/* Set Disposition */}
            <button
              onClick={() => setShowDispositionDialog(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Tag className="h-4 w-4" />
              Set Disposition
            </button>

            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-md hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Selection Dialog */}
      {showTransactionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Assign {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} to Transaction
              </h3>
            </div>
            <div className="px-6 py-4">
              <label htmlFor="transaction-select" className="block text-sm font-medium text-gray-700 mb-2">
                Select Transaction
              </label>
              <select
                id="transaction-select"
                value={selectedTransactionId}
                onChange={(e) => setSelectedTransactionId(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                disabled={loadingTransactions || isProcessing}
              >
                <option value="">Select a transaction</option>
                {loadingTransactions ? (
                  <option disabled>Loading transactions...</option>
                ) : (
                  transactions.map((transaction) => (
                    <option key={transaction.transactionId} value={transaction.transactionId}>
                      {new Date(transaction.transactionDate).toLocaleDateString()} - {getCanonicalTransactionTitle(transaction)} - ${transaction.amount}
                    </option>
                  ))
                )}
              </select>
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

      {/* Location Input Dialog */}
      {showLocationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set Location for {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="px-6 py-4">
              <label htmlFor="location-input" className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <input
                id="location-input"
                type="text"
                value={locationValue}
                onChange={(e) => setLocationValue(e.target.value)}
                placeholder="e.g., Living Room, Master Bedroom, Kitchen"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                disabled={isProcessing}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowLocationDialog(false)
                  setLocationValue('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleSetLocation}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Setting...' : 'Set Location'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disposition Selection Dialog */}
      {showDispositionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Set Disposition for {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="px-6 py-4">
              <label htmlFor="disposition-select" className="block text-sm font-medium text-gray-700 mb-2">
                Disposition
              </label>
              <select
                id="disposition-select"
                value={selectedDisposition}
                onChange={(e) => setSelectedDisposition(e.target.value as ItemDisposition | '')}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                disabled={isProcessing}
              >
                <option value="">Select a disposition</option>
                {DISPOSITION_OPTIONS.map((disposition) => (
                  <option key={disposition} value={disposition}>
                    {displayDispositionLabel(disposition)}
                  </option>
                ))}
              </select>
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

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
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
                {isProcessing ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
