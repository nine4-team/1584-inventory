import type { Item } from '@/types'
import { integrationService } from '@/services/inventoryService'

type EnsureItemInProjectOptions = {
  spaceName?: string
}

const buildPullInNote = (targetProjectId: string, spaceName?: string) => {
  if (spaceName) {
    return `Pulled into space "${spaceName}" in project ${targetProjectId}`
  }
  return `Pulled into space in project ${targetProjectId}`
}

export const ensureItemInProjectForSpace = async (
  accountId: string,
  item: Item,
  targetProjectId: string,
  options?: EnsureItemInProjectOptions
): Promise<void> => {
  if (item.projectId === targetProjectId) return

  const note = buildPullInNote(targetProjectId, options?.spaceName)

  await integrationService.sellItemToProject(
    accountId,
    item.itemId,
    item.projectId ?? null,
    targetProjectId,
    { notes: note, space: options?.spaceName }
  )
}
