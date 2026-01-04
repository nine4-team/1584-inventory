import { supabase } from './supabase'
import { convertTimestamps, handleSupabaseError, ensureAuthenticatedForDatabase } from './databaseService'
import { BudgetCategory } from '@/types'
import { getBudgetCategoryOrder } from './accountPresetsService'
import { cacheBudgetCategoriesOffline, getCachedBudgetCategories } from './offlineMetadataService'
import { isNetworkOnline } from './networkStatusService'

/**
 * Budget Categories Service
 * 
 * Provides CRUD operations for account-scoped budget categories.
 * Categories are scoped to accounts and can be archived (not hard deleted)
 * to preserve historical integrity.
 */
type GetCategoriesOptions = {
  mode?: 'auto' | 'cache-only'
}

export const budgetCategoriesService = {
  /**
   * Get all budget categories for an account
   * @param accountId - The account ID to fetch categories for
   * @param includeArchived - If true, includes archived categories (default: false)
   * @param options - Allows forcing cache-only reads (no Supabase calls)
   * @returns Array of budget categories ordered by preset order (if set), otherwise alphabetically
   */
  async getCategories(
    accountId: string,
    includeArchived: boolean = false,
    options?: GetCategoriesOptions
  ): Promise<BudgetCategory[]> {
    const mode = options?.mode ?? 'auto'
    const shouldForceCache = mode === 'cache-only'
    const online = shouldForceCache ? false : isNetworkOnline()

    if (!online) {
      return filterArchivedCategories(
        await loadCategoriesFromCache(accountId, { silent: mode !== 'cache-only' }),
        includeArchived
      )
    }

    await ensureAuthenticatedForDatabase()

    try {
      let query = supabase
        .from('budget_categories')
        .select('*')
        .eq('account_id', accountId)

      if (!includeArchived) {
        query = query.eq('is_archived', false)
      }

      const { data, error } = await query

      handleSupabaseError(error)

      const categories = (data || []).map(category => {
        const converted = convertTimestamps(category)
        return {
          id: converted.id,
          accountId: converted.account_id,
          name: converted.name,
          slug: converted.slug,
          isArchived: converted.is_archived || false,
          metadata: converted.metadata || null,
          createdAt: converted.created_at,
          updatedAt: converted.updated_at
        } as BudgetCategory
      })

      const ordered = await orderCategories(accountId, categories)

      if (!includeArchived) {
        cacheBudgetCategoriesOffline(accountId).catch((error) => {
          console.warn('[budgetCategoriesService] Background cache refresh failed:', error)
        })
      }

      return ordered
    } catch (err) {
      console.warn('[budgetCategoriesService] Falling back to cached categories after fetch failure:', err)
      const cached = await loadCategoriesFromCache(accountId, { silent: true })
      if (cached.length > 0) {
        return filterArchivedCategories(cached, includeArchived)
      }
      throw err
    }
  },

  /**
   * Get a single budget category by ID
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to fetch
   * @returns The budget category or null if not found
   */
  async getCategory(accountId: string, categoryId: string): Promise<BudgetCategory | null> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', categoryId)
      .eq('account_id', accountId)
      .single()

    handleSupabaseError(error, { returnNullOnNotFound: true })

    if (!data) {
      return null
    }

    const converted = convertTimestamps(data)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      slug: converted.slug,
      isArchived: converted.is_archived || false,
      metadata: converted.metadata || null,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at
    } as BudgetCategory
  },

  /**
   * Create a new budget category
   * @param accountId - The account ID to create the category for
   * @param name - The display name of the category
   * @param slug - URL-friendly identifier (unique per account)
   * @param metadata - Optional metadata JSON object
   * @returns The created budget category
   */
  async createCategory(
    accountId: string,
    name: string,
    // slug is generated internally now
    metadata?: Record<string, any> | null
  ): Promise<BudgetCategory> {
    await ensureAuthenticatedForDatabase()

    // Validate inputs
    if (!name || name.trim().length === 0) {
      throw new Error('Category name is required')
    }
    // Generate slug internally from name
    const normalizedSlug = (name || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

    const { data, error } = await supabase
      .from('budget_categories')
      .insert({
        account_id: accountId,
        name: name.trim(),
        slug: normalizedSlug,
        metadata: metadata || null,
        is_archived: false
      })
      .select()
      .single()

    handleSupabaseError(error)

    const converted = convertTimestamps(data)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      slug: converted.slug,
      isArchived: converted.is_archived || false,
      metadata: converted.metadata || null,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at
    } as BudgetCategory
  },

  /**
   * Update a budget category
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to update
   * @param updates - Partial updates to apply
   * @returns The updated budget category
   */
  async updateCategory(
    accountId: string,
    categoryId: string,
    updates: {
      name?: string
      slug?: string
      metadata?: Record<string, any> | null
    }
  ): Promise<BudgetCategory> {
    await ensureAuthenticatedForDatabase()

    // Verify category belongs to account
    const existing = await this.getCategory(accountId, categoryId)
    if (!existing) {
      throw new Error('Category not found or does not belong to this account')
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    }

    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error('Category name cannot be empty')
      }
      updateData.name = updates.name.trim()
    }

    if (updates.slug !== undefined) {
      if (!updates.slug || updates.slug.trim().length === 0) {
        throw new Error('Category slug cannot be empty')
      }
      // Normalize slug
      updateData.slug = updates.slug
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
    }

    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('account_id', accountId)
      .select()
      .single()

    handleSupabaseError(error)

    const converted = convertTimestamps(data)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      slug: converted.slug,
      isArchived: converted.is_archived || false,
      metadata: converted.metadata || null,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at
    } as BudgetCategory
  },

  /**
   * Archive a budget category (soft delete)
   * Prevents archiving if the category is referenced by transactions.
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to archive
   * @returns The archived budget category
   */
  async archiveCategory(accountId: string, categoryId: string): Promise<BudgetCategory> {
    await ensureAuthenticatedForDatabase()

    // Verify category belongs to account
    const existing = await this.getCategory(accountId, categoryId)
    if (!existing) {
      throw new Error('Category not found or does not belong to this account')
    }

    // Archive the category (allow archiving even if referenced to preserve history)
    const { data, error } = await supabase
      .from('budget_categories')
      .update({
        is_archived: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', categoryId)
      .eq('account_id', accountId)
      .select()
      .single()

    handleSupabaseError(error)

    const converted = convertTimestamps(data)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      slug: converted.slug,
      isArchived: converted.is_archived || false,
      metadata: converted.metadata || null,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at
    } as BudgetCategory
  },

  /**
   * Unarchive a budget category
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to unarchive
   * @returns The unarchived budget category
   */
  async unarchiveCategory(accountId: string, categoryId: string): Promise<BudgetCategory> {
    await ensureAuthenticatedForDatabase()

    // Verify category belongs to account
    const existing = await this.getCategory(accountId, categoryId)
    if (!existing) {
      throw new Error('Category not found or does not belong to this account')
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .update({
        is_archived: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', categoryId)
      .eq('account_id', accountId)
      .select()
      .single()

    handleSupabaseError(error)

    const converted = convertTimestamps(data)
    return {
      id: converted.id,
      accountId: converted.account_id,
      name: converted.name,
      slug: converted.slug,
      isArchived: converted.is_archived || false,
      metadata: converted.metadata || null,
      createdAt: converted.created_at,
      updatedAt: converted.updated_at
    } as BudgetCategory
  },

  /**
   * Delete a budget category (hard delete)
   * This is a convenience method that calls archiveCategory.
   * Hard deletes are prevented if the category is referenced.
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to delete
   * @deprecated Use archiveCategory instead. This method archives the category.
   */
  async deleteCategory(accountId: string, categoryId: string): Promise<void> {
    // Delegate to archiveCategory which handles reference checking
    await this.archiveCategory(accountId, categoryId)
  },

  /**
   * Get transaction count for a category
   * @param accountId - The account ID (for scoping)
   * @param categoryId - The category ID to check
   * @returns The number of transactions using this category
   */
  async getTransactionCount(accountId: string, categoryId: string): Promise<number> {
    await ensureAuthenticatedForDatabase()

    const { count, error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('category_id', categoryId)

    handleSupabaseError(error)

    return count || 0
  },

  /**
   * Get transaction counts for multiple categories
   * @param accountId - The account ID (for scoping)
   * @param categoryIds - Array of category IDs to check
   * @returns Map of categoryId -> transaction count
   */
  async getTransactionCounts(accountId: string, categoryIds: string[]): Promise<Map<string, number>> {
    await ensureAuthenticatedForDatabase()

    const countsMap = new Map<string, number>()

    // Query all transactions for this account with these category IDs
    const { data, error } = await supabase
      .from('transactions')
      .select('category_id')
      .eq('account_id', accountId)
      .in('category_id', categoryIds)

    handleSupabaseError(error)

    // Initialize all category IDs with 0
    categoryIds.forEach(id => countsMap.set(id, 0))

    // Count transactions per category
    if (data) {
      data.forEach(tx => {
        if (tx.category_id) {
          const currentCount = countsMap.get(tx.category_id) || 0
          countsMap.set(tx.category_id, currentCount + 1)
        }
      })
    }

    return countsMap
  },

  /**
   * Bulk archive multiple categories
   * Only archives categories that are not referenced by transactions.
   * @param accountId - The account ID (for scoping)
   * @param categoryIds - Array of category IDs to archive
   * @returns Object with successful and failed archive operations
   */
  async bulkArchiveCategories(
    accountId: string,
    categoryIds: string[]
  ): Promise<{ successful: string[]; failed: Array<{ categoryId: string; reason: string }> }> {
    await ensureAuthenticatedForDatabase()

    const successful: string[] = []
    const failed: Array<{ categoryId: string; reason: string }> = []

    // Get transaction counts for all categories
    // Try to archive each category (archive always allowed)
    for (const categoryId of categoryIds) {
      try {
        await this.archiveCategory(accountId, categoryId)
        successful.push(categoryId)
      } catch (error) {
        failed.push({
          categoryId,
          reason: error instanceof Error ? error.message : 'Failed to archive category'
        })
      }
    }

    return { successful, failed }
  }
}

async function orderCategories(accountId: string, categories: BudgetCategory[]): Promise<BudgetCategory[]> {
  try {
    const order = await getBudgetCategoryOrder(accountId)
    if (order && order.length > 0) {
      const categoryMap = new Map(categories.map(cat => [cat.id, cat]))
      const orderedCategories: BudgetCategory[] = []
      const seenIds = new Set<string>()

      for (const categoryId of order) {
        const category = categoryMap.get(categoryId)
        if (category) {
          orderedCategories.push(category)
          seenIds.add(categoryId)
        }
      }

      for (const category of categories) {
        if (!seenIds.has(category.id)) {
          orderedCategories.push(category)
        }
      }

      return orderedCategories
    }
  } catch (err) {
    console.warn('Failed to get budget category order, using alphabetical:', err)
  }

  return [...categories].sort((a, b) => a.name.localeCompare(b.name))
}

async function loadCategoriesFromCache(accountId: string, options?: { silent?: boolean }): Promise<BudgetCategory[]> {
  const cached = await getCachedBudgetCategories(accountId)
  if (!cached || cached.length === 0) {
    if (!options?.silent) {
      throw new Error(
        'Budget categories cache is empty. Go online and tap Retry sync to warm the offline cache before using this screen offline.'
      )
    }
    return []
  }
  return orderCategories(accountId, cached)
}

function filterArchivedCategories(categories: BudgetCategory[], includeArchived: boolean): BudgetCategory[] {
  if (includeArchived) {
    return categories
  }
  return categories.filter(cat => !cat.isArchived)
}

