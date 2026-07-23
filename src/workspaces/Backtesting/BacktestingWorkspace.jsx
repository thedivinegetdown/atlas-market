import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { BacktestSections } from './backtestSections.jsx'

export default function BacktestingWorkspace() {
  return (
    <WorkspacePage title="Backtesting" description="Replay, backtesting, performance, walk-forward, and Monte Carlo review.">
      <BacktestSections />
    </WorkspacePage>
  )
}

