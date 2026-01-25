import { useState, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import { useProjectLayoutContext } from './ProjectLayout'
import SpacePreviewCard from '@/components/spaces/SpacePreviewCard'
import { useNavigate } from 'react-router-dom'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { projectSpaceNew } from '@/utils/routes'
import { Space } from '@/types'

export default function ProjectSpacesPage() {
  const { project, spaces, items } = useProjectLayoutContext()
  const navigate = useNavigate()
  const { buildContextUrl } = useNavigationContext()
  const [searchQuery, setSearchQuery] = useState('')

  // Calculate item counts per space
  const itemCountsBySpace = useMemo(() => {
    const counts: Record<string, number> = {}
    items.forEach(item => {
      if (item.spaceId) {
        counts[item.spaceId] = (counts[item.spaceId] || 0) + 1
      }
    })
    return counts
  }, [items])

  // Filter spaces by search query
  const filteredSpaces = useMemo(() => {
    if (!searchQuery.trim()) return spaces

    const query = searchQuery.toLowerCase()
    return spaces.filter(space =>
      space.name.toLowerCase().includes(query) ||
      space.notes?.toLowerCase().includes(query)
    )
  }, [spaces, searchQuery])

  const handleCreateSpace = () => {
    navigate(buildContextUrl(projectSpaceNew(project.id)))
  }

  return (
    <div className="space-y-6">
      {/* Header with search and create button */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handleCreateSpace}
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add
        </button>
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search spaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Spaces grid */}
      {filteredSpaces.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg
              className="mx-auto h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? 'No spaces found' : 'No spaces yet'}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery
              ? 'Try adjusting your search query'
              : 'Create your first space to organize items by location'}
          </p>
          {!searchQuery && (
            <button
              onClick={handleCreateSpace}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredSpaces.map(space => (
            <SpacePreviewCard
              key={space.id}
              space={space}
              itemCount={itemCountsBySpace[space.id] || 0}
              projectId={project.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
