import { supabase } from './supabase'
import { convertTimestamps, handleSupabaseError, ensureAuthenticatedForDatabase } from './databaseService'
import { Space, ItemImage } from '@/types'
import { isNetworkOnline } from './networkStatusService'

/**
 * Space Service
 * 
 * Provides CRUD operations for Spaces (account-wide or project-specific).
 * Spaces replace the previous free-text location system.
 */

interface CreateSpaceInput {
  accountId: string
  projectId?: string | null // null = account-wide (deprecated in v1)
  templateId?: string | null // Optional: set when creating from a template
  name: string
  notes?: string | null
  images?: ItemImage[]
}

interface UpdateSpaceInput {
  name?: string
  notes?: string | null
  images?: ItemImage[]
  isArchived?: boolean
  metadata?: Record<string, any> | null
}

/**
 * Convert database row to Space object
 */
function mapSpaceRowToSpace(row: any): Space {
  return {
    id: row.id,
    accountId: row.account_id,
    projectId: row.project_id ?? null,
    templateId: row.template_id ?? null,
    name: row.name,
    notes: row.notes ?? null,
    images: (row.images || []) as ItemImage[],
    isArchived: row.is_archived ?? false,
    metadata: row.metadata ?? null,
    createdAt: convertTimestamps(row).created_at,
    updatedAt: convertTimestamps(row).updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    version: row.version ?? 1,
  }
}

export const spaceService = {
  /**
   * List spaces for an account, optionally filtered by project
   * Returns both project-specific spaces and account-wide spaces (where project_id IS NULL)
   * 
   * Fixed bug: check projectId === null BEFORE projectId !== undefined to handle account-wide-only requests
   */
  async listSpaces(params: {
    accountId: string
    projectId?: string | null // If provided, returns project spaces + account-wide spaces
    includeArchived?: boolean
  }): Promise<Space[]> {
    await ensureAuthenticatedForDatabase()

    const { accountId, projectId, includeArchived = false } = params

    let query = supabase
      .from('spaces')
      .select('*')
      .eq('account_id', accountId)

    // Fixed: check null case first, then undefined, then string
    if (projectId === null) {
      // Explicitly request only account-wide spaces
      query = query.is('project_id', null)
    } else if (projectId !== undefined) {
      // projectId is a string: get both project-specific and account-wide spaces
      query = query.or(`project_id.eq.${projectId},project_id.is.null`)
    }
    // If projectId is undefined, no project filter (get all spaces for account)

    if (!includeArchived) {
      query = query.eq('is_archived', false)
    }

    query = query.order('name', { ascending: true })

    const { data, error } = await query

    handleSupabaseError(error)

    return (data || []).map(mapSpaceRowToSpace)
  },

  /**
   * Get a single space by ID
   */
  async getSpace(accountId: string, spaceId: string): Promise<Space | null> {
    await ensureAuthenticatedForDatabase()

    const { data, error } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', spaceId)
      .eq('account_id', accountId)
      .single()

    if (error) {
      handleSupabaseError(error, { returnNullOnNotFound: true })
      return null
    }

    return data ? mapSpaceRowToSpace(data) : null
  },

  /**
   * Create a new space
   */
  async createSpace(input: CreateSpaceInput, createdBy?: string): Promise<Space> {
    await ensureAuthenticatedForDatabase()

    const { data: user } = await supabase.auth.getUser()
    const userId = createdBy || user?.user?.id

    const { data, error } = await supabase
      .from('spaces')
      .insert({
        account_id: input.accountId,
        project_id: input.projectId ?? null,
        template_id: input.templateId ?? null,
        name: input.name.trim(),
        notes: input.notes ?? null,
        images: input.images || [],
        is_archived: false,
        metadata: {},
        created_by: userId,
        updated_by: userId,
        version: 1,
      })
      .select()
      .single()

    handleSupabaseError(error)

    return mapSpaceRowToSpace(data)
  },

  /**
   * Update an existing space
   */
  async updateSpace(
    accountId: string,
    spaceId: string,
    updates: UpdateSpaceInput,
    updatedBy?: string
  ): Promise<Space> {
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
    if (updates.images !== undefined) {
      updateData.images = updates.images
    }
    if (updates.isArchived !== undefined) {
      updateData.is_archived = updates.isArchived
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata
    }

    // Increment version for conflict detection
    const currentSpace = await this.getSpace(accountId, spaceId)
    if (currentSpace) {
      updateData.version = (currentSpace.version || 1) + 1
    }

    const { data, error } = await supabase
      .from('spaces')
      .update(updateData)
      .eq('id', spaceId)
      .eq('account_id', accountId)
      .select()
      .single()

    handleSupabaseError(error)

    return mapSpaceRowToSpace(data)
  },

  /**
   * Archive a space (soft delete)
   */
  async archiveSpace(accountId: string, spaceId: string, updatedBy?: string): Promise<Space> {
    return this.updateSpace(accountId, spaceId, { isArchived: true }, updatedBy)
  },

  /**
   * Delete a space (hard delete)
   */
  async deleteSpace(accountId: string, spaceId: string): Promise<void> {
    await ensureAuthenticatedForDatabase()

    const { error } = await supabase
      .from('spaces')
      .delete()
      .eq('id', spaceId)
      .eq('account_id', accountId)

    handleSupabaseError(error)
  },

  /**
   * Add an image to a space's gallery
   */
  async addSpaceImage(
    accountId: string,
    spaceId: string,
    image: ItemImage,
    updatedBy?: string
  ): Promise<Space> {
    const space = await this.getSpace(accountId, spaceId)
    if (!space) {
      throw new Error('Space not found')
    }

    const images = space.images || []
    const updatedImages = [...images, image]

    return this.updateSpace(accountId, spaceId, { images: updatedImages }, updatedBy)
  },

  /**
   * Remove an image from a space's gallery
   */
  async removeSpaceImage(
    accountId: string,
    spaceId: string,
    imageUrl: string,
    updatedBy?: string
  ): Promise<Space> {
    const space = await this.getSpace(accountId, spaceId)
    if (!space) {
      throw new Error('Space not found')
    }

    const images = (space.images || []).filter(img => img.url !== imageUrl)
    return this.updateSpace(accountId, spaceId, { images }, updatedBy)
  },

  /**
   * Set the primary image for a space
   */
  async setSpacePrimaryImage(
    accountId: string,
    spaceId: string,
    imageUrl: string,
    updatedBy?: string
  ): Promise<Space> {
    const space = await this.getSpace(accountId, spaceId)
    if (!space) {
      throw new Error('Space not found')
    }

    const images = (space.images || []).map(img => ({
      ...img,
      isPrimary: img.url === imageUrl,
    }))

    return this.updateSpace(accountId, spaceId, { images }, updatedBy)
  },
}
