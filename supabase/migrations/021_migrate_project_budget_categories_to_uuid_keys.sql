-- Migrate legacy per-project budget category allocations stored in `projects.budget_categories`
-- from legacy keys (e.g. furnishings, propertyManagement, storageReceiving, designFee)
-- to UUID keys referencing `budget_categories.id`.
--
-- Also backfill `projects.design_fee` from the legacy `budget_categories->designFee` value when missing.

-- 1) Backfill design_fee from legacy JSON key if missing.
UPDATE projects
SET design_fee = NULLIF((budget_categories->>'designFee')::numeric, 0)
WHERE design_fee IS NULL
  AND budget_categories ? 'designFee'
  AND NULLIF((budget_categories->>'designFee')::numeric, 0) IS NOT NULL;

-- 2) Convert legacy JSON keys to UUID keys (budget_categories.id) by mapping legacy keys -> budget_categories.slug.
WITH per_project AS (
  SELECT
    p.id AS project_id,
    COALESCE(
      jsonb_object_agg(
        COALESCE(
          u.uuid_key,
          bc.id::text,
          e.key
        ),
        e.value
      ) FILTER (WHERE e.key <> 'designFee'),
      '{}'::jsonb
    ) AS new_budget_categories
  FROM projects p
  CROSS JOIN LATERAL jsonb_each(COALESCE(p.budget_categories, '{}'::jsonb)) AS e(key, value)
  LEFT JOIN LATERAL (
    SELECT e.key AS uuid_key
    WHERE e.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) AS u ON TRUE
  LEFT JOIN LATERAL (
    SELECT CASE e.key
      WHEN 'propertyManagement' THEN 'property-management'
      WHEN 'storageReceiving' THEN 'storage-receiving'
      WHEN 'designFee' THEN 'design-fee'
      ELSE e.key
    END AS legacy_slug
  ) AS s ON TRUE
  LEFT JOIN budget_categories bc
    ON bc.account_id = p.account_id
   AND bc.slug = s.legacy_slug
  WHERE p.budget_categories ?| ARRAY['designFee', 'fuel', 'furnishings', 'install', 'kitchen', 'propertyManagement', 'storageReceiving']
  GROUP BY p.id
)
UPDATE projects p
SET budget_categories = per_project.new_budget_categories
FROM per_project
WHERE p.id = per_project.project_id;


