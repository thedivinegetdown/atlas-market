import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { ResearchSections } from './researchSections.jsx'

export default function ResearchWorkspace() {
  return (
    <WorkspacePage title="Research" description="Research intelligence, context, market intelligence, decisions, multi-timeframe research, and research AI.">
      <ResearchSections />
    </WorkspacePage>
  )
}

