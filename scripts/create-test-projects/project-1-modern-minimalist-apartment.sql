DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
BEGIN
  INSERT INTO projects (
    account_id, id, name, description, client_name, budget, design_fee,
    budget_categories, main_image_url, created_by, created_at, updated_at
  ) VALUES (
    v_account_id,
    v_project_id,
    'Modern Minimalist Apartment',
    'Complete redesign of a 1200 sq ft downtown apartment featuring clean lines, neutral tones, and functional furniture',
    'Sarah Chen',
    110000.00,
    27500.00,
    '{"designFee": 27500, "furnishings": 68000, "install": 5000, "kitchen": 0, "fuel": 2000, "storageReceiving": 5000, "propertyManagement": 0}'::jsonb,
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop',
    v_created_by,
    NOW(),
    NOW()
  ) ON CONFLICT (id) DO UPDATE SET
    budget_categories = '{"designFee": 27500, "furnishings": 68000, "install": 5000, "kitchen": 0, "fuel": 2000, "storageReceiving": 5000, "propertyManagement": 0}'::jsonb,
    updated_at = NOW();
END $$;

-- Delete existing transactions and items for this project
DELETE FROM items WHERE project_id = '2115f472-03a1-4872-aa20-881a24d36389';
DELETE FROM transactions WHERE project_id = '2115f472-03a1-4872-aa20-881a24d36389';

-- Transaction 1: Large furnishings purchase from Crate & Barrel - $12,000 subtotal (with reimbursement)
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Modern Sectional Sofa', 'Low-profile sectional sofa in charcoal gray, 3-seater with chaise', 'CB-SOFA-SECTIONAL-001', 'Crate & Barrel', 3200.00, 3600.00, 4000.00),
      ('Glass Coffee Table', 'Rectangular glass and metal coffee table, 48x24 inches', 'CB-TABLE-GLASS-001', 'Crate & Barrel', 520.00, 580.00, 640.00),
      ('Scandinavian Dining Table', 'White oak dining table, seats 6, minimalist design', 'CB-TABLE-DINING-001', 'Crate & Barrel', 1350.00, 1500.00, 1650.00),
      ('Dining Chairs (Set of 4)', 'Modern dining chairs, upholstered in beige fabric', 'CB-CHAIR-DINE-001', 'Crate & Barrel', 540.00, 600.00, 660.00),
      ('Area Rug', 'Neutral beige wool blend area rug, 8x10 feet', 'CB-RUG-8X10-001', 'Crate & Barrel', 720.00, 800.00, 880.00),
      ('Media Console', 'Sleek media console with drawers, 72 inches wide', 'CB-CONSOLE-MEDIA-001', 'Crate & Barrel', 950.00, 1050.00, 1150.00),
      ('Bookshelf', '5-shelf bookcase, white oak finish', 'CB-SHELF-BOOK-001', 'Crate & Barrel', 580.00, 640.00, 700.00),
      ('Accent Chair', 'Modern accent chair in charcoal gray', 'CB-CHAIR-ACCENT-001', 'Crate & Barrel', 750.00, 820.00, 900.00),
      ('Side Table', 'Round side table with marble top', 'CB-TABLE-SIDE-001', 'Crate & Barrel', 480.00, 540.00, 600.00),
      ('Floor Lamp', 'Black metal arc floor lamp', 'CB-LAMP-FLOOR-001', 'Crate & Barrel', 360.00, 400.00, 440.00)
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
      'Design Business Card', 'to purchase', v_qr_key, 'allocated', CURRENT_DATE - INTERVAL '45 days',
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '45 days', 'Crate & Barrel', 'Purchase',
    v_tx_total::text, 'Major furnishings purchase from Crate & Barrel', v_cat_furnishings, 'completed', 'Design Business Card', 'Client Owes Design Business',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 2: West Elm accessories and decor - $3,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Arc Floor Lamp', 'Black metal arc floor lamp, adjustable height', 'WE-LAMP-ARC-001', 'West Elm', 320.00, 360.00, 400.00),
      ('Throw Pillows (Set of 3)', 'Decorative throw pillows, geometric patterns in gray and white', 'WE-PILLOW-GEO-001', 'West Elm', 135.00, 150.00, 165.00),
      ('Wall Art (Set of 3)', 'Abstract canvas prints, black and white, 24x36 inches each', 'WE-ART-ABSTRACT-001', 'West Elm', 360.00, 400.00, 440.00),
      ('Table Lamp', 'Ceramic table lamp with white linen shade', 'WE-LAMP-TABLE-001', 'West Elm', 170.00, 190.00, 210.00),
      ('Decorative Vases (Set of 2)', 'Ceramic vases in neutral tones', 'WE-VASE-SET-001', 'West Elm', 100.00, 110.00, 120.00),
      ('Throw Blankets (Set of 2)', 'Cozy throw blankets in gray and beige', 'WE-BLANKET-THROW-001', 'West Elm', 180.00, 200.00, 220.00),
      ('Wall Mirror', 'Round wall mirror, 36 inches', 'WE-MIRROR-ROUND-001', 'West Elm', 320.00, 360.00, 400.00),
      ('Storage Baskets (Set of 3)', 'Woven storage baskets', 'WE-BASKET-STORAGE-001', 'West Elm', 120.00, 135.00, 150.00),
      ('Coffee Table Books (Set of 5)', 'Curated coffee table books', 'WE-BOOKS-COFFEE-001', 'West Elm', 200.00, 225.00, 250.00),
      ('Candle Holders (Set of 3)', 'Brass candle holders', 'WE-CANDLE-HOLDER-001', 'West Elm', 150.00, 170.00, 190.00)
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '42 days', 'West Elm', 'Purchase',
    v_tx_total::text, 'Accessories and decor from West Elm', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 3: Wayfair bedroom furniture - $5,000 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Platform Bed Frame', 'Minimalist platform bed frame, queen size, white oak', 'WF-BED-PLATFORM-001', 'Wayfair', 750.00, 850.00, 950.00),
      ('Nightstands (Pair)', 'Modern nightstands with drawers, white oak finish', 'WF-NIGHTSTAND-001', 'Wayfair', 480.00, 540.00, 600.00),
      ('Dresser', '6-drawer dresser, white oak, minimalist design', 'WF-DRESSER-001', 'Wayfair', 950.00, 1050.00, 1150.00),
      ('Bedding Set', 'Luxury linen bedding set in neutral gray', 'WF-BEDDING-LINEN-001', 'Wayfair', 320.00, 360.00, 400.00),
      ('Bedside Lamps (Pair)', 'Modern bedside lamps', 'WF-LAMP-BEDSIDE-001', 'Wayfair', 240.00, 270.00, 300.00),
      ('Wardrobe', 'Minimalist wardrobe, white oak', 'WF-WARDROBE-001', 'Wayfair', 1200.00, 1350.00, 1500.00),
      ('Bench', 'Upholstered bench for end of bed', 'WF-BENCH-001', 'Wayfair', 360.00, 400.00, 440.00)
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
    v_tx_total::text, 'Bedroom furniture from Wayfair', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 4: Arhaus accent furniture - $4,500 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Accent Chair', 'Modern accent chair in charcoal gray fabric', 'AH-CHAIR-ACCENT-001', 'Arhaus', 750.00, 820.00, 900.00),
      ('Side Table', 'Round side table with marble top, 24 inches', 'AH-TABLE-SIDE-001', 'Arhaus', 480.00, 540.00, 600.00),
      ('Floor Mirror', 'Full-length floor mirror, minimalist frame', 'AH-MIRROR-FLOOR-001', 'Arhaus', 400.00, 450.00, 500.00),
      ('Console Table', 'Sleek console table with drawers', 'AH-CONSOLE-001', 'Arhaus', 950.00, 1050.00, 1150.00),
      ('Accent Table', 'Modern accent table', 'AH-TABLE-ACCENT-001', 'Arhaus', 540.00, 600.00, 660.00),
      ('Wall Art', 'Large abstract wall art', 'AH-ART-001', 'Arhaus', 480.00, 540.00, 600.00),
      ('Floor Lamp', 'Modern floor lamp', 'AH-LAMP-FLOOR-001', 'Arhaus', 360.00, 400.00, 440.00),
      ('Throw Pillows (Set of 4)', 'Luxury throw pillows', 'AH-PILLOW-001', 'Arhaus', 200.00, 225.00, 250.00)
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '32 days', 'Arhaus', 'Purchase',
    v_tx_total::text, 'Accent furniture from Arhaus', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 5: Living Spaces office furniture - $3,200 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Desk', 'Modern writing desk, white oak, 60 inches wide', 'LS-DESK-WRITING-001', 'Living Spaces', 580.00, 640.00, 700.00),
      ('Desk Chair', 'Ergonomic desk chair in charcoal gray', 'LS-CHAIR-DESK-001', 'Living Spaces', 320.00, 360.00, 400.00),
      ('Bookshelf', '5-shelf bookcase, white oak finish', 'LS-SHELF-BOOK-001', 'Living Spaces', 420.00, 460.00, 500.00),
      ('Desk Lamp', 'Modern desk lamp', 'LS-LAMP-DESK-001', 'Living Spaces', 120.00, 135.00, 150.00),
      ('File Cabinet', '2-drawer file cabinet', 'LS-CABINET-FILE-001', 'Living Spaces', 280.00, 320.00, 360.00),
      ('Wall Shelves (Set of 3)', 'Floating wall shelves', 'LS-SHELF-WALL-001', 'Living Spaces', 180.00, 200.00, 220.00),
      ('Desk Organizer', 'Desk organizer set', 'LS-ORGANIZER-001', 'Living Spaces', 85.00, 95.00, 105.00),
      ('Office Chair Mat', 'Clear chair mat', 'LS-MAT-CHAIR-001', 'Living Spaces', 75.00, 85.00, 95.00)
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '28 days', 'Living Spaces', 'Purchase',
    v_tx_total::text, 'Office furniture from Living Spaces', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 6: Target home essentials - $2,800 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Bath Towels (Set of 4)', 'Premium bath towels in neutral gray', 'TG-TOWEL-BATH-001', 'Target', 55.00, 62.00, 70.00),
      ('Shower Curtain', 'Minimalist white shower curtain with chrome hooks', 'TG-CURTAIN-SHOWER-001', 'Target', 38.00, 44.00, 50.00),
      ('Bath Mat', 'Memory foam bath mat in gray', 'TG-MAT-BATH-001', 'Target', 32.00, 36.00, 40.00),
      ('Kitchen Utensils Set', 'Stainless steel kitchen utensil set', 'TG-UTENSIL-KITCHEN-001', 'Target', 52.00, 60.00, 68.00),
      ('Bathroom Accessories Set', 'Complete bathroom accessory set', 'TG-ACCESSORY-BATH-001', 'Target', 85.00, 95.00, 105.00),
      ('Kitchen Towels (Set of 6)', 'Premium kitchen towels', 'TG-TOWEL-KITCHEN-001', 'Target', 50.00, 55.00, 60.00),
      ('Throw Blankets (Set of 2)', 'Cozy throw blankets', 'TG-BLANKET-THROW-001', 'Target', 72.00, 80.00, 88.00),
      ('Storage Baskets (Set of 3)', 'Woven storage baskets', 'TG-BASKET-STORAGE-001', 'Target', 60.00, 68.00, 76.00),
      ('Wall Clock', 'Minimalist wall clock', 'TG-CLOCK-WALL-001', 'Target', 40.00, 45.00, 50.00),
      ('Kitchen Canisters (Set of 3)', 'Glass kitchen canisters', 'TG-CANISTER-KITCHEN-001', 'Target', 65.00, 72.00, 80.00)
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '25 days', 'Target', 'Purchase',
    v_tx_total::text, 'Home essentials from Target', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 7: Amazon home accessories - $3,000 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
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
      ('Kitchen Towels (Set of 6)', 'Premium cotton kitchen towels in neutral colors', 'AM-KITCHEN-TOWELS-001', 'Amazon', 50.00, 55.00, 60.00),
      ('Throw Blankets (Set of 2)', 'Cozy throw blankets in gray and beige', 'AM-BLANKET-THROW-001', 'Amazon', 72.00, 80.00, 88.00),
      ('Storage Baskets (Set of 3)', 'Woven storage baskets for organization', 'AM-BASKET-STORAGE-001', 'Amazon', 60.00, 68.00, 76.00),
      ('Wall Clock', 'Minimalist wall clock, 12 inch, black', 'AM-CLOCK-WALL-001', 'Amazon', 40.00, 45.00, 50.00),
      ('Throw Pillows (Set of 4)', 'Decorative throw pillows', 'AM-PILLOW-THROW-001', 'Amazon', 110.00, 125.00, 140.00),
      ('Wall Art (Set of 3)', 'Abstract canvas prints', 'AM-ART-ABSTRACT-001', 'Amazon', 200.00, 225.00, 250.00),
      ('Table Lamps (Pair)', 'Modern table lamps', 'AM-LAMP-TABLE-001', 'Amazon', 180.00, 200.00, 220.00),
      ('Candle Holders (Set of 4)', 'Brass candle holders', 'AM-CANDLE-HOLDER-001', 'Amazon', 85.00, 95.00, 105.00),
      ('Vases (Set of 3)', 'Ceramic vases', 'AM-VASE-SET-001', 'Amazon', 100.00, 110.00, 120.00),
      ('Decorative Trays (Set of 2)', 'Decorative serving trays', 'AM-TRAY-DECORATIVE-001', 'Amazon', 75.00, 85.00, 95.00)
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
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '22 days', 'Amazon', 'Purchase',
    v_tx_total::text, 'Home accessories from Amazon', v_cat_furnishings, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, v_item_ids,
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 8: Storage & Receiving - $2,800 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_storage UUID := '4f23aa16-982e-49f7-8b1c-ec26b0a89716';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 2800.00;
  v_tx_tax := ROUND(v_tx_subtotal * v_tax_rate_pct / 100.0, 2);
  v_tx_total := v_tx_subtotal + v_tx_tax;
  INSERT INTO transactions (
    account_id, project_id, transaction_id, transaction_date, source, transaction_type,
    amount, description, category_id, status, payment_method,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '30 days', 'Storage Facility', 'Purchase',
    v_tx_total::text, 'Storage and receiving services for furniture', v_cat_storage, 'completed', 'Client Card',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Transaction 9: Installation services - $3,200 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_install UUID := '57981f56-2cb1-46f9-b574-0f882eb45d0b';
  v_tx_id TEXT;
  v_tx_subtotal NUMERIC;
  v_tx_tax NUMERIC;
  v_tx_total NUMERIC;
BEGIN
  v_tx_id := gen_random_uuid()::text;
  v_tx_subtotal := 3200.00;
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

-- Transaction 10: Fuel expenses (with reimbursement - company owes client) - $850 subtotal
DO $$
DECLARE
  v_account_id UUID := '2d612868-852e-4a80-9d02-9d10383898d4';
  v_created_by UUID := '4ef35958-597c-4aea-b99e-1ef62352a72d';
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
  v_tax_rate_pct NUMERIC := 10.0;
  v_cat_fuel UUID := '38bd39be-930c-4e2c-8a6a-be0cbef03e29';
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
    amount, description, category_id, status, payment_method, reimbursement_type,
    tax_rate_pct, subtotal, item_ids, created_by, created_at, updated_at
  ) VALUES (
    v_account_id, v_project_id, v_tx_id, CURRENT_DATE - INTERVAL '20 days', 'Gas', 'Purchase',
    v_tx_total::text, 'Fuel expenses for project site visits and deliveries', v_cat_fuel, 'completed', 'Design Business Card', 'Design Business Owes Client',
    v_tax_rate_pct, v_tx_subtotal::text, ARRAY[]::text[],
    v_created_by, NOW(), NOW()
  );
END $$;

-- Update project stats
DO $$
DECLARE
  v_project_id UUID := '2115f472-03a1-4872-aa20-881a24d36389';
BEGIN
  UPDATE projects SET
    item_count = (SELECT COUNT(*) FROM items WHERE project_id = v_project_id),
    transaction_count = (SELECT COUNT(*) FROM transactions WHERE project_id = v_project_id),
    total_value = (SELECT COALESCE(SUM(project_price::numeric), 0) FROM items WHERE project_id = v_project_id)
  WHERE id = v_project_id;
END $$;
