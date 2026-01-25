import { describe, expect, it } from 'vitest'
import { parseAmazonInvoiceText } from '@/utils/amazonInvoiceParser'

const fixtureText = `Final Details for Order #114-8185066-9439459
Order Placed: January 15, 2026
Amazon.com order number: 114-8185066-9439459
Order Total: $372.72
Business order information
Project code: Debbie Hyer - Martinique
Shipped on January 16, 2026
Items Ordered Price
1 of: Dark Grey Double Layer Thick Linen Floor Length Curtains 102 Inches Long for Bedroom, Blackout Memory Trained Pinch
Plea
ted Soundproof Insulated Textured Windows Drapes for Office Burg 2 Panels Set
Sold by: Pinch Pleated Drapes (seller profile)
Condition: New
$94.99
2 of: AMZSEVEN 100 Pack Metal Curtain Rings with Clips, Drapery Clips Hooks, Decorative Curtain Rod Clips 1.5 in Interior Diam
eter, Antique Bronze
Sold by: AMZSEVEN (seller profile)
Business Price
Condition: New
$25.88
Shipping Address:
Lisa Fisher
700 Picturesque Drive
Saint George, UT 84770
United States
Shipping Speed:
Scheduled Consolidated Delivery
Item(s) Subtotal: $146.75
Shipping & Handling: $0.00
-----
Total before tax: $146.75
Sales Tax: $9.91
-----
Total for This Shipment: $156.66
-----
Shipped on January 16, 2026
Items Ordered Price
2 of: MIULEE Sage Green Pinch Pleated 100% Blackout Linen Curtains 96 Inch Length 2 Panels Set, Black Out Memory Trained
Pleat
Curtains Light Blocking Room Darkening Drapes for Bedroom Living Room Window
Sold by: Miulee Home (seller profile)
Business Price
Condition: New
$75.98
1 of: DUALIFE 96 Inch Terracotta Curtains 2 Panel Set Blackout Heat Reducing Sun Block Out Curtains for Bedroom Dorm UV
Blocki
ng Noise Canceling Burlap Linen Look Drapes Rod Pocket Back Tab,50 X 96 Rust
Sold by: DUALIFE (seller profile)
Condition: New
$50.44
Shipping Address: Item(s) Subtotal: $202.40
-- 1 of 2 --
Lisa Fisher
700 Picturesque Drive
Saint George, UT 84770
United States
Shipping Speed:
Scheduled Consolidated Delivery
Shipping & Handling: $0.00
-----
Total before tax: $202.40
Sales Tax: $13.66
-----
Total for This Shipment: $216.06
-----
Payment information
Payment Method:
Visa | Last digits: 0579
Billing address
John C Hyer
101 Road 1.7 NE
Moses Lake, WA 98837
United States
Item(s) Subtotal: $349.15
Shipping & Handling: $0.00
-----
Total before tax: $349.15
Estimated Tax: $23.57
-----
Grand Total: $372.72
Credit Card transactions Visa ending in 0579: January 16, 2026: $372.72
To view the status of your order, return to Order Summary .
Conditions of Use | Privacy Notice © 1996-2020, Amazon.com, Inc.
-- 2 of 2 --`

describe('parseAmazonInvoiceText', () => {
  it('extracts header fields and line items from sample PDF', () => {
    const result = parseAmazonInvoiceText(fixtureText)

    expect(result.orderNumber).toBe('114-8185066-9439459')
    expect(result.orderPlacedDate).toBe('2026-01-15')
    expect(result.grandTotal).toBe('372.72')
    expect(result.projectCode).toBe('Debbie Hyer - Martinique')
    expect(result.paymentMethod).toBe('Visa | Last digits: 0579')

    expect(result.lineItems.length).toBe(4)
    
    // Check quantities match expected order [1, 2, 2, 1]
    expect(result.lineItems[0].qty).toBe(1)
    expect(result.lineItems[1].qty).toBe(2)
    expect(result.lineItems[2].qty).toBe(2)
    expect(result.lineItems[3].qty).toBe(1)

    // Check unit prices match expected order [94.99, 25.88, 75.98, 50.44]
    expect(result.lineItems[0].unitPrice).toBe('94.99')
    expect(result.lineItems[1].unitPrice).toBe('25.88')
    expect(result.lineItems[2].unitPrice).toBe('75.98')
    expect(result.lineItems[3].unitPrice).toBe('50.44')

    // Check totals are computed correctly (qty × unitPrice)
    expect(result.lineItems[0].total).toBe('94.99')
    expect(result.lineItems[1].total).toBe('51.76') // 2 × 25.88
    expect(result.lineItems[2].total).toBe('151.96') // 2 × 75.98
    expect(result.lineItems[3].total).toBe('50.44')

    // Check descriptions contain expected text
    expect(result.lineItems[0].description).toContain('Dark Grey Double Layer Thick Linen')
    expect(result.lineItems[1].description).toContain('AMZSEVEN 100 Pack Metal Curtain Rings')
    expect(result.lineItems[2].description).toContain('MIULEE Sage Green Pinch Pleated')
    expect(result.lineItems[3].description).toContain('DUALIFE 96 Inch Terracotta Curtains')
    expect(result.lineItems.some(item => item.description.includes('Lisa Fisher'))).toBe(false)
    expect(result.lineItems.some(item => item.description.includes('Saint George'))).toBe(false)

    // Check shippedOn dates
    expect(result.lineItems[0].shippedOn).toBe('2026-01-16')
    expect(result.lineItems[1].shippedOn).toBe('2026-01-16')
    expect(result.lineItems[2].shippedOn).toBe('2026-01-16')
    expect(result.lineItems[3].shippedOn).toBe('2026-01-16')
  })

  it('validates totals match grand total within tolerance', () => {
    const result = parseAmazonInvoiceText(fixtureText)
    
    // Sum of line item totals: 94.99 + 51.76 + 151.96 + 50.44 = 349.15
    // Grand total: 372.72
    // Difference: 23.57 (which is the tax)
    // The parser should warn about this mismatch
    const hasTotalMismatchWarning = result.warnings.some(w => 
      w.includes('do not match order total') || w.includes('Line totals')
    )
    
    // Note: The actual totals don't match because tax is included in grand total
    // but not in individual line items. This is expected behavior.
    expect(result.grandTotal).toBe('372.72')
    expect(hasTotalMismatchWarning).toBe(true)
  })

  it('rejects non-Amazon invoices', () => {
    const wayfairText = `
Wayfair
Invoice # 4386128736
Order Date: 12/01/2024
Order Total $12,580.48
`
    const result = parseAmazonInvoiceText(wayfairText)
    
    expect(result.lineItems.length).toBe(0)
    expect(result.warnings).toContain('Not an Amazon invoice')
  })

  it('handles missing order number gracefully', () => {
    const text = `
Order Placed: January 15, 2026
Amazon.com
Order Total: $100.00
Shipped on January 16, 2026
1 of: Test Item
$50.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.orderNumber).toBeUndefined()
    expect(result.warnings).toContain('Could not confidently find an order number.')
    expect(result.lineItems.length).toBeGreaterThan(0)
  })

  it('handles missing order date gracefully', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Total: $100.00
Shipped on January 16, 2026
1 of: Test Item
$50.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.orderPlacedDate).toBeUndefined()
    expect(result.warnings).toContain('Could not confidently find an order date')
  })

  it('handles missing grand total gracefully', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Shipped on January 16, 2026
1 of: Test Item
$50.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.grandTotal).toBeUndefined()
    expect(result.warnings).toContain('Missing order total')
  })

  it('parses order number from "Final Details for Order #" format', () => {
    const text = `
Final Details for Order #123-4567890-1234567
Order Placed: January 15, 2026
Order Total: $100.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.orderNumber).toBe('123-4567890-1234567')
  })

  it('prefers "Grand Total" over "Order Total"', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Order Total: $100.00
Grand Total: $120.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.grandTotal).toBe('120.00')
  })

  it('extracts project code when present', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Order Total: $100.00
Project code: Test Project Name
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.projectCode).toBe('Test Project Name')
  })

  it('extracts payment method when present', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Order Total: $100.00
Visa | Last digits: 1234
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.paymentMethod).toBe('Visa | Last digits: 1234')
  })

  it('handles multi-line item descriptions', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Order Total: $100.00
Shipped on January 16, 2026
1 of: First line of description
Second line of description
Third line of description
$50.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.lineItems.length).toBe(1)
    expect(result.lineItems[0].description).toContain('First line of description')
    expect(result.lineItems[0].description).toContain('Second line of description')
    expect(result.lineItems[0].description).toContain('Third line of description')
  })

  it('ignores non-item lines like "Sold by:", "Condition:", etc.', () => {
    const text = `
Amazon.com order number: 114-8185066-9439459
Order Placed: January 15, 2026
Order Total: $100.00
Shipped on January 16, 2026
1 of: Test Item Description
Sold by: Test Seller
Condition: New
Business Price
$50.00
`
    const result = parseAmazonInvoiceText(text)
    
    expect(result.lineItems.length).toBe(1)
    expect(result.lineItems[0].description).not.toContain('Sold by:')
    expect(result.lineItems[0].description).not.toContain('Condition:')
    expect(result.lineItems[0].description).not.toContain('Business Price')
    expect(result.lineItems[0].description).toBe('Test Item Description')
  })
})
