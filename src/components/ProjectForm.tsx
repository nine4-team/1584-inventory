import { useState, useRef, useEffect } from 'react'
import { X, DollarSign, Upload, Trash2 } from 'lucide-react'
import { ProjectBudgetCategories, BudgetCategory } from '@/types'
import { ImageUploadService } from '@/services/imageService'
import { projectService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { OfflinePrerequisiteBanner, useOfflinePrerequisiteGate } from './ui/OfflinePrerequisiteBanner'

interface ProjectFormData {
  name: string;
  description: string;
  clientName: string;
  budget?: number;
  designFee?: number;
  budgetCategories?: ProjectBudgetCategories;
  mainImageUrl?: string;
}

interface ProjectFormProps {
  onSubmit: (data: ProjectFormData) => Promise<string | void>; // Returns project ID for new projects
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Partial<ProjectFormData & { id?: string }>;
}

export default function ProjectForm({ onSubmit, onCancel, isLoading = false, initialData }: ProjectFormProps) {
  const { currentAccountId } = useAccount()
  const isEditing = Boolean(initialData?.name)
  const { isReady, blockingReason } = useOfflinePrerequisiteGate()

  const [availableCategories, setAvailableCategories] = useState<BudgetCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)

  const normalizeLegacyBudgetCategoryKeys = (
    raw: ProjectBudgetCategories | undefined,
    categories: BudgetCategory[]
  ): ProjectBudgetCategories => {
    const input = raw || {}
    const output: ProjectBudgetCategories = {}
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    for (const [key, amountRaw] of Object.entries(input)) {
      const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw || 0)
      if (!amount || amount <= 0) continue

      // New format: already UUID-keyed
      if (uuidRegex.test(key)) {
        output[key] = amount
        continue
      }

      // Legacy format: keys were slugs/camelCase identifiers
      const legacySlug = (() => {
        switch (key) {
          case 'propertyManagement':
            return 'property-management'
          case 'storageReceiving':
            return 'storage-receiving'
          case 'designFee':
            return 'design-fee'
          default:
            return key
        }
      })()

      const match = categories.find(c => c.slug === legacySlug)
      if (match) {
        output[match.id] = amount
      }
    }

    return output
  }

  const [formData, setFormData] = useState<ProjectFormData>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    clientName: initialData?.clientName || '',
    budget: initialData?.budget || undefined,
    designFee: initialData?.designFee || undefined,
    budgetCategories: initialData?.budgetCategories || {},
    mainImageUrl: initialData?.mainImageUrl || undefined,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.mainImageUrl || null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load budget categories from database (excluding archived)
  useEffect(() => {
    const loadCategories = async () => {
      if (!currentAccountId) {
        setCategoriesLoading(false)
        return
      }

      try {
        setCategoriesLoading(true)
        const categories = await budgetCategoriesService.getCategories(currentAccountId, false) // Exclude archived
        setAvailableCategories(categories)
      } catch (err) {
        console.error('Error loading budget categories:', err)
        setAvailableCategories([])
      } finally {
        setCategoriesLoading(false)
      }
    }

    loadCategories()
  }, [currentAccountId])

  // If a project comes in with legacy `budgetCategories` keys, normalize them once categories are loaded.
  useEffect(() => {
    if (categoriesLoading) return
    if (!availableCategories.length) return
    if (!formData.budgetCategories) return

    const normalized = normalizeLegacyBudgetCategoryKeys(formData.budgetCategories, availableCategories)
    const oldKeys = Object.keys(formData.budgetCategories).sort().join('|')
    const newKeys = Object.keys(normalized).sort().join('|')
    if (oldKeys !== newKeys) {
      setFormData(prev => ({ ...prev, budgetCategories: normalized }))
    }
  }, [categoriesLoading, availableCategories, formData.budgetCategories])

  // Calculate total budget from all budget categories
  const calculateTotalBudget = (): number => {
    if (!formData.budgetCategories) return 0
    return Object.values(formData.budgetCategories).reduce((sum, value) => sum + (value || 0), 0)
  }

  const handleChange = (field: keyof ProjectFormData, value: string | number | ProjectBudgetCategories | undefined) => {
    if (field === 'budgetCategories' && typeof value === 'object') {
      setFormData(prev => ({ ...prev, [field]: value }))
    } else {
      const processedValue = typeof value === 'number' && value === 0 ? undefined : value
      setFormData(prev => ({ ...prev, [field]: processedValue }))
    }
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setErrors(prev => ({ ...prev, image: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.' }))
      return
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      setErrors(prev => ({ ...prev, image: 'File too large. Maximum size is 10MB.' }))
      return
    }

    setImageFile(file)
    setImagePreview(ImageUploadService.createPreviewUrl(file))
    setErrors(prev => ({ ...prev, image: '' }))
  }

  const handleRemoveImage = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) {
      ImageUploadService.revokePreviewUrl(imagePreview)
    }
    setImagePreview(null)
    setImageFile(null)
    setFormData(prev => ({ ...prev, mainImageUrl: undefined }))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }


  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Project name is required'
    }

    if (!formData.clientName.trim()) {
      newErrors.clientName = 'Client name is required'
    }

    // Budget categories validation is handled in the individual fields

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    console.debug('ProjectForm: submit clicked', { formData })

    if (!validateForm()) {
      console.debug('ProjectForm: validation failed', { formData })
      return
    }
    
    // Block submission if offline prerequisites are not ready
    if (!isReady) {
      setErrors(prev => ({ 
        ...prev, 
        _prerequisite: blockingReason || 'Offline prerequisites not ready. Please sync metadata before saving.' 
      }))
      return
    }

    try {
      setIsUploadingImage(true)

      // Filter out undefined values before submitting
      const cleanObject = (obj: any): any => {
        if (obj === null || obj === undefined) return undefined
        if (typeof obj === 'object') {
          const cleaned = Object.fromEntries(
            Object.entries(obj).filter(([_, value]) => value !== undefined)
          )
          return Object.keys(cleaned).length > 0 ? cleaned : undefined
        }
        return obj
      }

      // For editing: upload image first if new file selected
      let imageUrl = formData.mainImageUrl
      if (isEditing && imageFile && (initialData as any)?.id) {
        try {
          const uploadResult = await ImageUploadService.uploadProjectImage(
            imageFile,
            formData.name || 'Project',
            (initialData as any).id
          )
          imageUrl = uploadResult.url
        } catch (uploadError) {
          console.error('Error uploading image:', uploadError)
          setErrors(prev => ({ ...prev, image: 'Failed to upload image. Please try again.' }))
          setIsUploadingImage(false)
          return
        }
      }

      const cleanedData = cleanObject({
        ...formData,
        mainImageUrl: imageUrl
      }) as ProjectFormData
      console.debug('ProjectForm: calling onSubmit with', { cleanedData })
      const result = await onSubmit(cleanedData)
      console.debug('ProjectForm: onSubmit resolved', { result })

      // For new projects: upload image after creation if projectId is returned
      if (!isEditing && imageFile && result && typeof result === 'string' && currentAccountId) {
        try {
          const uploadResult = await ImageUploadService.uploadProjectImage(
            imageFile,
            formData.name || 'Project',
            result
          )
          // Update project with image URL
          await projectService.updateProject(currentAccountId, result, {
            mainImageUrl: uploadResult.url
          })
        } catch (uploadError) {
          console.error('Error uploading image after project creation:', uploadError)
          // Don't fail the form submission, just log the error
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error)
    } finally {
      setIsUploadingImage(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto z-50 flex items-center justify-center p-4">
      <div className="relative w-full max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary-600 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white">
                {isEditing ? 'Edit Project' : 'Create New Project'}
              </h3>
              <p className="text-primary-100 text-sm mt-1">
                {isEditing ? 'Update project details and budget information' : 'Add a new project to your account'}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-white/80 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Form Content */}
        <div className="p-8 max-h-[calc(100vh-12rem)] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information - Two Column Layout */}
            <div className="grid grid-cols-2 gap-6">
              {/* Project Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">
                  Project Name *
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className={`w-full px-4 py-3 rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${
                    errors.name ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-primary-500'
                  }`}
                  placeholder="Enter project name"
                />
                {errors.name && <p className="mt-1.5 text-sm text-red-600 font-medium">{errors.name}</p>}
              </div>

              {/* Client Name */}
              <div>
                <label htmlFor="clientName" className="block text-sm font-semibold text-gray-700 mb-2">
                  Client Name *
                </label>
                <input
                  type="text"
                  id="clientName"
                  value={formData.clientName}
                  onChange={(e) => handleChange('clientName', e.target.value)}
                  className={`w-full px-4 py-3 rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${
                    errors.clientName ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-primary-500'
                  }`}
                  placeholder="Enter client name"
                />
                {errors.clientName && <p className="mt-1.5 text-sm text-red-600 font-medium">{errors.clientName}</p>}
              </div>
            </div>

            {/* Description - Full Width */}
            <div>
              <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all resize-none"
                placeholder="Enter project description"
              />
            </div>

            {/* Main Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Main Project Image
              </label>
              {imagePreview ? (
                <div className="relative group">
                  <img
                    src={imagePreview}
                    alt="Project preview"
                    className="w-full h-64 object-cover rounded-xl border-2 border-gray-200 shadow-md"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-3 right-3 p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 shadow-lg transition-all opacity-0 group-hover:opacity-100"
                    disabled={isUploadingImage}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 bg-gray-50 hover:bg-gray-100 transition-colors">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="w-full flex flex-col items-center justify-center py-6 text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded-lg disabled:opacity-50 transition-all"
                  >
                    <Upload className="h-10 w-10 mb-3 text-primary-600" />
                    <span className="text-sm font-semibold">Click to upload image</span>
                    <p className="text-xs text-gray-500 mt-1">JPEG, PNG, GIF, or WebP. Max 10MB.</p>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </div>
              )}
              {errors.image && <p className="mt-2 text-sm text-red-600 font-medium">{errors.image}</p>}
            </div>

            {/* Default Transaction Category moved to account-level presets (Settings → Presets → Budget Categories) */}

            {/* Budget Categories Section */}
            <div className="border-t-2 border-gray-200 pt-6">
              <div className="mb-6">
                <h4 className="text-xl font-bold text-gray-900 mb-2">Budget Categories</h4>
                <p className="text-sm text-gray-600">Set specific budgets for different project categories. These will be used to track spending by category.</p>
              </div>

              {/* Total Budget (Read-only) - Prominent Display */}
              <div className="mb-6 p-4 bg-primary-50 rounded-xl border-2 border-primary-200">
                <label htmlFor="totalBudget" className="block text-sm font-semibold text-gray-700 mb-2">
                  Total Budget
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <DollarSign className="h-5 w-5 text-primary-600" />
                  </div>
                  <input
                    type="text"
                    id="totalBudget"
                    value={calculateTotalBudget().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    readOnly
                    className="block w-full pl-12 pr-4 py-3 rounded-lg border-2 border-primary-300 bg-white text-gray-900 text-lg font-bold cursor-not-allowed"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-600 font-medium">Automatically calculated from budget categories</p>
              </div>

              {/* Budget Categories Grid - Dynamically generated from database */}
              {categoriesLoading ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">Loading budget categories...</p>
                </div>
              ) : availableCategories.length === 0 ? (
                <div className="text-center py-8 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 font-medium">
                    No budget categories available. Please create budget categories in Settings first.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {availableCategories.map((category) => {
                    const categoryId = category.id
                    const currentValue = formData.budgetCategories?.[categoryId] || 0
                    
                    return (
                      <div key={categoryId}>
                        <label 
                          htmlFor={`budgetCategories.${categoryId}`} 
                          className="block text-sm font-semibold text-gray-700 mb-2"
                        >
                          {category.name}
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <DollarSign className="h-4 w-4 text-gray-400" />
                          </div>
                          <input
                            type="number"
                            id={`budgetCategories.${categoryId}`}
                            value={currentValue > 0 ? currentValue.toString() : ''}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value) || 0
                              const newBudgetCategories: ProjectBudgetCategories = {
                                ...formData.budgetCategories,
                                [categoryId]: value > 0 ? value : 0
                              }
                              // Remove zero values to keep the object clean
                              if (value === 0) {
                                delete newBudgetCategories[categoryId]
                              }
                              handleChange('budgetCategories', newBudgetCategories)
                            }}
                            className="w-full pl-10 pr-4 py-2.5 rounded-lg border-2 border-gray-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex justify-end space-x-4 pt-6 border-t-2 border-gray-200">
              <button
                type="button"
                onClick={onCancel}
                className="px-6 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || isUploadingImage || !isReady}
                className="px-6 py-3 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all"
              >
                {isLoading || isUploadingImage
                  ? (isEditing ? 'Updating...' : 'Creating...')
                  : (isEditing ? 'Update Project' : 'Create Project')
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
