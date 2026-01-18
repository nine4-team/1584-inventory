import { useCallback } from 'react'
import { useToast } from '@/components/ui/ToastContext'

interface UseDuplicationOptions<T extends { itemId: string }> {
  items: T[]
  setItems?: (items: T[] | ((prev: T[]) => T[])) => void
  projectId?: string | undefined
  accountId?: string | undefined
  duplicationService?: (itemId: string) => Promise<string>
  onDuplicateComplete?: (newItemIds: string[]) => void | Promise<void>
}

// Track in-flight duplication operations across all hook instances
const inFlightDuplications = new Set<string>()

export function useDuplication<T extends { itemId: string }>({
  items,
  setItems: _setItems,
  projectId,
  accountId,
  duplicationService,
  onDuplicateComplete
}: UseDuplicationOptions<T>) {
  const { showSuccess, showError } = useToast()

  const duplicateItem = useCallback(async (itemId: string, quantity = 1) => {
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

      const duplicateCount = Math.max(0, Math.floor(quantity))
      const newItemIds: string[] = []

      if (duplicateCount === 0) {
        showError('Enter a quantity greater than 0.')
        return
      }

      let defaultService: ((accountId: string, projectId: string, itemId: string) => Promise<string>) | null = null
      if (!duplicationService && projectId && accountId) {
        const { unifiedItemsService } = await import('@/services/inventoryService')
        defaultService = (accountIdArg, projectIdArg, itemIdArg) =>
          unifiedItemsService.duplicateItem(accountIdArg, projectIdArg, itemIdArg)
      }

      if (!duplicationService && !defaultService) {
        console.error('No duplication service available:', {
          itemId,
          hasCustomDuplicationService: Boolean(duplicationService),
          projectId,
          accountId
        })
        showError('No duplication service available')
        return
      }

      for (let i = 0; i < duplicateCount; i += 1) {
        if (duplicationService) {
          // Use custom duplication service (e.g., for business inventory)
          const newItemId = await duplicationService(itemId)
          newItemIds.push(newItemId)
        } else if (defaultService && projectId && accountId) {
          // Use default project item duplication service (unified collection)
          const newItemId = await defaultService(accountId, projectId, itemId)
          newItemIds.push(newItemId)
        }
      }

      // The real-time listener will handle the UI update, but we'll show a success message
      if (duplicateCount === 1) {
        showSuccess('Item duplicated successfully!')
      } else {
        showSuccess(`Duplicated ${duplicateCount} items successfully!`)
      }

      if (onDuplicateComplete) {
        await onDuplicateComplete(newItemIds)
      }
    } catch (error) {
      console.error('Failed to duplicate item:', error)
      showError('Failed to duplicate item. Please try again.')
    } finally {
      // Remove from in-flight set when done (success or error)
      inFlightDuplications.delete(itemId)
    }
  }, [items, projectId, accountId, duplicationService, onDuplicateComplete, showSuccess, showError])

  return { duplicateItem }
}
