-- HighLevel onboarding event + idempotency storage
-- Captures every inbound HL purchase event, signature state, and resulting invite/account data

CREATE TABLE IF NOT EXISTS public.highlevel_onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  highlevel_event_id TEXT,
  payment_id TEXT,
  payment_status TEXT,
  buyer_email TEXT NOT NULL,
  buyer_full_name TEXT,
  offer_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'processing',
      'succeeded_invite',
      'succeeded_existing_user',
      'ignored',
      'failed'
    )
  ),
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  error_message TEXT,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
  invitation_link TEXT,
  existing_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  hmac_verified BOOLEAN NOT NULL DEFAULT FALSE,
  signature_strategy TEXT,
  static_secret_label TEXT,
  login_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_highlevel_onboarding_idempotency
  ON public.highlevel_onboarding_events (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_highlevel_onboarding_payment_id
  ON public.highlevel_onboarding_events (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_highlevel_onboarding_hl_event_id
  ON public.highlevel_onboarding_events (highlevel_event_id)
  WHERE highlevel_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_highlevel_onboarding_buyer_email
  ON public.highlevel_onboarding_events (buyer_email);

CREATE INDEX IF NOT EXISTS idx_highlevel_onboarding_status
  ON public.highlevel_onboarding_events (status);

ALTER TABLE public.highlevel_onboarding_events ENABLE ROW LEVEL SECURITY;

-- Only system owners (internal ops) can view onboarding logs through Supabase
DROP POLICY IF EXISTS "system_owner_can_manage_highlevel_onboarding_events"
  ON public.highlevel_onboarding_events;

CREATE POLICY "system_owner_can_manage_highlevel_onboarding_events"
  ON public.highlevel_onboarding_events
  USING (is_system_owner())
  WITH CHECK (is_system_owner());


