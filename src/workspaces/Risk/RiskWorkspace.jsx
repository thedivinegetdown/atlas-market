import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { RiskSections } from './riskSections.jsx'

export default function RiskWorkspace() {
  return (
    <WorkspacePage title="Risk" description="Risk panel, trade guardrails, position sizing, metrics, open risk, and reports.">
      <RiskSections />
    </WorkspacePage>
  )
}

