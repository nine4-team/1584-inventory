## HighLevel purchase → App onboarding plan

This document describes the recommended flow and HTTP contract for onboarding buyers who purchase via a HighLevel landing page/workflow. It intentionally reuses the app's existing invitation flow so buyers land in the familiar `InviteAccept` / `AuthCallback` flow and can sign in later with Google OAuth or email/password.

### Goal
- Give buyers immediate, reliable access after purchase while reusing existing app authentication and invitation plumbing to minimize new work and long-term maintenance.

### TL;DR recommendation
- After HighLevel marks the purchase as paid, it makes a single HTTP POST (a “webhook” call) to our API endpoint.
- That endpoint:
  - verifies the request using HMAC-SHA256 with our shared secret,
  - creates the account/workspace if needed,
  - generates an invite via the existing `createUserInvitation(...)` routine,
  - returns the `/invite/<token>` link (or 202 + job id if async).
- HighLevel drops that invite link into the buyer email it already sends. From the buyer’s perspective: pay → receive email → click invite link → sign in.

> A “webhook” in this doc just means “HighLevel calls our API automatically after payment.” There is no extra service—just an HTTP endpoint we own.

### Why reuse the invite flow
- The app already supports both Google OAuth and email/password via `InviteAccept` and `AuthCallback` (`src/pages/InviteAccept.tsx` and `src/pages/AuthCallback.tsx`).
- Reusing `createUserInvitation` avoids building new auth primitives (no extra token storage, no password plumbing, no new session management).
- Buyers who use Gmail can immediately continue with Google; others can set a password later — this mirrors your existing UX and support surface.

### High-level flow
1. Buyer submits minimal purchase form on landing page (name, email + payment via HL/processor).
2. HighLevel triggers “purchase success” workflow.
3. HighLevel POSTs buyer data to your onboarding endpoint.
4. Onboarding endpoint validates HMAC and idempotency, provisions account/workspace, calls `createUserInvitation(...)`, and returns the invite link.
5. HighLevel emails the invite link in a templated welcome message. Buyer clicks → `/invite/<token>` → `InviteAccept` flow (redirect to Google or set password) → `AuthCallback` handles session and user document creation.

### Onboarding API: recommended contract
- Endpoint:
  - `POST https://api.yoursite.com/hook/highlevel/onboard`
 - Auth:
  - Required: HMAC-SHA256 header `X-HL-Signature: sha256=<hex>` where HMAC = “hash the raw JSON body with our shared secret so we know the call is genuine.”
  - `Idempotency-Key` header set to HighLevel event id or payment_id
- Request (JSON):
```json
{
  "email": "buyer@example.com",
  "full_name": "Buyer Name",
  "payment_id": "stripe_ch_123"
}
```

- Note: the minimal payload intentionally omits `offer_id` and `payment_status`. Derive product/offer and payment state from HighLevel's workflow context or reconciliation systems; include extra fields only when required by downstream business logic (see "Recommended optional fields" below).
- Success responses:
  - Synchronous: `200 OK` with JSON:
```json
{ "status":"ok", "invitation_link":"https://app.yoursite.com/invite/abc123", "account_id":"acct_456" }
```
  - Asynchronous: `202 Accepted` with `job_id` and message when provisioning will complete.

-### Implementation notes (server-side)
- Verify signature: compute `sha256` HMAC of the raw request body bytes using your shared secret and compare against `X-HL-Signature`.
- Idempotency storage: persist `{idempotency_key, highlevel_event_id, payment_id, account_id, invitation_link, status}` in a table (Supabase or Postgres). When a repeated key arrives, short-circuit the handler and return the stored invite/account info instead of raising an error.
- Provisioning:
  - Create account/workspace rows and defaults.
  - Call your existing `createUserInvitation(email, role, invitedBy, accountId)` (found in `src/services/supabase.ts`) to insert an invitation and produce `/invite/<token>`.
  - Return the invite link to HL if sync; otherwise email it from your server when job completes.
- Existing users: default to attaching the existing user to the newly provisioned workspace, then send a “you now have access to workspace X” note instead of a new invite. Only fall back to manual steps if attaching fails (e.g., user already belongs to that workspace).

### Implementation (our side)
- Supabase Edge Function: `supabase/functions/highlevel-onboard/index.ts`.
  - Handles signature validation, idempotency, provisioning, and invite generation.
  - Returns JSON `{ status, invitation_link?, account_id, login_url?, idempotency_key }`.
- Persistence: `public.highlevel_onboarding_events` (migration `20251223_create_highlevel_onboarding_events.sql`) stores every incoming request, signature metadata, and the resulting account/invite IDs. Replays return the previously stored response body immediately.
- Existing users:
  - We still create a fresh `accounts` row.
  - Their `users.account_id` is updated to the new account, role forced to `admin` unless they were an `owner`.
  - API responds with `status: "existing_user_attached"` and a `login_url`, so HighLevel sends a “log back in” email.
- New users:
  - Function inserts an `invitations` row with a cryptographically secure token and returns `https://<APP_BASE_URL>/invite/<token>`.
  - Invitation is reused on retries until it expires.

**Environment variables (set via `supabase secrets set` before deploying the function):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` – standard service client creds (already used in other functions).
- `APP_BASE_URL` – e.g. `https://app.1584.design`. Used to build invite links.
- `APP_LOGIN_URL` _(optional)_ – overrides the login link that existing users receive (defaults to `APP_BASE_URL`).
- `HL_WEBHOOK_HMAC_SECRET` – required auth secret for `X-HL-Signature`.
- `ONBOARDING_INVITER_USER_ID` _(optional)_ – system user UUID to store in `accounts.created_by` / `invitations.invited_by`. Leave unset to write `NULL`.
- `ONBOARDING_INVITE_EXPIRATION_DAYS` _(optional)_ – defaults to `7`.

### HighLevel custom code example (build payload in-code)

Note: the payload below is intentionally verbose for correctness — it is **excessive and must be trimmed** before final rollout. Keep this example as an implementation starting point and refine the payload fields to the minimal set required (suggestion: `email`, `full_name`, `contact_id`, `offer_id`, `payment_id`, `payment_status`, `amount`, `currency`, `purchased_at`).

Use this custom-code block in HighLevel (Custom Code step). It constructs the payload in-code, derives a deterministic `Idempotency-Key` (preferring `contact_id`), computes `X-HL-Signature` (HMAC-SHA256), and outputs `body` + `headers` for the subsequent HTTP Request step.

```javascript
// HighLevel Custom Code - build the payload in-code (do NOT pass payload as inputData)
const crypto = require('crypto')

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

// Map HL-provided fields into local vars (common HL variables)
const email = (inputData.email || inputData.contact_email || '').toString().trim().toLowerCase()
const full_name = (inputData.full_name || `${inputData.first_name || ''} ${inputData.last_name || ''}`.trim() || '').toString().trim()
const contact_id = (inputData.contact_id || inputData.contactId || null)
const offer_id = (inputData.offer_id || inputData.offerId || null)
const payment_id = (inputData.payment_id || inputData.paymentId || null)
const payment_status = (inputData.payment_status || inputData.paymentStatus || '').toString().trim().toLowerCase()
const amountRaw = inputData.amount ?? inputData.amount_cents ?? 0
const amount = Number(amountRaw) || 0
const currency = (inputData.currency || 'USD').toString().toUpperCase()
const purchased_at = (inputData.purchased_at || new Date().toISOString())
const highlevel_event_id = (inputData.highlevel_event_id || inputData.event_id || null)

let metadata = {}
if (inputData.metadata) {
  if (typeof inputData.metadata === 'string') {
    try { metadata = JSON.parse(inputData.metadata) } catch (e) { metadata = { raw: inputData.metadata } }
  } else if (typeof inputData.metadata === 'object') {
    metadata = inputData.metadata
  }
}

const payloadObj = {
  email,
  full_name,
  offer_id,
  payment_id,
  payment_status,
  amount: Math.round(amount),
  currency,
  purchased_at,
  highlevel_event_id,
  contact_id,
  metadata
}

let idempotencyKey = null
if (contact_id) {
  idempotencyKey = `contact:${String(contact_id)}`
} else if (highlevel_event_id) {
  idempotencyKey = `event:${String(highlevel_event_id)}`
} else if (payment_id) {
  idempotencyKey = `payment:${String(payment_id)}`
} else {
  idempotencyKey = 'body:' + crypto.createHash('sha256').update(stableStringify(payloadObj)).digest('hex')
}

const hmacSecret = (inputData.hmac_secret || '').toString()
if (!hmacSecret) {
  output = { error: 'Missing hmac_secret — set HL_WEBHOOK_HMAC_SECRET in Supabase and map it to inputData.hmac_secret' }
} else {
  const bodyString = stableStringify(payloadObj)
  const hmac = crypto.createHmac('sha256', hmacSecret)
  hmac.update(bodyString)
  const signatureHex = hmac.digest('hex')
  const signatureHeader = `sha256=${signatureHex}`

  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'X-HL-Signature': signatureHeader
  }

  output = {
    idempotencyKey,
    signature: signatureHeader,
    headers,
    body: bodyString,
    debug: {
      idempotency_source: contact_id ? 'contact_id' : (highlevel_event_id ? 'highlevel_event_id' : (payment_id ? 'payment_id' : 'body_hash'))
    }
  }
}
```

> TODO: refine payload to minimal required fields before production.

### HighLevel workflow steps (concrete)
1. Trigger: Purchase success.
2. Action: HTTP Request
   - Method: POST
   - URL: `https://api.yoursite.com/hook/highlevel/onboard`
    - Headers:
      - `Content-Type: application/json`
      - `Idempotency-Key: {{event.id}}` (or HL variable for event id)
      - `X-HL-Signature: {{custom_code.hmac}}`
   - Body: map fields from form and HL purchase metadata to the JSON above.
3. Conditional/Follow-ups:
   - If response contains `invitation_link`: HL sends templated welcome email containing that link.
   - If response is `202 Accepted`: HL sends a “we’re creating your account” email and waits for webhook/callback or polls job status.
4. Failure path:
   - If onboarding endpoint returns 4xx: send buyer a support email, create an ops alert, and mark purchase for manual onboarding.
   - If 5xx: rely on HL retry semantics and log detailed context.

### Landing page fields to collect
- `email` (required)
- `full_name` (recommended)
- Payment handled by HL or payment provider; product/offer is handled by HighLevel and need not be sent in the payload
- Optional: `company_name`, `timezone`, `phone`

### Security & operational guidance
- HMAC verify every incoming request; reject unsigned requests.
- Short replay window: reject events older than e.g. 10 minutes (unless idempotency is used and stored).
- Rate limit the endpoint and log every incoming event (signature, event id, returned invite).
- Audit: store `highlevel_event_id`, `payment_id`, and raw metadata on the account for troubleshooting.
- Only create invites on `payment_status === 'paid'`. Handle refunds/chargebacks by deprovisioning or flagging the account.

### Edge cases
- Duplicate events: use `Idempotency-Key` and return the existing invite/account.
- Existing account for email: attach user to workspace or send special instructions in the welcome email.
- Email deliverability failure: either send invite from your server (more control) or have HL surface retry attempts.

### Alternatives considered
- Magic link/session creation via Supabase Admin: possible but duplicates auth plumbing and requires extra secrets; only recommend if you need immediate browser session without clicking an invite.
- Create account + send set-password link: simpler than magic links but adds friction compared to invite + Google OAuth (which the app already supports).

### Next steps / checklist
- [ ] Implement onboarding endpoint and validate HMAC + idempotency. (`onboard-api` TODO)
- [ ] Build/validate provisioning logic that calls `createUserInvitation(...)`. (`onboard-api`)
- [ ] Create HL workflow to POST to onboarding endpoint and email invite. (`hl-workflow` TODO)
- [ ] Implement webhook security (HMAC) and rotateable secrets. (`webhook-security` TODO)
- [ ] Ensure landing page maps fields cleanly to HL workflow variables. (`landing-form` TODO)

If you want, I can now produce the exact Express route skeleton that calls `createUserInvitation(...)` (ready to drop into your API) or produce the HL workflow action text you can paste into HighLevel. Which do you want next?


