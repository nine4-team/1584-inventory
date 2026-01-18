import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense, ReactNode, useEffect } from 'react'
import Layout from './components/layout/Layout'
import LoadingSpinner from './components/ui/LoadingSpinner'
import { ToastProvider } from './components/ui/ToastContext'
import { AccountProvider } from '@/contexts/AccountContext'
import { BusinessProfileProvider } from './contexts/BusinessProfileContext'
import { ProjectRealtimeProvider } from './contexts/ProjectRealtimeContext'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { NetworkStatus } from './components/NetworkStatus'
import { SyncStatus } from './components/SyncStatus'
import { BackgroundSyncErrorNotifier } from './components/BackgroundSyncErrorNotifier'
import { StorageQuotaWarning } from './components/ui/StorageQuotaWarning'
import { offlineStore } from './services/offlineStore'
import { operationQueue } from './services/operationQueue'
import { initSyncScheduler } from './services/syncScheduler'
import { offlineMediaService } from './services/offlineMediaService'

const withRouteSuspense = (element: ReactNode, fallback?: ReactNode) => (
  <Suspense fallback={fallback ?? <LoadingSpinner />}>{element}</Suspense>
)

function App() {
  useEffect(() => {
    // Initialize offline store and operation queue on app startup
    // This ensures offlineContext is hydrated before offline-first screens render
    const initOfflineServices = async () => {
      try {
        // Initialize offline context first - this is critical for offline-first screens
        const { initOfflineContext } = await import('./services/offlineContext')
        await initOfflineContext()
        console.log('[App] Offline context initialized')

        await offlineStore.init()
        console.log('[App] Offline store initialized')

        await operationQueue.init()
        console.log('[App] Operation queue initialized')

        await initSyncScheduler()

        // Preload offline-critical services and routes when online to warm caches
        if (navigator.onLine) {
          Promise.all([
            import('./services/offlineTransactionService'),
            import('./pages/Projects'),
            import('./pages/ProjectLayout'),
            import('./pages/ProjectItemsPage'),
            import('./pages/ProjectTransactionsPage'),
            import('./pages/AddTransaction'),
            import('./pages/TransactionDetail'),
            import('./pages/ItemDetail')
          ]).then(() => {
            console.log('[App] Offline-critical modules preloaded')
          }).catch(err => {
            console.warn('[App] Failed to preload offline-critical modules:', err)
          })
        }

        // Cleanup expired media files on app start
        try {
          const cleanedCount = await offlineMediaService.cleanupExpiredMedia()
          if (cleanedCount > 0) {
            console.log(`[App] Cleaned up ${cleanedCount} expired media files`)
          }
        } catch (error) {
          console.error('[App] Failed to cleanup expired media:', error)
        }
      } catch (error) {
        console.error('[App] Failed to initialize offline services:', error)
      }
    }

    initOfflineServices()
  }, [])

  return (
    <AccountProvider>
      <BusinessProfileProvider>
        <ProjectRealtimeProvider>
          <ToastProvider>
            <NetworkStatus />
            <SyncStatus />
            <BackgroundSyncErrorNotifier />
            <div className="fixed top-16 left-0 right-0 z-40 px-4 pt-2">
              <StorageQuotaWarning />
            </div>
            <Routes>
            <Route path="/auth/callback" element={withRouteSuspense(<AuthCallback />)} />
            <Route path="/invite/:token" element={withRouteSuspense(<InviteAccept />)} />

            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/" element={withRouteSuspense(<Projects />)} />
                      <Route path="/projects" element={withRouteSuspense(<Projects />)} />
                      <Route path="/settings" element={withRouteSuspense(<Settings />)} />
                      <Route path="/item/:id" element={withRouteSuspense(<ItemDetail />)} />

                      <Route path="/project/:projectId/*" element={withRouteSuspense(<ProjectLayout />)}>
                        <Route index element={withRouteSuspense(<ProjectLegacyTabRedirect />)} />
                        <Route path="items" element={withRouteSuspense(<ProjectItemsPage />)} />
                        <Route path="transactions" element={withRouteSuspense(<ProjectTransactionsPage />)} />
                        <Route path="budget" element={withRouteSuspense(<ProjectBudgetPage />)} />
                      </Route>

                      <Route path="/project/:projectId/invoice" element={withRouteSuspense(<ProjectInvoice />)} />
                      <Route
                        path="/project/:projectId/property-management-summary"
                        element={withRouteSuspense(<PropertyManagementSummary />)}
                      />
                      <Route
                        path="/project/:projectId/client-summary"
                        element={withRouteSuspense(<ClientSummary />)}
                      />

                      <Route path="/project/:projectId/items/new" element={withRouteSuspense(<AddItem />)} />
                      <Route path="/project/:projectId/items/:itemId" element={withRouteSuspense(<ItemDetail />)} />
                      <Route
                        path="/project/:projectId/items/:itemId/edit"
                        element={withRouteSuspense(<EditItem />)}
                      />
                      <Route
                        path="/project/:projectId/transactions/new"
                        element={withRouteSuspense(<AddTransaction />)}
                      />
                      <Route
                        path="/project/:projectId/transactions/import-wayfair"
                        element={withRouteSuspense(<ImportWayfairInvoice />)}
                      />
                      <Route
                        path="/project/:projectId/transactions/:transactionId"
                        element={withRouteSuspense(<TransactionDetail />)}
                      />
                      <Route
                        path="/project/:projectId/transactions/:transactionId/edit"
                        element={withRouteSuspense(<EditTransaction />)}
                      />

                      <Route
                        path="/project/:id/item/:itemId"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="item-detail" />
                        )}
                      />
                      <Route
                        path="/project/:id/item/add"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="item-new" />
                        )}
                      />
                      <Route
                        path="/project/:id/edit-item/:itemId"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="item-edit" />
                        )}
                      />
                      <Route
                        path="/project/:id/transaction/add"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="transaction-new" />
                        )}
                      />
                      <Route
                        path="/project/:id/transaction/import-wayfair"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="transaction-import" />
                        )}
                      />
                      <Route
                        path="/project/:id/transaction/:transactionId/edit"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="transaction-edit" />
                        )}
                      />
                      <Route
                        path="/project/:id/transaction/:transactionId"
                        element={withRouteSuspense(
                          <ProjectLegacyEntityRedirect type="transaction-detail" />
                        )}
                      />

                      <Route path="/business-inventory" element={withRouteSuspense(<BusinessInventory />)} />
                      <Route
                        path="/business-inventory/add"
                        element={withRouteSuspense(<AddBusinessInventoryItem />)}
                      />
                      <Route
                        path="/business-inventory/:id"
                        element={withRouteSuspense(<BusinessInventoryItemDetail />)}
                      />
                      <Route
                        path="/business-inventory/:id/edit"
                        element={withRouteSuspense(<EditBusinessInventoryItem />)}
                      />
                      <Route
                        path="/business-inventory/transaction/add"
                        element={withRouteSuspense(<AddBusinessInventoryTransaction />)}
                      />
                      <Route
                        path="/business-inventory/transaction/:transactionId"
                        element={withRouteSuspense(<TransactionDetail />)}
                      />
                      <Route
                        path="/business-inventory/transaction/:projectId/:transactionId/edit"
                        element={withRouteSuspense(<EditBusinessInventoryTransaction />)}
                      />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
          </ToastProvider>
        </ProjectRealtimeProvider>
      </BusinessProfileProvider>
    </AccountProvider>
  )
}

const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const InviteAccept = lazy(() => import('./pages/InviteAccept'))
const Projects = lazy(() => import('./pages/Projects'))
const ItemDetail = lazy(() => import('./pages/ItemDetail'))
const ProjectLayout = lazy(() => import('./pages/ProjectLayout'))
const ProjectItemsPage = lazy(() => import('./pages/ProjectItemsPage'))
const ProjectTransactionsPage = lazy(() => import('./pages/ProjectTransactionsPage'))
const ProjectBudgetPage = lazy(() => import('./pages/ProjectBudgetPage'))
const ProjectLegacyTabRedirect = lazy(() => import('./pages/ProjectLegacyTabRedirect'))
const ProjectLegacyEntityRedirect = lazy(() => import('./pages/ProjectLegacyEntityRedirect'))
const ProjectInvoice = lazy(() => import('./pages/ProjectInvoice'))
const PropertyManagementSummary = lazy(() => import('./pages/PropertyManagementSummary'))
const ClientSummary = lazy(() => import('./pages/ClientSummary'))
const AddItem = lazy(() => import('./pages/AddItem'))
const EditItem = lazy(() => import('./pages/EditItem'))
const AddTransaction = lazy(() => import('./pages/AddTransaction'))
const ImportWayfairInvoice = lazy(() => import('./pages/ImportWayfairInvoice'))
const EditTransaction = lazy(() => import('./pages/EditTransaction'))
const TransactionDetail = lazy(() => import('./pages/TransactionDetail'))
const Settings = lazy(() => import('./pages/Settings'))
const BusinessInventory = lazy(() => import('./pages/BusinessInventory'))
const BusinessInventoryItemDetail = lazy(() => import('./pages/BusinessInventoryItemDetail'))
const AddBusinessInventoryItem = lazy(() => import('./pages/AddBusinessInventoryItem'))
const EditBusinessInventoryItem = lazy(() => import('./pages/EditBusinessInventoryItem'))
const AddBusinessInventoryTransaction = lazy(() => import('./pages/AddBusinessInventoryTransaction'))
const EditBusinessInventoryTransaction = lazy(() => import('./pages/EditBusinessInventoryTransaction'))

export default App
