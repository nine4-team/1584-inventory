-- Data repair: recover offline-only items missing on server
--
-- Source: dev_docs/actively_implementing/reconciliation_offline_vs_server_report_2026-02-03_account-1dd4fd75.json
-- Account: 1dd4fd75-8eea-4f7a-98e7-bf45b987ae94
--
-- What this does:
-- - Inserts the 7 "offline-only canonical" items into public.items (if they do not already exist).
-- - No updates, no deletes.
-- - Idempotent.
-- - Safe across environments: no-ops if the account does not exist.
--
-- Important limitation:
-- - The reconciliation report does not include the full `images` JSON payload (only `imagesCount`).
--   This migration inserts `images = []`. If you need to restore image metadata, it must come from the
--   original offline record that contains the per-image url/fileName/uploadedAt fields.
DO $$
DECLARE
  v_account_id uuid := '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94'::uuid;
  v_export_user_id uuid := '4ef35958-597c-4aea-b99e-1ef62352a72d'::uuid;
  v_created_by uuid := null;
BEGIN
  -- Skip entirely if the target account doesn't exist in this environment.
  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = v_account_id) THEN
    RAISE NOTICE 'Skipping item recovery: account % not found', v_account_id;
    RETURN;
  END IF;

  -- Use created_by only if the referenced user exists (avoid FK failures).
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_export_user_id) THEN
    v_created_by := v_export_user_id;
  END IF;

  WITH seed(
    item_id,
    description,
    source,
    sku,
    purchase_price,
    project_price,
    market_value,
    payment_method,
    disposition,
    date_created,
    last_updated,
    qr_key
  ) AS (
    VALUES
      (
        'I-1768698497733-l9fw',
        'Small gold round lift',
        '',
        '084553',
        '',
        '',
        '',
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:09:52.393+00:00'::timestamptz,
        'qr_1768698497733_i5uv196t3'
      ),
      (
        'I-1768698607868-o0ao',
        'Small gold round lift',
        '',
        '084553',
        null,
        null,
        null,
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:10:07.88+00:00'::timestamptz,
        'qr_1768698497733_i5uv196t3'
      ),
      (
        'I-1768698614872-prtb',
        'Small gold round lift',
        '',
        '084553',
        null,
        null,
        null,
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:10:14.886+00:00'::timestamptz,
        'qr_1768698497733_i5uv196t3'
      ),
      (
        'I-1768698616864-fm1b',
        'Small gold round lift',
        '',
        '084553',
        null,
        null,
        null,
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:10:16.876+00:00'::timestamptz,
        'qr_1768698497733_i5uv196t3'
      ),
      (
        'I-1768699194616-cx30',
        'Square marble lift',
        '',
        '',
        '',
        '',
        '',
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:19:54.63+00:00'::timestamptz,
        'qr_1768699194616_b9elgarta'
      ),
      (
        'I-1768699214269-6rg1',
        'Square marble lift',
        '',
        '',
        null,
        null,
        null,
        'Cash',
        'inventory',
        '2026-01-17'::date,
        '2026-01-18T01:20:14.28+00:00'::timestamptz,
        'qr_1768699194616_b9elgarta'
      ),
      (
        'I-1769049054881-7rv2',
        'White distressed cylinder tree pot',
        'Homegoods',
        '007517',
        '24.99',
        '69.99',
        '99.99',
        'Cash',
        'inventory',
        '2026-01-21'::date,
        '2026-01-22T02:30:54.914+00:00'::timestamptz,
        'qr_1769049054880_cwr5a68xj'
      )
  )
  INSERT INTO public.items (
    account_id,
    project_id,
    transaction_id,
    item_id,
    description,
    source,
    sku,
    purchase_price,
    project_price,
    market_value,
    payment_method,
    disposition,
    date_created,
    last_updated,
    qr_key,
    images,
    created_by,
    created_at
  )
  SELECT
    v_account_id,
    null::uuid,
    null::text,
    s.item_id,
    s.description,
    nullif(s.source, ''),
    nullif(s.sku, ''),
    nullif(s.purchase_price, ''),
    nullif(s.project_price, ''),
    nullif(s.market_value, ''),
    nullif(s.payment_method, ''),
    nullif(s.disposition, ''),
    s.date_created,
    s.last_updated,
    s.qr_key,
    '[]'::jsonb,
    v_created_by,
    s.last_updated
  FROM seed s
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.account_id = v_account_id
      AND i.item_id = s.item_id
  );
END $$;

