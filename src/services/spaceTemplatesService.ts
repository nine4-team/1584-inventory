import { supabase } from './supabase'
import { convertTimestamps, handleSupabaseError, ensureAuthenticatedForDatabase } from './databaseService'
import { SpaceTemplate } from '@/types'

/**
 * Space Templates Service
 * 
 * Provides CRUD operations for Space Templates (account-scoped definitions).
 * Templates are used to create project spaces.
 */

interface CreateTemplateInput {
  accountId: string
  name: string
  notes?: string | null
}

interface UpdateTemplateInput {
  name?: string
  notes?: string | null
  isArchived?: boolean
  metadata?: Record<string, any> | null
}

/**
 * Convert database row to SpaceTemplate object
 */
function mapTemplateRowToTemplate(row: any): SpaceTemplate {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    notes: row.notes ?? null,
    isArchived: row.is_archived ?? false,
    sortOrder: row.sort_order ?? null,
    metadata: row.metadata ?? null,
    createdAt: convertTimestamps(row).created_at,
    updatedAt: convertTimestamps(row).updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    version: row.version ?? 1,
  }
}

export const spaceTemplatesService = {
  /**
   * List templates for an account
   */
  async listTemplates(params: {
    accountId: string
    includeArchived?: boolean
  }): Promise<SpaceTemplate[]> {
    await ensureAuthenticatedForDatabase()

    const { accountId, includeArchived = false } = params

    let query = supabase
      .from('space_templates')
      .select('*')
      .eq('account_id', accountId)

    if (!includeArchived) {
      query = query.eq('is_archived', false)
    }

    query = query
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })

    const { data, error } = await query

    handleSupabaseError(error)

    return (data || []).map(mapTemplateRowToTemplate)
  },

  /**
   * Get a single template by ID
   */
  async getTemplate(accountId: string, templateId: string): Promise<SpaceTemplate | null> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('space_templates')
      .select('*')
      .eq('id', templateId)
      .eq('account_id', accountId)
      .single()

    if (error) {
      handleSupabaseError(error, { returnNullOnNotFound: true })
      return null
    }

    return data ? mapTemplateRowToTemplate(data) : null
  },

  /**
   * Create a new template
   */
  async createTemplate(input: CreateTemplateInput, createdBy?: string): Promise<SpaceTemplate> {
    await ensureAuthenticatedForDatabase()

    const { data: user } = await supabase.auth.getUser()
    const userId = createdBy || user?.user?.id
    const { data: maxRow, error: maxError } = await supabase
      .from('space_templates')
      .select('sort_order')
      .eq('account_id', input.accountId)
      .order('sort_order', { ascending: false })
      .limit(1)

    handleSupabaseError(maxError)

    const nextSortOrder = (maxRow?.[0]?.sort_order ?? 0) + 1

    const { data, error } = await supabase
      .from('space_templates')
      .insert({
        account_id: input.accountId,
        name: input.name.trim(),
        notes: input.notes ?? null,
        is_archived: false,
        sort_order: nextSortOrder,
        metadata: {},
        created_by: userId,
        updated_by: userId,
        version: 1,
      })
      .select()
      .single()

    handleSupabaseError(error)

    return mapTemplateRowToTemplate(data)
  },

  /**
   * Update an existing template
   */
  async updateTemplate(
    accountId: string,
    templateId: string,
    updates: UpdateTemplateInput,
    updatedBy?: string
  ): Promise<SpaceTemplate> {
    await ensureAuthenticatedForDatabase()

    const { data: user } = await supabase.auth.getUser()
    const userId = updatedBy || user?.user?.id

    const updateData: any = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }

    if (updates.name !== undefined) {
      updateData.name = updates.name.trim()
    }
    if (updates.notes !== undefined) {
      updateData.notes = updates.notes
    }
    if (updates.isArchived !== undefined) {
      updateData.is_archived = updates.isArchived
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata
    }

    // Increment version for conflict detection
    const currentTemplate = await this.getTemplate(accountId, templateId)
    if (currentTemplate) {
      updateData.version = (currentTemplate.version || 1) + 1
    }

    const { data, error } = await supabase
      .from('space_templates')
      .update(updateData)
      .eq('id', templateId)
      .eq('account_id', accountId)
      .select()
      .single()

    handleSupabaseError(error)

    return mapTemplateRowToTemplate(data)
  },

  /**
   * Archive a template (soft delete)
   */
  async archiveTemplate(accountId: string, templateId: string, updatedBy?: string): Promise<SpaceTemplate> {
    return this.updateTemplate(accountId, templateId, { isArchived: true }, updatedBy)
  },

  /**
   * Unarchive a template
   */
  async unarchiveTemplate(accountId: string, templateId: string, updatedBy?: string): Promise<SpaceTemplate> {
    return this.updateTemplate(accountId, templateId, { isArchived: false }, updatedBy)
  },

  /**
   * Delete a template (hard delete)
   */
  async deleteTemplate(accountId: string, templateId: string): Promise<void> {
    await ensureAuthenticatedForDatabase()

    const { error } = await supabase
      .from('space_templates')
      .delete()
      .eq('id', templateId)
      .eq('account_id', accountId)

    handleSupabaseError(error)
  },

  /**
   * Update template ordering for an account
   */
  async updateTemplateOrder(
    accountId: string,
    orderedTemplateIds: string[],
    updatedBy?: string
  ): Promise<void> {
    if (!orderedTemplateIds.length) return

    await ensureAuthenticatedForDatabase()

    const { data: user } = await supabase.auth.getUser()
    const userId = updatedBy || user?.user?.id
    const updatedAt = new Date().toISOString()

    const updates = orderedTemplateIds.map((id, index) => ({
      id,
      account_id: accountId,
      sort_order: index + 1,
      updated_by: userId,
      updated_at: updatedAt,
    }))

    const { error } = await supabase
      .from('space_templates')
      .upsert(updates, { onConflict: 'id' })

    handleSupabaseError(error)
  },
}
