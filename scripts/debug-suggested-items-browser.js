// Run this in the browser console while logged into your app
// 1. Open http://localhost:3000/business-inventory/transaction/5f68a8fc-4489-4415-b7d2-cd1793972970
// 2. Open DevTools (F12 or Cmd+Option+I)
// 3. Paste this entire script into the Console tab and press Enter

(async function debugSuggestedItems() {
  const ITEM_SKU = '400297050281'
  const TRANSACTION_ID = '5f68a8fc-4489-4415-b7d2-cd1793972970'

  console.log('=== Debugging Suggested Items Issue ===\n')

  // Get the Supabase client from the app
  const { supabase, currentAccountId } = await (async () => {
    // Try to get from window/global context
    if (window.supabase) {
      const accountId = localStorage.getItem('currentAccountId') ||
                       sessionStorage.getItem('currentAccountId')
      return { supabase: window.supabase, currentAccountId: accountId }
    }

    // If not available, we'll need to import it
    console.log('Supabase client not found in window. Make sure you\'re logged in.')
    return { supabase: null, currentAccountId: null }
  })()

  if (!supabase || !currentAccountId) {
    console.error('❌ Cannot access Supabase client or account ID')
    console.log('Please make sure you are:')
    console.log('1. Logged into the app')
    console.log('2. On a page where the app has loaded')
    return
  }

  console.log('✅ Found Supabase client and account ID:', currentAccountId)
  console.log()

  // 1. Search for the item by SKU
  console.log('1. Searching for item with SKU:', ITEM_SKU)
  let { data: items, error: itemError } = await supabase
    .from('items')
    .select('*')
    .eq('account_id', currentAccountId)
    .eq('sku', ITEM_SKU)

  if (itemError) {
    console.error('Error fetching item by SKU:', itemError)
    return
  }

  if (!items || items.length === 0) {
    console.log('No items found with exact SKU. Trying partial match...')
    const { data: partialItems, error: partialError } = await supabase
      .from('items')
      .select('*')
      .eq('account_id', currentAccountId)
      .ilike('sku', '%400297%')
      .limit(10)

    if (partialError) {
      console.error('Error with partial SKU search:', partialError)
      return
    }

    items = partialItems
    console.log(`Found ${items?.length || 0} items with SKU containing "400297"`)

    if (!items || items.length === 0) {
      console.log('❌ No items found. Cannot continue.')
      return
    }

    console.log('Found items:')
    items.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.item_id} - SKU: ${item.sku} - Source: ${item.source}`)
    })
    console.log()
  }

  const item = items[0]
  console.log('✅ Using item:', item.item_id)
  console.log()

  // 2. Fetch the transaction
  console.log('2. Fetching transaction:', TRANSACTION_ID)
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('account_id', currentAccountId)
    .eq('transaction_id', TRANSACTION_ID)
    .single()

  if (txError) {
    console.error('Error fetching transaction:', txError)
    return
  }

  console.log('✅ Transaction found')
  console.log()

  // 3. Display item details
  console.log('📦 ITEM DETAILS:')
  console.log('  - Item ID:', item.item_id)
  console.log('  - SKU:', item.sku)
  console.log('  - Description:', item.description)
  console.log('  - Source:', item.source)
  console.log('  - Transaction ID:', item.transaction_id || 'null')
  console.log('  - Project ID:', item.project_id || 'null')
  console.log('  - Date Created:', item.date_created)
  console.log('  - Created At:', item.created_at)
  console.log()

  // 4. Display transaction details
  console.log('💳 TRANSACTION DETAILS:')
  console.log('  - Transaction ID:', transaction.transaction_id)
  console.log('  - Source:', transaction.source)
  console.log('  - Project ID:', transaction.project_id || 'null')
  console.log('  - Transaction Type:', transaction.transaction_type)
  console.log()

  // 5. Check suggested items criteria
  console.log('🔍 SUGGESTED TAB CRITERIA CHECK:')
  console.log('   For an item to appear in Suggested tab, it must:')
  console.log('   ✓ Have the same source as the transaction')
  console.log('   ✓ Have transaction_id = null')
  console.log('   ✓ Be in the first 50 most recent items (by date_created)')
  console.log()

  const sourceMatch = item.source === transaction.source
  const hasNoTransaction = item.transaction_id === null

  console.log(`   ${sourceMatch ? '✅' : '❌'} Source match: ${sourceMatch}`)
  console.log(`       Item source: "${item.source}"`)
  console.log(`       Transaction source: "${transaction.source}"`)
  console.log()

  console.log(`   ${hasNoTransaction ? '✅' : '❌'} Has no transaction_id: ${hasNoTransaction}`)
  console.log(`       Item transaction_id: ${item.transaction_id || 'null'}`)
  console.log()

  // 6. Check if within top 50 by date
  if (sourceMatch && hasNoTransaction) {
    console.log('   ⏱️  Checking if within top 50 most recent items...')
    const { data: recentItems, error: recentError } = await supabase
      .from('items')
      .select('item_id, sku, date_created')
      .eq('account_id', currentAccountId)
      .eq('source', transaction.source)
      .is('transaction_id', null)
      .order('date_created', { ascending: false })
      .limit(50)

    if (recentError) {
      console.error('Error fetching recent items:', recentError)
    } else {
      const itemIndex = recentItems.findIndex(i => i.item_id === item.item_id)
      const inTop50 = itemIndex !== -1

      console.log(`       ${inTop50 ? '✅' : '❌'} Item is ${inTop50 ? `#${itemIndex + 1} in top 50` : 'NOT in top 50'}`)

      if (!inTop50) {
        console.log()
        console.log('       Top 10 most recent items for this source:')
        recentItems.slice(0, 10).forEach((i, idx) => {
          console.log(`         ${idx + 1}. ${i.sku || 'No SKU'} (${i.date_created})`)
        })
      }
    }
  }
  console.log()

  // 7. Check Inventory tab criteria
  console.log('📦 INVENTORY TAB CRITERIA CHECK:')
  console.log('   For an item to appear in Inventory tab, it must:')
  console.log('   ✓ Have project_id = null (business inventory item)')
  console.log()

  const isBusinessInventory = item.project_id === null
  console.log(`   ${isBusinessInventory ? '✅' : '❌'} Is business inventory item: ${isBusinessInventory}`)
  console.log(`       Item project_id: ${item.project_id || 'null'}`)
  console.log()

  if (isBusinessInventory) {
    console.log('   🔎 Testing search query "400297" in Inventory tab...')
    const { data: searchResults, error: searchError } = await supabase
      .from('items')
      .select('item_id, sku, description')
      .eq('account_id', currentAccountId)
      .is('project_id', null)
      .or(`description.ilike.%400297%,source.ilike.%400297%,sku.ilike.%400297%,business_inventory_location.ilike.%400297%`)
      .limit(10)

    if (searchError) {
      console.error('Error testing search:', searchError)
    } else {
      const foundInSearch = searchResults.some(i => i.item_id === item.item_id)
      console.log(`       ${foundInSearch ? '✅' : '❌'} Item ${foundInSearch ? 'FOUND' : 'NOT FOUND'} in database search results`)
      console.log(`       Total results: ${searchResults.length}`)

      if (foundInSearch) {
        const match = searchResults.find(i => i.item_id === item.item_id)
        console.log(`       Matched on SKU: "${match?.sku}"`)
      } else if (searchResults.length > 0) {
        console.log('       Results found:')
        searchResults.forEach((i, idx) => {
          console.log(`         ${idx + 1}. ${i.sku} - ${i.description}`)
        })
      }
    }
  }
  console.log()

  // Summary
  console.log('=' .repeat(60))
  console.log('📊 SUMMARY')
  console.log('=' .repeat(60))

  if (!sourceMatch) {
    console.log('❌ SUGGESTED TAB: Item will NOT appear')
    console.log(`   Reason: Source mismatch`)
    console.log(`   Item source "${item.source}" ≠ Transaction source "${transaction.source}"`)
  } else if (!hasNoTransaction) {
    console.log('❌ SUGGESTED TAB: Item will NOT appear')
    console.log(`   Reason: Item already has transaction_id: ${item.transaction_id}`)
  } else {
    console.log('✅ SUGGESTED TAB: Item meets basic criteria')
    console.log('   (Check top 50 results above)')
  }
  console.log()

  if (isBusinessInventory) {
    console.log('✅ INVENTORY TAB: Item SHOULD appear here')
    console.log('   (This is a business inventory item)')
    console.log('   If not visible in the UI, check client-side filtering')
  } else {
    console.log('❌ INVENTORY TAB: Item will NOT appear')
    console.log(`   Reason: Item belongs to project ${item.project_id}`)
  }
  console.log('=' .repeat(60))
})()
