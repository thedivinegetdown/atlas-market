import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { CopilotSections } from './copilotSections.jsx'

export default function AtlasCopilotWorkspace() {
  return (
    <WorkspacePage title="Atlas Copilot" description="Conversation, portfolio analysis, opportunity review, context, history, and safe AI advisory.">
      <CopilotSections />
    </WorkspacePage>
  )
}

