import { useMemo } from 'react'
import { Combobox } from '@/components/ui/Combobox'
import { Space } from '@/types'
import { spaceService } from '@/services/spaceService'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'

interface SpaceSelectorProps {
  projectId?: string | null
  value?: string | null // spaceId
  onChange: (spaceId: string | null) => void
  placeholder?: string
  allowCreate?: boolean
  disabled?: boolean
  required?: boolean
  error?: string
}

export default function SpaceSelector({
  projectId,
  value,
  onChange,
  placeholder = 'Select a space...',
  allowCreate = true,
  disabled = false,
  required = false,
  error,
}: SpaceSelectorProps) {
  const { currentAccountId } = useAccount()
  const { spaces } = useProjectRealtime(projectId || null)

  const options = useMemo(() => {
    const spaceOptions = spaces.map(space => ({
      id: space.id,
      label: space.name + (space.projectId === null ? ' (Account-wide)' : ''),
    }))
    return [
      { id: '', label: 'No space set' },
      ...spaceOptions,
    ]
  }, [spaces])

  const handleCreateSpace = async (name: string): Promise<string> => {
    if (!currentAccountId) {
      throw new Error('Account not available')
    }

    try {
      // Create project-specific space by default (unless projectId is null, then account-wide)
      const newSpace = await spaceService.createSpace({
        accountId: currentAccountId,
        projectId: projectId || null,
        name: name.trim(),
      })

      // Refresh spaces in realtime context
      // Note: This will be handled by the parent component refreshing collections

      return newSpace.id
    } catch (error: any) {
      console.error('Failed to create space:', error)
      if (error.message?.includes('unique')) {
        throw new Error('A space with this name already exists')
      }
      throw new Error('Failed to create space')
    }
  }

  return (
    <Combobox
      options={options}
      value={value || ''}
      onChange={(selectedValue) => {
        onChange(selectedValue === '' ? null : selectedValue)
      }}
      placeholder={placeholder}
      allowCreate={allowCreate && !disabled}
      onCreateOption={handleCreateSpace}
      createOptionLabel={(query) => `Create "${query}"`}
      disabled={disabled}
      required={required}
      error={error}
    />
  )
}
