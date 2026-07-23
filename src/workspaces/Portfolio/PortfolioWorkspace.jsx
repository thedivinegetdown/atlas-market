import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { PortfolioSections } from './portfolioSections.jsx'
import { selectPortfolioOverview } from './portfolioSelectors.js'

export default function PortfolioWorkspace() {
  return (
    <WorkspacePage title="Portfolio" description="Positions, performance, analytics, allocation, drawdown, P&L, exposure, diversification, and intelligence.">
      <PortfolioSections overview={selectPortfolioOverview()} />
    </WorkspacePage>
  )
}

