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
        .from('vw_budget_categories')
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
        cacheBudgetCategoriesOffline(accountId, { categories: ordered }).catch((error) => {
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
      .from('vw_budget_categories')
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

    // Call RPC function to create category
    const { data, error } = await supabase.rpc('rpc_upsert_budget_category', {
      p_account_id: accountId,
      p_category_id: null,
      p_name: name.trim(),
      p_slug: null, // Let RPC generate slug
      p_metadata: metadata || null,
      p_is_archived: false
    })

    handleSupabaseError(error)

    if (!data) {
      throw new Error('Failed to create category: no data returned')
    }

    // RPC returns JSONB, convert to BudgetCategory
    const category = data as any
    return {
      id: category.id,
      accountId: category.account_id,
      name: category.name,
      slug: category.slug,
      isArchived: category.is_archived || false,
      metadata: category.metadata || null,
      createdAt: new Date(category.created_at),
      updatedAt: new Date(category.updated_at)
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

    // Validate name if provided
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error('Category name cannot be empty')
      }
    }

    // Normalize slug if provided
    let normalizedSlug: string | null = null
    if (updates.slug !== undefined) {
      if (!updates.slug || updates.slug.trim().length === 0) {
        throw new Error('Category slug cannot be empty')
      }
      normalizedSlug = updates.slug
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
    }

    // Call RPC function to update category
    const { data, error } = await supabase.rpc('rpc_upsert_budget_category', {
      p_account_id: accountId,
      p_category_id: categoryId,
      p_name: updates.name !== undefined ? updates.name.trim() : existing.name,
      p_slug: normalizedSlug,
      p_metadata: updates.metadata !== undefined ? updates.metadata : existing.metadata,
      p_is_archived: existing.isArchived
    })

    handleSupabaseError(error)

    if (!data) {
      throw new Error('Failed to update category: no data returned')
    }

    // RPC returns JSONB, convert to BudgetCategory
    const category = data as any
    return {
      id: category.id,
      accountId: category.account_id,
      name: category.name,
      slug: category.slug,
      isArchived: category.is_archived || false,
      metadata: category.metadata || null,
      createdAt: new Date(category.created_at),
      updatedAt: new Date(category.updated_at)
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

    // Call RPC function to archive category
    const { data, error } = await supabase.rpc('rpc_archive_budget_category', {
      p_account_id: accountId,
      p_category_id: categoryId,
      p_is_archived: true
    })

    handleSupabaseError(error)

    if (!data) {
      throw new Error('Failed to archive category: no data returned')
    }

    // RPC returns JSONB, convert to BudgetCategory
    const category = data as any
    return {
      id: category.id,
      accountId: category.account_id,
      name: category.name,
      slug: category.slug,
      isArchived: category.is_archived || false,
      metadata: category.metadata || null,
      createdAt: new Date(category.created_at),
      updatedAt: new Date(category.updated_at)
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

    // Call RPC function to unarchive category
    const { data, error } = await supabase.rpc('rpc_archive_budget_category', {
      p_account_id: accountId,
      p_category_id: categoryId,
      p_is_archived: false
    })

    handleSupabaseError(error)

    if (!data) {
      throw new Error('Failed to unarchive category: no data returned')
    }

    // RPC returns JSONB, convert to BudgetCategory
    const category = data as any
    return {
      id: category.id,
      accountId: category.account_id,
      name: category.name,
      slug: category.slug,
      isArchived: category.is_archived || false,
      metadata: category.metadata || null,
      createdAt: new Date(category.created_at),
      updatedAt: new Date(category.updated_at)
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
  },

  /**
   * Ensure default budget categories exist for an account
   * Creates the four required default categories if they don't exist:
   * - Furnishings
   * - Install
   * - Design Fee
   * - Storage & Receiving
   * This function is idempotent and safe to call multiple times.
   * @param accountId - The account ID to ensure defaults for
   * @returns Promise that resolves when defaults are ensured
   */
  async ensureDefaultBudgetCategories(accountId: string): Promise<void> {
    if (!accountId) {
      console.warn('[budgetCategoriesService] Cannot ensure defaults: accountId is required')
      return
    }

    try {
      // Get existing non-archived categories
      const existingCategories = await this.getCategories(accountId, false, { mode: 'auto' })
      
      // Define the four required default categories
      const defaultCategories = [
        { name: 'Furnishings', slug: 'furnishings' },
        { name: 'Install', slug: 'install' },
        { name: 'Design Fee', slug: 'design-fee' },
        { name: 'Storage & Receiving', slug: 'storage-receiving' }
      ]

      // Check which defaults are missing
      const existingSlugs = new Set(existingCategories.map(cat => cat.slug))
      const missingCategories = defaultCategories.filter(
        def => !existingSlugs.has(def.slug)
      )

      // Create missing categories
      if (missingCategories.length > 0) {
        console.log(
          `[budgetCategoriesService] Creating ${missingCategories.length} default categories for account ${accountId}`
        )
        
        let furnishingsCategoryId: string | null = null

        for (const category of missingCategories) {
          try {
            const created = await this.createCategory(
              accountId,
              category.name,
              { is_default: true }
            )
            
            // Track furnishings category ID for setting as default
            if (category.slug === 'furnishings') {
              furnishingsCategoryId = created.id
            }
            
            console.log(
              `[budgetCategoriesService] Created default category: ${category.name} (${created.id})`
            )
          } catch (error) {
            // Log error but continue with other categories
            console.error(
              `[budgetCategoriesService] Failed to create default category ${category.name}:`,
              error
            )
          }
        }

        // Set Furnishings as the default category if we created it and no default is set
        if (furnishingsCategoryId) {
          try {
            const { getDefaultCategory, setDefaultCategory } = await import('./accountPresetsService')
            const currentDefault = await getDefaultCategory(accountId)
            if (!currentDefault) {
              await setDefaultCategory(accountId, furnishingsCategoryId)
              console.log(
                `[budgetCategoriesService] Set Furnishings as default category for account ${accountId}`
              )
            }
          } catch (error) {
            // Non-fatal: default category setting failed
            console.warn(
              `[budgetCategoriesService] Failed to set default category:`,
              error
            )
          }
        }
      } else {
        console.log(
          `[budgetCategoriesService] All default categories already exist for account ${accountId}`
        )
      }
    } catch (error) {
      // Log error but don't throw - this is a best-effort operation
      console.error(
        `[budgetCategoriesService] Failed to ensure default categories for account ${accountId}:`,
        error
      )
    }
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

