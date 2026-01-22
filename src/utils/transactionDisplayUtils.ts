import { transactionService } from '@/services/inventoryService'
import { Transaction } from '@/types'
import { projectTransactionDetail } from './routes'

/**
 * Gets transaction display information including title and date
 * @param accountId - The account ID
 * @param transactionId - The transaction ID
 * @param maxLength - Maximum length of the display text (default: 25)
 * @returns Promise<{title: string, date: string} | null> - The display info or null if transaction not found
 */
export async function getTransactionDisplayInfo(
  accountId: string,
  transactionId: string | null | undefined,
  maxLength: number = 25
): Promise<{title: string, amount: string} | null> {
  if (!transactionId || !accountId) {
    return null
  }

  try {
    const { transaction } = await transactionService.getTransactionById(accountId, transactionId)

    if (!transaction) {
      return null
    }

    // Use the same logic as getCanonicalTransactionTitle
    let title: string
    if (transaction.transactionId?.startsWith('INV_SALE_')) {
      title = 'Design Business Inventory Sale'
    } else if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
      title = 'Design Business Inventory Purchase'
    } else {
      title = transaction.source
    }

    // Truncate if too long
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + '...'
    }

    // Format amount as currency with commas
    const amount = `$${parseFloat(transaction.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    return { title, amount }
  } catch (error) {
    console.error('Failed to get transaction display info:', error)
    return null
  }
}

/**
 * Gets a truncated display text for a transaction based on transactionId (legacy function)
 * @param accountId - The account ID
 * @param transactionId - The transaction ID
 * @param maxLength - Maximum length of the display text (default: 25)
 * @returns Promise<string | null> - The display text or null if transaction not found
 */
export async function getTransactionDisplayText(
  accountId: string,
  transactionId: string | null | undefined,
  maxLength: number = 25
): Promise<string | null> {
  const info = await getTransactionDisplayInfo(accountId, transactionId, maxLength)
  return info ? info.title : null
}

/**
 * Gets the transaction route path and project ID for navigation
 * @param transactionId - The transaction ID
 * @param accountId - The account ID
 * @param projectId - The project ID (if already known)
 * @returns Promise<{path: string, projectId: string | null}> - The route path and resolved project ID
 */
export async function getTransactionRoute(
  transactionId: string | null | undefined,
  accountId: string,
  projectId?: string | null
): Promise<{path: string, projectId: string | null}> {
  if (!transactionId || !accountId) {
    return { path: '', projectId: null }
  }

  // If we have a projectId, use the project transaction route
  if (projectId) {
    return {
      path: projectTransactionDetail(projectId, transactionId),
      projectId
    }
  }

  // Otherwise, try to get the project ID for the transaction
  try {
    const { projectId: resolvedProjectId } = await transactionService.getTransactionById(accountId, transactionId)
    if (resolvedProjectId) {
      return {
        path: projectTransactionDetail(resolvedProjectId, transactionId),
        projectId: resolvedProjectId
      }
    }
  } catch (error) {
    console.error('Failed to resolve project ID for transaction:', error)
  }

  // Fallback - transaction not found or no project
  return { path: '/projects', projectId: null }
}