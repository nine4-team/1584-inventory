export type ProjectSection = 'items' | 'transactions' | 'spaces' | 'budget'

export const projectsRoot = () => '/projects'

export const projectRoot = (projectId: string) => `/project/${projectId}`

export const projectItems = (projectId: string) => `${projectRoot(projectId)}/items`

export const projectItemDetail = (projectId: string, itemId: string) =>
  `${projectItems(projectId)}/${itemId}`

export const projectItemEdit = (projectId: string, itemId: string) =>
  `${projectItemDetail(projectId, itemId)}/edit`

export const projectItemNew = (projectId: string) => `${projectItems(projectId)}/new`

export const projectTransactions = (projectId: string) => `${projectRoot(projectId)}/transactions`

export const projectTransactionDetail = (projectId: string, transactionId: string) =>
  `${projectTransactions(projectId)}/${transactionId}`

export const projectTransactionEdit = (projectId: string, transactionId: string) =>
  `${projectTransactionDetail(projectId, transactionId)}/edit`

export const projectTransactionNew = (projectId: string) => `${projectTransactions(projectId)}/new`

export const projectTransactionImport = (projectId: string) =>
  `${projectTransactions(projectId)}/import-wayfair`

export const projectBudget = (projectId: string) => `${projectRoot(projectId)}/budget`

export const projectInvoice = (projectId: string) => `${projectRoot(projectId)}/invoice`

export const projectClientSummary = (projectId: string) => `${projectRoot(projectId)}/client-summary`

export const projectPropertyManagementSummary = (projectId: string) =>
  `${projectRoot(projectId)}/property-management-summary`

export const projectSpaces = (projectId: string) => `${projectRoot(projectId)}/spaces`

export const projectSpaceDetail = (projectId: string, spaceId: string) =>
  `${projectSpaces(projectId)}/${spaceId}`

export const projectSpaceEdit = (projectId: string, spaceId: string) =>
  `${projectSpaceDetail(projectId, spaceId)}/edit`

export const projectSpaceNew = (projectId: string) => `${projectSpaces(projectId)}/new`
