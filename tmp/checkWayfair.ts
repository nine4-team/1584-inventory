import { parseWayfairInvoiceText } from '../src/utils/wayfairInvoiceParser'

const text = `
Shipped On Dec 19, 2025
Modern Upholstered Swivel
Counter Stool With Wood
Frame,Counter Height Bar Stool
$222.99 4 $891.96 $0.00 ($89.20) $54.19 $856.95
Shipping &
For Kitchen Island,Coffee Bar (Set
of 2)
W112013734
Color/Pattern: Beige/Brown
Bisto Modern Upholstered 27.1'' Swivel Bar Stool With Solid Wood
Frame
$265.99 4 $1,063.96 $0.00 ($95.76) $65.35 $1,033.55
`

const result = parseWayfairInvoiceText(text)
console.log(JSON.stringify(result.lineItems, null, 2))
