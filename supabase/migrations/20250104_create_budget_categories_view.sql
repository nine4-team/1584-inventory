-- Phase 3: Create view to unnest embedded budget categories
-- This view makes embedded categories appear as if they're in a table
-- for backward compatibility with existing code

CREATE OR REPLACE VIEW vw_budget_categories AS
SELECT 
  (cat->>'id')::uuid AS id,
  ap.account_id AS account_id,  -- Use account_id from account_presets, not from JSONB
  cat->>'name' AS name,
  cat->>'slug' AS slug,
  COALESCE((cat->>'is_archived')::boolean, false) AS is_archived,
  CASE 
    WHEN cat->>'metadata' = 'null' THEN NULL
    ELSE (cat->>'metadata')::jsonb
  END AS metadata,
  (cat->>'created_at')::timestamptz AS created_at,
  (cat->>'updated_at')::timestamptz AS updated_at
FROM account_presets ap,
     jsonb_array_elements(ap.presets->'budget_categories') AS cat
WHERE ap.presets->'budget_categories' IS NOT NULL;

-- Enable RLS on the view (views inherit RLS from underlying tables)
ALTER VIEW vw_budget_categories SET (security_invoker = true);

-- Add comment
COMMENT ON VIEW vw_budget_categories IS 'View that unnests budget categories from account_presets.presets->budget_categories for backward compatibility';
