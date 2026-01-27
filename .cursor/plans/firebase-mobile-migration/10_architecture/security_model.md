# Security Model (Auth, Membership, Rules, Functions)

This doc defines the security model for the Firebase migration: **who can access what**, and **how we enforce it** via Firebase Auth, Firestore Rules, Storage Rules, and callable Cloud Functions.

This model is designed to support the architecture in:

- [`target_system_architecture.md`](./target_system_architecture.md)
- [`sync_engine_spec.plan.md`](../sync_engine_spec.plan.md) (sync constraints, idempotency, change-signal)

---

## Goals

- **Account isolation**: a user never reads/writes data outside accounts they belong to.
- **Principle of least privilege**: only owners/admins can perform dangerous operations. (have we defined dangerous?)
- **Local-first compatible**: rules support idempotent writes and the `meta/sync` signal pattern.
- **Rules are simple; correctness is server-owned**: complex invariants go through callable Functions.

---

## Core concepts

### Actor

- `uid`: Firebase Auth user id
- `email`: verified email (where applicable)

### Account

- A top-level tenant boundary for all data.
- All entity docs include `accountId` and rules verify membership in that account.

### Membership + roles

Membership is expressed as a document keyed by `uid`:

`accounts/{accountId}/members/{uid}`

Fields (suggested):

- `role`: `"admin" | "user"` (account-level role)
- `joinedAt`, `joinedBy`
- Optional (only if you need offboarding without deleting the doc):
  - `disabledAt?: Timestamp | null`
  - `disabledBy?: string | null`

System owners are **global**, matching the current app:

- Store them as either a Firebase Auth custom claim (e.g. `request.auth.token.role == "owner"`)
  or a rules-checkable allowlist doc like `systemOwners/{uid}`.
- In rules: allow access if the requester is a system owner **OR** has an active membership doc.

Role semantics:

- **admin**: manage presets/business profile; can invite/remove users
- **user**: project work (items/transactions/spaces/media) within the account
- **owner (system)**: can access all accounts; can manage users/roles across accounts

### Authorization model (now + future)

This migration starts with **coarse roles** (`owner` system-wide, plus `admin/user` per account) but must stay compatible with a future where an admin can restrict what a user can **see** and **do** (e.g., “only kitchen budget-category work”).

This doc stays focused on **enforcement** (Rules/Functions + data shape). Product-level definitions (“what exact capabilities exist”) should live in feature specs and the master feature list.

#### Now (MVP): role-gated capabilities

- **Account membership** gates all reads/writes.
- **Role** gates “dangerous” operations and configuration surfaces:
  - membership management / invites
  - business profile + presets (budget categories, vendors, taxes, templates)
  - destructive operations (delete project, mass delete, etc.)

#### Future: scoped visibility + fine-grained permissions (budget-category + ownership)

Planned direction: an admin can assign a member a **visibility scope** such that they only see:

- transactions/items/spaces/projects related to a permitted **budget category** (or set of categories), and/or
- records they **created** (ownership fallback), depending on policy.

Key constraint: Firestore Rules cannot “query”; they can only validate against:

- the current document
- `request.auth`
- and `get()`/`exists()` of specific docs by path

So, for scoped visibility to be enforceable (and not just a UI filter), we need explicit, rules-checkable shapes:

##### A) Store scopes in path-addressable ACL docs (recommended for rules)

Example:

- `accounts/{accountId}/permissions/{uid}`: coarse switches (enabled features, allowed operations)
- `accounts/{accountId}/permissions/{uid}/budgetCategories/{budgetCategoryId}`: per-category allow docs

Then rules can do:

- allow read/write of a transaction with `budgetCategoryId` only if:
  - member is active, and
  - `exists(accounts/{accountId}/permissions/{uid}/budgetCategories/{budgetCategoryId})`

This scales better than large arrays (rules are simpler; avoids hitting array-size limits).

##### B) Denormalize “security-critical selectors” onto docs

If an entity’s visibility depends on budget category, that entity should carry a **direct selector** that rules can check without complex joins:

- Non-canonical transactions should carry `budgetCategoryId` (good).
- Items need a category selector for rules-checkable scoped visibility and for canonical inventory budgeting; use:
  - **(preferred)** `item.inheritedBudgetCategoryId` (server-owned/derived) when items are linked to a **non-canonical** transaction or otherwise categorized.
  - avoid rule-time joins like `get(transaction).data.budgetCategoryId` as the primary visibility mechanism (more complex/brittle and does not work for canonical-item attribution rules).

Naming note:

- The current web app uses `Transaction.categoryId`. For the Firebase/RN model we prefer `budgetCategoryId` for clarity.
- If you maintain an interop layer, map `categoryId` → `budgetCategoryId` at the boundary (import/adapters), not inside rules logic.

##### C) Ownership fallback requires `createdBy`

If “see your own created records” is part of the policy, entities must include `createdBy` (uid) and rules must enforce it on create:

- `request.resource.data.createdBy == request.auth.uid`

##### D) Make scoping explicit in rules and in callable Functions

When scoped visibility is enabled for an account/member:

- **Rules** should enforce category allowlists on reads and writes for category-bound entities
- **Callable Functions** should validate permissions server-side for multi-doc operations (allocation/sale/rollups) and should be the only writer of any denormalized security fields (like `item.inheritedBudgetCategoryId`)

##### E) Keep a safe “default” for accounts without scoping

To remain backward-compatible (and keep MVP simple), scope enforcement should be designed as:

- “no scope docs present” => account-wide access (current behavior)
- “scope docs present” => scoped access enforced

### Project access

Default assumption (simple, scalable enough for now):

- Project access is **account-wide** (any active member can access account projects).
- If you later need per-project ACLs, add:
  - `accounts/{accountId}/projects/{projectId}/members/{uid}` (or a compact allowlist)
  - and update rules accordingly.

---

## Firestore collection layout (security-relevant)

All docs must include `accountId` (and `projectId` where applicable).

Recommended high-level layout:

- `accounts/{accountId}`
  - `members/{uid}` (membership/role)
  - `invites/{inviteId}` (or `invites/{tokenHash}`) — invite issuance + status
  - `projects/{projectId}`
    - `meta/sync` (change-signal doc)
  - `inventory/meta/sync` (change-signal doc for Business Inventory scope)
  - `inventory/items/{itemId}`
  - `inventory/transactions/{transactionId}`
  - `inventory/spaces/{spaceId}`
  - `inventory/attachments/{attachmentId}`
  - `presets/...` (budget categories, vendor defaults, tax presets, space templates, etc.)

This layout aligns with the change-signal pattern described in the sync spec and supports both collaboration scopes:

- project: `accounts/{accountId}/projects/{projectId}/meta/sync`
- inventory: `accounts/{accountId}/inventory/meta/sync`

---

## Rules principles (how we write rules safely)

### Baseline: authentication required

- All reads/writes require `request.auth != null`

### Membership gate (account boundary)

- A request is allowed only if:
  - the doc’s `accountId` matches the path account id, and
  - requester is a **system owner**, OR:
    - a membership doc exists for `request.auth.uid`, and
    - membership is not disabled (e.g. `disabledAt == null`, if you include that field)

### Validate server-owned sync fields

For entity docs that participate in delta sync, require these fields exist and have the right types:

- `accountId` (string)
- `updatedAt` (timestamp)
- `deletedAt` (timestamp or null)
- `version` (number)
- `updatedBy` (string uid)
- `lastMutationId` (string)
- optional `schemaVersion` (number)

Rules should enforce:

- `updatedBy == request.auth.uid`
- `updatedAt == request.time` for direct client writes (when not using Functions)
- `version` increments by exactly +1 for client updates (where feasible)

If enforcing `version` is too strict (because Functions may write), prefer enforcing **presence + monotonicity** and shift strictness to server-callable writes.

### Prefer “append-only” over “rewrite big arrays”

For relationships, prefer foreign keys on child docs (`item.projectId`, `item.transactionId`, etc.) rather than updating arrays on parent docs. This reduces:

- rule complexity
- write volume
- conflict surface

---

## The `meta/sync` change-signal doc (rules-safe updates)

The change-signal doc is critical to collaboration latency; it must be writable by authorized clients **without allowing arbitrary data corruption**.

Path:

`accounts/{accountId}/projects/{projectId}/meta/sync`

Inventory scope path:

`accounts/{accountId}/inventory/meta/sync`

Suggested fields:

- `seq` (number, monotonic)
- `changedAt` (timestamp)
- `byCollection` (map of collection -> number, monotonic per key)

Rules should enforce:

- Only account members can read the doc.
- Only account members can update the doc.
- Only these keys may exist (no arbitrary extra keys).
- Values are monotonic:
  - `request.resource.data.seq == resource.data.seq + 1`
  - each `byCollection.<name>` is `>=` its prior value
- `changedAt == request.time`

If you find Firestore Rules make monotonic constraints too brittle in practice, move signal updates behind a callable Function (slightly higher latency), or keep client updates but loosen to:

- `seq > resource.data.seq`

…and treat the signal as a **hint** that triggers delta fetch, not as a correctness primitive.

---

## What must be callable Functions (server-owned writes)

Use callable Functions when any of these are true:

- The operation touches **multiple documents** and must be atomic/correct.
- The operation requires **read-before-write** beyond simple version checks.
- The operation would require complex rule logic that’s hard to secure.

Examples (from existing app behavior / sync spec intent):

- Inventory allocation/sale operations that update multiple docs
- Lineage pointers / canonical relationships
- Rollups (project totals, counts) that must match canonical state
- Invitation acceptance (token validation → create membership → mark invite used)
- Entitlement/billing-gated operations (e.g., “create project beyond free limit”)

Callable Functions should:

- validate membership + role server-side
- run a Firestore transaction/batch
- write `updatedAt`, `version`, `updatedBy`, `lastMutationId`
- update `meta/sync` once per logical operation

---

## Invitations and account/user management

### Invite issuance

Allowed:

- owners/admins create invites in `accounts/{accountId}/invites/*`
- invite documents contain:
  - target email (or hashed email)
  - role to grant on acceptance
  - expiration
  - status

Not allowed:

- non-admin members creating invites
- clients directly creating membership docs for other users

### Invite acceptance

Invite acceptance should be a callable Function:

- inputs: invite token, optional profile data
- server validates token + expiry + status
- server creates `accounts/{accountId}/members/{uid}` with role
- server marks invite as used

This avoids fragile rules around “only the invited person can accept”.

---

## Storage security (receipts/images/PDFs)

Use Storage paths that include tenant and project boundaries:

`attachments/{accountId}/{projectId}/{attachmentId}/{filename}`

Storage rules:

- require authenticated user
- require membership in `accounts/{accountId}/members/{uid}`
- optionally require App Check

Integrity linkage:

- after upload, client (or function) writes an `attachments/{attachmentId}` Firestore doc containing:
  - `storagePath`, `size`, `mimeType`, `sha256`, `uploadedBy`, `uploadedAt`
  - `accountId`, `projectId`, `parentType`, `parentId`

---

## App Check

Enable **Firebase App Check** early (for Firestore + Functions + Storage) to reduce automated abuse.

- iOS: DeviceCheck/App Attest (depending on your iOS targets)
- Debug tokens for dev

---

## Threat model notes (practical)

- **Cross-tenant reads/writes**: prevented by membership checks keyed off path `accountId`
- **Client tampering with money/critical fields**: mitigate via:
  - callable Functions for critical operations, or
  - stricter rule validation + conflict detection
- **Signal spam** (`meta/sync` increments): mitigate via:
  - monotonic constraints + allow only certain fields
  - App Check
  - server-side rate limiting if needed (Functions/Cloud Armor patterns)

