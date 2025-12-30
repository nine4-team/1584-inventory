# Wayfair Invoice Import Performance Plan

## Context
- Creating a transaction from a Wayfair invoice currently blocks on thumbnail and PDF uploads for every parsed item (often 40+).  
- Each `handleCreate` run performs image uploads and `updateItem` calls sequentially, then uploads the PDF receipt, all before resolving.  
- Result: the user waits for storage/network latency rather than just the DB transaction, so “Create Transaction” feels painfully slow.

## Goals
1. Make “Create Transaction” complete as soon as the database write succeeds.  
2. Keep uploads reliable while reducing perceived waiting time.  
3. Cut total runtime by parallelizing work and reducing redundant calls.  
4. Surface progress + errors so background tasks are transparent.

## Recommended Changes

### 1. Offload Asset Uploads to Background Flow (biggest win)
- Move item thumbnail uploads and PDF receipt attachment out of the main `handleCreate` `try` block.  
- After `transactionService.createTransaction` returns, immediately show success + navigate.  
- Kick off an async worker (e.g., `void finalizeWayfairImportAssets(...)`) that:
  - Fetches created items, performs uploads, patches metadata.  
  - Attaches the PDF receipt.  
  - Notifies the UI via toast/banner when uploads finish or fail (optional polling or optimistic message).  
- Store a “pending assets” flag on the transaction if needed for visibility.

### 2. Concurrency-Limited Upload Pipeline
- Replace the nested `for ... await` loops with batched uploads via `Promise.allSettled` combined with a concurrency limiter (`p-limit` or a small custom queue).  
- Suggested limit: 3–5 simultaneous file uploads to avoid saturating the browser or hitting Supabase throttles.  
- Cache identical Files as today so qty-split items reuse the same upload promise.

### 3. Batch Item Image Updates
- Instead of calling `unifiedItemsService.updateItem` once per item, prepare an array of `{ itemId, images }` updates.  
- Add a server-side RPC or extend `unifiedItemsService.updateItem` to accept bulk payloads so Supabase performs a single `upsert` on `items`.  
- Benefit: 1 network round-trip instead of N.

### 4. Receipt Attachment Improvements
- When moving uploads to background, reuse the same queue so the PDF shares retry / status handling.  
- If the PDF is large, show a progress bar or “Uploading receipt...” toast until completion.  
- Ensure validation errors surface without blocking the transaction creation (store failure status and surface a banner on the transaction detail page).

### 5. Instrumentation & UX Feedback
- Add metrics/timing around parse time, transaction creation, asset upload duration, and failure counts (simple console timing or analytics event).  
- Update the UI to show discrete states:
  - “Transaction created” (immediate).  
  - “Uploading X assets...” with spinner/badge.  
  - Final toast when uploads finish (success or failure with retry CTA).

## Implementation Order
1. **Background worker + immediate navigation** (unlock perceived speed).  
2. **Concurrency-limited uploads** (reduce total wall-clock).  
3. **Batch update endpoint** (trim network chatter).  
4. **Receipt/upload UX polish** (progress + retries).  
5. **Instrumentation** (verify improvements, catch regressions).

Following this plan aligns the importer with best practices: the critical path finishes fast, long-running I/O happens off-thread with user feedback, and network calls are minimized.***
