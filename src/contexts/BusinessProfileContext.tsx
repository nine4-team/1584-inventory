import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useAccount } from './AccountContext'
import { businessProfileService } from '../services/businessProfileService'
import { BusinessProfile } from '../types'

interface BusinessProfileContextType {
  businessProfile: BusinessProfile | null
  businessName: string
  businessLogoUrl: string | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const BusinessProfileContext = createContext<BusinessProfileContextType | undefined>(undefined)

interface BusinessProfileProviderProps {
  children: ReactNode
}

export function BusinessProfileProvider({ children }: BusinessProfileProviderProps) {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async () => {
    if (!currentAccountId) {
      setBusinessProfile(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const profile = await businessProfileService.getBusinessProfile(currentAccountId)
      setBusinessProfile(profile)
    } catch (error) {
      console.error('Error loading business profile:', error)
      setBusinessProfile(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (accountLoading) {
      setLoading(true)
      return
    }
    loadProfile()
  }, [currentAccountId, accountLoading])

  // Derived values
  // Note: businessProfileService already handles fallback to account name,
  // so businessProfile?.name should always have a value if account exists
  const businessName = businessProfile?.name || ''
  const businessLogoUrl = businessProfile?.logoUrl || null

  const value: BusinessProfileContextType = {
    businessProfile,
    businessName,
    businessLogoUrl,
    loading,
    refreshProfile: loadProfile
  }

  return (
    <BusinessProfileContext.Provider value={value}>
      {children}
    </BusinessProfileContext.Provider>
  )
}

export function useBusinessProfile() {
  const context = useContext(BusinessProfileContext)
  if (context === undefined) {
    throw new Error('useBusinessProfile must be used within a BusinessProfileProvider')
  }
  return context
}

