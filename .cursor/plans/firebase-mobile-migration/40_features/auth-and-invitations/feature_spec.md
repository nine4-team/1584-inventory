# Auth + invitations — Feature spec (Firebase mobile migration)

## Intent
Establish a reliable authentication and account-context bootstrap that supports:
- fast “already signed in” startup
- explicit “you must sign in” gating when unauthenticated
- invitation acceptance via tokenized links

This feature must be compatible with the migration’s invariants (local-first UI and cost-controlled sync), but **auth itself is network-dependent** except when restoring an existing session.

## Owned screens / routes

### Login (ProtectedRoute fallback)
- **Web parity source**: `src/components/auth/Login.tsx`
- **Rendered by**: `src/components/auth/ProtectedRoute.tsx`

### Auth callback
- **Route**: `/auth/callback`
- **Web parity source**: `src/pages/AuthCallback.tsx`

### Invite acceptance
- **Route**: `/invite/:token`
- **Web parity source**: `src/pages/InviteAccept.tsx`

## Primary flows

### 1) App boot → resolve auth → enter app or show login
Behavior:
- App mounts providers and initializes offline services early.
- Auth initializes by:
  - subscribing to auth state changes
  - calling `getSession()`
  - resolving the global auth loading state once initialization completes
- While auth is loading, protected routes render a spinner.
- If auth initialization stalls, a **safety timeout** forces loading to resolve and the app falls back to Login.

Parity evidence:
- Boot/providers: `src/main.tsx`
- Offline services init on app mount: `src/App.tsx` (initializes `offlineContext`, `offlineStore`, `operationQueue`, `syncScheduler`)
- Auth initialization + 7s timeout + `timedOutWithoutAuth`: `src/contexts/AuthContext.tsx`
- Protected gating (spinner then Login): `src/components/auth/ProtectedRoute.tsx`

### 2) Sign in with Google (OAuth redirect)
Behavior:
- User initiates Google sign-in.
- OAuth redirect navigates to `/auth/callback`.
- `/auth/callback` polls for session briefly, then navigates to `/` (Projects entry).
- The actual auth state transition is handled by the auth listener in `AuthContext` (it will create/update the app user record after `SIGNED_IN`).

Parity evidence:
- Google sign-in initiation: `src/components/auth/Login.tsx` → `signIn()` from `AuthContext`
- OAuth redirect setup: `signInWithGoogle()` in `src/services/supabase.ts` (redirectTo `/auth/callback`)
- Callback polling and navigation: `src/pages/AuthCallback.tsx`
- Fresh `SIGNED_IN` handling + user doc upsert: `src/contexts/AuthContext.tsx` (`onAuthStateChange`, `createOrUpdateUserDocument`, `getCurrentUserWithData`)

### 3) Sign in with email + password
Behavior:
- User enters email/password on Login.
- On successful sign-in, the AuthContext listener resolves the user document and app user state.

Parity evidence:
- Email/password login form validation + call: `src/components/auth/Login.tsx` → `signInWithEmailPassword()` (`src/services/supabase.ts`)
- Listener-driven app user load: `src/contexts/AuthContext.tsx` (`getCurrentUserWithData()`)

### 4) Invite acceptance (tokenized link) → Google or email/password signup
Behavior:
- Visiting `/invite/:token` verifies the token and displays signup options.
- The invite token is persisted locally so it can survive an OAuth redirect.

#### 4a) InviteAccept: token verification and state
- If no token: show error (“Invalid invitation link”).
- Verify invitation with a bounded timeout.
- If invitation is not found/expired: show error state.
- If valid:
  - store `pendingInvitationToken` in local storage
  - display invitation role indicator (admin vs member)
  - pre-fill email for email/password signup

Parity evidence:
- Token fetch + timeout + error states + local storage write: `src/pages/InviteAccept.tsx`
- Invitation token validation and expiry behavior: `getInvitationByToken()` in `src/services/supabase.ts`

#### 4b) InviteAccept → Google signup path (OAuth)
Behavior:
- User taps “Sign up with Google”.
- App initiates Google OAuth (redirect).
- On `/auth/callback`, if `pendingInvitationToken` exists:
  - fetch invitation details by token
  - store `pendingInvitationData` (accountId, role, invitationId)
  - clear `pendingInvitationToken` (but keep `pendingInvitationData` for user doc creation)
- AuthContext `SIGNED_IN` handler creates the user record and **accepts the invitation** using `pendingInvitationData`.

Parity evidence:
- OAuth initiation from InviteAccept: `src/pages/InviteAccept.tsx` → `signInWithGoogle()`
- Callback token handoff: `src/pages/AuthCallback.tsx` (reads `pendingInvitationToken`, writes `pendingInvitationData`)
- Consumption of `pendingInvitationData` in user doc creation: `createOrUpdateUserDocument()` in `src/services/supabase.ts`

#### 4c) InviteAccept → email/password signup path (with email verification branch)
Behavior:
- Validations:
  - email required
  - password required and \(\ge 6\) chars
  - confirm password matches
- After calling email/password signup:
  - if session is `null`, show “Check your email” verification screen (do not proceed)
  - else navigate to `/auth/callback` so the invitation can be processed like OAuth

Parity evidence:
- Validation + signup + email verification branch: `src/pages/InviteAccept.tsx`
- Email signup configuration (emailRedirectTo `/auth/callback`): `signUpWithEmailPassword()` in `src/services/supabase.ts`

## Account context resolution (required for app entry)
Behavior:
- Account context loads after auth resolves.
- If account can’t be fetched (offline or error), the app applies an offline fallback account id (if cached).
- Offline context persistence is a join of `userId` (from AuthContext) and `accountId` (from AccountContext).

Parity evidence:
- Account context load strategy + offline fallback: `src/contexts/AccountContext.tsx`
- Offline context persistence rules: `src/services/offlineContext.ts` + updates from:
  - `src/contexts/AuthContext.tsx` (persists `userId`)
  - `src/contexts/AccountContext.tsx` (persists `accountId`)

## Offline-first behavior (mobile target)

### Auth while offline
Policy:
- **If a prior session is present** (Firebase Auth cached credentials), allow boot into the app and render local DB content.
- **If no prior session is present**, block with “requires connection” messaging (sign-in cannot be completed offline).

Parity evidence (web equivalent concept):
- Session persistence in local storage: `src/services/supabase.ts` (persistSession + localStorage storageKey)
- Protected-route fallback when unauthenticated: `src/components/auth/ProtectedRoute.tsx`

### Restart behavior
- On restart, auth should rehydrate session and avoid a long loading spinner if credentials exist.
- If auth cannot resolve within the safety timeout, fall back to login to avoid indefinite loading.

Parity evidence:
- Auth init with safety timeout: `src/contexts/AuthContext.tsx`

## Firebase migration notes (intentional deltas / requirements)
- Replace Supabase Auth with Firebase Auth (Google + email/password).
- Replace web redirect callback with mobile-appropriate OAuth/deep-link handling. The behavioral contract remains:
  - “Complete sign-in…” interstitial
  - bounded wait for session availability
  - invitation token bridging across auth redirect
- Invitation acceptance should be server-owned:
  - validate token
  - create membership / user profile defaults
  - mark invitation accepted
  - be idempotent (safe retries)

