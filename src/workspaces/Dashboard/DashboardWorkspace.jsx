import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { DashboardSections } from './dashboardSections.jsx'
import { selectDashboardSummary } from './dashboardSelectors.js'

export default function DashboardWorkspace() {
  return (
    <WorkspacePage title="Dashboard" description="Executive overview across portfolio, market, alert, system, and advisory paper-trading context.">
      <DashboardSections summary={selectDashboardSummary()} />
    </WorkspacePage>
  )
}

