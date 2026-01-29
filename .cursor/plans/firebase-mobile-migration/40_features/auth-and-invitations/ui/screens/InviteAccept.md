# InviteAccept — Screen contract

## Intent
Allow an invited user to join an account via a tokenized link, using either Google OAuth or email/password signup. Persist the invite token across OAuth redirects so the invitation can be accepted after authentication.

## Inputs
- Route params:
  - `token` (required)
- Query params: none
- Entry points:
  - External link to `/invite/:token`

## Reads (local-first)
- Route param `token`
- Local storage (web parity) for invitation bridging:
  - reads/writes `pendingInvitationToken`

## Writes (local-first)
User actions:
- Verify invitation token:
  - calls `getInvitationByToken(token)`
  - writes `pendingInvitationToken` to local storage on success
- Initiate Google OAuth signup:
  - calls `signInWithGoogle()` (redirect)
- Initiate email/password signup:
  - calls `signUpWithEmailPassword(email, password)`
  - checks session after signup to decide whether to show email verification state vs continue
- Navigation:
  - if a session exists after signup, navigate to `/auth/callback` to finish processing invitation

## UI structure (high level)
- Loading state (“Verifying invitation…”)
- Error state (“Invalid Invitation” + CTA back to home)
- Email verification state (“Check your email”)
- Main signup card:
  - Role indicator (admin vs member)
  - Signup method tabs (Google vs email/password)
  - Google signup CTA OR email/password form (password + confirm password with show/hide toggles)

## User actions → behavior (the contract)
- On mount:
  - if `token` missing → show “Invalid invitation link”
  - otherwise verify token with bounded timeout
  - if valid:
    - store `pendingInvitationToken`
    - set `invitation` state (email + role)
    - prefill email in the email/password form
- Google signup:
  - initiates OAuth redirect; invitation acceptance is completed after callback + auth listener processing
- Email/password signup:
  - validates:
    - email present
    - password present and \(\ge 6\)
    - confirm password matches
  - calls signup
  - checks session:
    - if no session: show “Check your email”
    - if session exists: navigate to `/auth/callback`

## States
- Loading:
  - full screen spinner + copy “Verifying invitation…”
- Error:
  - show “Invalid Invitation” card with message
- Email verification:
  - show “Check your email” card

## Media (if applicable)
- None.

## Collaboration / realtime expectations
- Not applicable.

## Performance notes
- Invitation verification should be bounded (timeout).

## Parity evidence
- Token verification, local storage token persistence, and UI branches: `src/pages/InviteAccept.tsx`
- Invitation token validation/expiry behavior: `getInvitationByToken()` in `src/services/supabase.ts`
- OAuth initiation: `signInWithGoogle()` in `src/services/supabase.ts`
- Email/password signup + redirectTo callback: `signUpWithEmailPassword()` in `src/services/supabase.ts`

