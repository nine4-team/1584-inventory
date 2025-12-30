import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  projectBudget,
  projectItems,
  projectTransactions,
  ProjectSection,
} from '@/utils/routes'
import { getPreferredProjectSection } from '@/utils/projectSectionStorage'

const tabToSection: Record<string, ProjectSection> = {
  inventory: 'items',
  transactions: 'transactions',
  budget: 'budget',
}

const sectionPathBuilders: Record<ProjectSection, (projectId: string) => string> = {
  items: projectItems,
  transactions: projectTransactions,
  budget: projectBudget,
}

export default function ProjectLegacyTabRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryString = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    if (!projectId) return

    const params = new URLSearchParams(queryString)
    const tabParam = params.get('tab')
    if (tabParam) {
      params.delete('tab')
    }

    const section = tabParam && tabToSection[tabParam]
      ? tabToSection[tabParam]
      : getPreferredProjectSection(projectId)
    const targetBuilder = sectionPathBuilders[section] || projectItems
    const targetBase = targetBuilder(projectId)
    const query = params.toString()

    navigate(query ? `${targetBase}?${query}` : targetBase, { replace: true })
  }, [navigate, projectId, queryString])

  return null
}
