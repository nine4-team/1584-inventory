import { useState } from 'react'
import { supabase } from '@/services/supabase'
import { useAccount } from '@/contexts/AccountContext'

type DiagnosticResult = {
  item: any
  transaction: any
  sourceMatch: boolean
  hasNoTransaction: boolean
  inTop50: boolean
  top50Position?: number
  isBusinessInventory: boolean
  foundInSearch: boolean
}

export function DiagnoseSuggestedItems() {
  const { currentAccountId } = useAccount()
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skuInput, setSkuInput] = useState('400297050281')

  const TRANSACTION_ID = '5f68a8fc-4489-4415-b7d2-cd1793972970'

  const runDiagnostic = async () => {
    if (!currentAccountId) {
      setError('No account ID found')
      return
    }

    if (!skuInput.trim()) {
      setError('Please enter a SKU to search for')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 1. Find the item by exact SKU first, then try partial
      let { data: items } = await supabase
        .from('items')
        .select('*')
        .eq('account_id', currentAccountId)
        .eq('sku', skuInput.trim())

      if (!items || items.length === 0) {
        // Try partial match
        const { data: partialItems } = await supabase
          .from('items')
          .select('*')
          .eq('account_id', currentAccountId)
          .ilike('sku', `%${skuInput.trim()}%`)
          .limit(10)
        items = partialItems
      }

      if (!items || items.length === 0) {
        setError(`No items found with SKU "${skuInput.trim()}"`)
        setLoading(false)
        return
      }

      console.log(`Found ${items.length} item(s) matching SKU "${skuInput.trim()}":`, items)

      const item = items[0]
      console.log('Found item:', item)

      // 2. Fetch the transaction
      const { data: transaction } = await supabase
        .from('transactions')
        .select('*')
        .eq('account_id', currentAccountId)
        .eq('transaction_id', TRANSACTION_ID)
        .single()

      if (!transaction) {
        setError('Transaction not found')
        setLoading(false)
        return
      }

      console.log('Found transaction:', transaction)

      // 3. Check criteria
      const sourceMatch = item.source === transaction.source
      const hasNoTransaction = item.transaction_id === null
      const isBusinessInventory = item.project_id === null

      // 4. Check if in top 50
      let inTop50 = false
      let top50Position: number | undefined

      if (sourceMatch && hasNoTransaction) {
        const { data: recentItems } = await supabase
          .from('items')
          .select('item_id, sku, date_created')
          .eq('account_id', currentAccountId)
          .eq('source', transaction.source)
          .is('transaction_id', null)
          .order('date_created', { ascending: false })
          .limit(50)

        if (recentItems) {
          const itemIndex = recentItems.findIndex(i => i.item_id === item.item_id)
          inTop50 = itemIndex !== -1
          top50Position = itemIndex !== -1 ? itemIndex + 1 : undefined
        }
      }

      // 5. Check search
      let foundInSearch = false
      if (isBusinessInventory) {
        const searchTerm = skuInput.trim()
        const { data: searchResults } = await supabase
          .from('items')
          .select('item_id')
          .eq('account_id', currentAccountId)
          .is('project_id', null)
          .or(`description.ilike.%${searchTerm}%,source.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,business_inventory_location.ilike.%${searchTerm}%`)

        foundInSearch = searchResults?.some(i => i.item_id === item.item_id) ?? false
      }

      setResult({
        item,
        transaction,
        sourceMatch,
        hasNoTransaction,
        inTop50,
        top50Position,
        isBusinessInventory,
        foundInSearch
      })
    } catch (err) {
      console.error('Diagnostic error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed top-4 right-4 z-50 bg-white border-2 border-red-500 rounded-lg p-4 shadow-xl max-w-md max-h-[80vh] overflow-y-auto">
      <h3 className="text-lg font-bold mb-3 text-red-600">🔍 Diagnostic Tool</h3>

      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          SKU to search:
        </label>
        <input
          type="text"
          value={skuInput}
          onChange={(e) => setSkuInput(e.target.value)}
          placeholder="Enter SKU"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>

      <button
        onClick={runDiagnostic}
        disabled={loading}
        className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 mb-3"
      >
        {loading ? 'Running...' : 'Run Diagnostic'}
      </button>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 text-sm">
          <div className="border-b pb-2">
            <h4 className="font-semibold">Item Details</h4>
            <div className="text-xs space-y-1 mt-1">
              <p>ID: {result.item.item_id}</p>
              <p>SKU: {result.item.sku}</p>
              <p>Source: {result.item.source}</p>
              <p>Transaction ID: {result.item.transaction_id || 'null'}</p>
              <p>Project ID: {result.item.project_id || 'null'}</p>
            </div>
          </div>

          <div className="border-b pb-2">
            <h4 className="font-semibold">Transaction Details</h4>
            <div className="text-xs space-y-1 mt-1">
              <p>ID: {result.transaction.transaction_id}</p>
              <p>Source: {result.transaction.source}</p>
              <p>Project ID: {result.transaction.project_id || 'null'}</p>
            </div>
          </div>

          <div className="border-b pb-2">
            <h4 className="font-semibold">Suggested Tab Criteria</h4>
            <div className="text-xs space-y-1 mt-1">
              <p className={result.sourceMatch ? 'text-green-600' : 'text-red-600'}>
                {result.sourceMatch ? '✅' : '❌'} Source match
              </p>
              <p className={result.hasNoTransaction ? 'text-green-600' : 'text-red-600'}>
                {result.hasNoTransaction ? '✅' : '❌'} No transaction_id
              </p>
              {result.sourceMatch && result.hasNoTransaction && (
                <p className={result.inTop50 ? 'text-green-600' : 'text-red-600'}>
                  {result.inTop50 ? '✅' : '❌'} In top 50
                  {result.top50Position && ` (position ${result.top50Position})`}
                </p>
              )}
            </div>
          </div>

          <div>
            <h4 className="font-semibold">Inventory Tab Criteria</h4>
            <div className="text-xs space-y-1 mt-1">
              <p className={result.isBusinessInventory ? 'text-green-600' : 'text-red-600'}>
                {result.isBusinessInventory ? '✅' : '❌'} Is business inventory
              </p>
              {result.isBusinessInventory && (
                <p className={result.foundInSearch ? 'text-green-600' : 'text-red-600'}>
                  {result.foundInSearch ? '✅' : '❌'} Found in search
                </p>
              )}
            </div>
          </div>

          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mt-3">
            <h4 className="font-semibold mb-1">Summary</h4>
            <div className="text-xs">
              {!result.sourceMatch && (
                <p>❌ Won't appear in Suggested: Source mismatch ({result.item.source} ≠ {result.transaction.source})</p>
              )}
              {result.sourceMatch && !result.hasNoTransaction && (
                <p>❌ Won't appear in Suggested: Already has transaction_id</p>
              )}
              {result.sourceMatch && result.hasNoTransaction && !result.inTop50 && (
                <p>❌ Won't appear in Suggested: Not in top 50 most recent</p>
              )}
              {result.sourceMatch && result.hasNoTransaction && result.inTop50 && (
                <p>✅ SHOULD appear in Suggested tab!</p>
              )}
              {result.isBusinessInventory && (
                <p className="mt-1">✅ SHOULD appear in Inventory tab!</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
