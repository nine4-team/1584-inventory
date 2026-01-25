import { useState, useMemo, useCallback, useEffect } from 'react'
import { Save, X } from 'lucide-react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { spaceService } from '@/services/spaceService'
import { spaceTemplatesService } from '@/services/spaceTemplatesService'
import { useToast } from '@/components/ui/ToastContext'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import { projectSpaces } from '@/utils/routes'
import { navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'
import { SpaceTemplate, SpaceChecklist, SpaceChecklistItem } from '@/types'

export default function SpaceNew() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const { project, refreshCollections } = useProjectRealtime(projectId)
  const { showError, showSuccess } = useToast()

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<SpaceTemplate[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string }>({})

  const fallbackPath = useMemo(() => (projectId ? projectSpaces(projectId) : '/projects'), [projectId])

  const handleClose = useCallback(() => {
    navigateToReturnToOrFallback(navigate, location, fallbackPath)
  }, [fallbackPath, location, navigate])

  // Load templates when account is available
  useEffect(() => {
    if (!currentAccountId) return

    const loadTemplates = async () => {
      setIsLoadingTemplates(true)
      try {
        const loadedTemplates = await spaceTemplatesService.listTemplates({
          accountId: currentAccountId,
          includeArchived: false,
        })
        setTemplates(loadedTemplates)
      } catch (error) {
        console.error('Error loading templates:', error)
      } finally {
        setIsLoadingTemplates(false)
      }
    }

    loadTemplates()
  }, [currentAccountId])

  // Prefill name, notes, and checklists when template is selected
  useEffect(() => {
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId)
      if (template) {
        setName(template.name)
        setNotes(template.notes || '')
      }
    } else {
      // Reset when no template is selected
      setName('')
      setNotes('')
    }
  }, [selectedTemplateId, templates])

  // Helper function to normalize checklists from template (set all items to unchecked)
  const normalizeChecklistsFromTemplate = (checklists: SpaceChecklist[] | undefined): SpaceChecklist[] => {
    if (!checklists || checklists.length === 0) return []
    return checklists.map(checklist => ({
      ...checklist,
      items: checklist.items.map(item => ({
        ...item,
        isChecked: false, // Always start unchecked when creating from template
      })),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    const newErrors: { name?: string } = {}
    if (!name.trim()) {
      newErrors.name = 'Space name is required'
    }
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    if (!currentAccountId) {
      showError('Account not found')
      return
    }

    if (!projectId) {
      showError('Project ID is required')
      return
    }

    setIsSaving(true)
    try {
      // Get template checklists if a template is selected
      const selectedTemplate = selectedTemplateId
        ? templates.find(t => t.id === selectedTemplateId)
        : null
      const checklists = selectedTemplate
        ? normalizeChecklistsFromTemplate(selectedTemplate.checklists)
        : []

      const newSpace = await spaceService.createSpace({
        accountId: currentAccountId,
        projectId: projectId, // Always set projectId (never null)
        templateId: selectedTemplateId, // Set templateId if template was selected
        name: name.trim(),
        notes: notes.trim() || null,
        checklists,
      })

      showSuccess('Space created')
      await refreshCollections({ includeProject: false })
      handleClose()
    } catch (error: any) {
      console.error('Error creating space:', error)
      if (error.message?.includes('unique')) {
        showError('A space with this name already exists')
      } else {
        showError('Failed to create space')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl space-y-6 rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">Create New Space</h1>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-2 text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template picker */}
          <div>
            <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-2">
              Start from Template (optional)
            </label>
            <select
              id="template"
              value={selectedTemplateId || ''}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value || null)
                if (errors.name) {
                  setErrors(prev => ({ ...prev, name: undefined }))
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isLoadingTemplates}
            >
              <option value="">Start blank</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Select a template to prefill name and notes, or start blank.
            </p>
          </div>

          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Space Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) {
                  setErrors(prev => ({ ...prev, name: undefined }))
                }
              }}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                errors.name ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., Living Room, Kitchen, Storage Unit A"
            />
            {errors.name && <p className="mt-1 text-sm text-red-500">{errors.name}</p>}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={6}
              placeholder="Add any notes about this space..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Creating...' : 'Create Space'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

