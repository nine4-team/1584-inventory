import type { FilterOptions, Item, Transaction } from '@/types'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'

export const mergeBusinessInventoryTransactions = (primary: Transaction[], secondary: Transaction[]) => {
  const allTransactions = [...primary, ...secondary]
  const uniqueTransactions = allTransactions.filter((transaction, index, self) =>
    index === self.findIndex(t => t.transactionId === transaction.transactionId)
  )
  uniqueTransactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return uniqueTransactions
}

export type BusinessInventoryRefreshResult = {
  items: Item[]
  transactions: Transaction[]
  businessInventoryTransactions: Transaction[]
  inventoryRelatedTransactions: Transaction[]
}

export const refreshBusinessInventoryRealtimeSnapshot = async (
  accountId: string,
  filters?: FilterOptions
): Promise<BusinessInventoryRefreshResult> => {
  const [inventoryData, businessInventoryTransactions, inventoryRelatedTransactions] = await Promise.all([
    unifiedItemsService.getBusinessInventoryItems(accountId, filters),
    transactionService.getBusinessInventoryTransactions(accountId),
    transactionService.getInventoryRelatedTransactions(accountId)
  ])

  const uniqueTransactions = mergeBusinessInventoryTransactions(
    businessInventoryTransactions,
    inventoryRelatedTransactions
  )

  unifiedItemsService.seedBusinessInventoryItemsRealtimeSnapshot(accountId, inventoryData)
  transactionService.seedBusinessInventoryTransactionsRealtimeSnapshot(accountId, businessInventoryTransactions)

  return {
    items: inventoryData,
    transactions: uniqueTransactions,
    businessInventoryTransactions,
    inventoryRelatedTransactions
  }
}
