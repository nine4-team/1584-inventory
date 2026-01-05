import type { QueryClient } from '@tanstack/react-query'
import type { Transaction, Item } from '@/types'

export function removeTransactionFromCaches(
  queryClient: QueryClient,
  accountId: string,
  transactionId: string,
  projectId?: string | null
): void {
  queryClient.removeQueries({ queryKey: ['transaction', accountId, transactionId], exact: true })
  queryClient.removeQueries({ queryKey: ['transaction-items', accountId, transactionId], exact: true })

  queryClient.setQueryData(['transactions', accountId], (old: Transaction[] | undefined) => {
    if (!old) return old
    return old.filter(tx => tx.transactionId !== transactionId)
  })

  if (projectId) {
    queryClient.setQueryData(['project-transactions', accountId, projectId], (old: Transaction[] | undefined) => {
      if (!old) return old
      return old.filter(tx => tx.transactionId !== transactionId)
    })
  }
}

export function removeItemFromCaches(
  queryClient: QueryClient,
  accountId: string,
  itemId: string,
  options?: { projectId?: string | null; transactionId?: string | null }
): void {
  queryClient.removeQueries({ queryKey: ['item', accountId, itemId], exact: true })

  if (options?.projectId) {
    queryClient.setQueryData(['project-items', accountId, options.projectId], (old: Item[] | undefined) => {
      if (!old) return old
      return old.filter(item => item.itemId !== itemId)
    })
  } else {
    queryClient.setQueryData(['business-inventory', accountId], (old: Item[] | undefined) => {
      if (!old) return old
      return old.filter(item => item.itemId !== itemId)
    })
  }

  if (options?.transactionId) {
    queryClient.setQueryData(['transaction-items', accountId, options.transactionId], (old: Item[] | undefined) => {
      if (!old) return old
      return old.filter(item => item.itemId !== itemId)
    })
  }
}
