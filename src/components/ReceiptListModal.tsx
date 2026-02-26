import { useState } from 'react'
import { parseReceiptList, type ParsedReceiptItem } from '@/utils/receiptListParser'

interface ReceiptListModalProps {
  onSubmit: (items: ParsedReceiptItem[]) => Promise<void>
  onClose: () => void
}

export default function ReceiptListModal({ onSubmit, onClose }: ReceiptListModalProps) {
  const [text, setText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [preview, setPreview] = useState<{ items: ParsedReceiptItem[]; skippedLines: string[] } | null>(null)

  const handleParse = () => {
    const result = parseReceiptList(text)
    setPreview(result)
  }

  const handleSubmit = async () => {
    if (!preview || preview.items.length === 0) return
    setIsSubmitting(true)
    try {
      await onSubmit(preview.items)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    setPreview(null)
  }

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const totalCents = preview?.items.reduce((sum, item) => sum + item.priceCents, 0) ?? 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Create Items from List</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {!preview ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Paste an itemized receipt. Each line should follow this format:
              </p>
              <pre className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
                {'DEPT - DESCRIPTION SKU $PRICE T\ne.g. 53 - ACCENT FURNISH 252972 $129.99 T'}
              </pre>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste receipt lines here..."
                rows={12}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:ring-primary-500"
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-4">
              {preview.items.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">
                    {preview.items.length} item{preview.items.length !== 1 ? 's' : ''} found
                  </h4>
                  <div className="border border-gray-200 rounded-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.items.map((item, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-sm text-gray-900">{item.name}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 font-mono">{item.sku}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 text-right">{formatPrice(item.priceCents)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-medium">
                          <td className="px-3 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                          <td className="px-3 py-2 text-sm text-gray-900 text-right">{formatPrice(totalCents)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.skippedLines.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-yellow-800 mb-1">
                    {preview.skippedLines.length} line{preview.skippedLines.length !== 1 ? 's' : ''} skipped
                  </h4>
                  <ul className="text-xs text-yellow-700 bg-yellow-50 rounded px-3 py-2 space-y-1 font-mono">
                    {preview.skippedLines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.items.length === 0 && (
                <p className="text-sm text-red-600">No valid receipt lines found. Check the format and try again.</p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          {!preview ? (
            <button
              type="button"
              onClick={handleParse}
              disabled={!text.trim()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-primary-600 hover:bg-primary-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Preview Items
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || preview.items.length === 0}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-primary-600 hover:bg-primary-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Creating...' : `Create ${preview.items.length} Item${preview.items.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
