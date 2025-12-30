import type { ProjectSection } from './routes'

const sectionStorageKey = (projectId: string) => `lastProjectSection:${projectId}`

export function storeProjectSection(projectId: string, section: ProjectSection) {
  try {
    localStorage.setItem(sectionStorageKey(projectId), section)
  } catch {
    // localStorage may be unavailable (SSR/tests); ignore persist errors
  }
}

export function getStoredProjectSection(projectId: string): ProjectSection | null {
  try {
    const value = localStorage.getItem(sectionStorageKey(projectId))
    if (value === 'items' || value === 'transactions' || value === 'budget') {
      return value
    }
  } catch {
    // ignore access errors
  }
  return null
}

export function getPreferredProjectSection(
  projectId: string,
  fallback: ProjectSection = 'transactions'
): ProjectSection {
  return getStoredProjectSection(projectId) ?? fallback
}
