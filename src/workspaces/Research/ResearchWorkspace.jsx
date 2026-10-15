import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { ResearchSections } from './researchSections.jsx'
import { useParams } from 'react-router-dom'
import SymbolResearchWorkspace from './SymbolResearchWorkspace.jsx'

export default function ResearchWorkspace() {
  const { symbol: routeSymbol } = useParams()
  const symbol = String(routeSymbol ?? '').trim().toUpperCase()
  if (symbol) return <SymbolResearchWorkspace symbol={symbol} />

  return (
    <WorkspacePage title="Research" description="Research intelligence, context, market intelligence, decisions, multi-timeframe research, and research AI.">
      <ResearchSections />
    </WorkspacePage>
  )
}

