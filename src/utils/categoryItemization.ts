import { BudgetCategory } from '@/types'

/**
 * Get whether itemization is enabled for a category
 * Defaults to true if metadata is missing (backward compatible)
 */
export function getItemizationEnabled(category: BudgetCategory | null | undefined): boolean {
  if (!category || !category.metadata || category.metadata.itemizationEnabled === undefined) {
    return true // Default to enabled for backward compatibility
  }
  return category.metadata.itemizationEnabled === true
}
