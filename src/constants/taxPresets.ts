export interface TaxPreset {
  id: string
  name: string
  rate: number // percentage, e.g., 8.375
}

// UI-only sentinel for explicit "No Tax" selection.
export const NO_TAX_PRESET_ID = '__no_tax__'

// Default tax presets - these can be updated via Settings page
export const DEFAULT_TAX_PRESETS: TaxPreset[] = [
  { id: 'nv', name: 'NV', rate: 8.375 },
  { id: 'ut', name: 'UT', rate: 7.10 },
  { id: 'ca', name: 'CA', rate: 7.25 },
  { id: 'tx', name: 'TX', rate: 6.25 },
  { id: 'az', name: 'AZ', rate: 8.6 }
]

// Supabase table name for tax presets
export const TAX_PRESETS_DOC_PATH = 'settings/taxPresets'

// Helper to create a map of preset ID to preset
export const createPresetMap = (presets: TaxPreset[]): Map<string, TaxPreset> => {
  const map = new Map<string, TaxPreset>()
  presets.forEach(preset => {
    map.set(preset.id, preset)
  })
  return map
}

