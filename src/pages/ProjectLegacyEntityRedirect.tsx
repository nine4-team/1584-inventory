import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  projectClientSummary,
  projectInvoice,
  projectItemDetail,
  projectItemEdit,
  projectItemNew,
  projectPropertyManagementSummary,
  projectTransactionDetail,
  projectTransactionEdit,
  projectTransactionImport,
  projectTransactionNew,
} from '@/utils/routes'

type LegacyRouteType =
  | 'item-detail'
  | 'item-edit'
  | 'item-new'
  | 'transaction-detail'
  | 'transaction-edit'
  | 'transaction-new'
  | 'transaction-import'
  | 'report-invoice'
  | 'report-client-summary'
  | 'report-property-summary'

interface ProjectLegacyEntityRedirectProps {
  type: LegacyRouteType
}

const targetResolvers: Record<LegacyRouteType, (params: Record<string, string>) => string> = {
  'item-detail': params => projectItemDetail(params.projectId, params.itemId),
  'item-edit': params => projectItemEdit(params.projectId, params.itemId),
  'item-new': params => projectItemNew(params.projectId),
  'transaction-detail': params => projectTransactionDetail(params.projectId, params.transactionId),
  'transaction-edit': params => projectTransactionEdit(params.projectId, params.transactionId),
  'transaction-new': params => projectTransactionNew(params.projectId),
  'transaction-import': params => projectTransactionImport(params.projectId),
  'report-invoice': params => projectInvoice(params.projectId),
  'report-client-summary': params => projectClientSummary(params.projectId),
  'report-property-summary': params => projectPropertyManagementSummary(params.projectId),
}

const requiredParams: Record<LegacyRouteType, string[]> = {
  'item-detail': ['itemId'],
  'item-edit': ['itemId'],
  'item-new': [],
  'transaction-detail': ['transactionId'],
  'transaction-edit': ['transactionId'],
  'transaction-new': [],
  'transaction-import': [],
  'report-invoice': [],
  'report-client-summary': [],
  'report-property-summary': [],
}

export default function ProjectLegacyEntityRedirect({ type }: ProjectLegacyEntityRedirectProps) {
  const params = useParams<Record<string, string | undefined>>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const serializedParams = useMemo(() => {
    const definedEntries = Object.entries(params).filter(
      ([, value]) => value !== undefined
    ) as Array<[string, string]>
    definedEntries.sort(([a], [b]) => a.localeCompare(b))

    return JSON.stringify(Object.fromEntries(definedEntries))
  }, [params])

  const queryString = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    const normalizedParams = JSON.parse(serializedParams) as Record<string, string>
    const projectId = normalizedParams.projectId || normalizedParams.id
    if (!projectId) return

    const resolver = targetResolvers[type]
    if (!resolver) return

    const missingParam = (requiredParams[type] || []).some(key => {
      return key === 'projectId' ? !projectId : !normalizedParams[key]
    })
    if (missingParam) return

    const resolvedParams: Record<string, string> = {
      ...normalizedParams,
      projectId,
    }

    const target = resolver(resolvedParams)
    const query = queryString

    navigate(query ? `${target}?${query}` : target, { replace: true })
  }, [navigate, queryString, serializedParams, type])

  return null
}
