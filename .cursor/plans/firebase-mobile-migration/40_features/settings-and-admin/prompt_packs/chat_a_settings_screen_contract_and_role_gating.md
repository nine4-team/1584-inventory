# Prompt Pack: Settings screen contract + role gating

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- Produce parity specs for the **Settings** screen contract and role gating, grounded in the existing web codebase.

---

## Outputs (required)

Update or create the following docs:
- `40_features/settings-and-admin/ui/screens/Settings.md`
- `40_features/settings-and-admin/feature_spec.md` (only the sections that reference the Settings screen contract)
- `40_features/settings-and-admin/acceptance_criteria.md` (only criteria relevant to screen behavior + gating)

---

## Source-of-truth code pointers

Primary screens/components:
- `src/pages/Settings.tsx`
- `src/components/layout/Header.tsx`

Related contexts/services:
- `src/contexts/AuthContext.tsx` (`isOwner`)
- `src/contexts/AccountContext.tsx` (`isAdmin`, offline fallback account context)
- `src/contexts/BusinessProfileContext.tsx`

---

## What to capture (required sections)

- Tab visibility rules and defaults
- Online-required vs offline-readable behavior (explicit)
- Success/error UX expectations (banners, auto-clear timing)
- “No account found” / missing context handling
- Navigation entrypoint behavior (header link)

---

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide **parity evidence**: “Observed in …” with file + component/function, OR
- Mark as an **intentional change** and explain why.

---

## Constraints / non-goals

- Do not imply listeners on large collections.
- Do not write pixel-perfect UI specs.

