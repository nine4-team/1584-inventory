import { useState } from 'react'
import { User, Settings as SettingsIcon, Building2, Upload, Tag } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useAccount } from '../contexts/AccountContext'
import { useBusinessProfile } from '../contexts/BusinessProfileContext'
import { businessProfileService } from '../services/businessProfileService'
import { ImageUploadService } from '../services/imageService'
import UserManagement from '../components/auth/UserManagement'
import AccountManagement from '../components/auth/AccountManagement'
import TaxPresetsManager from '../components/TaxPresetsManager'
import VendorDefaultsManager from '../components/VendorDefaultsManager'
import BudgetCategoriesManager from '../components/BudgetCategoriesManager'
import { Button } from '../components/ui/Button'

export default function Settings() {
  const { user, isOwner } = useAuth()
  const { currentAccountId, isAdmin } = useAccount()
  const { businessProfile, businessName, businessLogoUrl, refreshProfile } = useBusinessProfile()
  const [businessNameInput, setBusinessNameInput] = useState(businessName)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(businessLogoUrl || null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'presets' | 'account' | 'users'>('general')

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!ImageUploadService.validateImageFile(file)) {
        setProfileError('Invalid image file. Please upload a valid image (JPEG, PNG, GIF, WebP) under 10MB.')
        return
      }
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setProfileError(null)
    }
  }

  const handleSaveProfile = async () => {
    if (!currentAccountId || !user) return

    setIsSavingProfile(true)
    setProfileError(null)
    setProfileSuccess(false)

    try {
      let logoUrl = businessLogoUrl || null

      // Upload logo if a new file was selected
      if (logoFile) {
        console.log('Attempting to upload business logo...')
        const uploadResult = await ImageUploadService.uploadBusinessLogo(currentAccountId, logoFile)
        logoUrl = uploadResult.url
        console.log('Business logo uploaded successfully.')
      }

      // Update business profile
      console.log('Attempting to update business profile...')
      await businessProfileService.updateBusinessProfile(
        currentAccountId,
        businessNameInput.trim(),
        logoUrl,
        user.id
      )
      console.log('Business profile updated successfully.')

      // Refresh profile to get updated data
      console.log('Attempting to refresh profile...')
      await refreshProfile()
      console.log('Profile refreshed successfully.')
      setProfileSuccess(true)
      setLogoFile(null)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (error: any) {
      console.error('Error saving business profile:', error)
      setProfileError(error.message || 'Failed to save business profile. Please try again.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your account settings and preferences.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-md shadow-sm">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px space-x-6 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('general')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'general' ? 'border-primary-500 text-gray-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('presets')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'presets' ? 'border-primary-500 text-gray-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Presets
            </button>
            {(isOwner() || isAdmin) && (
              <button
                onClick={() => setActiveTab('users')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'users' ? 'border-primary-500 text-gray-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                Users
              </button>
            )}
            {isOwner() && (
              <button
                onClick={() => setActiveTab('account')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'account' ? 'border-primary-500 text-gray-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                Account
              </button>
            )}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'general' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profile Section */}
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <div className="flex-shrink-0">
                    <User className="h-8 w-8 text-gray-400" />
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      Profile
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Manage your account settings and preferences
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Profile Information</h4>
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Full Name</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md text-sm text-gray-900">{user?.fullName}</div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md text-sm text-gray-900">{user?.email}</div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Role</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md text-sm text-gray-900 capitalize">
                          {user?.role}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          Contact an administrator to change your role.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Business Profile Section - Only for admins */}
            {isAdmin && (
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center mb-4">
                    <div className="flex-shrink-0">
                      <Building2 className="h-8 w-8 text-gray-400" />
                    </div>
                    <div className="ml-4 flex-1">
                      <h3 className="text-lg font-medium text-gray-900">
                        Business Profile
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Manage your business name and logo for invoices and branding
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Business Name */}
                    <div>
                      <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1">
                        Business Name
                      </label>
                      <input
                        type="text"
                        id="businessName"
                        value={businessNameInput}
                        onChange={(e) => setBusinessNameInput(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        placeholder="Enter business name"
                      />
                    </div>

                    {/* Logo Upload */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Business Logo
                      </label>
                      <div className="flex items-start space-x-4">
                        {logoPreview && (
                          <div className="flex-shrink-0">
                            <img
                              src={logoPreview}
                              alt="Business logo preview"
                              className="h-24 w-24 object-contain border border-gray-300 rounded"
                            />
                          </div>
                        )}
                        <div className="flex-1">
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleLogoChange}
                              className="hidden"
                            />
                            <div className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                              <Upload className="h-4 w-4 mr-2" />
                              {logoFile ? 'Change Logo' : logoPreview ? 'Change Logo' : 'Upload Logo'}
                            </div>
                          </label>
                          <p className="mt-2 text-xs text-gray-500">
                            Recommended: Square image, at least 200x200px. Max size: 10MB
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Error/Success Messages */}
                    {profileError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm text-red-800">{profileError}</p>
                      </div>
                    )}
                    {profileSuccess && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                        <p className="text-sm text-green-800">Business profile saved successfully!</p>
                      </div>
                    )}

                    {/* Save Button */}
                    <div className="pt-4">
                      <Button
                        onClick={handleSaveProfile}
                        disabled={isSavingProfile || !businessNameInput.trim()}
                        className="w-full sm:w-auto"
                      >
                        {isSavingProfile ? 'Saving...' : 'Save Business Profile'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'presets' && (
          <div className="space-y-6">
            {isAdmin ? (
              <>
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-6">
                    {/* Section header removed — manager renders its own title/description */}
                    <BudgetCategoriesManager />
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-6">
                    {/* Section header removed — manager renders its own title/description */}
                    <VendorDefaultsManager />
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-6">
                    {/* Section header removed — manager renders its own title/description */}
                    <TaxPresetsManager />
                  </div>
                </div>
              </>
            ) : (
              <div className="p-6 bg-white rounded-md shadow">
                <p className="text-sm text-gray-600">Presets are only configurable by account administrators.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'account' && (
          <div className="space-y-6">
            {/* Account management visible only to owners */}
            {isOwner() ? (
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <AccountManagement />
                </div>
              </div>
            ) : (
              <div className="p-6 bg-white rounded-md shadow">
                <p className="text-sm text-gray-600">Account management is only available to account owners.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* User management visible to owners and admins */}
            {(isOwner() || isAdmin) ? (
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <UserManagement />
                </div>
              </div>
            ) : (
              <div className="p-6 bg-white rounded-md shadow">
                <p className="text-sm text-gray-600">User management is only available to account owners and administrators.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
