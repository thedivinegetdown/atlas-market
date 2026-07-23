import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { HealthSections } from './healthSections.jsx'

export default function SystemHealthWorkspace() {
  return (
    <WorkspacePage title="System Health" description="Release readiness, runtime health, observability, deployment, environment, diagnostics, and release candidate review.">
      <HealthSections />
    </WorkspacePage>
  )
}

