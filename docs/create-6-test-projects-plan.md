# Plan: Create 6 Test Projects in Account 2d612868-852e-4a80-9d02-9d10383898d4

## Overview
Create 6 diverse interior design projects with realistic data including:
- Project metadata (name, description, client name, budget, design fee)
- Project budget categories (JSONB) - **PARTIALLY ALLOCATED, NOT FULLY FILLED**
- Project main images
- Multiple transactions per project (each with category_id)
- Items tied to transactions (via transaction_id)
- Transaction totals should partially fill budget categories, NOT completely fill them

**Budget Reference**: Based on review of existing projects in the account, budgets range from $132K-$160K with design fees averaging 24-25% of budget. This plan includes projects in the $105K-$160K range (within +/- 20% of real projects) to match realistic scale.

**Key Points**:
- Budget categories are set in `projects.budget_categories` JSONB
- Transactions drive spending and fill budget categories
- Items are created WITH transactions (transaction_id links them)
- Budget categories should show PARTIAL progress (e.g., 30-60% spent), not 100%

## Account Details
- **Account ID**: `2d612868-852e-4a80-9d02-9d10383898d4`
- **Created By User ID**: `4ef35958-597c-4aea-b99e-1ef62352a72d` (from existing test data)

## SQL Seed Scripts
All seed scripts now live in `scripts/create-test-projects/`, and each file inserts exactly one project (plus its transactions and items). Run whichever project(s) you need via the Supabase MCP `execute_sql` tool.

- `project-1-modern-minimalist-apartment.sql` – downtown apartment refresh with clean furnishings
- `project-2-coastal-family-home.sql` – coastal family home with layered textiles and mixed vendors
- `project-3-industrial-loft-conversion.sql` – industrial loft with reclaimed woods and metals
- `project-4-traditional-elegance-estate.sql` – traditional estate with formal entertaining spaces
- `project-5-scandinavian-studio.sql` – compact Scandinavian studio with light woods
- `project-6-bohemian-eclectic-loft.sql` – colorful bohemian loft with global influences

**Note**: Item `images` arrays are intentionally left empty in every script to avoid storing brittle third-party URLs while still allowing the app to upload media later.

## Database Schema Reference

### Projects Table Fields
- `id` (UUID, auto-generated)
- `account_id` (UUID, required)
- `name` (TEXT, required)
- `description` (TEXT, optional)
- `client_name` (TEXT, optional)
- `budget` (DECIMAL(10, 2), optional)
- `design_fee` (DECIMAL(10, 2), optional)
- `main_image_url` (TEXT, optional)
- `budget_categories` (JSONB, default '{}')
- `settings` (JSONB, default '{}')
- `metadata` (JSONB, default '{}')
- `created_by` (UUID, references users)
- `created_at` (TIMESTAMPTZ, default NOW())
- `updated_at` (TIMESTAMPTZ, default NOW())

### Items Table Fields
- `id` (UUID, auto-generated)
- `account_id` (UUID, required)
- `project_id` (UUID, references projects)
- `item_id` (TEXT, required, format: 'I-{timestamp}-{random}')
- `name` (TEXT, optional)
- `description` (TEXT, optional)
- `sku` (TEXT, optional)
- `source` (TEXT, optional)
- `purchase_price` (TEXT, optional)
- `project_price` (TEXT, optional)
- `market_value` (TEXT, optional)
- `payment_method` (TEXT, default 'Client Card')
- `disposition` (TEXT, default 'purchased')
- `notes` (TEXT, optional)
- `qr_key` (TEXT, required, format: 'QR-{timestamp}-{random}')
- `tax_rate_pct` (DECIMAL(6,4), optional)
- `tax_amount_purchase_price` (TEXT, optional)
- `tax_amount_project_price` (TEXT, optional)
- `inventory_status` (TEXT, CHECK: 'available', 'allocated', 'sold')
- `date_created` (DATE, optional)
- `images` (JSONB, default '[]')
- `bookmark` (BOOLEAN, default false)
- `created_by` (UUID, references users)
- `created_at` (TIMESTAMPTZ, default NOW())
- `last_updated` (TIMESTAMPTZ, default NOW())

### Item Images JSONB Structure
```json
[
  {
    "url": "https://...",
    "alt": "Description",
    "isPrimary": true,
    "uploadedAt": "2025-12-17T...",
    "fileName": "image.jpg",
    "size": 123456,
    "mimeType": "image/jpeg"
  }
]
```

---

## Project 1: Modern Minimalist Apartment

### Project Details
- **Name**: Modern Minimalist Apartment
- **Description**: Complete redesign of a 1200 sq ft downtown apartment featuring clean lines, neutral tones, and functional furniture
- **Client Name**: Sarah Chen
- **Budget**: $110,000.00
- **Design Fee**: $27,500.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 27500,
    "furnishings": 68000,
    "install": 5000,
    "kitchen": 0,
    "fuel": 2000,
    "storageReceiving": 5000,
    "propertyManagement": 0
  }
  ```
  - Categories sum to: $110,000 (matches total budget)
  - Design Fee: $27,500 = 25% of budget
  - Furnishings: $68,000 = 62% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop` (Modern minimalist living room)

### Transactions (3 transactions, ~$40,000 total spent - ~36% of budget)

**Transaction 1: Furnishings Purchase**
- Date: 2025-11-15
- Source: Homegoods
- Type: Purchase
- Category ID: `ea004cdf-9766-4a0b-974e-499c6dad9c14` (Furnishings)
- Amount: ~$8,500 (with tax)
- Items: 5 items (sofa, coffee table, dining table, 4 chairs, area rug)

**Transaction 2: Furnishings Purchase**
- Date: 2025-11-22
- Source: West Elm
- Type: Purchase
- Category ID: `ea004cdf-9766-4a0b-974e-499c6dad9c14` (Furnishings)
- Amount: ~$6,200 (with tax)
- Items: 3 items (floor lamp, throw pillows, wall art)

**Transaction 3: Install**
- Date: 2025-11-25
- Source: Local Installer
- Type: Purchase
- Category ID: `57981f56-2cb1-46f9-b574-0f882eb45d0b` (Install)
- Amount: ~$3,300 (with tax)
- Items: 0 items (service transaction)

### Items (8 items total, tied to transactions)

**Transaction 1 Items (5 items):**
1. **Sleek Sofa** - Transaction 1
   - Description: Low-profile sectional sofa in charcoal gray, 3-seater
   - SKU: HG-SOFA-MODERN-001
   - Purchase Price: $1,200.00
   - Project Price: $1,350.00
   - Market Value: $1,500.00

2. **Coffee Table** - Transaction 1
   - Description: Glass and metal coffee table, rectangular, 48x24 inches
   - SKU: HG-TABLE-GLASS-001
   - Purchase Price: $280.00
   - Project Price: $320.00
   - Market Value: $350.00

3. **Dining Table** - Transaction 1
   - Description: Scandinavian-style dining table, white oak, seats 6
   - SKU: HG-TABLE-DINING-001
   - Purchase Price: $850.00
   - Project Price: $950.00
   - Market Value: $1,100.00

4. **Dining Chairs (Set of 4)** - Transaction 1
   - Description: Modern dining chairs, upholstered in beige fabric
   - SKU: HG-CHAIR-DINE-001
   - Purchase Price: $320.00 (4x $80)
   - Project Price: $352.00 (4x $88)
   - Market Value: $380.00 (4x $95)

5. **Area Rug** - Transaction 1
   - Description: Neutral beige wool blend area rug, 8x10 feet
   - SKU: HG-RUG-8X10-001
   - Purchase Price: $450.00
   - Project Price: $500.00
   - Market Value: $550.00

**Transaction 2 Items (3 items):**
6. **Floor Lamp** - Transaction 2
   - Description: Arc floor lamp, black metal, adjustable
   - SKU: HG-LAMP-ARC-001
   - Purchase Price: $120.00
   - Project Price: $135.00
   - Market Value: $150.00

7. **Throw Pillows (Set of 3)** - Transaction 2
   - Description: Decorative throw pillows, geometric patterns
   - SKU: HG-PILLOW-GEO-001
   - Purchase Price: $75.00 (3x $25)
   - Project Price: $78.00 (3x $26)
   - Market Value: $84.00 (3x $28)

8. **Wall Art (Set of 3)** - Transaction 2
   - Description: Abstract canvas prints, black and white, 24x36 inches each
   - SKU: HG-ART-ABSTRACT-001
   - Purchase Price: $180.00
   - Project Price: $200.00
   - Market Value: $220.00

---

## Project 2: Coastal Family Home

### Project Details
- **Name**: Coastal Family Home
- **Description**: Bright and airy coastal design for a family of four, featuring beach-inspired colors and comfortable, durable furnishings
- **Client Name**: Michael & Jennifer Thompson
- **Budget**: $125,000.00
- **Design Fee**: $31,250.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 31250,
    "furnishings": 77000,
    "install": 5000,
    "kitchen": 5000,
    "fuel": 2000,
    "storageReceiving": 1000,
    "propertyManagement": 7500
  }
  ```
  - Categories sum to: $125,000 (matches total budget)
  - Design Fee: $31,250 = 25% of budget
  - Furnishings: $77,000 = 62% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop` (Coastal living room)

### Items (10 items)

1. **Sectional Sofa**
   - Description: Large sectional sofa in light blue fabric, seats 5
   - SKU: HG-SOFA-COASTAL-001
   - Source: Pottery Barn
   - Purchase Price: $2,200.00
   - Project Price: $2,500.00
   - Market Value: $2,800.00

2. **Rattan Coffee Table**
   - Description: Woven rattan coffee table with glass top, round
   - SKU: HG-TABLE-RATTAN-001
   - Source: World Market
   - Purchase Price: $350.00
   - Project Price: $400.00
   - Market Value: $450.00

3. **Dining Set**
   - Description: Farmhouse dining table with 6 matching chairs, white washed
   - SKU: HG-SET-DINING-001
   - Source: Pottery Barn
   - Purchase Price: $1,800.00
   - Project Price: $2,100.00
   - Market Value: $2,400.00

4. **Jute Area Rug**
   - Description: Natural jute area rug, 9x12 feet
   - SKU: HG-RUG-JUTE-001
   - Source: Rugs USA
   - Purchase Price: $380.00
   - Project Price: $420.00
   - Market Value: $480.00

5. **Accent Chairs (Pair)**
   - Description: Wicker accent chairs with blue cushions
   - SKU: HG-CHAIR-WICKER-001
   - Source: Homegoods
   - Purchase Price: $560.00 (2x $280)
   - Project Price: $600.00 (2x $300)
   - Market Value: $640.00 (2x $320)

6. **Console Table**
   - Description: White console table with drawers, 60 inches
   - SKU: HG-TABLE-CONSOLE-001
   - Source: Homegoods
   - Purchase Price: $320.00
   - Project Price: $360.00
   - Market Value: $400.00

7. **Table Lamps (Pair)**
   - Description: Ceramic table lamps with white shades
   - SKU: HG-LAMP-TABLE-001
   - Source: Target
   - Purchase Price: $140.00 (2x $70)
   - Project Price: $160.00 (2x $80)
   - Market Value: $180.00 (2x $90)

8. **Throw Blankets (Set of 2)**
   - Description: Cozy throw blankets in navy and white stripes
   - SKU: HG-BLANKET-COASTAL-001
   - Source: Homegoods
   - Purchase Price: $60.00 (2x $30)
   - Project Price: $66.00 (2x $33)
   - Market Value: $72.00 (2x $36)

9. **Wall Mirror**
   - Description: Large round mirror with rope frame, 36 inches
   - SKU: HG-MIRROR-ROPE-001
   - Source: Homegoods
   - Purchase Price: $180.00
   - Project Price: $200.00
   - Market Value: $220.00

10. **Decorative Vases (Set of 3)**
    - Description: Ceramic vases in various sizes, white and blue
    - SKU: HG-VASE-SET-001
    - Source: Homegoods
    - Purchase Price: $90.00
    - Project Price: $100.00
    - Market Value: $110.00

---

## Project 3: Industrial Loft Conversion

### Project Details
- **Name**: Industrial Loft Conversion
- **Description**: Raw industrial space transformed into a modern living space with exposed brick, metal accents, and reclaimed wood furniture
- **Client Name**: David Martinez
- **Budget**: $100,000.00
- **Design Fee**: $25,000.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 25000,
    "furnishings": 62000,
    "install": 5000,
    "kitchen": 5000,
    "fuel": 2000,
    "storageReceiving": 3000,
    "propertyManagement": 0
  }
  ```
  - Categories sum to: $100,000 (matches total budget)
  - Design Fee: $25,000 = 25% of budget
  - Furnishings: $62,000 = 62% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=600&fit=crop` (Industrial loft)

---

## Project 4: Traditional Elegance Estate

### Project Details
- **Name**: Traditional Elegance Estate
- **Description**: Classic and sophisticated design for a large estate home featuring traditional furniture, rich fabrics, and timeless pieces
- **Client Name**: Robert & Elizabeth Windsor
- **Budget**: $140,000.00
- **Design Fee**: $35,000.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 35000,
    "furnishings": 87000,
    "install": 5000,
    "kitchen": 5000,
    "fuel": 2000,
    "storageReceiving": 5000,
    "propertyManagement": 1000
  }
  ```
  - Categories sum to: $140,000 (matches total budget)
  - Design Fee: $35,000 = 25% of budget
  - Furnishings: $87,000 = 62% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&h=600&fit=crop` (Traditional elegant living room)

---

## Project 5: Scandinavian Studio

### Project Details
- **Name**: Scandinavian Studio
- **Description**: Light-filled studio apartment with Scandinavian design principles: light woods, simple forms, and functional beauty
- **Client Name**: Emma Johansson
- **Budget**: $105,000.00
- **Design Fee**: $26,250.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 26250,
    "furnishings": 65000,
    "install": 5000,
    "kitchen": 0,
    "fuel": 2000,
    "storageReceiving": 3000,
    "propertyManagement": 3750
  }
  ```
  - Categories sum to: $105,000 (matches total budget)
  - Design Fee: $26,250 = 25% of budget
  - Furnishings: $65,000 = 62% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&h=600&fit=crop` (Scandinavian interior)

---

## Project 6: Bohemian Eclectic Loft

### Project Details
- **Name**: Bohemian Eclectic Loft
- **Description**: Vibrant and colorful bohemian design mixing patterns, textures, and global influences for a creative professional
- **Client Name**: Maya Patel
- **Budget**: $160,000.00
- **Design Fee**: $40,000.00 (25% of budget)
- **Budget Categories** (JSONB): 
  ```json
  {
    "designFee": 40000,
    "furnishings": 90000,
    "install": 5000,
    "kitchen": 5000,
    "fuel": 2000,
    "storageReceiving": 5000,
    "propertyManagement": 13000
  }
  ```
  - Categories sum to: $160,000 (matches total budget)
  - Design Fee: $40,000 = 25% of budget
  - Furnishings: $90,000 = 56% of TOTAL budget (matches real: 59-64% of total)
- **Main Image URL**: `https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop` (Bohemian living space)

---

## Implementation Structure

### How Budget Categories Work
1. **Projects have budget_categories JSONB** - Defines the TOTAL budget allocation per category
   - Example: `{"designFee": 12500, "furnishings": 30000, "install": 5000}` means $12.5K design fee, $30K furnishings, $5K install
   - Categories sum to total budget (including design fee)
   - These are TARGETS, not current spending

2. **Transactions drive spending** - Each transaction has a `category_id` that links to `budget_categories`
   - Transaction amounts accumulate per category
   - Budget progress = (sum of transaction amounts in category) / (budget_categories[category])
   - Should show PARTIAL progress (30-60%), NOT 100%

3. **Items are tied to transactions** - Items have `transaction_id` that links them to a transaction
   - Items are created WITH transactions
   - Items don't directly affect budget categories - transactions do
   - Item `project_price` values sum to transaction `amount` (approximately)

### Example Flow
- Project budget: $110K
- Budget categories: `{"designFee": 27500, "furnishings": 68000, "install": 5000}`
- Transaction 1: $18,500 in "Furnishings" category → Furnishings: $18,500 / $68,000 = 27% spent
- Transaction 2: $13,200 in "Furnishings" category → Furnishings: $31,700 / $68,000 = 47% spent
- Transaction 3: $7,300 in "Install" category → Install: $7,300 / $5,000 = 146% spent (over budget)
- Total spent: $39,000 (35% of total budget) - **PARTIALLY FILLED**

---

## Implementation Notes

### Tax Rate
- Use standard tax rate: **10.0%** (stored as `10.0` in `tax_rate_pct` field)
- Calculate `tax_amount_purchase_price` = `purchase_price * tax_rate_pct / 100.0`
- Calculate `tax_amount_project_price` = `project_price * tax_rate_pct / 100.0`
- Store tax amounts as strings with 4 decimal places (e.g., `"45.0000"`)

### Item ID Format
- Format: `I-{timestamp}-{random}`
- Example: `I-1734489600000-a3f2`

### QR Key Format
- Format: `QR-{timestamp}-{random}`
- Example: `QR-1734489600000-x9k1`

### Transaction Creation
- Each project should have MULTIPLE transactions (2-4 transactions per project)
- Each transaction should have a `category_id` linking to `budget_categories`
- Transactions should PARTIALLY fill budget categories (aim for 30-60% spent per category)
- Transaction type: `'Purchase'`
- Status: `'completed'`
- Payment method: `'Client Card'`
- Transaction `amount` should approximately equal sum of item `project_price` values (plus tax)
- Use `category_id` UUID from budget_categories table, NOT the legacy `budget_category` text field

### Image URLs
- Project hero images still reference Unsplash photo IDs at 800x600 resolution
- Item image URLs are intentionally omitted from both the plan and SQL scripts

### Price Normalization
For items with multiple prices (purchase, project, market):
- `purchase_price` = LEAST(purchase, project, market)
- `market_value` = GREATEST(purchase, project, market)
- `project_price` = purchase + project + market - purchase_price - market_value

### Inventory Status
- All items should have `inventory_status` = `'allocated'` (since they're assigned to projects)
- `business_inventory_location` should be `NULL` for project items

### Date Fields
- `date_created`: Use `current_date` (today's date)
- `created_at`: Use `now()` (current timestamp)
- `last_updated`: Use `now()` (current timestamp)

---

## SQL Implementation Strategy

1. **Get Budget Category IDs**
   - Query `budget_categories` table for account to get category UUIDs
   - Store mapping: category name → UUID

2. **Create Projects First**
   - Insert all 6 projects with their metadata and `budget_categories` JSONB
   - Store project IDs for later use

3. **Create Transactions (Multiple per project)**
   - Create 2-4 transactions per project
   - Each transaction has `category_id` linking to budget category
   - Calculate transaction totals from item prices (sum of project_price + tax)
   - Transactions should PARTIALLY fill budgets (30-60% spent)

4. **Create Items WITH Transactions**
   - Insert items with `transaction_id` linking to the transaction
   - Items are created as part of transaction creation
   - Leave item `images` JSONB arrays empty in this seed data; upload real media later
   - Calculate tax amounts

5. **Update Project Counts**
   - Update `item_count` and `transaction_count` on projects
   - Update `total_value` on projects (sum of item project_price values)

---

## Next Steps

1. Review this plan for accuracy
2. Run whichever `scripts/create-test-projects/project-*.sql` files you need through the Supabase MCP `execute_sql` tool
3. Verify data in database
4. Test in application UI

---

## Image Sources

Project hero images are sourced from Unsplash (https://unsplash.com), which provides free, high-quality stock photos. Item-level images are omitted in this dataset; upload or link real assets later as needed.

**Note**: In production, images would typically be uploaded to Supabase Storage or a CDN. For this test data we keep only the project-level Unsplash URLs for quick reference.
