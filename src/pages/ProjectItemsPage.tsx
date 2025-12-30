import InventoryList from './InventoryList'
import { useProjectLayoutContext } from './ProjectLayout'

export default function ProjectItemsPage() {
  const { project, items } = useProjectLayoutContext()

  return (
    <InventoryList
      projectId={project.id}
      projectName={project.name}
      items={items}
    />
  )
}
