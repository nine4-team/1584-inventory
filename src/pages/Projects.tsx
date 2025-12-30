import { useState, useEffect } from 'react'
import { Plus, FolderOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { Project, Transaction } from '@/types'
import { projectService, transactionService } from '@/services/inventoryService'
import { useAuth } from '@/contexts/AuthContext'
import { useAccount } from '@/contexts/AccountContext'
import ProjectForm from '@/components/ProjectForm'
import BudgetProgress from '@/components/ui/BudgetProgress'
import ContextLink from '@/components/ContextLink'
import { projectItems } from '@/utils/routes'

export default function Projects() {
  const { buildContextUrl } = useNavigationContext()
  const { user } = useAuth()
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [projects, setProjects] = useState<Project[]>([])
  const [transactions, setTransactions] = useState<Record<string, Transaction[]>>({})
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  
  // Combined loading state - show loading if account is loading OR data is loading
  const isLoading = accountLoading || isLoadingData

  useEffect(() => {
    console.log('🔍 Projects - useEffect triggered. accountLoading:', accountLoading, 'currentAccountId:', currentAccountId, 'isLoading:', isLoading)
    
    let unsubscribe: (() => void) | undefined

    const setupSubscription = (initialProjects: Project[]) => {
      if (!currentAccountId) return
      unsubscribe = projectService.subscribeToProjects(
        currentAccountId,
        (updatedProjects) => {
          setProjects(updatedProjects)
          // Also refetch transactions when projects change
          loadTransactionsForProjects(updatedProjects)
        },
        initialProjects
      )
    }

    const loadTransactionsForProjects = async (projectsToLoad: Project[]) => {
      if (!currentAccountId || projectsToLoad.length === 0) {
        setTransactions({})
        return
      }

      try {
        const projectIds = projectsToLoad.map(p => p.id)
        const allTransactions = await transactionService.getTransactionsForProjects(currentAccountId, projectIds, projectsToLoad)
        const transactionsByProject: Record<string, Transaction[]> = {}
        allTransactions.forEach(t => {
          if (!t.projectId) return;
          if (!transactionsByProject[t.projectId]) {
            transactionsByProject[t.projectId] = []
          }
          transactionsByProject[t.projectId].push(t)
        })
        setTransactions(transactionsByProject)
      } catch (error) {
        console.error('Error loading transactions for projects:', error)
        setTransactions({})
      }
    }

    const loadInitialData = async () => {
      console.log('🔍 Projects - loadInitialData called. accountLoading:', accountLoading, 'currentAccountId:', currentAccountId)
      
      // Don't load if account is still loading - wait for it to finish
      // The useEffect will re-run when accountLoading changes to false
      if (accountLoading) {
        console.log('🔍 Projects - Account still loading, waiting...')
        return
      }

      if (currentAccountId) {
        console.log('🔍 Projects - Loading projects for account:', currentAccountId)
        setIsLoadingData(true)
        try {
          const projectsData = await projectService.getProjects(currentAccountId)
          console.log('🔍 Projects - Loaded', projectsData.length, 'projects')
          setProjects(projectsData)
          await loadTransactionsForProjects(projectsData)
          setupSubscription(projectsData)
        } catch (error) {
          console.error('Error loading initial projects data:', error)
          setProjects([])
          setTransactions({})
        } finally {
          setIsLoadingData(false)
        }
      } else {
        console.log('🔍 Projects - No account ID, clearing data')
        setIsLoadingData(false)
        setProjects([])
        setTransactions({})
      }
    }

    loadInitialData()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [currentAccountId, accountLoading])

  const handleCreateProject = async (projectData: any): Promise<string> => {
    if (!user?.email) {
      throw new Error('User must be authenticated to create projects')
    }
    if (!currentAccountId) {
      throw new Error('Account ID is required to create projects')
    }

    try {
      const projectId = await projectService.createProject(currentAccountId, {
        ...projectData,
        createdBy: user.id
      })
      
      // Handle image upload if imageFile is provided (stored in formData)
      // Note: Image upload for new projects is handled in ProjectForm after creation
      
      // The subscription will handle the update
      setShowCreateForm(false)
      return projectId
    } catch (error) {
      console.error('Error creating project:', error)
      throw error // Let the form handle the error
    }
  }

  const handleShowCreateForm = () => {
    setShowCreateForm(true)
  }

  const handleCloseCreateForm = () => {
    setShowCreateForm(false)
  }

  // Check if not loading but no account - this shouldn't happen with proper auth/account flow
  // but we guard against it for UX safety
  if (!isLoading && !accountLoading && !currentAccountId) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        </div>
        <div className="bg-white shadow rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="px-4 py-5 sm:p-6">
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-yellow-600" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No Account Selected
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Please select or create an account to view projects.
              </p>
              <div className="mt-6">
                <Link
                  to="/settings"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleShowCreateForm}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <Plus className="h-4 w-4 mr-2" />
            New
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading projects...</p>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No projects yet
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Create your first project to start organizing your inventory.
              </p>
              <div className="mt-6">
                <button
                  onClick={handleShowCreateForm}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Project
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div key={project.id} className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
              {/* Project Image */}
              {project.mainImageUrl && (
                <div className="w-full h-48 bg-gray-200 overflow-hidden">
                  <img
                    src={project.mainImageUrl}
                    alt={project.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-6">
                {/* Project Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <FolderOpen className={`h-8 w-8 text-primary-600 mr-3 ${project.mainImageUrl ? 'mt-2' : ''}`} />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {project.name}
                    </h3>
                  </div>
                </div>

                {/* Project Client */}
                <div className="mb-4">
                  <div className="text-sm font-normal text-gray-900 ml-11">
                    {project.clientName}
                  </div>
                </div>

                {/* Budget Progress */}
                <div className="mb-4">
                  <BudgetProgress
                    budget={project.budget}
                    designFee={project.designFee}
                    budgetCategories={project.budgetCategories}
                    transactions={transactions[project.id] || []}
                    previewMode={true}
                  />
                </div>




                {/* Action Button */}
                <div className="flex justify-center">
                  <ContextLink
                    to={buildContextUrl(projectItems(project.id))}
                    className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Open Project
                  </ContextLink>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project Creation Form */}
      {showCreateForm && (
        <ProjectForm
          onSubmit={handleCreateProject}
          onCancel={handleCloseCreateForm}
        />
      )}

    </div>
  )
}
