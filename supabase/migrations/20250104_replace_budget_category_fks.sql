-- Replace foreign key constraints on budget_categories with validation functions
-- that check against embedded presets in account_presets
-- This allows us to drop the budget_categories table while maintaining referential integrity

-- 1. Drop existing foreign key constraints
ALTER TABLE transactions 
  DROP CONSTRAINT IF EXISTS transactions_category_id_fkey;

ALTER TABLE projects 
  DROP CONSTRAINT IF EXISTS projects_default_category_id_fkey;

ALTER TABLE account_presets 
  DROP CONSTRAINT IF EXISTS account_presets_default_category_id_fkey;

-- 2. Create validation function to check if a category exists in embedded presets
CREATE OR REPLACE FUNCTION validate_budget_category_exists(
  p_category_id uuid,
  p_account_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  -- Check if category exists in embedded presets for the given account
  SELECT EXISTS (
    SELECT 1
    FROM account_presets ap,
         jsonb_array_elements(ap.presets->'budget_categories') AS cat
    WHERE ap.account_id = p_account_id
      AND (cat->>'id')::uuid = p_category_id
      AND ap.presets->'budget_categories' IS NOT NULL
  ) INTO v_exists;
  
  RETURN v_exists;
END;
$$;

COMMENT ON FUNCTION validate_budget_category_exists IS 'Validates that a budget category ID exists in the embedded presets for a given account';

-- 3. Create trigger function for transactions.category_id validation
CREATE OR REPLACE FUNCTION check_transaction_category_valid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only validate if category_id is set
  IF NEW.category_id IS NOT NULL THEN
    -- Check if category exists in embedded presets for the transaction's account
    IF NOT validate_budget_category_exists(NEW.category_id, NEW.account_id) THEN
      RAISE EXCEPTION 'Category ID % does not exist in budget categories for account %', NEW.category_id, NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_transaction_category_valid IS 'Validates that transactions.category_id references a valid category in embedded presets';

-- 4. Create trigger function for projects.default_category_id validation
CREATE OR REPLACE FUNCTION check_project_default_category_valid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only validate if default_category_id is set
  IF NEW.default_category_id IS NOT NULL THEN
    -- Check if category exists in embedded presets for the project's account
    IF NOT validate_budget_category_exists(NEW.default_category_id, NEW.account_id) THEN
      RAISE EXCEPTION 'Category ID % does not exist in budget categories for account %', NEW.default_category_id, NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_project_default_category_valid IS 'Validates that projects.default_category_id references a valid category in embedded presets';

-- 5. Create trigger function for account_presets.default_category_id validation
CREATE OR REPLACE FUNCTION check_account_preset_default_category_valid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only validate if default_category_id is set
  IF NEW.default_category_id IS NOT NULL THEN
    -- Check if category exists in embedded presets for the same account
    IF NOT validate_budget_category_exists(NEW.default_category_id, NEW.account_id) THEN
      RAISE EXCEPTION 'Category ID % does not exist in budget categories for account %', NEW.default_category_id, NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_account_preset_default_category_valid IS 'Validates that account_presets.default_category_id references a valid category in embedded presets';

-- 6. Drop existing triggers if they exist (from migration 019)
DROP TRIGGER IF EXISTS enforce_project_category_account_match ON projects;
DROP FUNCTION IF EXISTS check_project_category_account_match();

-- 7. Create triggers
CREATE TRIGGER check_transaction_category_valid
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION check_transaction_category_valid();

CREATE TRIGGER check_project_default_category_valid
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION check_project_default_category_valid();

CREATE TRIGGER check_account_preset_default_category_valid
  BEFORE INSERT OR UPDATE ON account_presets
  FOR EACH ROW
  EXECUTE FUNCTION check_account_preset_default_category_valid();

-- 8. Add comments
COMMENT ON TRIGGER check_transaction_category_valid ON transactions IS 'Validates category_id references embedded presets';
COMMENT ON TRIGGER check_project_default_category_valid ON projects IS 'Validates default_category_id references embedded presets';
COMMENT ON TRIGGER check_account_preset_default_category_valid ON account_presets IS 'Validates default_category_id references embedded presets';
