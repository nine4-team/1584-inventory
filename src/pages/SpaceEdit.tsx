import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Save, X } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useAccount } from '@/contexts/AccountContext'
import { useToast } from '@/components/ui/ToastContext'
import { spaceService } from '@/services/spaceService'
import { projectSpaceDetail, projectSpaces } from '@/utils/routes'
import { getReturnToFromLocation, navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'

export default function SpaceEdit() {
  const { projectId, spaceId } = useParams<{ projectId: string; spaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const { showError, showSuccess } = useToast()

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string }>({})

  const fallbackPath = useMemo(() => {
    if (projectId && spaceId) return projectSpaceDetail(projectId, spaceId)
    if (projectId) return projectSpaces(projectId)
    return '/projects'
  }, [projectId, spaceId])

  const backDestination = useMemo(
    () => getReturnToFromLocation(location) ?? fallbackPath,
    [location, fallbackPath]
  )

  useEffect(() => {
    if (!currentAccountId || !spaceId) {
      setIsLoading(false)
      return
    }

    const loadSpace = async () => {
      setIsLoading(true)
      try {
        const fetchedSpace = await spaceService.getSpace(currentAccountId, spaceId)
        if (!fetchedSpace) {
          showError('Space not found')
          navigateToReturnToOrFallback(navigate, location, fallbackPath)
          return
        }
        setName(fetchedSpace.name)
        setNotes(fetchedSpace.notes || '')
      } catch (error) {
        console.error('Error loading space:', error)
        showError('Failed to load space')
      } finally {
        setIsLoading(false)
      }
    }

    loadSpace()
  }, [currentAccountId, spaceId, navigate, location, fallbackPath, showError])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setErrors({ name: 'Space name is required' })
      return
    }
    if (!currentAccountId || !spaceId) return

    setIsSaving(true)
    try {
      await spaceService.updateSpace(currentAccountId, spaceId, {
        name: trimmedName,
        notes: notes.trim() || null,
      })
      showSuccess('Space updated')
      navigateToReturnToOrFallback(navigate, location, fallbackPath)
    } catch (error) {
      console.error('Error updating space:', error)
      showError('Failed to update space')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading space...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </ContextBackLink>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Edit Space</h1>
        </div>
        <div className="px-6 py-4">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="space-name" className="block text-sm font-medium text-gray-700">
                Space Name <span className="text-red-500">*</span>
              </label>
              <input
                id="space-name"
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (errors.name) {
                    setErrors(prev => ({ ...prev, name: undefined }))
                  }
                }}
                className={`mt-2 w-full px-3 py-2 border rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter space name"
              />
              {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="space-notes" className="block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                id="space-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={6}
                placeholder="Add notes about this space..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <ContextBackLink
                fallback={backDestination}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </ContextBackLink>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
