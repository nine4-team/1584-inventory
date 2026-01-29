# Auth + invitations (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **authentication** and **invitation acceptance** flows, grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Sign in (Google OAuth)
- Sign in (email + password)
- Sign up (email + password) as part of invite acceptance (including email verification flow)
- Invitation link acceptance (`/invite/:token`) with Google or email/password
- Auth callback handling after OAuth redirect (`/auth/callback`)
- Protected-route gating (show spinner while auth initializes; fall back to login if auth cannot resolve)
- Persist minimal offline context needed for offline-first UX (`userId`, `accountId`)

## Non-scope (for this feature folder)
- Settings UI for managing invites (create/revoke/resend) — belongs under `settings-and-admin`
- Roles v2 / scoped permissions — belongs under `roles-v2` (net-new planned)
- Project/business-inventory domain behavior — separate feature folders
- Pixel-perfect UI design

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/Login.md`
  - `ui/screens/InviteAccept.md`
  - `ui/screens/AuthCallback.md`

## Cross-cutting dependencies
- Sync architecture constraints (local-first, outbox, delta sync): `40_features/sync_engine_spec.plan.md`

## Parity evidence (web sources)
- Providers/boot order: `src/main.tsx`, `src/App.tsx`
- Auth state lifecycle + safety timeout + offline context persistence: `src/contexts/AuthContext.tsx`
- Protected-route gating: `src/components/auth/ProtectedRoute.tsx`
- Login screen (Google + email/password): `src/components/auth/Login.tsx`
- OAuth callback flow + invitation token bridging: `src/pages/AuthCallback.tsx`
- Invite acceptance screen + email verification branch: `src/pages/InviteAccept.tsx`
- Account context resolution + offline fallback: `src/contexts/AccountContext.tsx`
- Supabase auth configuration + invite helpers (parity reference only): `src/services/supabase.ts`

