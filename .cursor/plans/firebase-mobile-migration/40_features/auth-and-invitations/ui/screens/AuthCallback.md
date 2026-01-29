# AuthCallback — Screen contract

## Intent
Handle the post-OAuth redirect state by waiting briefly for an authenticated session to become available, bridging any pending invitation token into invitation data for user-document creation, and then navigating into the app.

## Inputs
- Route params: none
- Query params: none (auth SDK may use hash/query internally)
- Entry points:
  - OAuth redirect target from Google sign-in (`redirectTo: /auth/callback`)
  - InviteAccept email/password signup may route here when session exists

## Reads (local-first)
- Auth session availability:
  - polls `supabase.auth.getSession()` with bounded attempts
- Invitation bridging state:
  - reads `pendingInvitationToken` from local storage

## Writes (local-first)
- If `pendingInvitationToken` exists and invitation is found:
  - write `pendingInvitationData` to local storage (for consumption by user doc creation)
  - remove `pendingInvitationToken`
- Navigation:
  - navigate to `/` regardless of outcome after bounded wait

## UI structure (high level)
- Full-screen spinner + “Completing sign in…”

## User actions → behavior (the contract)
- No user actions; this screen is purely transitional.

## States
- Loading:
  - always (until it navigates away)
- Error:
  - errors are logged; user is navigated to `/`

## Collaboration / realtime expectations
- Not applicable.

## Performance notes
- Must be bounded (avoid infinite waits).

## Parity evidence
- Bounded polling loop + invitation token bridging + navigation: `src/pages/AuthCallback.tsx`
- Invitation lookup by token (pending or accepted): `checkInvitationByToken()` in `src/services/supabase.ts`
- User doc creation consumes `pendingInvitationData`: `createOrUpdateUserDocument()` in `src/services/supabase.ts`

