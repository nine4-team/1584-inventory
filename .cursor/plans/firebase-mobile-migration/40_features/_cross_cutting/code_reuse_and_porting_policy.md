# Code reuse and porting policy (migration)

## Intent
Reduce risk and wasted effort by **porting existing working implementations** wherever possible, rather than recreating behavior from scratch.

This is compatible with the offline-first invariants as long as we separate:
- **pure logic** (portable TypeScript) from
- **platform-specific adapters** (React Native UI, SQLite persistence, Firebase I/O, background execution, share/print).

## Rule of thumb: “port the logic, rewrite the edges”

- **Prefer porting**:
  - parsers, reducers, data shaping, validation, formatting, sorting/filtering logic
  - deterministic computations (totals, rollups, derived view models)
  - idempotency key generation and operation shaping (conceptual)
- **Expect to rewrite/adapt**:
  - network/storage SDK usage (Supabase → Firebase; web fetch → native)
  - UI components (React DOM → React Native)
  - file picking, printing/sharing, clipboard, background execution
  - local persistence integration (web offline store → SQLite layer + outbox)

## How to capture this in specs (required)
Each feature spec (or screen contract) should include an **“Implementation reuse (porting) notes”** section listing:
- **Reusable logic**: file paths + key exported symbols to port
- **Wrappers needed**: what must be replaced with RN/Firebase adapters
- **Non-negotiable invariants**: where we must diverge to obey `sync_engine_spec.plan.md`

## Examples (parity evidence pointers)
- PDF parsing + diagnostics is already portable TS:
  - `src/utils/pdfTextExtraction.ts`
  - `src/utils/amazonInvoiceParser.ts`
  - `src/utils/wayfairInvoiceParser.ts`
  - `src/utils/pdfEmbeddedImageExtraction.ts` (logic is portable, but canvas/render APIs are web-only → must be adapted)

## Constraints
- This policy does **not** permit violating:
  - local SQLite as source of truth
  - explicit outbox + idempotency
  - delta sync + change-signal (no large listeners)

