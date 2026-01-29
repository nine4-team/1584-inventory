# Prompt pack — Account context + offline boot + roles v1

## Goal
You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Refine the parity spec for account-context resolution, offline fallback, and coarse roles v1 semantics as used in the existing web app.

## Outputs (required)
Update or create the following docs:
- `40_features/auth-and-invitations/feature_spec.md`
- `40_features/auth-and-invitations/acceptance_criteria.md`

If ambiguity warrants it, you may add:
- `40_features/auth-and-invitations/flows/account_context_resolution.md`

## Source-of-truth code pointers
Primary screens/components:
- `src/contexts/AccountContext.tsx`

Related services/hooks:
- `src/contexts/AuthContext.tsx` (role fields and helpers: `hasRole`, `isOwner`)
- `src/services/offlineContext.ts` (persistence rules; requires both userId and accountId)
- `src/App.tsx` (offline init sequencing)

## What to capture (required sections)
- How `currentAccountId` is derived (user.accountId, fallback fetch, owner fallback)
- Offline fallback account id behavior (when it is used and when not)
- What is persisted for offline boot, and when it is cleared
- Role semantics (owner/admin/member) used in gating logic today (even if UI gates are sparse)
- Firebase deltas (where to enforce membership/role: Rules/Functions)

## Evidence rule (anti-hallucination)
For each non-obvious behavior:
- Provide **parity evidence** (file + component/function), OR
- Mark as an **intentional change** and explain why.

## Constraints / non-goals
- Do not define Roles v2 / scoped permissions here; just document the v1 semantics the app relies on today.
- Do not prescribe “subscribe to everything” listeners.

