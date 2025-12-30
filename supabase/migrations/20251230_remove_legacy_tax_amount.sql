-- Remove legacy tax_amount column as it's no longer used
-- All tax amount data is now stored in tax_amount_purchase_price and tax_amount_project_price
ALTER TABLE items DROP COLUMN tax_amount;