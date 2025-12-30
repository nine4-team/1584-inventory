import TransactionsList from './TransactionsList'
import { useProjectLayoutContext } from './ProjectLayout'

export default function ProjectTransactionsPage() {
  const { project, transactions } = useProjectLayoutContext()

  return <TransactionsList projectId={project.id} transactions={transactions} />
}
