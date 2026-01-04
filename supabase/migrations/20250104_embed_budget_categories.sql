-- Phase 1: Embed budget categories into account_presets
-- This migration aggregates each account's categories (ordered by budget_category_order)
-- and writes them into account_presets.presets->budget_categories

-- Ensure account_presets rows exist for all accounts
INSERT INTO account_presets (account_id, presets, created_at, updated_at)
SELECT a.id, '{}'::jsonb, now(), now()
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM account_presets ap WHERE ap.account_id = a.id
)
ON CONFLICT (account_id) DO NOTHING;

-- Embed categories into account_presets.presets->budget_categories
-- Categories are ordered by budget_category_order if it exists, otherwise by created_at
UPDATE account_presets ap
SET 
  presets = jsonb_set(
    jsonb_set(
      COALESCE(presets, '{}'::jsonb),
      '{budget_categories}',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bc.id,
              'account_id', bc.account_id,
              'name', bc.name,
              'slug', bc.slug,
              'is_archived', bc.is_archived,
              'metadata', bc.metadata,
              'created_at', bc.created_at,
              'updated_at', bc.updated_at
            ) ORDER BY 
              -- Use budget_category_order if it exists
              CASE 
                WHEN ap.presets->'budget_category_order' IS NOT NULL 
                THEN array_position(
                  ARRAY(SELECT jsonb_array_elements_text(ap.presets->'budget_category_order')),
                  bc.id::text
                )
                ELSE NULL
              END NULLS LAST,
              -- Fallback to created_at
              bc.created_at
          )
          FROM budget_categories bc
          WHERE bc.account_id = ap.account_id
        ),
        '[]'::jsonb
      ),
      true
    ),
    '{last_migrated_at}',
    to_jsonb(now()),
    true
  ),
  updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM budget_categories bc WHERE bc.account_id = ap.account_id
);

-- Add comment
COMMENT ON COLUMN account_presets.presets IS 'JSONB object containing presets. After migration, budget_categories array is stored here. Format: {"budget_categories": [...], "budget_category_order": [...], "last_migrated_at": "timestamp"}';
