# Prompt pack — Invite acceptance + AuthCallback

## Goal
You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Refine the parity spec for invitation acceptance, OAuth token bridging, and callback behavior.

## Outputs (required)
Update or create the following docs:
- `40_features/auth-and-invitations/feature_spec.md`
- `40_features/auth-and-invitations/acceptance_criteria.md`
- `40_features/auth-and-invitations/ui/screens/InviteAccept.md`
- `40_features/auth-and-invitations/ui/screens/AuthCallback.md`

## Source-of-truth code pointers
Primary screens/components:
- `src/pages/InviteAccept.tsx`
- `src/pages/AuthCallback.tsx`

Related services/hooks:
- `src/services/supabase.ts` (invitation helpers + signup/signin methods)
- `src/contexts/AuthContext.tsx` (SIGNED_IN handler + user doc creation)

## What to capture (required sections)
- Token verification + expiry behavior
- Local persistence of invitation token across redirects
- Email verification branch (session null after signup)
- Where invitation acceptance actually happens (server-side or user-doc creation)
- Firebase migration deltas (server-owned invitation acceptance + idempotency)

## Evidence rule (anti-hallucination)
For each non-obvious behavior:
- Provide **parity evidence** (file + component/function), OR
- Mark as an **intentional change** and explain why.

## Constraints / non-goals
- Do not do pixel-perfect design specs.
- Focus on behaviors where multiple implementations would diverge (timeouts, retries, token persistence, idempotency).

