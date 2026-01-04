import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { signInWithGoogle, signUpWithEmailPassword, supabase } from '../services/supabase'
import { getInvitationByToken } from '../services/supabase'
import { UserRole } from '../types'
import { Mail, Shield, Users, AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useStackedNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<{
    email: string;
    role: UserRole;
  } | null>(null)
  const [signupMethod, setSignupMethod] = useState<'google' | 'email'>('google')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
  const [emailVerificationSent, setEmailVerificationSent] = useState(false)

  useEffect(() => {
    const checkInvitation = async () => {
      if (!token) {
        setError('Invalid invitation link')
        setLoading(false)
        return
      }

      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        console.error('Invitation check timeout')
        setError('Request timed out. Please try again.')
        setLoading(false)
      }, 10000) // 10 second timeout

      try {
        const inv = await getInvitationByToken(token)
        clearTimeout(timeoutId)
        
        if (!inv) {
          setError('Invitation not found or has expired')
          setLoading(false)
          return
        }

        // Store token in localStorage so we can check it after OAuth redirect
        localStorage.setItem('pendingInvitationToken', token)
        setInvitation({
          email: inv.email,
          role: inv.role
        })
        // Pre-fill email for email/password signup
        setEmail(inv.email)
        setLoading(false)
      } catch (err) {
        clearTimeout(timeoutId)
        console.error('Error checking invitation:', err)
        setError('Failed to verify invitation. Please try again.')
        setLoading(false)
      }
    }

    checkInvitation()
  }, [token])

  const handleSignUp = async () => {
    if (!token) return
    
    try {
      // Token is already stored in localStorage from useEffect
      // Redirect to Google OAuth
      await signInWithGoogle()
      // The OAuth redirect will happen, and AuthCallback will handle accepting the invitation
    } catch (err) {
      console.error('Error initiating sign up:', err)
      setError('Failed to start sign up process')
    }
  }

  const handleEmailPasswordSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    // Validation
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    try {
      setSigningUp(true)
      setError(null)
      
      // Token is already stored in localStorage from useEffect
      await signUpWithEmailPassword(email.trim(), password)
      
      // Check if email confirmation is required
      // If session is null, email confirmation is required
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setEmailVerificationSent(true)
      } else {
        // If session exists, redirect to callback to process invitation
        navigate('/auth/callback')
      }
    } catch (err: any) {
      console.error('Error signing up:', err)
      setError(err.message || 'Failed to create account')
    } finally {
      setSigningUp(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Verifying invitation...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
            Invalid Invitation
          </h2>
          <p className="text-gray-600 text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  if (emailVerificationSent) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full mb-4">
            <Mail className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
            Check Your Email
          </h2>
          <p className="text-gray-600 text-center mb-6">
            We've sent a verification email to <span className="font-medium">{email}</span>.
            Click the link in the email to activate your account.
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  if (!invitation) {
    return null
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-primary-100 rounded-full mb-4">
          <Mail className="h-6 w-6 text-primary-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Welcome to Ledger!
        </h2>
        <p className="text-gray-600 text-center mb-6">
          Create your account below to get started.
        </p>
        <div className="flex items-center justify-center mb-6">
          {invitation.role === UserRole.ADMIN ? (
            <Shield className="h-5 w-5 text-blue-500" />
          ) : (
            <Users className="h-5 w-5 text-gray-500" />
          )}
        </div>

        {/* Signup Method Tabs */}
        <div className="mb-6">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => {
                setSignupMethod('google')
                setError(null)
              }}
              className={`flex-1 py-2 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
                signupMethod === 'google'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Google
            </button>
            <button
              onClick={() => {
                setSignupMethod('email')
                setError(null)
              }}
              className={`flex-1 py-2 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
                signupMethod === 'email'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Email & Password
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <div className="flex items-center">
              <AlertCircle className="h-4 w-4 text-red-600 mr-2" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Google Signup */}
        {signupMethod === 'google' && (
          <>
            <button
              onClick={handleSignUp}
              className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 font-medium flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Sign up with Google</span>
            </button>
          </>
        )}

        {/* Email/Password Signup */}
        {signupMethod === 'email' && (
          <form onSubmit={handleEmailPasswordSignup} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border"
                placeholder="user@example.com"
                required
                disabled={signingUp}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border pr-10"
                  placeholder="Enter password"
                  required
                  disabled={signingUp}
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border pr-10"
                  placeholder="Confirm password"
                  required
                  disabled={signingUp}
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={signingUp || !email.trim() || !password || password !== confirmPassword}
              className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signingUp ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
        )}

        <p className="text-xs text-gray-500 text-center mt-4">
          By creating your account, you'll gain access to manage inventory and track transactions.
        </p>
      </div>
    </div>
  )
}

