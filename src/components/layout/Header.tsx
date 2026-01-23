import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useBusinessProfile } from '../../contexts/BusinessProfileContext'
import { Button } from '../ui/Button'
import { LogOut, Settings, Package, FolderOpen } from 'lucide-react'

export default function Header() {
  const { user, signOut, loading } = useAuth()
  const { businessName } = useBusinessProfile()
  const location = useLocation()

  const isProjectsActive = location.pathname.startsWith('/projects') || location.pathname.startsWith('/project') || location.pathname === '/'
  const isBusinessInventoryActive = location.pathname.startsWith('/business-inventory')
  const isSettingsActive = location.pathname.startsWith('/settings')

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 print:hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center gap-2">
          {/* Left side - Logo and business name */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center">
              <span className="inline-flex items-center justify-center p-1.5 rounded-[12px] bg-white border border-black/[0.06] shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
                <img 
                  src="/ledger_logo.png" 
                  alt="Ledger" 
                  className="h-9 w-auto rounded-[8px] block" 
                />
              </span>
            </Link>
            {businessName && (
              <Link to="/" className="text-xl font-bold text-gray-900 hidden sm:block">
                {businessName}
              </Link>
            )}
          </div>

          {/* Right side - All navigation and user controls */}
          <div className="flex items-center">
            {user && (
              <div className="flex items-center space-x-1">
                {/* Navigation Tabs */}
                <nav className="flex space-x-0 sm:space-x-1">
                  <Link
                    to="/"
                    className={`inline-flex items-center px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-all duration-200 border-b-2 ${
                      isProjectsActive
                        ? 'border-primary-500 text-gray-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                    title="Projects"
                  >
                    <FolderOpen className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Projects</span>
                  </Link>
                  <Link
                    to="/business-inventory"
                    className={`inline-flex items-center px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-all duration-200 border-b-2 ${
                      isBusinessInventoryActive
                        ? 'border-primary-500 text-gray-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                    title="Inventory"
                  >
                    <Package className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Inventory</span>
                  </Link>
                </nav>

                {/* Settings */}
                <Link
                  to="/settings"
                  className={`flex items-center px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-all duration-200 border-b-2 ${
                    isSettingsActive
                      ? 'border-primary-500 text-gray-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                  title="Settings"
                >
                  <Settings className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Settings</span>
                </Link>

                {/* Sign Out */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={signOut}
                  disabled={loading}
                  className="flex items-center px-2 sm:px-3 ml-2 sm:ml-3"
                  title="Sign Out"
                >
                  <LogOut className="h-3 w-3 sm:h-4 sm:w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
