import React, { useState } from 'react'
import { ConflictItem, Resolution } from '../types/conflicts'
import { Button } from './ui/Button'
import { AlertTriangle, CheckCircle } from 'lucide-react'

interface ConflictModalProps {
  conflict: ConflictItem
  onResolve: (resolution: Resolution) => void
  onCancel: () => void
}

export function ConflictModal({ conflict, onResolve, onCancel }: ConflictModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<'local' | 'server' | null>(null)

  const handleResolve = () => {
    if (!selectedChoice) return

    onResolve({
      strategy: 'manual',
      userChoice: selectedChoice
    })
  }

  const renderFieldComparison = (field: string) => {
    const localValue = conflict.local.data[field]
    const serverValue = conflict.server.data[field]

    return (
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">{field}</label>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-red-50 rounded border">
            <div className="text-xs text-red-600 mb-1">Your local change</div>
            <div className="font-mono text-sm">{String(localValue)}</div>
          </div>
          <div className="p-3 bg-blue-50 rounded border">
            <div className="text-xs text-blue-600 mb-1">Server version</div>
            <div className="font-mono text-sm">{String(serverValue)}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-lg shadow-xl">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Data Conflict Detected</h2>
          </div>

          <p className="text-gray-600 mb-6">
            The item "{conflict.local.data.name}" has been modified both locally and on the server.
            Please choose which version to keep.
          </p>

          {renderFieldComparison(conflict.field)}

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Choose resolution:</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="choice"
                  value="local"
                  checked={selectedChoice === 'local'}
                  onChange={(e) => setSelectedChoice(e.target.value as 'local')}
                  className="text-blue-600"
                />
                <span>Keep my local changes</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="choice"
                  value="server"
                  checked={selectedChoice === 'server'}
                  onChange={(e) => setSelectedChoice(e.target.value as 'server')}
                  className="text-blue-600"
                />
                <span>Use server version (discard my changes)</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel}>
              Cancel Sync
            </Button>
            <Button
              onClick={handleResolve}
              disabled={!selectedChoice}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Apply Resolution
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}