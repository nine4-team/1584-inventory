/**
 * Utility functions for managing project location presets
 */

/**
 * Normalizes a location name by trimming whitespace and collapsing multiple spaces to one.
 * Does NOT auto-titlecase to avoid surprising users.
 */
export function normalizeLocationName(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

/**
 * Deduplicates locations array using case-insensitive comparison on normalized names.
 * Preserves the first-seen display casing.
 */
export function dedupeLocations(locations: string[]): string[] {
  const seen = new Map<string, string>() // normalized -> display casing
  
  for (const location of locations) {
    const normalized = normalizeLocationName(location).toLowerCase()
    if (normalized && !seen.has(normalized)) {
      seen.set(normalized, location.trim())
    }
  }
  
  return Array.from(seen.values())
}

/**
 * Filters out empty strings from locations array
 */
export function filterEmptyLocations(locations: string[]): string[] {
  return locations.filter(loc => normalizeLocationName(loc).length > 0)
}

/**
 * Gets locations from project settings, handling optional/untrusted data
 */
export function getProjectLocations(settings?: { locations?: string[] } | null): string[] {
  if (!settings?.locations || !Array.isArray(settings.locations)) {
    return []
  }
  return filterEmptyLocations(dedupeLocations(settings.locations))
}
