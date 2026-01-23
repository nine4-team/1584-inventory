import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../ui/Button'
import { signInWithEmailPassword } from '../../services/supabase'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'

interface LoginProps {
  onSuccess?: () => void
}

export default function Login({ onSuccess }: LoginProps) {
  const { signIn, loading } = useAuth()
  const [error, setError] = useState<string>('')
  const [loginMethod, setLoginMethod] = useState<'google' | 'email'>('google')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  const handleGoogleSignIn = async () => {
    try {
      setError('')
      await signIn()
      onSuccess?.()
    } catch (err) {
      console.error('Login error:', err)
      setError('Failed to sign in. Please try again.')
    }
  }

  const handleEmailPasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }

    try {
      setSigningIn(true)
      setError('')
      
      await signInWithEmailPassword(email.trim(), password)
      
      // If successful, the auth state change listener in AuthContext will handle
      // user document creation and state updates, then redirect
      onSuccess?.()
    } catch (err: any) {
      console.error('Error signing in:', err)
      setError(err.message || 'Failed to sign in. Please check your email and password.')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full">
        <div className="-mt-8">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center justify-center p-2.5 rounded-[30px] bg-white border border-black/[0.06] shadow-[0_12px_28px_rgba(0,0,0,0.14)]">
              <img 
                src="/ledger_logo.png" 
                alt="Ledger logo" 
                className="w-[clamp(100px,9vw,180px)] h-auto rounded-[20px] block" 
              />
            </span>
          </div>
          {/* <h2 className="text-center text-4xl font-extrabold text-gray-900">
            <span className="text-primary-600">Ledger</span>
          </h2> */}
          <p className="mt-2 text-center text-gray-600" style={{ fontSize: 'clamp(0.9375rem, 2.5vw, 1.25rem)' }}>
          For <strong className="font-semibold">Interior Designers</strong> by <strong className="font-semibold">Interior Designers</strong>
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {/* Login Method Tabs */}
          <div>
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => {
                  setLoginMethod('google')
                  setError('')
                }}
                className={`flex-1 py-2 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
                  loginMethod === 'google'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Google
              </button>
              <button
                onClick={() => {
                  setLoginMethod('email')
                  setError('')
                }}
                className={`flex-1 py-2 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
                  loginMethod === 'email'
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
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex items-center">
                <AlertCircle className="h-4 w-4 text-red-600 mr-2" />
                <div className="text-sm text-red-600">{error}</div>
              </div>
            </div>
          )}

          {/* Google Sign In */}
          {loginMethod === 'google' && (
            <div>
              <Button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
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
                {loading ? 'Signing in...' : 'Continue with Google'}
              </Button>
            </div>
          )}

          {/* Email/Password Sign In */}
          {loginMethod === 'email' && (
            <form onSubmit={handleEmailPasswordSignIn} className="space-y-4">
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
                  autoComplete="email"
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
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={signingIn}
                className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {signingIn ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
