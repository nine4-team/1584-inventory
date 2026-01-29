# Prompt Pack: Users + account management (invites, accounts, pending invitations)

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity specs for the **Users** and **Account** tabs in Settings (invites + account creation), grounded in the existing web codebase.

---

## Outputs (required)

Update or create the following docs:
- `40_features/settings-and-admin/feature_spec.md` (users/account sections)
- `40_features/settings-and-admin/acceptance_criteria.md` (users/account criteria)
- `40_features/settings-and-admin/ui/screens/Settings.md` (users/account tab behavior)

---

## Source-of-truth code pointers

Primary UI:
- `src/pages/Settings.tsx` (tab gating)
- `src/components/auth/UserManagement.tsx`
- `src/components/auth/AccountManagement.tsx`

Related services (parity reference only):
- `src/services/accountService.ts`
- `src/services/supabase.ts` (`createUserInvitation`, `getPendingInvitations`, `getAllPendingInvitationsForAccounts`)
- `src/contexts/AuthContext.tsx`, `src/contexts/AccountContext.tsx` (role gating)

---

## What to capture (required sections)

- Role gating rules (admin/owner)
- Invitation link generation + clipboard UX
- Pending invitations list behaviors (copy, expand/collapse)
- Validation and error cases (missing accountId, missing userId, offline)
- Explicit offline policy: these actions are online-required

---

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide **parity evidence**: “Observed in …” with file + component/function, OR
- Mark as an **intentional change** and explain why.

