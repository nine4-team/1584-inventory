import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rwevbekceexnoaabdnbz.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_6egKYDm7XsfIPvwDD5qqpg_eY_5nYgW'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const ITEM_ID = 'I-1770409972867-v870'
const ITEM_SKU = '400297050281'
const TRANSACTION_ID = '5f68a8fc-4489-4415-b7d2-cd1793972970'

async function main() {
  console.log('=== Debugging Suggested Items Issue ===\n')

  // Check if we can access any items at all
  console.log('0. Testing database access...')
  const { data: testItems, error: testError, count } = await supabase
    .from('items')
    .select('item_id, sku', { count: 'exact' })
    .limit(5)

  if (testError) {
    console.error('❌ Cannot access items table:', testError)
    console.log('\nThis is likely due to Row Level Security (RLS) policies.')
    console.log('The anon key cannot read items without authentication.')
    console.log('\nPlease run this script in the browser console instead:')
    console.log('1. Open your app at http://localhost:3000')
    console.log('2. Log in to your account')
    console.log('3. Open browser DevTools console')
    console.log('4. Paste the browser version of this script')
    return
  }

  console.log(`✅ Can access items table (found ${count} total items, showing first ${testItems?.length || 0})`)
  if (testItems && testItems.length > 0) {
    testItems.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.item_id} - SKU: ${item.sku}`)
    })
  }
  console.log()

  // 1. Fetch the item by SKU first
  console.log('1. Searching for item with SKU:', ITEM_SKU)
  let { data: items, error: itemError } = await supabase
    .from('items')
    .select('*')
    .eq('sku', ITEM_SKU)

  if (itemError) {
    console.error('Error fetching item by SKU:', itemError)
    return
  }

  if (!items || items.length === 0) {
    console.log('No items found with that SKU. Trying partial match...')
    const { data: partialItems, error: partialError } = await supabase
      .from('items')
      .select('*')
      .ilike('sku', '%400297%')
      .limit(10)

    if (partialError) {
      console.error('Error with partial SKU search:', partialError)
      return
    }

    items = partialItems
    console.log(`Found ${items?.length || 0} items with SKU containing "400297"`)

    if (!items || items.length === 0) {
      console.log('No items found. Cannot continue.')
      return
    }

    items.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.item_id} - SKU: ${item.sku} - Source: ${item.source}`)
    })
    console.log()
  }

  const item = items[0]
  console.log('Using item:', item.item_id)
  console.log()

  console.log('Item data:')
  console.log('  - SKU:', item.sku)
  console.log('  - Description:', item.description)
  console.log('  - Source:', item.source)
  console.log('  - Transaction ID:', item.transaction_id)
  console.log('  - Project ID:', item.project_id)
  console.log('  - Date Created:', item.date_created)
  console.log('  - Created At:', item.created_at)
  console.log()

  // 2. Fetch the transaction
  console.log('2. Fetching transaction:', TRANSACTION_ID)
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_id', TRANSACTION_ID)
    .single()

  if (txError) {
    console.error('Error fetching transaction:', txError)
    return
  }

  console.log('Transaction data:')
  console.log('  - Source:', transaction.source)
  console.log('  - Project ID:', transaction.project_id)
  console.log('  - Transaction Type:', transaction.transaction_type)
  console.log()

  // 3. Check suggested items criteria
  console.log('3. Checking Suggested Items Criteria:')
  console.log('   For an item to appear in Suggested tab, it must:')
  console.log('   ✓ Have the same source as the transaction')
  console.log('   ✓ Have transaction_id = null')
  console.log('   ✓ Be in the first 50 most recent items (by date_created)')
  console.log()

  const sourceMatch = item.source === transaction.source
  const hasNoTransaction = item.transaction_id === null

  console.log(`   Source match: ${sourceMatch ? '✅' : '❌'}`)
  console.log(`     - Item source: "${item.source}"`)
  console.log(`     - Transaction source: "${transaction.source}"`)
  console.log()

  console.log(`   Has no transaction_id: ${hasNoTransaction ? '✅' : '❌'}`)
  console.log(`     - Item transaction_id: ${item.transaction_id || 'null'}`)
  console.log()

  // 4. Check if within top 50 by date
  if (sourceMatch && hasNoTransaction) {
    console.log('   Checking if within top 50 most recent items...')
    const { data: recentItems, error: recentError } = await supabase
      .from('items')
      .select('item_id, sku, date_created')
      .eq('account_id', item.account_id)
      .eq('source', transaction.source)
      .is('transaction_id', null)
      .order('date_created', { ascending: false })
      .limit(50)

    if (recentError) {
      console.error('Error fetching recent items:', recentError)
    } else {
      const itemIndex = recentItems.findIndex(i => i.item_id === ITEM_ID)
      const inTop50 = itemIndex !== -1

      console.log(`     ${inTop50 ? '✅' : '❌'} Item is ${inTop50 ? `#${itemIndex + 1}` : 'NOT'} in top 50`)

      if (!inTop50) {
        console.log('\n     Top 5 most recent items for reference:')
        recentItems.slice(0, 5).forEach((i, idx) => {
          console.log(`       ${idx + 1}. ${i.sku || 'No SKU'} (${i.date_created})`)
        })
      }
    }
  }
  console.log()

  // 5. Check Inventory tab criteria
  console.log('4. Checking Inventory Tab Criteria:')
  console.log('   For an item to appear in Inventory tab, it must:')
  console.log('   ✓ Have project_id = null (business inventory item)')
  console.log()

  const isBusinessInventory = item.project_id === null
  console.log(`   Is business inventory item: ${isBusinessInventory ? '✅' : '❌'}`)
  console.log(`     - Item project_id: ${item.project_id || 'null'}`)
  console.log()

  if (isBusinessInventory) {
    console.log('   Testing search query "400297" against SKU...')
    const { data: searchResults, error: searchError } = await supabase
      .from('items')
      .select('item_id, sku, description')
      .eq('account_id', item.account_id)
      .is('project_id', null)
      .or(`description.ilike.%400297%,source.ilike.%400297%,sku.ilike.%400297%,business_inventory_location.ilike.%400297%`)
      .limit(10)

    if (searchError) {
      console.error('Error testing search:', searchError)
    } else {
      const foundInSearch = searchResults.some(i => i.item_id === ITEM_ID)
      console.log(`     ${foundInSearch ? '✅' : '❌'} Item ${foundInSearch ? 'FOUND' : 'NOT FOUND'} in search results`)
      console.log(`     Total results: ${searchResults.length}`)

      if (foundInSearch) {
        const match = searchResults.find(i => i.item_id === ITEM_ID)
        console.log(`     Matched on: SKU "${match?.sku}"`)
      }
    }
  }
  console.log()

  // Summary
  console.log('=== SUMMARY ===')
  if (!sourceMatch) {
    console.log('❌ Item will NOT appear in Suggested tab: Source mismatch')
    console.log(`   The item source "${item.source}" does not match transaction source "${transaction.source}"`)
  } else if (!hasNoTransaction) {
    console.log('❌ Item will NOT appear in Suggested tab: Already has transaction_id')
    console.log(`   The item is already assigned to transaction: ${item.transaction_id}`)
  } else {
    console.log('✅ Item meets basic Suggested tab criteria (source match + no transaction)')
    console.log('   Check if it\'s in the top 50 most recent items above')
  }

  if (isBusinessInventory) {
    console.log('✅ Item SHOULD appear in Inventory tab (it\'s a business inventory item)')
    console.log('   If it\'s not appearing, check the client-side filtering logic')
  }
}

main().catch(console.error)
