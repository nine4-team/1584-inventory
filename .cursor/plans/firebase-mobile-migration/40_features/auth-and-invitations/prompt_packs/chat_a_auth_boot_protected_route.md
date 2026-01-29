# Prompt pack — Auth boot + ProtectedRoute

## Goal
You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Refine the parity spec for auth bootstrap + protected-route gating, grounded in the existing web codebase.

## Outputs (required)
Update or create the following docs:
- `40_features/auth-and-invitations/feature_spec.md`
- `40_features/auth-and-invitations/acceptance_criteria.md`
- `40_features/auth-and-invitations/ui/screens/Login.md`

## Source-of-truth code pointers
Primary screens/components:
- `src/components/auth/ProtectedRoute.tsx`
- `src/components/auth/Login.tsx`

Related services/hooks:
- `src/contexts/AuthContext.tsx`
- `src/main.tsx` (provider boot order)
- `src/App.tsx` (route placement + offline init ordering)
- `src/services/supabase.ts` (redirect target + auth config parity reference)

## What to capture (required sections)
- Owned screens
- Primary user flows
- Offline behavior:
  - what works with cached auth vs what requires network
  - restart behavior
- Error states:
  - auth timeout / “stuck loading” behavior
- Risk level + dependencies

## Evidence rule (anti-hallucination)
For each non-obvious behavior:
- Provide **parity evidence** (file + component/function), OR
- Mark as an **intentional change** and explain why.

## Constraints / non-goals
- Do not prescribe “subscribe to everything” listeners; realtime must use the **change-signal + delta** approach.
- Do not do pixel-perfect design specs.
- Focus on behaviors where multiple implementations would diverge.

