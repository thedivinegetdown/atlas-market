import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { StrategySections } from './strategySections.jsx'

export default function StrategiesWorkspace() {
  return (
    <WorkspacePage title="Strategies" description="Strategy builder, rule evaluation, signal composer, lifecycle, and registry.">
      <StrategySections />
    </WorkspacePage>
  )
}

