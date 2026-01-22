import { Item } from '@/types'
import type { ItemDisposition } from '@/types'
import ItemPreviewCard, { type ItemPreviewData } from './ItemPreviewCard'
import { useTransactionDisplayInfo } from '@/hooks/useTransactionDisplayInfo'
import { useAccount } from '@/contexts/AccountContext'

interface InventoryItemRowProps {
  item: Item
  isSelected: boolean
  onSelect: (itemId: string, checked: boolean) => void
  onBookmark: (itemId: string) => void
  onDuplicate: (itemId: string, quantity?: number) => void
  onEdit: (href: string) => void
  onAddToTransaction?: (itemId: string) => void
  onSellToBusiness?: (itemId: string) => void
  onSellToProject?: (itemId: string) => void
  onMoveToBusiness?: (itemId: string) => void
  onMoveToProject?: (itemId: string) => void
  onChangeStatus?: (itemId: string, disposition: ItemDisposition) => void
  onDelete?: (itemId: string) => void
  onAddImage: (itemId: string) => void
  uploadingImages: Set<string>
  context: 'project' | 'businessInventory'
  projectId?: string // Required for project context
  itemNumber: number
  duplicateCount?: number
  duplicateIndex?: number
}

export default function InventoryItemRow({
  item,
  isSelected,
  onSelect,
  onBookmark,
  onDuplicate,
  onEdit,
  onAddToTransaction,
  onSellToBusiness,
  onSellToProject,
  onMoveToBusiness,
  onMoveToProject,
  onChangeStatus,
  onDelete,
  onAddImage,
  uploadingImages,
  context,
  projectId,
  itemNumber,
  duplicateCount,
  duplicateIndex
}: InventoryItemRowProps) {
  const { currentAccountId } = useAccount()
  const { displayInfo: transactionDisplayInfo, route: transactionRoute, isLoading: isLoadingTransaction } = useTransactionDisplayInfo(
    currentAccountId,
    item.transactionId,
    projectId
  )

  // Determine the link destination based on context
  const getItemLink = () => {
    if (context === 'project' && projectId) {
      return `/item/${item.itemId}?project=${projectId}`
    } else if (context === 'businessInventory') {
      return `/business-inventory/${item.itemId}`
    }
    return `/item/${item.itemId}`
  }

  // Determine the edit link based on context
  const getEditLink = () => {
    if (context === 'project' && projectId) {
      return `/project/${projectId}/items/${item.itemId}/edit`
    } else if (context === 'businessInventory') {
      return `/business-inventory/${item.itemId}/edit`
    }
    return `/item/${item.itemId}/edit`
  }

  // Convert Item to ItemPreviewData
  const previewData: ItemPreviewData = {
    itemId: item.itemId,
    description: item.description,
    sku: item.sku,
    purchasePrice: item.purchasePrice,
    projectPrice: item.projectPrice,
    marketValue: item.marketValue,
    disposition: item.disposition,
    images: item.images,
    projectId: item.projectId ?? null,
    transactionId: item.transactionId,
    source: item.source,
    space: item.space,
    businessInventoryLocation: item.businessInventoryLocation,
    bookmark: item.bookmark
  }

  return (
    <li className="relative bg-white">
      <ItemPreviewCard
        item={previewData}
        isSelected={isSelected}
        onSelect={onSelect}
        showCheckbox={true}
        onBookmark={onBookmark}
        onDuplicate={onDuplicate}
        onEdit={onEdit}
        onAddToTransaction={onAddToTransaction}
        onSellToBusiness={onSellToBusiness}
        onSellToProject={onSellToProject}
        onMoveToBusiness={onMoveToBusiness}
        onMoveToProject={onMoveToProject}
        onChangeStatus={onChangeStatus}
        onDelete={onDelete}
        onAddImage={onAddImage}
        uploadingImages={uploadingImages}
        itemLink={getItemLink()}
        editLink={getEditLink()}
        context={context}
        projectId={projectId}
        duplicateCount={duplicateCount}
        duplicateIndex={duplicateIndex}
        itemNumber={itemNumber}
        transactionDisplayInfo={transactionDisplayInfo}
        transactionRoute={transactionRoute}
        isLoadingTransaction={isLoadingTransaction}
      />
    </li>
  )
}