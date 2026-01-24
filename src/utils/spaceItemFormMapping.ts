import type { Item, TransactionItemFormData } from '@/types'

export function mapItemToTransactionItemFormData(
  item: Item,
  options?: { spaceName?: string }
): TransactionItemFormData {
  return {
    id: item.itemId,
    transactionId: item.transactionId ?? undefined,
    description: item.description ?? '',
    sku: item.sku ?? '',
    price: item.price ?? undefined,
    purchasePrice: item.purchasePrice ?? undefined,
    projectPrice: item.projectPrice ?? undefined,
    marketValue: item.marketValue ?? undefined,
    space: item.space ?? options?.spaceName ?? undefined,
    notes: item.notes ?? undefined,
    disposition: item.disposition ?? undefined,
    taxAmountPurchasePrice: item.taxAmountPurchasePrice ?? undefined,
    taxAmountProjectPrice: item.taxAmountProjectPrice ?? undefined,
    images: item.images ?? undefined
  }
}

export function mapTransactionItemFormDataToItemUpdate(item: TransactionItemFormData): Partial<Item> {
  return {
    description: item.description,
    sku: item.sku || '',
    purchasePrice: item.purchasePrice || '',
    projectPrice: item.projectPrice || '',
    marketValue: item.marketValue || '',
    notes: item.notes || '',
    space: item.space || '',
    disposition: item.disposition ?? null,
    taxAmountPurchasePrice: item.taxAmountPurchasePrice,
    taxAmountProjectPrice: item.taxAmountProjectPrice
  }
}
