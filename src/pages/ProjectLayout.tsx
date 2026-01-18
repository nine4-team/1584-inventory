import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  DollarSign,
  Edit,
  FileText,
  Package,
  RefreshCw,
  Receipt,
  Trash2,
  User,
} from 'lucide-react'
import ContextBackLink from '@/components/ContextBackLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { Project, Transaction, Item } from '@/types'
import { projectService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { useProjectRealtime } from '@/contexts/ProjectRealtimeContext'
import ProjectForm from '@/components/ProjectForm'
import { hydrateProjectCache } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'
import BudgetProgress from '@/components/ui/BudgetProgress'
import { useToast } from '@/components/ui/ToastContext'
import { Button } from '@/components/ui/Button'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { isNetworkOnline } from '@/services/networkStatusService'
import {
  projectBudget,
  projectClientSummary,
  projectInvoice,
  projectItems,
  projectPropertyManagementSummary,
  projectTransactions,
  projectsRoot,
  ProjectSection,
} from '@/utils/routes'
import { storeProjectSection } from '@/utils/projectSectionStorage'

interface ProjectLayoutContextValue {
  project: Project
  transactions: Transaction[]
  items: Item[]
}

export function useProjectLayoutContext() {
  const context = useOutletContext<ProjectLayoutContextValue>()
  if (!context) {
    throw new Error('useProjectLayoutContext must be used within ProjectLayout')
  }
  return context
}

const sectionDefinitions: Array<{ id: ProjectSection; name: string; icon: typeof Package }> = [
  { id: 'items', name: 'Items', icon: Package },
  { id: 'transactions', name: 'Transactions', icon: FileText },
]

const budgetTabs = [
  { id: 'budget', name: 'Budget', icon: FileText },
  { id: 'accounting', name: 'Accounting', icon: DollarSign },
]

const resolveSectionFromPath = (pathname: string, projectId?: string): ProjectSection | null => {
  if (!projectId) return null
  const prefix = `/project/${projectId}/`
  if (!pathname.startsWith(prefix)) return null
  const remainder = pathname.slice(prefix.length)
  if (remainder.startsWith('transactions')) return 'transactions'
  if (remainder.startsWith('budget')) return 'budget'
  if (remainder.startsWith('items')) return 'items'
  return null
}

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const hasSyncError = useSyncError()
  const stackedNavigate = useStackedNavigate()
  const stackedNavigateRef = useRef(stackedNavigate)
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const [searchParams, setSearchParams] = useSearchParams()
  const budgetTabParam = searchParams.get('budgetTab')
  const [isEditing, setIsEditing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeSection, setActiveSection] = useState<ProjectSection>('items')
  const { showError } = useToast()
  const { getBackDestination, buildContextUrl } = useNavigationContext()
  const [activeBudgetTab, setActiveBudgetTab] = useState<string>(() =>
    budgetTabParam === 'accounting' ? 'accounting' : 'budget'
  )
  const {
    project,
    transactions,
    items,
    isLoading,
    error,
    refreshProject: refreshProjectSnapshot,
    refreshCollections,
  } = useProjectRealtime(projectId)

  useEffect(() => {
    stackedNavigateRef.current = stackedNavigate
  }, [stackedNavigate])

  useEffect(() => {
    if (!projectId) {
      stackedNavigateRef.current(projectsRoot())
    }
  }, [projectId])

  // Hydrate project cache from offlineStore before rendering
  useEffect(() => {
    if (!projectId || !currentAccountId) return

    const hydrate = async () => {
      try {
        await hydrateProjectCache(getGlobalQueryClient(), currentAccountId, projectId)
      } catch (error) {
        console.warn('Failed to hydrate project cache (non-fatal):', error)
      }
    }

    hydrate()
  }, [projectId, currentAccountId])

  const sectionPaths = useMemo(() => {
    if (!projectId) return null
    return {
      items: projectItems(projectId),
      transactions: projectTransactions(projectId),
      budget: projectBudget(projectId),
    }
  }, [projectId])

  const owedTo1584 = useMemo(() => {
    return transactions
      .filter(t => t.status !== 'canceled')
      .filter(t => t.reimbursementType === CLIENT_OWES_COMPANY)
      .reduce((sum, t) => sum + parseFloat(t.amount || '0'), 0)
  }, [transactions])

  const owedToClient = useMemo(() => {
    return transactions
      .filter(t => t.status !== 'canceled')
      .filter(t => t.reimbursementType === COMPANY_OWES_CLIENT)
      .reduce((sum, t) => sum + parseFloat(t.amount || '0'), 0)
  }, [transactions])

  useEffect(() => {
    const resolved = resolveSectionFromPath(location.pathname, projectId)
    if (resolved) {
      setActiveSection(resolved)
      if (projectId) {
        storeProjectSection(projectId, resolved)
      }
    } else {
      setActiveSection('items')
    }
  }, [location.pathname, projectId])

  const retryLoadProject = () => {
    if (!projectId) return
    refreshCollections({ includeProject: true }).catch(retryError => {
      console.error('ProjectLayout: retry load failed', retryError)
    })
  }

  const handleEditProject = async (projectData: any) => {
    if (!project || !projectId || !currentAccountId) return

    try {
      await projectService.updateProject(currentAccountId, projectId, projectData)
      await refreshProjectSnapshot()
      setIsEditing(false)
    } catch (updateError) {
      console.error('Error updating project:', updateError)
      throw updateError
    }
  }

  const handleRefreshProject = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await refreshCollections({ includeProject: true })
    } catch (refreshError) {
      console.error('Error refreshing project:', refreshError)
      showError('Failed to refresh project. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!projectId || !currentAccountId) return

    setIsDeleting(true)
    try {
      await projectService.deleteProject(currentAccountId, projectId)
      stackedNavigate(projectsRoot())
    } catch (deleteError) {
      console.error('Error deleting project:', deleteError)
      setIsDeleting(false)
      setShowDeleteConfirm(false)
      showError('Failed to delete project. Please try again.')
    }
  }

  const handleBudgetTabChange = (tabId: string) => {
    setActiveBudgetTab(tabId)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('budgetTab', tabId)
    setSearchParams(nextSearchParams)
  }

  const handleSectionChange = (section: ProjectSection) => {
    if (!sectionPaths) return
    setActiveSection(section)
    if (projectId) {
      storeProjectSection(projectId, section)
    }
    stackedNavigate(sectionPaths[section])
  }

  const backDestination = getBackDestination(projectsRoot())

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading project...</p>
        </div>
      </div>
    )
  }

  if (error) {
    const isOfflineError = error === 'Network unavailable' || !isNetworkOnline()
    
    return (
      <div className="text-center py-12">
        <div className="mx-auto h-12 w-12 text-red-400">⚠️</div>
        <h3 className="mt-2 text-sm font-medium text-gray-900">
          {isOfflineError ? 'Offline' : 'Error Loading Project'}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {isOfflineError 
            ? 'You\'re currently offline. The project will load automatically when you reconnect.'
            : error}
        </p>
        <div className="mt-6 flex justify-center space-x-3">
          {!isOfflineError && (
            <button
              onClick={retryLoadProject}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              Try Again
            </button>
          )}
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </ContextBackLink>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto h-12 w-12 text-gray-400">📁</div>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Project not found</h3>
        <p className="mt-1 text-sm text-gray-500">The project you're looking for doesn't exist.</p>
        <div className="mt-6">
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </ContextBackLink>
        </div>
      </div>
    )
  }

  const outletContext: ProjectLayoutContextValue = {
    project,
    transactions,
    items,
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
            <button
              onClick={handleRefreshProject}
              className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Refresh project"
              title="Refresh"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </button>
            {hasSyncError && <RetrySyncButton size="sm" variant="secondary" />}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {project.mainImageUrl && (
            <div className="w-full h-64 bg-gray-200 overflow-hidden">
              <img src={project.mainImageUrl} alt={project.name} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-6 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{project.name}</h1>
              {project.clientName && (
                <p className="text-lg text-gray-600 mb-6">{project.clientName}</p>
              )}
            </div>

            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                {budgetTabs.map(tab => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleBudgetTabChange(tab.id)}
                      className={`py-4 px-1 border-b-2 font-medium text-base flex items-center ${
                        activeBudgetTab === tab.id
                          ? 'border-primary-500 text-primary-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {tab.name}
                    </button>
                  )
                })}
              </nav>
            </div>

            <div className="pt-2">
              {activeBudgetTab === 'budget' && (
                <BudgetProgress
                  budget={project.budget}
                  designFee={project.designFee}
                  budgetCategories={project.budgetCategories}
                  transactions={transactions}
                />
              )}
              {activeBudgetTab === 'accounting' && (
                <div className="space-y-6">
                  <section>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-600 mb-0.5">Owed to Design Business</div>
                        <div className="text-xl font-bold text-gray-900">${owedTo1584.toFixed(2)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-600 mb-0.5">Owed to Client</div>
                        <div className="text-xl font-bold text-gray-900">${owedToClient.toFixed(2)}</div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Reports</h2>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          stackedNavigate(
                            buildContextUrl(projectPropertyManagementSummary(project.id))
                          )
                        }
                      >
                        <Building2 className="h-4 w-4 mr-2" />
                        Generate Property Management Summary
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          stackedNavigate(buildContextUrl(projectClientSummary(project.id)))
                        }
                      >
                        <User className="h-4 w-4 mr-2" />
                        Generate Client Summary
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          stackedNavigate(buildContextUrl(projectInvoice(project.id)))
                        }
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        Generate Invoice
                      </Button>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {sectionDefinitions.map(section => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  disabled={!sectionPaths}
                  onClick={() => handleSectionChange(section.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-base flex items-center ${
                    isActive
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } ${!sectionPaths ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {section.name}
                </button>
              )
            })}
          </nav>
        </div>
        <div className="px-6 py-6">
          <Suspense
            fallback={
              <div className="py-10 text-center text-sm text-gray-500">Loading section...</div>
            }
          >
            <Outlet context={outletContext} />
          </Suspense>
        </div>
      </div>

      {isEditing && (
        <ProjectForm
          initialData={{
            id: project.id,
            name: project.name,
            description: project.description,
            clientName: project.clientName,
            budget: project.budget,
            designFee: project.designFee,
            budgetCategories: project.budgetCategories,
            mainImageUrl: project.mainImageUrl,
          }}
          onSubmit={handleEditProject}
          onCancel={() => setIsEditing(false)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Delete</h3>
                <button onClick={() => setShowDeleteConfirm(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-2">
                <p className="text-sm text-gray-500 mb-4">
                  Are you sure you want to delete the project <strong>"{project.name}"</strong>? This action cannot be
                  undone and will permanently delete the project and all associated data.
                </p>
                {project.metadata?.totalItems && project.metadata.totalItems > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                    <div className="flex">
                      <div className="ml-3">
                        <h4 className="text-sm font-medium text-yellow-800">Warning</h4>
                        <div className="mt-1 text-sm text-yellow-700">
                          <p>
                            This project contains {project.metadata.totalItems} item(s). Deleting the project will
                            permanently remove all associated data.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteProject}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
