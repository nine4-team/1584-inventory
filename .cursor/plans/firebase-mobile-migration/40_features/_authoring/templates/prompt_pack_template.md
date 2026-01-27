# Prompt Pack Template (Multi‑Chat AI Dev Workflow)

Copy/paste this at the start of any AI dev chat so the dev can work **without prior conversation context**.

---

## Goal

You are helping migrate Ledger to **React Native + Firebase** with an **offline‑first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

Your job in this chat:
- **Produce parity specs** grounded in the existing codebase (web) so an implementation team can reproduce behavior with the new architecture.

---

## Outputs (required)

Update or create the following docs:
- `40_features/<feature>/README.md`
- `40_features/<feature>/feature_spec.md`
- `40_features/<feature>/acceptance_criteria.md`

If (and only if) ambiguity exists, also produce:
- `40_features/<feature>/ui/screens/<screen>.md` (screen contracts)
- `40_features/<feature>/flows/<flow>.md` (multi-screen flows)
- `40_features/<feature>/data/*.md` (data/rules/indexes notes)

If the behavior is shared across multiple features, put it under:
- `40_features/_cross_cutting/...` and link to it from feature docs.

---

## Source-of-truth code pointers

Use these as the canonical references for parity.

**Primary screens/components:**
- <paste file paths here>

**Related services/hooks:**
- <paste file paths here>

---

## What to capture (required sections)

For each feature or screen contract, include:
- **Owned screens** (names)
- **Primary user flows** (happy path + alt paths)
- **Entities touched** (and what fields are read/written)
- **Offline behavior**:
  - create/edit/delete/search
  - pending UI + retries
  - app restart behavior
  - reconnect behavior
  - media placeholders + uploads
- **Collaboration needs**:
  - yes/no
  - if yes, what should propagate and what the SLA is while foregrounded
- **Error states**:
  - empty/loading/error/offline
  - permission denied
  - quota/full storage
- **Risk level** (low/med/high) with *why*
- **Dependencies** (auth shell, sync engine, media pipeline, conflict UI, metadata caches, etc.)

---

## Evidence rule (anti-hallucination)

For each non-obvious behavior:
- Provide **parity evidence**: point to where it is observed in the current codebase (file + component/function), OR
- Mark as an **intentional change** and explain why.

---

## Constraints / non-goals

- Do not prescribe “subscribe to everything” listeners; realtime must use the **change-signal + delta** approach.
- Do not do pixel-perfect design specs.
- Focus on behaviors where multiple implementations would diverge.

