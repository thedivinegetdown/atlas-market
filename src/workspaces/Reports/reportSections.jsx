import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { usePaperPerformanceReview } from '../../hooks/usePaperPerformanceReview.js'

export function PaperPerformanceReviewPanel({state}={}){const live=usePaperPerformanceReview();const resolved=state??live,review=resolved.review;return <WorkspacePanel id="paper-performance-review" title="Paper Performance Review" subtitle="Deterministic strategy feedback · advisory only">
  {resolved.isLoading?<p role="status">Loading completed paper performance…</p>:null}{resolved.error?<p role="alert">Paper performance review is unavailable.</p>:null}
  {!resolved.isLoading&&!resolved.error&&!review?<EmptyWorkspaceState>No paper performance review is available.</EmptyWorkspaceState>:null}
  {review?<><p><strong>{String(review.status).replaceAll('_',' ')}</strong> · {review.sample.completedTrades} completed trades · Sample: {String(review.sample.status).replaceAll('_',' ')}</p><div className="metric-grid"><MetricCard label="Win Rate" value={`${review.performance.winRate}%`}/><MetricCard label="Expectancy" value={`$${review.performance.expectancyPerTrade}`}/><MetricCard label="Profit Factor" value={review.performance.profitFactor}/><MetricCard label="Net Realized P&L" value={`$${review.performance.netRealizedPnl}`}/><MetricCard label="Max Drawdown" value={`${review.performance.maximumDrawdownPct}%`}/><MetricCard label="Recent Trend" value={review.recentTrend}/></div>{review.sample.status==='INSUFFICIENT_SAMPLE'?<p role="status">Small sample: results cannot establish profitability or reliability.</p>:null}<h3>Deterministic feedback</h3><ul>{review.feedback.map(x=><li key={x}>{x}</li>)}</ul><details><summary>Strategy, quality, and regime evidence</summary><p>Strategies: {review.strategies.map(x=>`${x.value} (${x.sampleSize})`).join(', ')||'Insufficient data'}</p><p>Quality bands: {review.qualityBands.map(x=>`${x.value} (${x.sampleSize})`).join(', ')||'Insufficient data'}</p><p>Trend regimes: {review.trendRegimes.map(x=>`${x.value} (${x.sampleSize})`).join(', ')||'Insufficient data'}</p></details><p>PAPER ONLY · Advisory feedback only. No strategy, risk, scoring, or execution settings are changed.</p></>:null}
 </WorkspacePanel>}

export function ReportSections() {
  return (
    <>
      <WorkspacePanel id="paper-reports" title="Paper Reports" subtitle="Reporting outputs">
        <div className="metric-grid">
          <MetricCard label="Audit" value="available" />
          <MetricCard label="Exports" value="CSV / JSON" />
          <MetricCard label="History" value="paper mode" />
          <MetricCard label="Operator Reports" value="review" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="exports" title="Exports" subtitle="CSV and JSON">
        <EmptyWorkspaceState>Exports remain report artifacts only and do not change trading state.</EmptyWorkspaceState>
      </WorkspacePanel>
      <PaperPerformanceReviewPanel />
    </>
  )
}
