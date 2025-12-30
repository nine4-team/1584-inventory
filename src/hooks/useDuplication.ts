import { useCallback } from 'react'
import { useToast } from '@/components/ui/ToastContext'

interface UseDuplicationOptions<T extends { itemId: string }> {
  items: T[]
  setItems?: (items: T[] | ((prev: T[]) => T[])) => void
  projectId?: string | undefined
  accountId?: string | undefined
  duplicationService?: (itemId: string) => Promise<string>
}

// Track in-flight duplication operations across all hook instances
const inFlightDuplications = new Set<string>()

export function useDuplication<T extends { itemId: string }>({
  items,
  setItems: _setItems,
  projectId,
  accountId,
  duplicationService
}: UseDuplicationOptions<T>) {
  const { showSuccess, showError } = useToast()

  const duplicateItem = useCallback(async (itemId: string) => {
    // Prevent concurrent duplication of the same item
    if (inFlightDuplications.has(itemId)) {
      console.log('Duplication already in progress for item:', itemId)
      return
    }

    try {
      // Mark this item as being duplicated
      inFlightDuplications.add(itemId)

      const item = items.find(item => item.itemId === itemId)
      if (!item) {
        showError('Item not found')
        return
      }

      let newItemId: string

      if (duplicationService) {
        // Use custom duplication service (e.g., for business inventory)
        newItemId = await duplicationService(itemId)
      } else if (projectId && accountId) {
        // Use default project item duplication service (unified collection)
        const { unifiedItemsService } = await import('@/services/inventoryService')
        newItemId = await unifiedItemsService.duplicateItem(accountId, projectId, itemId)
      } else {
        console.error('No duplication service available:', {
          itemId,
          hasCustomDuplicationService: Boolean(duplicationService),
          projectId,
          accountId
        })
        showError('No duplication service available')
        return
      }

      // The real-time listener will handle the UI update, but we'll show a success message
      showSuccess(`Item duplicated successfully! New item ID: ${newItemId}`)

      // Note: We don't need to manually update local state here because
      // the real-time listener in the parent component will handle it
    } catch (error) {
      console.error('Failed to duplicate item:', error)
      showError('Failed to duplicate item. Please try again.')
    } finally {
      // Remove from in-flight set when done (success or error)
      inFlightDuplications.delete(itemId)
    }
  }, [items, projectId, accountId, duplicationService, showSuccess, showError])

  return { duplicateItem }
}
