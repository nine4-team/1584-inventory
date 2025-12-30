import type { TransactionItemFormData } from '@/types'

export type DisplayTransactionItem = TransactionItemFormData & {
  _latestTransactionId?: string | null
  _transactionId?: string | null
  _projectId?: string | null
  _previousProjectTransactionId?: string | null
  _hasMovedOut: boolean
}

const isTransitionallyMovedOut = (item: DisplayTransactionItem, transactionId?: string | null) => {
  if (!transactionId) return false

  return !item._latestTransactionId &&
    item._projectId == null &&
    item._previousProjectTransactionId === transactionId
}

export const splitItemsByMovement = (items: DisplayTransactionItem[], transactionId?: string | null) => {
  if (!transactionId) {
    return {
      inTransaction: [...items],
      movedOut: [] as DisplayTransactionItem[]
    }
  }

  return items.reduce(
    (acc, item) => {
      const hasLatestTransaction = Boolean(item._latestTransactionId)
      const explicitMoved = Boolean(item._hasMovedOut)
      const transactionMismatch = hasLatestTransaction && item._latestTransactionId !== transactionId
      const transitionalMovedOut = isTransitionallyMovedOut(item, transactionId)
      const isMoved = explicitMoved || transactionMismatch || transitionalMovedOut


      if (isMoved) {
        acc.movedOut.push(item)
      } else {
        acc.inTransaction.push(item)
      }

      return acc
    },
    {
      inTransaction: [] as DisplayTransactionItem[],
      movedOut: [] as DisplayTransactionItem[]
    }
  )
}
