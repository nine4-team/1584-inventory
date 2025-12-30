import { useProjectLayoutContext } from './ProjectLayout'

export default function ProjectBudgetPage() {
  const { project } = useProjectLayoutContext()

  return (
    <div className="space-y-4 text-sm text-gray-600">
      <p>
        The budget and accounting tabs above remain visible for project <strong>{project.name}</strong>,
        so you can toggle between budget health and accounting insights without leaving this section.
      </p>
      <p>
        Use the Budget tab to monitor allocation progress, or switch to Accounting to access quick reports.
      </p>
    </div>
  )
}
