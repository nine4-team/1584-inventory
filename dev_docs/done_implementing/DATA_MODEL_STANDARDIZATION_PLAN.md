### Data Model Standardization Plan

A practical, step-by-step plan to standardize data structures and field names across the project, eliminate redundant/ambiguous fields, and establish guardrails to keep consistency over time. This plan is written to enable a junior developer to execute the work methodically and traceably.

---

### Goals
- **Consistency**: Use the same field names and shapes for common concepts across all documents and operations.
- **Clarity**: Disambiguate date fields; ensure `transaction_date` (date-only) co-exists with `created_at` (insert timestamp) in Transactions, and remove ambiguous synonyms.
- **Safety**: Migrate data with dual-read/dual-write and a reversible path.
- **Traceability**: Ensure every change is discoverable, reviewable, and auditable.

---

### Scope
- All Firestore collections and subcollections used by the app.
- All TypeScript types in `src/types/` and any domain types embedded elsewhere.
- All service code in `src/services/` (e.g., `inventoryService.ts`).
- All UI code that reads/writes affected fields (components, pages, hooks).
- Firestore security rules and indexes if impacted.

---

### Canonical Field Dictionary (by domain)
Use the exact casing and names already present in the codebase. For timestamps, store ISO strings unless otherwise noted. For Transactions, `transaction_date` is intentionally date-only (`YYYY-MM-DD`).

- Projects (camelCase):
  - `id` (string), `name` (string), `description` (string), `clientName` (string)
  - `createdAt` (Date/ISO), `updatedAt` (Date/ISO), `createdBy` (string)
  - Optional: `budget`, `designFee`, `budgetCategories`, `settings`, `metadata`, `status` (`active`|`archived`)

- Transactions (snake_case):
  - Required: `transaction_id` (string), `transaction_date` (YYYY-MM-DD), `source` (string), `transaction_type` (string), `payment_method` (string), `amount` (string), `created_at` (ISO), `created_by` (string)
  - Optional: `project_id` (string|null), `project_name` (string|null), `budget_category` (string), `notes` (string), `status` (`pending`|`completed`|`cancelled`), `reimbursement_type`, `trigger_event`, `item_ids` (string[])
  - Images: `transaction_images` (legacy), `receipt_images`, `other_images`

- Items (snake_case):
  - Required: `item_id` (string), `description` (string), `source` (string), `payment_method` (string), `qr_key` (string), `bookmark` (boolean), `transaction_id` (string), `date_created` (ISO), `last_updated` (ISO)
  - Optional: `sku` (string), `price` (string), `purchase_price` (string), `project_price` (string), `market_value` (string), `disposition` (string), `notes` (string), `space` (string), `project_id` (string|null), `images` (array)
  - Business inventory: `inventory_status` (`available`|`pending`|`sold`), `business_inventory_location` (string)

- Item location shape (optional, where used): `storage` (string), `shelf` (string), `position` (string)

- Files and images:
  - Items: `images` with `{ url, alt, isPrimary, uploadedAt, fileName, size, mimeType, caption? }`
  - Transactions: `transaction_images` (legacy), `receipt_images`, `other_images`

---

### Domain Canonicals and Status Values

Transactions (financial or inventory movement):
- Required: `transaction_date` (YYYY-MM-DD), `created_at`, `created_by`
- Optional: `last_updated`, `notes`, `status`, `reimbursement_type`, `trigger_event`, images fields
- Relationships: `project_id`, `item_ids` (when applicable)
- Amounts: use existing `amount` (string)
- Status: `status` in { `pending`, `completed`, `cancelled` }

Items (catalog or inventory items):
- Required: `date_created`, `last_updated`, `description`
- Optional: `inventory_status`, `business_inventory_location`, `project_id`, pricing fields (`price`, `purchase_price`, `project_price`, `market_value`), `disposition`, `notes`, `space`, `images`
- Relationships: `transaction_id`, `project_id` (if allocated)

Projects:
- Required: `name`, `createdAt`, `createdBy`
- Optional: `updatedAt`, `notes`, `tags`
- Status: `status` in { `active`, `archived` }

Business Inventory (items and related transactions):
- Use `business_inventory_location` (string) for storage location. Do not introduce new location fields (`fromLocationId`, `toLocationId`, bins, etc.).
- Transactions use the same Transaction fields above; `transaction_date` is date-only.

Images/Attachments:
- Use `images` array shape listed above.

---

### Old → New Field Mapping (by domain)
Use the “New Canonical” column going forward for each domain.

Transactions (snake_case):
| Concept | Example Current Names (any of these) | New Canonical |
|---|---|---|
| Created timestamp | `createdAt`, `dateCreated`, `creationDate` | `created_at` |
| Created by | `createdBy`, `creator`, `owner`, `userId` | `created_by` |
| Last updated | `updatedAt`, `lastUpdated`, `modifiedAt`, `updatedOn` | `last_updated` |
| Transaction date | `transactionDate`, `date`, `timestamp` | `transaction_date` (YYYY-MM-DD) |
| References | `projectId` | `project_id` |
| Images | `images` | `receipt_images` / `other_images` / `transaction_images` (legacy) |

Items (snake_case):
| Concept | Example Current Names (any of these) | New Canonical |
|---|---|---|
| Created timestamp | `createdAt`, `dateCreated` | `date_created` |
| Last updated | `updatedAt`, `lastUpdated` | `last_updated` |
| Storage location | `storageLocation`, `warehouse`, `location` | `business_inventory_location` |
| References | `projectId` | `project_id` |
| Generic date | `date` | Avoid; choose `date_created` or `last_updated` |

Rules of thumb:
- Transactions: `transaction_date` is the real-world date (no time). `created_at` is when the record was inserted. Keep both; never treat them as interchangeable.
- Items: use `date_created` and `last_updated` consistently.
- Do not introduce new location fields; use `business_inventory_location` where relevant.
- Use a single boolean only if it cannot be modeled by `status`. Prefer explicit `status` values to avoid multiple flags.

---

### Conventions and Guardrails
- **Naming**: Honor existing casing by domain. Projects use camelCase (`createdAt`, `updatedAt`, `createdBy`). Transactions and Items use snake_case (`created_at`, `last_updated`, `created_by`, `date_created`).
- **References**: Use snake_case `*_id` for Transactions/Items (e.g., `project_id`, `transaction_id`, `item_id`).
- **Time**: Transactions: `transaction_date` is `YYYY-MM-DD` (date-only). `created_at`/`last_updated` are ISO strings. Items: `date_created`/`last_updated` are ISO strings.
- **Money**: Keep existing `amount` as string for Transactions and pricing fields as strings for Items.
- **Schema version**: Add `schemaVersion` only if/when needed to coordinate migrations (optional).
- **Status**: Single `status` string per document type; avoid redundant booleans.
- **Extensibility**: Use `metadata: Record<string, unknown>` only where needed to avoid schema creep.

---

### Execution Plan (Junior Dev Playbook)
This is the step-by-step process to execute changes safely and traceably.

1) Discovery and Inventory (no code changes)
- Read `src/types/index.ts` and list all field names by domain (Transactions, Items, Projects, Business Inventory, Images).
- Search the codebase for potential synonyms. Use ripgrep (install `rg` if necessary):

```bash
rg -n --no-ignore -S "created_at|date_created|createdAt|dateCreated" src
rg -n --no-ignore -S "last_updated|updatedAt|lastUpdated|modifiedAt|updatedOn" src
rg -n --no-ignore -S "created_by|createdBy" src
rg -n --no-ignore -S "transaction_date|transactionDate" src
rg -n --no-ignore -S "business_inventory_location|storageLocation|warehouse|location" src
rg -n --no-ignore -S "amount\b|price\b|purchase_price\b|project_price\b|market_value\b" src
rg -n --no-ignore -S "project_id\b|transaction_id\b|item_id\b|projectId\b" src
rg -n --no-ignore -S "receipt_images\b|transaction_images\b|other_images\b|images\b" src
```

- Create an inventory spreadsheet (or markdown table) with columns: `File`, `Line`, `Domain`, `Current Field`, `Intended Canonical`, `Notes`.
- Submit the inventory as a PR artifact for review before proceeding.

2) Canonicalization Spec (documentation-first)
- Draft a short spec per domain documenting the final field list for each document type using the Canonical Field Dictionary and Domain Canonicals above.
- Include explicit Old → New mapping for every field found in step 1.
- Get approval from a senior reviewer.

3) Add Schema Version and Dual-Read/Dual-Write (implementation scaffold)
- Introduce `schemaVersion` to each document type (e.g., start at `1`).
- Reading: update reads to accept both old and new fields, preferring new canonicals when present.
- Writing: update writes to produce the new canonical fields while still populating old fields (if necessary) for backward compatibility until migration completes.
- Add TODO checklists in PR description to ensure each domain has dual-read/dual-write enabled before data migration.

4) Data Migration Plan (idempotent and staged)
- Write a migration spec per collection: batches, filters, field transforms, and validation queries.
- Plan to migrate in small batches (e.g., 500–1000 docs at a time) and record progress with a resumable cursor.
- Ensure migrations are idempotent: running twice should not damage data.
- Define validation queries and spot checks (sample counts per status, date ranges, and money totals).

5) Update Firestore Rules and Indexes
- Update `firestore.rules` to authorize new fields and enforce invariants (e.g., server-only for created timestamps).
- Add or update indexes required by the new `status`/date fields or queries relying on `transaction_date`.

6) UI/Service Refactors
- Update TypeScript types in `src/types/` to reflect canonical fields only.
- Update services (e.g., `src/services/inventoryService.ts`) to read/write canonical fields and support dual-read.
- Update components/pages/hooks to consume canonical fields. Remove reliance on deprecated names.

7) Run Migration and Verify
- Execute the migration in stages, verifying after each batch.
- Monitor errors and logs; compare pre/post counts and totals.
- When all documents are migrated and verified, flip reads to use canonical fields only.

8) Cleanup and Lock Down
- Remove dual-write to deprecated fields.
- Remove dead code that references old names.
- Set a linter/check to forbid deprecated names (see Enforcement below).
- Increment `schemaVersion` and record the change in this document.

---

### Enforcement and Tooling
- **Linter rule**: Add a banned-terms rule forbidding old field names in TypeScript (e.g., custom ESLint rule or regex-based lint). The rule should fail CI when deprecated names are used.
- **Type gate**: Centralize common field types (e.g., a BaseDocument type) in `src/types/` and reuse everywhere.
- **PR template**: Include a checklist (see below) to force confirmation of dual-read/dual-write, migration coverage, and UI updates.
- **Schema doc**: Keep this plan and a minimal reference of canonical fields in `dev_docs/DATA_SCHEMA.md` synchronized.

---

### PR Checklist (paste this into PR descriptions)
- [ ] Inventory updated for this domain (files and field mappings)
- [ ] Types updated to canonical fields
- [ ] Services read both old and new fields (dual-read)
- [ ] Services write new canonical fields (dual-write)
- [ ] UI updated to consume canonical fields
- [ ] `transaction_date` stored as ISO date-only string (`YYYY-MM-DD`) for transactions
- [ ] Firestore rules updated and reviewed
- [ ] Indexes added/updated (if needed)
- [ ] Migration spec prepared (idempotent, batched)
- [ ] Migration executed for this domain
- [ ] Validation checks passed
- [ ] Deprecated names removed; linter rule enforces bans

---

### Domain-by-Domain To-Do (execution sequence)

1) Transactions
- Replace any `date`/`transactionDate` with `transaction_date` (date-only).
- Ensure `created_at` is set when inserting; keep distinct from `transaction_date`.
- Use `last_updated` on updates.
- Keep `amount` as string; no money object.
- Standardize `status` to existing values (`pending`, `completed`, `cancelled`).

2) Items
- Ensure `date_created` and `last_updated` are present and consistent.
- Use `business_inventory_location` for storage location; remove/rename any synonyms.
- Normalize references: `project_id` (if applicable) and `transaction_id`.

3) Projects
- Ensure canonical audit fields.
- Prefer `status` = `active`/`archived`.

4) Business Inventory
- Use `business_inventory_location` for item storage; do not add new location fields.
- Transactions follow the Transactions rules above (`transaction_date`, `created_at`, `last_updated`).

5) Images/Attachments
- Use `images` array shape; drop ad-hoc fields.

---

### Validation and Acceptance Criteria
- All domains use canonical field names only in `src/types/`.
- Transactions contain `transaction_date` as ISO `YYYY-MM-DD` (date-only), not a timestamp.
- No occurrences of deprecated names in the codebase (verified via ripgrep and linter).
- Firestore documents sampled from each collection contain expected canonical fields (e.g., `created_at`, `last_updated`, `created_by`, `date_created`).
- Dual-read removed and code reads/writes canonicals exclusively.
- All relevant UI flows function with real data after migration.

---

### Risk and Rollback
- Dual-read/dual-write allows runtime compatibility during rollout.
- Migration is idempotent and batched; failures can resume.
- Rollback path: pause writes, revert to old read path, and re-run with corrections.

---

### Maintenance
- Add any new document types to the Canonical Field Dictionary first.
- Require the PR checklist for all schema-affecting changes.
- Keep `dev_docs/DATA_SCHEMA.md` and this plan updated with each schema change (bump `schemaVersion`).


---

### Verifier Playbook (for second dev/model)
Follow this exact sequence. Treat any failure as a stop-and-fix gate.

1) Run final sweep searches (repo-wide)

```bash
# Transactions & Items audit: created timestamps
rg -n --no-ignore -S "\bcreatedAt\b|\bdateCreated\b|\bcreationDate\b" src

# Updates audit
rg -n --no-ignore -S "\bupdatedAt\b|\blastUpdated\b|\bmodifiedAt\b|\bupdatedOn\b" src

# Transaction date audit
rg -n --no-ignore -S "\btransactionDate\b|\boccurredAt\b|\btransaction_date\b" src

# Inventory storage/location audit
rg -n --no-ignore -S "\bbusiness_inventory_location\b|\bstorageLocation\b|\bwarehouse\b|\blocation\b" src

# Audit snake_case IDs vs camelCase
rg -n --no-ignore -S "\bprojectId\b|\bitemId\b|\btransactionId\b|\bproject_id\b|\bitem_id\b|\btransaction_id\b" src

# Image fields in transactions & items
rg -n --no-ignore -S "\breceipt_images\b|\bother_images\b|\btransaction_images\b|\bimages\b" src

# Created/updated fields actually used
rg -n --no-ignore -S "\bcreated_at\b|\blast_updated\b|\bdate_created\b|\bcreated_by\b" src
```

Pass criteria:
- Only canonical fields exist in code outside tests/migration logs.
- If any deprecated field appears, either it’s in comments/tests or it’s a bug to fix.

2) Types and Service layer spot-check
- Open `src/types/index.ts` and verify Transactions and Items match this document.
- Open `src/services/inventoryService.ts` and verify all reads/writes use `transaction_date`, `created_at`, `last_updated`, `date_created`, `created_by`, and `business_inventory_location` as applicable.

3) UI spot-checks (happy paths)
- Add Transaction: confirm date input binds to `transaction_date` and creates `created_at`.
- Add Item: confirm `date_created`/`last_updated` populate; storage uses `business_inventory_location`.
- List/detail pages: confirm date displays use `transaction_date` for transactions and `date_created`/`last_updated` for items.

4) Firestore document sampling
- Sample 50 recent Transactions: all have `transaction_date` (YYYY-MM-DD), `created_at` (ISO), and no camelCase timestamp fields.
- Sample 50 recent Items: all have `date_created`, `last_updated`, and storage (when applicable) in `business_inventory_location` only.

5) CI checks green
- Ensure denylist lints/grep (below) pass.

---

### Deprecated Fields Denylist (must not appear outside tests/migrations)

- Transactions:
  - Timestamps: `createdAt`, `dateCreated`, `creationDate`, `updatedAt`, `lastUpdated`, `modifiedAt`, `updatedOn`
  - Dates: `transactionDate`, `occurredAt`
  - References: `projectId`, `itemId`, `transactionId`

- Items:
  - Timestamps: `createdAt`, `dateCreated`, `updatedAt`, `lastUpdated`
  - Storage: `storageLocation`, `warehouse`, `location` (when used as storage field)
  - References: `projectId`

Allowed replacements:
- Transactions: `created_at`, `last_updated`, `transaction_date`, `project_id`, `item_ids`, `transaction_id`, `created_by`.
- Items: `date_created`, `last_updated`, `business_inventory_location`, `project_id`, `transaction_id`.

---

### Final Sweep Commands (copy-paste as a single audit)

```bash
set -e
echo "🔎 Audit: deprecated timestamps"
rg -n --no-ignore -S "\bcreatedAt\b|\bdateCreated\b|\bcreationDate\b|\bupdatedAt\b|\blastUpdated\b|\bmodifiedAt\b|\bupdatedOn\b" src || true

echo "🔎 Audit: transaction date synonyms"
rg -n --no-ignore -S "\btransactionDate\b|\boccurredAt\b" src || true

echo "🔎 Audit: references casing"
rg -n --no-ignore -S "\bprojectId\b|\bitemId\b|\btransactionId\b" src || true

echo "🔎 Audit: canonical fields presence"
rg -n --no-ignore -S "\btransaction_date\b|\bcreated_at\b|\blast_updated\b|\bdate_created\b|\bcreated_by\b" src

echo "🔎 Audit: inventory storage fields"
rg -n --no-ignore -S "\bbusiness_inventory_location\b|\bstorageLocation\b|\bwarehouse\b|\blocation\b" src || true

echo "✅ Expectation: no deprecated fields (first three audits) outside tests; canonical fields present"
```

Reviewer outcome:
- If any deprecated field matches appear in non-test, non-doc files, mark as FAIL and open a follow-up fix.

---

### Data Validation Acceptance Checks (post-migration)

- Transactions (sample ≥50 or full set if small):
  - `transaction_date` matches `/^\d{4}-\d{2}-\d{2}$/`.
  - `created_at` is present and ISO-like.
  - `last_updated` present on any doc that was edited after creation.
  - No camelCase timestamp fields present.

- Items (sample ≥50 or full set if small):
  - `date_created` and `last_updated` present and ISO-like.
  - No camelCase timestamp fields present.
  - `business_inventory_location` used where storage is displayed/required; no legacy storage fields.

Record results in the PR with counts: total docs checked, failures (0 expected), example document IDs if failures.

---

### CI Enforcement (recommended)

- Add a CI step that fails on denylist terms outside `**/test/**` and `dev_docs/**`:

```bash
rg -n --no-ignore -S "\bcreatedAt\b|\bdateCreated\b|\bcreationDate\b|\bupdatedAt\b|\blastUpdated\b|\bmodifiedAt\b|\bupdatedOn\b|\btransactionDate\b|\boccurredAt\b|\bprojectId\b|\bitemId\b|\btransactionId\b" src && echo "❌ Deprecated terms found" && exit 1 || echo "✅ No deprecated terms"
```

- Optionally, wire a lightweight ESLint custom rule or a simple script that scans changed files in PRs and blocks merges if denylist terms are introduced.

---

### Reviewer Checklist (paste into review)
- [ ] Final sweep commands run; no deprecated fields found outside tests/docs.
- [ ] `src/types/index.ts` matches this plan (Transactions snake_case, Items snake_case, Projects camelCase).
- [ ] `src/services/inventoryService.ts` reads/writes only canonical fields.
- [ ] UI flows verified: add/edit transaction uses `transaction_date`; add item sets `date_created`/`last_updated`; storage uses `business_inventory_location`.
- [ ] Firestore sampling done; 0 failures on validation checks.
- [ ] CI denylist step passed.

