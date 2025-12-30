import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0'

type HighLevelPayload = {
  email?: string
  full_name?: string
  fullName?: string
  offer_id?: string
  payment_id?: string
  paymentId?: string
  payment_status?: string
  paymentStatus?: string
  amount?: number
  currency?: string
  highlevel_event_id?: string
  highLevelEventId?: string
  metadata?: Record<string, unknown> | null
  [key: string]: unknown
}

type OnboardingEventRow = {
  id: string
  status: string
  account_id: string | null
  invitation_id: string | null
  invitation_link: string | null
  existing_user_id: string | null
  processing_attempts: number | null
  login_url: string | null
}

type SignatureVerification =
  | { verified: true; strategy: 'hmac' }
  | { verified: false; strategy: 'none' }

const encoder = new TextEncoder()
const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const APP_BASE_URL = stripTrailingSlash(requireEnv('APP_BASE_URL'))
const APP_LOGIN_URL = stripTrailingSlash(Deno.env.get('APP_LOGIN_URL') ?? APP_BASE_URL)
const HL_HMAC_SECRET = Deno.env.get('HL_WEBHOOK_HMAC_SECRET')
const INVITER_USER_ID = Deno.env.get('ONBOARDING_INVITER_USER_ID') ?? null
const INVITE_EXPIRATION_DAYS = Number(Deno.env.get('ONBOARDING_INVITE_EXPIRATION_DAYS') ?? '7')

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

Deno.serve(async req => {
  let activeEventId: string | null = null
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-HL-Signature, X-Webhook-Secret'
        }
      })
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const idempotencyKey = req.headers.get('Idempotency-Key')
    if (!idempotencyKey) {
      return jsonResponse({ error: 'Missing Idempotency-Key header' }, 400)
    }

    const rawBody = await req.text()
    if (!rawBody) {
      return jsonResponse({ error: 'Empty request body' }, 400)
    }

    let payload: HighLevelPayload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload' }, 400)
    }

    const verification = await verifySignature(req.headers, rawBody)
    if (!verification.verified) {
      return jsonResponse({ error: 'Signature verification failed' }, 401)
    }

    const normalizedEmail = normalizeEmail(payload.email)
    if (!normalizedEmail) {
      return jsonResponse({ error: 'email is required' }, 422)
    }

    const metadata = coerceRecord(payload.metadata)
    const paymentStatusRaw = extractString(payload.payment_status ?? payload.paymentStatus)
    const paymentStatus = paymentStatusRaw?.toLowerCase()
    const amountCents = typeof payload.amount === 'number' && Number.isFinite(payload.amount)
      ? Math.round(payload.amount)
      : null
    const currency = extractString(payload.currency)?.toUpperCase() ?? null
    const fullName = extractString(payload.full_name ?? payload.fullName)
    const highLevelEventId = extractString(payload.highlevel_event_id ?? payload.highLevelEventId)
    const offerId = extractString(payload.offer_id)
    const paymentId = extractString(payload.payment_id ?? payload.paymentId)

    const existingEvent = await fetchEventByIdempotency(idempotencyKey)
    if (existingEvent) {
      const replayResponse = replayResponseFor(existingEvent)
      if (replayResponse) {
        return replayResponse
      }

      if (existingEvent.status === 'processing') {
        return jsonResponse({ error: 'Event is already processing' }, 409)
      }
    }

    const eventRecord = existingEvent && existingEvent.status === 'failed'
      ? await updateEventForRetry(existingEvent.id, existingEvent.processing_attempts ?? null, {
        idempotency_key: idempotencyKey,
        payload,
        metadata,
        buyer_email: normalizedEmail,
        buyer_full_name: fullName,
        offer_id: offerId,
        payment_id: paymentId,
        highlevel_event_id: highLevelEventId,
        payment_status: paymentStatusRaw,
        amount_cents: amountCents,
        currency,
        hmac_verified: verification.strategy === 'hmac',
        signature_strategy: verification.strategy
      })
      : await insertNewEvent({
        idempotency_key: idempotencyKey,
        payload,
        metadata,
        buyer_email: normalizedEmail,
        buyer_full_name: fullName,
        offer_id: offerId,
        payment_id: paymentId,
        highlevel_event_id: highLevelEventId,
        payment_status: paymentStatusRaw,
        amount_cents: amountCents,
        currency,
        hmac_verified: verification.strategy === 'hmac',
        signature_strategy: verification.strategy
      })

    activeEventId = eventRecord.id

    if (!paymentStatus || paymentStatus !== 'paid') {
      await markEventIgnored(eventRecord.id, `payment_status=${paymentStatusRaw ?? 'unknown'}`)
      return jsonResponse({
        status: 'ignored',
        reason: 'Payment not marked as paid yet',
        payment_status: paymentStatusRaw ?? null,
        idempotency_key: idempotencyKey
      }, 202)
    }

    const accountName = deriveAccountName(metadata, fullName, normalizedEmail)
    const { accountId, reusedAccount } = await ensureAccount(eventRecord, accountName)

    const existingUser = await findUserByEmail(normalizedEmail)
    if (existingUser) {
      await attachExistingUser(existingUser, accountId)
      await markExistingUserSuccess(eventRecord.id, accountId, existingUser.id)
      return jsonResponse({
        status: 'existing_user_attached',
        account_id: accountId,
        login_url: APP_LOGIN_URL,
        idempotency_key: idempotencyKey,
        reused_account: reusedAccount
      })
    }

    const invitation = await ensureInvitation(
      eventRecord,
      accountId,
      normalizedEmail
    )

    await markInviteSuccess(eventRecord.id, accountId, invitation.id, invitation.link)

    return jsonResponse({
      status: 'ok',
      invitation_link: invitation.link,
      account_id: accountId,
      idempotency_key: idempotencyKey,
      reused_account: reusedAccount
    })
  } catch (error) {
    console.error('HighLevel onboarding handler error:', error)
    if (activeEventId) {
      const message = truncateErrorMessage(error)
      await safeUpdateFailure(activeEventId, message)
    }
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})

function requireEnv(key: string): string {
  const value = Deno.env.get(key)
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function stripTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function extractString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function normalizeEmail(email?: string) {
  return email?.trim().toLowerCase() ?? null
}

function coerceRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function deriveAccountName(metadata: Record<string, unknown>, fullName: string | null, email: string) {
  const companyName = extractString(
    (metadata['company_name'] ?? metadata['companyName']) as string | undefined
  )
  if (companyName) {
    return companyName
  }
  if (fullName) {
    return `${fullName}'s Workspace`
  }
  return `${email}'s Workspace`
}

async function verifySignature(headers: Headers, rawBody: string): Promise<SignatureVerification> {
  const signatureHeader = headers.get('X-HL-Signature')
  if (HL_HMAC_SECRET && signatureHeader && signatureHeader.startsWith('sha256=')) {
    const provided = signatureHeader.substring(7)
    const expected = await hmacSha256Hex(HL_HMAC_SECRET, rawBody)
    if (timingSafeEqual(provided, expected)) {
      return { verified: true, strategy: 'hmac' }
    }
  }

  return { verified: false, strategy: 'none' }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i]
  }
  return result === 0
}

async function fetchEventByIdempotency(idempotencyKey: string) {
  const { data, error } = await supabaseAdmin
    .from('highlevel_onboarding_events')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch onboarding event: ${error.message}`)
  }

  return data as (OnboardingEventRow & Record<string, any>) | null
}

function replayResponseFor(event: OnboardingEventRow) {
  if (event.status === 'succeeded_invite' && event.invitation_link && event.account_id) {
    return jsonResponse({
      status: 'ok',
      invitation_link: event.invitation_link,
      account_id: event.account_id,
      idempotency_replay: true
    })
  }
  if (event.status === 'succeeded_existing_user' && event.account_id) {
    return jsonResponse({
      status: 'existing_user_attached',
      account_id: event.account_id,
      login_url: event.login_url ?? APP_LOGIN_URL,
      idempotency_replay: true
    })
  }
  if (event.status === 'ignored') {
    return jsonResponse({
      status: 'ignored',
      account_id: event.account_id,
      login_url: event.login_url ?? APP_LOGIN_URL,
      idempotency_replay: true
    }, 202)
  }
  return null
}

async function insertNewEvent(values: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from('highlevel_onboarding_events')
    .insert({
      ...values,
      status: 'processing',
      processing_attempts: 1
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to insert onboarding event: ${error?.message ?? 'Unknown error'}`)
  }

  return data as OnboardingEventRow & Record<string, any>
}

async function updateEventForRetry(eventId: string, previousAttempts: number | null, values: Record<string, unknown>) {
  const attemptCount = (previousAttempts ?? 0) + 1
  const { data, error } = await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      ...values,
      status: 'processing',
      error_message: null,
      last_processed_at: null,
      processing_attempts: attemptCount
    })
    .eq('id', eventId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to reset onboarding event: ${error?.message ?? 'Unknown error'}`)
  }

  return data as OnboardingEventRow & Record<string, any>
}

async function markEventIgnored(eventId: string, reason: string) {
  await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      status: 'ignored',
      error_message: reason,
      last_processed_at: new Date().toISOString()
    })
    .eq('id', eventId)
}

async function ensureAccount(
  eventRecord: OnboardingEventRow & Record<string, any>,
  accountName: string
) {
  if (eventRecord.account_id) {
    return { accountId: eventRecord.account_id as string, reusedAccount: true }
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .insert({
      name: accountName,
      created_by: INVITER_USER_ID
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create account: ${error?.message ?? 'Unknown error'}`)
  }

  await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      account_id: data.id
    })
    .eq('id', eventRecord.id)

  return { accountId: data.id as string, reusedAccount: false }
}

async function findUserByEmail(email: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch user: ${error.message}`)
  }

  return data as { id: string; role: string | null } | null
}

async function attachExistingUser(
  user: { id: string; role: string | null },
  accountId: string
) {
  const updatePayload: Record<string, unknown> = {
    account_id: accountId
  }

  if (user.role !== 'owner') {
    updatePayload.role = 'admin'
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update(updatePayload)
    .eq('id', user.id)

  if (error) {
    throw new Error(`Failed to attach existing user: ${error.message}`)
  }
}

async function markExistingUserSuccess(eventId: string, accountId: string, userId: string) {
  await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      status: 'succeeded_existing_user',
      account_id: accountId,
      invitation_id: null,
      invitation_link: null,
      login_url: APP_LOGIN_URL,
      existing_user_id: userId,
      last_processed_at: new Date().toISOString(),
      error_message: null
    })
    .eq('id', eventId)
}

function generateInvitationToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function ensureInvitation(
  eventRecord: OnboardingEventRow & Record<string, any>,
  accountId: string,
  email: string
) {
  if (eventRecord.invitation_id && eventRecord.invitation_link) {
    return {
      id: eventRecord.invitation_id,
      link: eventRecord.invitation_link
    }
  }

  const token = generateInvitationToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRATION_DAYS)

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .insert({
      email,
      role: 'admin',
      account_id: accountId,
      invited_by: INVITER_USER_ID,
      status: 'pending',
      token,
      expires_at: expiresAt.toISOString()
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create invitation: ${error?.message ?? 'Unknown error'}`)
  }

  const invitationLink = `${APP_BASE_URL}/invite/${token}`

  await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      invitation_id: data.id,
      invitation_link: invitationLink
    })
    .eq('id', eventRecord.id)

  return { id: data.id as string, link: invitationLink }
}

async function markInviteSuccess(eventId: string, accountId: string, invitationId: string, link: string) {
  await supabaseAdmin
    .from('highlevel_onboarding_events')
    .update({
      status: 'succeeded_invite',
      account_id: accountId,
      invitation_id: invitationId,
      invitation_link: link,
      last_processed_at: new Date().toISOString(),
      error_message: null
    })
    .eq('id', eventId)
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  })
}

function truncateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500)
  }
  return 'Unhandled error'
}

async function safeUpdateFailure(eventId: string, message: string) {
  try {
    await supabaseAdmin
      .from('highlevel_onboarding_events')
      .update({
        status: 'failed',
        error_message: message,
        last_processed_at: new Date().toISOString()
      })
      .eq('id', eventId)
  } catch (err) {
    console.error('Failed to record onboarding failure:', err)
  }
}



