import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { ScannerSections } from './scannerSections.jsx'

export default function ScannerWorkspace() {
  return (
    <WorkspacePage title="Scanner" description="Signals, scanner candidates, alerts, opportunity ranking, and review.">
      <ScannerSections />
    </WorkspacePage>
  )
}

