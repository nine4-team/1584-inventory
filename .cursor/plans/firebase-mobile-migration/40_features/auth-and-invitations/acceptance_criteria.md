# Auth + invitations — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Routing + boot
- [ ] **Routes exist**: `/auth/callback` and `/invite/:token` routes exist outside the protected app shell.  
  Observed in `src/App.tsx`.
- [ ] **Providers are mounted**: `AuthProvider` wraps the app before `App` renders so ProtectedRoute can read auth state.  
  Observed in `src/main.tsx`.
- [ ] **Offline services initialize early**: offline context is initialized at app start to support offline-first screens.  
  Observed in `src/App.tsx` (`initOfflineContext()` then offline store + operation queue init).

## Protected route gating
- [ ] **Spinner while auth is resolving**: while `loading || userLoading`, protected routes render a full-screen loading indicator.  
  Observed in `src/components/auth/ProtectedRoute.tsx`.
- [ ] **Fallback to Login**: when unauthenticated, missing app user, or auth timed out, protected routes render `<Login />`.  
  Observed in `src/components/auth/ProtectedRoute.tsx`.
- [ ] **Auth safety timeout**: auth initialization has a bounded timeout (7s) that forces `loading=false` and sets `timedOutWithoutAuth` when no user exists.  
  Observed in `src/contexts/AuthContext.tsx` (timeout branch sets `timedOutWithoutAuth`).

## Login (Google + email/password)
- [ ] **Login methods**: Login offers Google and Email/Password methods with a switchable UI.  
  Observed in `src/components/auth/Login.tsx`.
- [ ] **Google sign-in launches OAuth**: tapping Google sign-in calls AuthContext `signIn()` which initiates OAuth redirect to `/auth/callback`.  
  Observed in `src/components/auth/Login.tsx` and `signInWithGoogle()` in `src/services/supabase.ts`.
- [ ] **Email/password validation**: login requires non-empty email and password and shows an error message on failure.  
  Observed in `src/components/auth/Login.tsx`.
- [ ] **Email/password sign-in uses Supabase auth password flow (parity)**.  
  Observed in `signInWithEmailPassword()` in `src/services/supabase.ts`.

## Auth callback
- [ ] **Bounded wait for session**: callback polls for session up to a bounded limit, then navigates to `/` regardless.  
  Observed in `src/pages/AuthCallback.tsx` (`maxAttempts` loop + `navigate('/')`).
- [ ] **Invitation token bridge**: if `pendingInvitationToken` exists, callback attempts to fetch invitation info and stores `pendingInvitationData`, then clears the token.  
  Observed in `src/pages/AuthCallback.tsx` + `checkInvitationByToken()` in `src/services/supabase.ts`.

## Invite acceptance
- [ ] **Token required**: if `token` param is missing, show “Invalid invitation link”.  
  Observed in `src/pages/InviteAccept.tsx`.
- [ ] **Token verification is bounded**: invitation lookup is protected by a timeout that fails with “Request timed out…”.  
  Observed in `src/pages/InviteAccept.tsx`.
- [ ] **Expired/invalid token shows error state**: when invitation is not found or expired, show an “Invalid Invitation” error UI.  
  Observed in `src/pages/InviteAccept.tsx` + expiry behavior in `getInvitationByToken()` (`src/services/supabase.ts`).
- [ ] **Token persisted across redirect**: for valid tokens, store `pendingInvitationToken` locally to survive OAuth redirect.  
  Observed in `src/pages/InviteAccept.tsx`.
- [ ] **Google signup path**: tapping “Sign up with Google” initiates OAuth; invitation is processed after callback and sign-in.  
  Observed in `src/pages/InviteAccept.tsx` + `src/pages/AuthCallback.tsx` + `createOrUpdateUserDocument()` (`src/services/supabase.ts`).
- [ ] **Email/password signup validations**: email required; password required and \(\ge 6\); confirm password must match.  
  Observed in `src/pages/InviteAccept.tsx`.
- [ ] **Email verification branch**: if signup results in `session=null`, show “Check your email” screen and do not proceed to callback.  
  Observed in `src/pages/InviteAccept.tsx`.
- [ ] **If session exists after signup**: navigate to `/auth/callback` to process invitation acceptance.  
  Observed in `src/pages/InviteAccept.tsx`.

## Account context + offline context persistence
- [ ] **Account resolves after auth**: account loading backs off while auth is loading; if user is null, account is cleared.  
  Observed in `src/contexts/AccountContext.tsx`.
- [ ] **Offline fallback account id**: when online load fails or is unavailable, `offlineFallbackAccountId` can be applied to set `currentAccountId`.  
  Observed in `src/contexts/AccountContext.tsx`.
- [ ] **Offline context requires both userId and accountId**: offline context is persisted only when both are present; otherwise it is cleared.  
  Observed in `src/services/offlineContext.ts`.

## Firebase migration requirements (intentional deltas)
- [ ] **Auth provider**: replace Supabase Auth with Firebase Auth but preserve the behavioral contracts above.  
  **Intentional delta** (migration requirement).
- [ ] **Invitation acceptance is server-owned**: token validation + membership creation + invitation acceptance is implemented via server-owned Functions/transactions and is idempotent.  
  **Intentional delta** (migration requirement).
- [ ] **Offline policy**: if no cached session exists, sign-in/invite acceptance is blocked while offline with explicit messaging; if cached session exists, allow offline boot.  
  **Intentional delta** (mobile constraint; auth requires network).

