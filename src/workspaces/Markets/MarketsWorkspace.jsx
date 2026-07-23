import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { MarketSections } from './marketSections.jsx'

export default function MarketsWorkspace() {
  return (
    <WorkspacePage title="Markets" description="Market data, streaming, provider health, regime, and research-score presentation.">
      <MarketSections />
    </WorkspacePage>
  )
}

