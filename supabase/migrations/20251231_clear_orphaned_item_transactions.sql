-- Clear stale transaction references from items whose transactions were deleted.
UPDATE public.items AS i
SET
  previous_project_transaction_id = COALESCE(i.previous_project_transaction_id, i.transaction_id),
  transaction_id = NULL,
  latest_transaction_id = CASE
    WHEN i.latest_transaction_id = i.transaction_id THEN NULL
    ELSE i.latest_transaction_id
  END,
  last_updated = NOW()
WHERE i.transaction_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.account_id = i.account_id
      AND t.transaction_id = i.transaction_id
  );
