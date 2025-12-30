-- Create Test Project (Traditional Elegance Estate) with Transactions and Items
-- Account: 2d612868-852e-4a80-9d02-9d10383898d4
-- Created By: 4ef35958-597c-4aea-b99e-1ef62352a72d

-- Budget Category UUIDs (from account)
-- Design Fee: 2864a93a-d0a6-4a27-b90c-ddb532097514
-- Furnishings: ea004cdf-9766-4a0b-974e-499c6dad9c14
-- Install: 57981f56-2cb1-46f9-b574-0f882eb45d0b
-- Kitchen: 1ed62640-70f5-403d-84a0-3a35d8dff1d0
-- Fuel: 38bd39be-930c-4e2c-8a6a-be0cbef03e29
-- Storage & Receiving: 4f23aa16-982e-49f7-8b1c-ec26b0a89716
-- Property Management: 69b403a4-3dfd-4900-8a1e-a0a30623c73e

DO $$
DECLARE
  -- Constants
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_tax_rate_pct NUMERIC := 10.0;
  
  -- Budget Category UUIDs
  v_cat_design_fee UUID := '2864a93a-d0a6-4a27-b90c-ddb532097514';
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_cat_install UUID := '57981f56-2cb1-46f9-b574-0f882eb45d0b';
  v_cat_kitchen UUID := '1ed62640-70f5-403d-84a0-3a35d8dff1d0';
  v_cat_fuel UUID := '38bd39be-930c-4e2c-8a6a-be0cbef03e29';
  v_cat_storage UUID := '4f23aa16-982e-49f7-8b1c-ec26b0a89716';
  v_cat_property_mgmt UUID := '69b403a4-3dfd-4900-8a1e-a0a30623c73e';
  
  -- Project IDs
  v_project_id UUID;
  
  -- Transaction IDs (TEXT)
  v_tx_id TEXT;
  
  -- Item variables
  v_item_id TEXT;
  v_qr_key TEXT;
  v_raw_purchase NUMERIC;
  v_raw_project NUMERIC;
  v_raw_market NUMERIC;
  v_purchase NUMERIC;
  v_project_price NUMERIC;
  v_market NUMERIC;
  v_tax_purchase NUMERIC;
  v_tax_project NUMERIC;
  
  -- Transaction totals
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  
  -- Timestamp for IDs
  v_timestamp BIGINT;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;

-- ============================================
  -- PROJECT 4: Traditional Elegance Estate
  -- ============================================
  INSERT INTO projects (
    account_id, name, description, client_name, budget, design_fee,
    budget_categories, main_image_url, created_by, created_at, updated_at
  ) VALUES (
    v_account_id,
    'Traditional Elegance Estate',
    'Classic and sophisticated design for a large estate home featuring traditional furniture, rich fabrics, and timeless pieces',
    'Robert & Elizabeth Windsor',
    140000.00,
    35000.00,
    '{"designFee": 35000, "furnishings": 87000, "install": 5000, "kitchen": 5000, "fuel": 2000, "storageReceiving": 5000, "propertyManagement": 1000}'::jsonb,
    'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&h=600&fit=crop',
    v_created_by,
    NOW(),
    NOW()
  ) RETURNING id INTO v_project_id;
  
  -- Create transactions and items for Project 4 (simplified - key items only)
  -- Tufted Sofa, Formal Dining Table, Oriental Rug, Chandelier
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;
  
  -- Tufted Sofa
  v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_raw_purchase := 4200.00;
  v_raw_project := 4800.00;
  v_raw_market := 5400.00;
  v_purchase := LEAST(v_raw_purchase, v_raw_project, v_raw_market);
  v_market := GREATEST(v_raw_purchase, v_raw_project, v_raw_market);
  v_project_price := v_raw_purchase + v_raw_project + v_raw_market - v_purchase - v_market;
  v_tax_purchase := ROUND(v_purchase * v_tax_rate_pct / 100.0, 4);
  v_tax_project := ROUND(v_project_price * v_tax_rate_pct / 100.0, 4);
  INSERT INTO items (
    account_id, project_id, transaction_id, item_id, name, description, sku, source,
    purchase_price, project_price, market_value, tax_rate_pct, tax_amount_purchase_price, tax_amount_project_price,
    payment_method, disposition, qr_key, inventory_status, date_created, created_by, created_at, last_updated
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, v_item_id, 'Tufted Sofa',
    'Classic tufted sofa in navy blue velvet, 3-seater',
    'HG-SOFA-TUFTED-001', 'Restoration Hardware',
    v_purchase::text, v_project_price::text, v_market::text,
    v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
    'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE,
    v_created_by, NOW(), NOW()
  );
  v_item_ids := v_item_ids || v_item_id;
  v_tx_subtotal := v_tx_subtotal + v_project_price;
  
  -- Formal Dining Table
  v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_raw_purchase := 5500.00;
  v_raw_project := 6200.00;
  v_raw_market := 7000.00;
  v_purchase := LEAST(v_raw_purchase, v_raw_project, v_raw_market);
  v_market := GREATEST(v_raw_purchase, v_raw_project, v_raw_market);
  v_project_price := v_raw_purchase + v_raw_project + v_raw_market - v_purchase - v_market;
  v_tax_purchase := ROUND(v_purchase * v_tax_rate_pct / 100.0, 4);
  v_tax_project := ROUND(v_project_price * v_tax_rate_pct / 100.0, 4);
  INSERT INTO items (
    account_id, project_id, transaction_id, item_id, name, description, sku, source,
    purchase_price, project_price, market_value, tax_rate_pct, tax_amount_purchase_price, tax_amount_project_price,
    payment_method, disposition, qr_key, inventory_status, date_created, created_by, created_at, last_updated
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, v_item_id, 'Formal Dining Table',
    'Extendable mahogany dining table, seats 10-12',
    'HG-TABLE-FORMAL-001', 'Restoration Hardware',
    v_purchase::text, v_project_price::text, v_market::text,
    v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
    'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE,
    v_created_by, NOW(), NOW()
  );
  v_item_ids := v_item_ids || v_item_id;
  v_tx_subtotal := v_tx_subtotal + v_project_price;
  
  -- Oriental Area Rug
  v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
  v_raw_purchase := 3200.00;
  v_raw_project := 3800.00;
  v_raw_market := 4400.00;
  v_purchase := LEAST(v_raw_purchase, v_raw_project, v_raw_market);
  v_market := GREATEST(v_raw_purchase, v_raw_project, v_raw_market);
  v_project_price := v_raw_purchase + v_raw_project + v_raw_market - v_purchase - v_market;
  v_tax_purchase := ROUND(v_purchase * v_tax_rate_pct / 100.0, 4);
  v_tax_project := ROUND(v_project_price * v_tax_rate_pct / 100.0, 4);
  INSERT INTO items (
    account_id, project_id, transaction_id, item_id, name, description, sku, source,
    purchase_price, project_price, market_value, tax_rate_pct, tax_amount_purchase_price, tax_amount_project_price,
    payment_method, disposition, qr_key, inventory_status, date_created, created_by, created_at, last_updated
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, v_item_id, 'Oriental Area Rug',
    'Hand-knotted Oriental rug, 10x14 feet, navy and gold',
    'HG-RUG-ORIENTAL-001', 'Rugs USA',
    v_purchase::text, v_project_price::text, v_market::text,
    v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
    'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE,
    v_created_by, NOW(), NOW()
  );
  v_item_ids := v_item_ids || v_item_id;
  v_tx_subtotal := v_tx_subtotal + v_project_price;
  
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '60 days', 'Various', 'Purchase',
    v_tx_total::text, 'Furnishings purchase', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
  
  RAISE NOTICE 'Project 4 created: %', v_project_id;

UPDATE projects SET
    item_count = (SELECT COUNT(*) FROM items WHERE project_id = v_project_id),
    transaction_count = (SELECT COUNT(*) FROM transactions WHERE project_id = v_project_id),
    total_value = (SELECT COALESCE(SUM(project_price::numeric), 0) FROM items WHERE project_id = v_project_id)
  WHERE id = v_project_id;
END $$;
