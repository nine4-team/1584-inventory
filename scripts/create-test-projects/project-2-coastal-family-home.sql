DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
BEGIN
  INSERT INTO projects (
    account_id, id, name, description, client_name, budget, design_fee,
    budget_categories, main_image_url, created_by, created_at, updated_at
  ) VALUES (
    v_account_id,
    v_project_id,
    'Coastal Family Home',
    'Bright and airy coastal design for a family of four, featuring beach-inspired colors and comfortable, durable furnishings',
    'Michael & Jennifer Thompson',
    125000.00,
    31250.00,
    '{"designFee": 31250, "furnishings": 77000, "install": 5000, "kitchen": 5000, "fuel": 2000, "storageReceiving": 1000, "propertyManagement": 7500}'::jsonb,
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop',
    v_created_by,
    NOW(),
    NOW()
  ) ON CONFLICT (id) DO UPDATE SET
    budget_categories = '{"designFee": 31250, "furnishings": 77000, "install": 5000, "kitchen": 5000, "fuel": 2000, "storageReceiving": 1000, "propertyManagement": 7500}'::jsonb,
    updated_at = NOW();
END $$;

-- Delete existing transactions and items for this project
DELETE FROM items WHERE project_id = '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
DELETE FROM transactions WHERE project_id = '60734ca8-8f0d-4f96-8cab-f507fa0829e5';

-- Transaction 1: Large furnishings purchase from Pottery Barn - $15,000 subtotal (with reimbursement)
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Large Sectional Sofa', 'Coastal sectional sofa in light blue fabric, seats 5', 'PB-SOFA-SECTIONAL-001', 'Pottery Barn', 3600.00, 4000.00, 4400.00),
      ('Farmhouse Dining Table', 'White washed farmhouse dining table, seats 8', 'PB-TABLE-DINING-001', 'Pottery Barn', 2100.00, 2400.00, 2700.00),
      ('Dining Chairs (Set of 6)', 'Matching dining chairs, white washed finish', 'PB-CHAIR-DINE-001', 'Pottery Barn', 800.00, 880.00, 960.00),
      ('Coffee Table', 'Woven rattan coffee table with glass top, round', 'PB-TABLE-COFFEE-001', 'Pottery Barn', 620.00, 690.00, 760.00),
      ('Area Rug', 'Natural jute area rug, 9x12 feet', 'PB-RUG-JUTE-001', 'Pottery Barn', 750.00, 820.00, 900.00),
      ('Media Console', 'White media console with storage', 'PB-CONSOLE-MEDIA-001', 'Pottery Barn', 1100.00, 1220.00, 1340.00),
      ('Accent Chairs (Pair)', 'Coastal style accent chairs', 'PB-CHAIR-ACCENT-001', 'Pottery Barn', 1350.00, 1500.00, 1650.00),
      ('Bookshelf', '5-shelf bookcase, white finish', 'PB-SHELF-BOOK-001', 'Pottery Barn', 580.00, 640.00, 700.00),
      ('Sideboard', 'Coastal sideboard with drawers', 'PB-SIDEBOARD-001', 'Pottery Barn', 950.00, 1050.00, 1150.00),
      ('Console Table', 'White console table', 'PB-TABLE-CONSOLE-001', 'Pottery Barn', 480.00, 540.00, 600.00),
      ('Wall Mirror', 'Large round mirror with rope frame', 'PB-MIRROR-ROPE-001', 'Pottery Barn', 320.00, 360.00, 400.00),
      ('Throw Pillows (Set of 6)', 'Coastal themed throw pillows', 'PB-PILLOW-COASTAL-001', 'Pottery Barn', 200.00, 225.00, 250.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Design Business Card', 'to purchase', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '50 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method, reimbursement_type,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '50 days', 'Pottery Barn', 'Purchase',
    v_tx_total::text, 'Major furnishings purchase from Pottery Barn', v_cat_furnishings, 'completed', 'Design Business Card', 'Client Owes Design Business',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 2: Homegoods coastal accessories - $4,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Wicker Accent Chairs (Pair)', 'Wicker accent chairs with blue cushions', 'HG-CHAIR-WICKER-001', 'Homegoods', 750.00, 820.00, 900.00),
      ('White Console Table', 'White console table with drawers, 60 inches', 'HG-TABLE-CONSOLE-001', 'Homegoods', 480.00, 540.00, 600.00),
      ('Throw Blankets (Set of 2)', 'Cozy throw blankets in navy and white stripes', 'HG-BLANKET-COASTAL-001', 'Homegoods', 95.00, 105.00, 115.00),
      ('Round Wall Mirror', 'Large round mirror with rope frame, 36 inches', 'HG-MIRROR-ROPE-001', 'Homegoods', 320.00, 360.00, 400.00),
      ('Decorative Vases (Set of 3)', 'Ceramic vases in various sizes, white and blue', 'HG-VASE-SET-001', 'Homegoods', 135.00, 150.00, 165.00),
      ('Table Lamps (Pair)', 'Coastal table lamps', 'HG-LAMP-TABLE-001', 'Homegoods', 200.00, 225.00, 250.00),
      ('Wall Art (Set of 4)', 'Coastal prints', 'HG-ART-COASTAL-001', 'Homegoods', 300.00, 340.00, 380.00),
      ('Throw Pillows (Set of 6)', 'Coastal themed throw pillows', 'HG-PILLOW-COASTAL-001', 'Homegoods', 180.00, 200.00, 220.00),
      ('Storage Baskets (Set of 5)', 'Woven storage baskets', 'HG-BASKET-STORAGE-001', 'Homegoods', 150.00, 170.00, 190.00),
      ('Candle Holders (Set of 4)', 'Coastal candle holders', 'HG-CANDLE-HOLDER-001', 'Homegoods', 120.00, 135.00, 150.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '45 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '45 days', 'Homegoods', 'Purchase',
    v_tx_total::text, 'Coastal accessories from Homegoods', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 3: World Market and Rugs USA - $3,200 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Rattan Coffee Table', 'Woven rattan coffee table with glass top, round', 'WM-TABLE-RATTAN-001', 'World Market', 540.00, 600.00, 660.00),
      ('Jute Area Rug', 'Natural jute area rug, 9x12 feet', 'RU-RUG-JUTE-001', 'Rugs USA', 580.00, 640.00, 700.00),
      ('Table Lamps (Pair)', 'Ceramic table lamps with white shades', 'TG-LAMP-TABLE-001', 'Target', 200.00, 220.00, 240.00),
      ('Wall Sconces (Pair)', 'Coastal wall sconces with rope accents', 'WM-SCONCE-WALL-001', 'World Market', 270.00, 300.00, 330.00),
      ('Throw Pillows (Set of 4)', 'Coastal throw pillows', 'WM-PILLOW-COASTAL-001', 'World Market', 150.00, 170.00, 190.00),
      ('Wall Art (Set of 3)', 'Coastal wall art', 'WM-ART-COASTAL-001', 'World Market', 240.00, 270.00, 300.00),
      ('Vases (Set of 3)', 'Ceramic vases', 'WM-VASE-SET-001', 'World Market', 110.00, 125.00, 140.00),
      ('Candle Holders (Set of 4)', 'Coastal candle holders', 'WM-CANDLE-HOLDER-001', 'World Market', 100.00, 110.00, 120.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '42 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '42 days', 'Various', 'Purchase',
    v_tx_total::text, 'Furnishings purchase from multiple vendors', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 4: Wayfair bedroom sets - $8,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Master Bed Frame', 'Coastal style bed frame, king size, white washed', 'WF-BED-COASTAL-001', 'Wayfair', 950.00, 1050.00, 1150.00),
      ('Nightstands (Pair)', 'Matching nightstands with drawers, white washed', 'WF-NIGHTSTAND-COASTAL-001', 'Wayfair', 580.00, 640.00, 700.00),
      ('Dresser', '6-drawer dresser, white washed finish', 'WF-DRESSER-COASTAL-001', 'Wayfair', 1100.00, 1220.00, 1340.00),
      ('Kids Bedroom Set', 'Twin bed frame with matching dresser and nightstand', 'WF-BED-KIDS-001', 'Wayfair', 1350.00, 1500.00, 1650.00),
      ('Bedding Sets (2)', 'Coastal themed bedding sets for master and kids rooms', 'WF-BEDDING-COASTAL-001', 'Wayfair', 480.00, 540.00, 600.00),
      ('Kids Bedroom Dresser', 'Matching dresser for kids room', 'WF-DRESSER-KIDS-001', 'Wayfair', 850.00, 950.00, 1050.00),
      ('Bedside Lamps (Pair)', 'Coastal bedside lamps', 'WF-LAMP-BEDSIDE-001', 'Wayfair', 270.00, 300.00, 330.00),
      ('Wardrobe', 'Coastal wardrobe for master bedroom', 'WF-WARDROBE-COASTAL-001', 'Wayfair', 1350.00, 1500.00, 1650.00),
      ('Bench', 'Upholstered bench for end of bed', 'WF-BENCH-COASTAL-001', 'Wayfair', 400.00, 450.00, 500.00),
      ('Wall Art (Set of 4)', 'Coastal wall art for bedrooms', 'WF-ART-COASTAL-001', 'Wayfair', 200.00, 225.00, 250.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '38 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '38 days', 'Wayfair', 'Purchase',
    v_tx_total::text, 'Bedroom furniture sets from Wayfair', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 5: Crate & Barrel living room additions - $6,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Accent Chairs (Pair)', 'Coastal style accent chairs in light blue', 'CB-CHAIR-ACCENT-001', 'Crate & Barrel', 1350.00, 1500.00, 1650.00),
      ('Media Console', 'White media console with storage, 72 inches', 'CB-CONSOLE-MEDIA-001', 'Crate & Barrel', 1100.00, 1220.00, 1340.00),
      ('Bookshelf', '5-shelf bookcase, white finish', 'CB-SHELF-BOOK-001', 'Crate & Barrel', 580.00, 640.00, 700.00),
      ('Sideboard', 'Coastal sideboard with drawers, 60 inches', 'CB-SIDEBOARD-001', 'Crate & Barrel', 950.00, 1050.00, 1150.00),
      ('Coffee Table', 'Coastal coffee table', 'CB-TABLE-COFFEE-001', 'Crate & Barrel', 620.00, 690.00, 760.00),
      ('End Tables (Pair)', 'Coastal end tables', 'CB-TABLE-END-001', 'Crate & Barrel', 540.00, 600.00, 660.00),
      ('Floor Lamp', 'Coastal floor lamp', 'CB-LAMP-FLOOR-001', 'Crate & Barrel', 360.00, 400.00, 440.00),
      ('Wall Art (Set of 3)', 'Coastal wall art', 'CB-ART-COASTAL-001', 'Crate & Barrel', 300.00, 340.00, 380.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '35 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '35 days', 'Crate & Barrel', 'Purchase',
    v_tx_total::text, 'Living room additions from Crate & Barrel', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 6: Amazon home accessories - $3,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Throw Pillows (Set of 6)', 'Coastal themed throw pillows in various sizes', 'AM-PILLOW-COASTAL-001', 'Amazon', 110.00, 125.00, 140.00),
      ('Throw Blankets (Set of 3)', 'Cozy throw blankets in navy, white, and blue', 'AM-BLANKET-COASTAL-001', 'Amazon', 135.00, 150.00, 165.00),
      ('Wall Art (Set of 4)', 'Coastal prints, beach scenes, various sizes', 'AM-ART-COASTAL-001', 'Amazon', 200.00, 225.00, 250.00),
      ('Decorative Baskets (Set of 5)', 'Woven storage baskets for organization', 'AM-BASKET-STORAGE-001', 'Amazon', 95.00, 105.00, 115.00),
      ('Kitchen Towels (Set of 8)', 'Coastal themed kitchen towels', 'AM-KITCHEN-TOWELS-001', 'Amazon', 62.00, 70.00, 78.00),
      ('Table Lamps (Pair)', 'Coastal table lamps', 'AM-LAMP-TABLE-001', 'Amazon', 200.00, 225.00, 250.00),
      ('Candle Holders (Set of 4)', 'Coastal candle holders', 'AM-CANDLE-HOLDER-001', 'Amazon', 85.00, 95.00, 105.00),
      ('Vases (Set of 3)', 'Ceramic vases', 'AM-VASE-SET-001', 'Amazon', 110.00, 125.00, 140.00),
      ('Wall Clock', 'Coastal wall clock', 'AM-CLOCK-WALL-001', 'Amazon', 45.00, 50.00, 55.00),
      ('Decorative Trays (Set of 2)', 'Coastal serving trays', 'AM-TRAY-DECORATIVE-001', 'Amazon', 75.00, 85.00, 95.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '32 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '32 days', 'Amazon', 'Purchase',
    v_tx_total::text, 'Home accessories from Amazon', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 7: West Elm outdoor furniture - $4,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Outdoor Dining Set', 'Coastal outdoor dining table with 6 chairs', 'WE-OUTDOOR-DINING-001', 'West Elm', 1350.00, 1500.00, 1650.00),
      ('Outdoor Sofa', 'Weather-resistant outdoor sofa in blue', 'WE-OUTDOOR-SOFA-001', 'West Elm', 950.00, 1050.00, 1150.00),
      ('Outdoor Coffee Table', 'Rattan outdoor coffee table', 'WE-OUTDOOR-TABLE-001', 'West Elm', 360.00, 400.00, 440.00),
      ('Outdoor Side Tables (Pair)', 'Coastal outdoor side tables', 'WE-OUTDOOR-TABLE-SIDE-001', 'West Elm', 540.00, 600.00, 660.00),
      ('Outdoor Lounge Chairs (Pair)', 'Coastal lounge chairs', 'WE-OUTDOOR-CHAIR-LOUNGE-001', 'West Elm', 800.00, 880.00, 960.00),
      ('Outdoor Umbrella', 'Large outdoor umbrella', 'WE-UMBRELLA-OUTDOOR-001', 'West Elm', 400.00, 450.00, 500.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '28 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '28 days', 'West Elm', 'Purchase',
    v_tx_total::text, 'Outdoor furniture from West Elm', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 8: Arhaus accent pieces - $3,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Accent Table', 'Coastal style accent table with storage', 'AH-TABLE-ACCENT-001', 'Arhaus', 540.00, 600.00, 660.00),
      ('Floor Lamp', 'Rattan floor lamp with linen shade', 'AH-LAMP-FLOOR-001', 'Arhaus', 360.00, 400.00, 440.00),
      ('Wall Art', 'Large coastal wall art, 36x48 inches', 'AH-ART-COASTAL-001', 'Arhaus', 480.00, 540.00, 600.00),
      ('Console Table', 'Coastal console table', 'AH-CONSOLE-001', 'Arhaus', 950.00, 1050.00, 1150.00),
      ('Side Table', 'Coastal side table', 'AH-TABLE-SIDE-001', 'Arhaus', 480.00, 540.00, 600.00),
      ('Throw Pillows (Set of 4)', 'Luxury throw pillows', 'AH-PILLOW-001', 'Arhaus', 225.00, 250.00, 275.00),
      ('Vases (Set of 3)', 'Ceramic vases', 'AH-VASE-SET-001', 'Arhaus', 125.00, 140.00, 155.00),
      ('Candle Holders (Set of 4)', 'Coastal candle holders', 'AH-CANDLE-HOLDER-001', 'Arhaus', 110.00, 125.00, 140.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '25 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '25 days', 'Arhaus', 'Purchase',
    v_tx_total::text, 'Accent pieces from Arhaus', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 9: Target home essentials - $2,550 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Bath Towels (Set of 8)', 'Premium bath towels in coastal colors', 'TG-TOWEL-BATH-001', 'Target', 110.00, 125.00, 140.00),
      ('Shower Curtains (2)', 'Coastal themed shower curtains', 'TG-CURTAIN-SHOWER-001', 'Target', 75.00, 85.00, 95.00),
      ('Bath Mats (Set of 3)', 'Memory foam bath mats', 'TG-MAT-BATH-001', 'Target', 65.00, 75.00, 85.00),
      ('Kitchen Utensils Set', 'Stainless steel kitchen utensil set', 'TG-UTENSIL-KITCHEN-001', 'Target', 85.00, 95.00, 105.00),
      ('Kitchen Towels (Set of 8)', 'Coastal kitchen towels', 'TG-TOWEL-KITCHEN-001', 'Target', 55.00, 62.00, 70.00),
      ('Throw Blankets (Set of 2)', 'Coastal throw blankets', 'TG-BLANKET-THROW-001', 'Target', 80.00, 88.00, 96.00),
      ('Storage Baskets (Set of 3)', 'Woven storage baskets', 'TG-BASKET-STORAGE-001', 'Target', 68.00, 76.00, 84.00),
      ('Wall Clock', 'Coastal wall clock', 'TG-CLOCK-WALL-001', 'Target', 50.00, 55.00, 60.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '22 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '22 days', 'Target', 'Purchase',
    v_tx_total::text, 'Home essentials from Target', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 10: Additional furnishings from various vendors - $6,000 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_furnishings UUID := 'ea004cdf-9766-4a0b-974e-499c6dad9c14';
  v_tx_id TEXT;
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
  v_tx_total NUMERIC;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_item_ids TEXT[];
  v_timestamp BIGINT;
  item_data RECORD;
BEGIN
  v_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  v_tx_id := gen_random_uuid()::text;
  v_item_ids := ARRAY[]::text[];
  v_tx_subtotal := 0;

  FOR item_data IN
    SELECT *
    FROM (VALUES
      ('Dining Room Chandelier', 'Coastal chandelier for dining room', 'PB-CHANDELIER-001', 'Pottery Barn', 850.00, 950.00, 1050.00),
      ('Living Room Rug', 'Large coastal area rug, 10x14 feet', 'RU-RUG-LIVING-001', 'Rugs USA', 1200.00, 1350.00, 1500.00),
      ('Entryway Console', 'Coastal entryway console table', 'CB-CONSOLE-ENTRY-001', 'Crate & Barrel', 950.00, 1050.00, 1150.00),
      ('Wall Sconces (Set of 4)', 'Coastal wall sconces for living room', 'WE-SCONCE-WALL-001', 'West Elm', 540.00, 600.00, 660.00),
      ('Floor Lamps (Pair)', 'Coastal floor lamps', 'AH-LAMP-FLOOR-PAIR-001', 'Arhaus', 720.00, 800.00, 880.00),
      ('Accent Tables (Set of 3)', 'Coastal accent tables', 'WM-TABLE-ACCENT-001', 'World Market', 540.00, 600.00, 660.00),
      ('Wall Art Collection', 'Large coastal wall art collection', 'AM-ART-LARGE-001', 'Amazon', 400.00, 450.00, 500.00),
      ('Throw Pillows (Set of 8)', 'Coastal throw pillows', 'TG-PILLOW-COASTAL-001', 'Target', 300.00, 340.00, 380.00)
    ) AS items(name, description, sku, source, raw_purchase, raw_project, raw_market)
  LOOP
    v_item_id := 'I-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_qr_key := 'QR-' || v_timestamp || '-' || substr(md5(random()::text), 1, 4);
    v_raw_purchase := item_data.raw_purchase;
    v_raw_project := item_data.raw_project;
    v_raw_market := item_data.raw_market;
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
      v_account_id, v_project_id, v_tx_id, v_item_id, item_data.name,
      item_data.description,
      item_data.sku, item_data.source,
      v_purchase::text, v_project_price::text, v_market::text,
      v_tax_rate_pct, v_tax_purchase::text, v_tax_project::text,
      'Client Card', 'purchased', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '18 days',
      v_created_by, NOW(), NOW()
    );
    v_item_ids := v_item_ids || v_item_id;
    v_tx_subtotal := v_tx_subtotal + v_project_price;
  END LOOP;

  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '18 days', 'Various', 'Purchase',
    v_tx_total::text, 'Additional furnishings from multiple vendors', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 11: Kitchen category - appliances and fixtures - $3,800 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_kitchen UUID := '1ed62640-70f5-403d-84a0-3a35d8dff1d0';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 3800.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '30 days', 'Home Depot', 'Purchase',
    v_tx_total::text, 'Kitchen fixtures and small appliances', v_cat_kitchen, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 12: Storage & Receiving - $850 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_storage UUID := '4f23aa16-982e-49f7-8b1c-ec26b0a89716';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 850.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '28 days', 'Storage Facility', 'Purchase',
    v_tx_total::text, 'Storage and receiving services', v_cat_storage, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 13: Installation services - $4,000 subtotal (under $5,000 budget)
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_install UUID := '57981f56-2cb1-46f9-b574-0f882eb45d0b';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 4000.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '25 days', 'Local Installer', 'Purchase',
    v_tx_total::text, 'Furniture installation and assembly services', v_cat_install, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 14: Fuel expenses (with reimbursement - company owes client) - $1,650 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_fuel UUID := '38bd39be-930c-4e2c-8a6a-be0cbef03e29';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 1650.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method, reimbursement_type,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '22 days', 'Gas', 'Purchase',
    v_tx_total::text, 'Fuel expenses for project site visits and deliveries', v_cat_fuel, 'completed', 'Design Business Card', 'Design Business Owes Client',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 15: Property Management - $5,800 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_prop_mgmt UUID := '69b403a4-3dfd-4900-8a1e-a0a30623c73e';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 5800.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '20 days', 'Property Management Co', 'Purchase',
    v_tx_total::text, 'Property management services for project coordination', v_cat_prop_mgmt, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Update project stats
DO $$
DECLARE
  v_project_id UUID := '60734ca8-8f0d-4f96-8cab-f507fa0829e5';
BEGIN
  UPDATE projects SET
    item_count = (SELECT COUNT(*) FROM items WHERE project_id = v_project_id),
    transaction_count = (SELECT COUNT(*) FROM transactions WHERE project_id = v_project_id),
    total_value = (SELECT COALESCE(SUM(project_price::numeric), 0) FROM items WHERE project_id = v_project_id)
  WHERE id = v_project_id;
END $$;
