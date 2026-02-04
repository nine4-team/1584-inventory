## Offline vs Server reconciliation (read-only)

Account: `1dd4fd75-8eea-4f7a-98e7-bf45b987ae94`  
Exported at: `2026-02-03T23:27:02.306Z`  
Report JSON: `dev_docs/actively_implementing/reconciliation_offline_vs_server_report_2026-02-03_account-1dd4fd75.json`

### Summary
- **Server items**: 778
- **Offline items**: 804
  - **Canonical-keyed (`I-...`)**: 785
  - **UUID-keyed**: 19
- **Offline-only canonical items (missing on server)**: **7**
- **Scalar field diffs for items that exist on both sides**: **0** after normalizing `taxRatePct` formatting
- **Operation queue stuck ops**: **2** (both are false “missing on server”)

### Key findings
- **The 19 UUID-keyed items are real duplicates, not missing server rows**:
  - Each UUID key maps to a server row `id` with a valid `item_id` (see JSON report under `uuidKeyedItems.mappings`).
  - After normalizing numeric formatting, there’s **no evidence of additional unsynced scalar changes** hidden in the UUID-keyed copies.
  - Images also match: we compared a stable “images fingerprint” for each of the 19, and **all 19 matched** (see `uuidKeyedItems.imagesComparison` in the JSON report).
- **The 2 stuck `UPDATE_ITEM` ops are false positives caused by the UUID-vs-`item_id` bug**:
  - `e26fd3a6-...` maps to `I-1768250810839-f0iq`
  - `e65771fe-...` maps to `I-1768252761307-yj5c`
  - Both are paused with `PGRST116` because older sync code tried to update by `item_id = <uuid>`.

### What’s actually missing from the server
The only clear “didn’t make it to server” set in this export is the **7 offline-only canonical items**:

- `I-1768698497733-l9fw`
- `I-1768698607868-o0ao`
- `I-1768698614872-prtb`
- `I-1768698616864-fm1b`
- `I-1768699194616-cx30`
- `I-1768699214269-6rg1`
- `I-1769049054881-7rv2`

#### Details (from offline export)

| itemId | description | source | sku | purchasePrice | projectPrice | marketValue | paymentMethod | disposition | dateCreated | lastUpdated | last_synced_at | imagesCount | qrKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `I-1768698497733-l9fw` | Small gold round lift | *(empty)* | 084553 | *(empty)* | *(empty)* | *(empty)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:09:52.393+00:00 | 2026-01-20T01:09:09.524Z | 2 | `qr_1768698497733_i5uv196t3` |
| `I-1768698607868-o0ao` | Small gold round lift | *(empty)* | 084553 | *(null)* | *(null)* | *(null)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:10:07.88+00:00 | 2026-01-20T01:09:09.524Z | 2 | `qr_1768698497733_i5uv196t3` |
| `I-1768698614872-prtb` | Small gold round lift | *(empty)* | 084553 | *(null)* | *(null)* | *(null)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:10:14.886+00:00 | 2026-01-20T01:09:09.524Z | 2 | `qr_1768698497733_i5uv196t3` |
| `I-1768698616864-fm1b` | Small gold round lift | *(empty)* | 084553 | *(null)* | *(null)* | *(null)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:10:16.876+00:00 | 2026-01-20T01:09:09.524Z | 2 | `qr_1768698497733_i5uv196t3` |
| `I-1768699194616-cx30` | Square marble lift | *(empty)* | *(empty)* | *(empty)* | *(empty)* | *(empty)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:19:54.63+00:00 | 2026-01-20T01:09:09.523Z | 2 | `qr_1768699194616_b9elgarta` |
| `I-1768699214269-6rg1` | Square marble lift | *(empty)* | *(empty)* | *(null)* | *(null)* | *(null)* | Cash | inventory | 2026-01-17 | 2026-01-18T01:20:14.28+00:00 | 2026-01-20T01:09:09.523Z | 2 | `qr_1768699194616_b9elgarta` |
| `I-1769049054881-7rv2` | White distressed cylinder tree pot | Homegoods | 007517 | 24.99 | 69.99 | 99.99 | Cash | inventory | 2026-01-21 | 2026-01-22T02:30:54.914+00:00 | 2026-01-23T20:49:43.578Z | 2 | `qr_1769049054880_cwr5a68xj` |

Full item records (including `transactionId` / `projectId`) are in the JSON report under `reconciliation.offlineOnlyCanonical`.

### Next steps (no DB writes implied)
- **To recover these 7 items on the server**: treat them as candidates for “dropped CREATE” and re-create them from the offline record (ideally through the app’s normal create flow / a controlled repair tool).
- **To fix the 2 stuck operations**: rewrite/replace those queued ops so they target the canonical `item_id` (or clear them if they represent no-op updates).

