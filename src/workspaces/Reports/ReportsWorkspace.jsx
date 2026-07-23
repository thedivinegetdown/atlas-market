import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { ReportSections } from './reportSections.jsx'

export default function ReportsWorkspace() {
  return (
    <WorkspacePage title="Reports" description="Paper reports, audit, exports, history, CSV, JSON, and operator reports.">
      <ReportSections />
    </WorkspacePage>
  )
}

