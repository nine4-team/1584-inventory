-- Normalize legacy disposition values and enforce canonical options
UPDATE items
SET disposition = 'purchased'
WHERE disposition = 'keep';

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_disposition_check,
  ADD CONSTRAINT items_disposition_check
    CHECK (
      disposition IN ('to purchase', 'purchased', 'to return', 'returned', 'inventory')
      OR disposition IS NULL
    );
