# Login — Screen contract

## Intent
Allow users to authenticate via Google OAuth or email/password. This screen is shown when protected routes are accessed without a resolved authenticated user.

## Inputs
- Route params: none
- Query params: none
- Entry points:
  - Rendered by `ProtectedRoute` when unauthenticated, missing app user, or auth timed out.

## Reads (local-first)
- Auth state:
  - `loading`, `userLoading`, `isAuthenticated`, `user`, `timedOutWithoutAuth` (via `useAuth()`)

## Writes (local-first)
- Initiate Google OAuth:
  - Calls `signIn()` from `AuthContext` (redirect happens immediately).
- Initiate email/password sign-in:
  - Calls `signInWithEmailPassword(email, password)` (auth listener loads app user after session establishes).

## UI structure (high level)
- Ledger logo + tagline
- Method tabs:
  - Google
  - Email & Password
- Error banner area
- Primary CTA for the chosen method

## User actions → behavior (the contract)
- Switch method tabs:
  - Switches between Google and email/password form
  - Clears any existing error message
- Google “Continue”:
  - Calls `signIn()` and expects an OAuth redirect
  - Errors surface as a generic “Failed to sign in” message
- Email/password “Sign In”:
  - Validates required email/password
  - Shows inline error message on validation or auth failure
  - On success, relies on auth listener to update global auth state and unlock protected routes

## States
- Loading:
  - While global auth is initializing, `ProtectedRoute` shows a spinner (Login may never render).
- Error:
  - Shows a red banner with message

## Collaboration / realtime expectations
- Not applicable.

## Performance notes
- Not applicable.

## Parity evidence
- Rendering conditions + fallback: `src/components/auth/ProtectedRoute.tsx`
- Login UI + method switching + validation: `src/components/auth/Login.tsx`
- Google auth redirect and callback route: `signInWithGoogle()` in `src/services/supabase.ts`
- Email/password sign-in: `signInWithEmailPassword()` in `src/services/supabase.ts`

