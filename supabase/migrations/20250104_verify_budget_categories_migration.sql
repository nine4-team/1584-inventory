-- Phase 2: Verification queries for budget categories migration
-- Run these queries to verify the migration was successful
-- Expected: zero rows in both result sets

-- Verification 1: Count comparison per account
-- This query shows accounts where the count of categories in the table
-- does not match the count in account_presets
WITH table_counts AS (
  SELECT account_id, COUNT(*) AS cnt
  FROM budget_categories
  GROUP BY account_id
), embedded_counts AS (
  SELECT account_id,
         jsonb_array_length(presets->'budget_categories') AS cnt
  FROM account_presets
  WHERE presets->'budget_categories' IS NOT NULL
)
SELECT 
  tc.account_id, 
  tc.cnt AS table_cnt, 
  COALESCE(ec.cnt, 0) AS embedded_cnt,
  tc.cnt - COALESCE(ec.cnt, 0) AS difference
FROM table_counts tc
LEFT JOIN embedded_counts ec USING (account_id)
WHERE COALESCE(tc.cnt, 0) <> COALESCE(ec.cnt, 0);

-- Verification 2: Checksum comparison
-- This query shows accounts where the checksum of serialized categories
-- does not match the checksum of embedded categories
WITH serialized AS (
  SELECT 
    bc.account_id,
    md5(
      jsonb_agg(
        to_jsonb(bc) 
        ORDER BY 
          CASE 
            WHEN ap.presets->'budget_category_order' IS NOT NULL 
            THEN array_position(
              ARRAY(SELECT jsonb_array_elements_text(ap.presets->'budget_category_order')),
              bc.id::text
            )
            ELSE NULL
          END NULLS LAST,
          bc.created_at
      )::text
    ) AS checksum
  FROM budget_categories bc
  LEFT JOIN account_presets ap ON ap.account_id = bc.account_id
  GROUP BY bc.account_id
),
embedded AS (
  SELECT 
    account_id,
    md5((presets->'budget_categories')::text) AS checksum
  FROM account_presets
  WHERE presets->'budget_categories' IS NOT NULL
)
SELECT 
  s.account_id,
  s.checksum AS table_checksum,
  e.checksum AS embedded_checksum
FROM serialized s
LEFT JOIN embedded e USING (account_id)
WHERE s.checksum <> COALESCE(e.checksum, '');

-- Note: If either query returns rows, investigate before proceeding with app deployment
