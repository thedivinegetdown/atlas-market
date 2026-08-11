import { useState } from 'react'
import { AlertsPanel, ScannerPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useScanners } from '../../hooks/useScanners.js'
import { useTradeQuality } from '../../hooks/useTradeQuality.js'
import { usePaperEvaluation } from '../../hooks/usePaperEvaluation.js'
import { usePaperOrderSimulation } from '../../hooks/usePaperOrderSimulation.js'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'

function display(value) {
  return String(value ?? 'UNKNOWN').replaceAll('_', ' ')
}

export function TradeQualityPanel({ candidate, state }) {
  const liveState = useTradeQuality(state ? null : candidate)
  const resolved = state ?? liveState
  const quality = resolved.quality
  return (
    <WorkspacePanel id="trade-quality" title="Trade Quality" subtitle="Deterministic, read-only opportunity review">
      {!candidate && !quality ? <EmptyWorkspaceState>Select Review quality on a scanner match. No score affects scanner order.</EmptyWorkspaceState> : null}
      {candidate && !quality && !resolved.isLoading && !resolved.error ? <button type="button" onClick={resolved.evaluate}>Evaluate {candidate.symbol}</button> : null}
      {resolved.isLoading ? <p role="status">Evaluating trade quality…</p> : null}
      {resolved.error ? <p role="alert">Trade quality is unavailable.</p> : null}
      {quality ? <>
        <MarketDataStatus provenance={quality.marketData} />
        <div className="metric-grid">
          <MetricCard label="Symbol" value={quality.symbol} />
          <MetricCard label="Score" value={quality.score == null ? 'Not scored' : `${quality.score}/100`} />
          <MetricCard label="Band" value={display(quality.band)} />
          <MetricCard label="Confidence" value={`${quality.confidence}%`} />
          <MetricCard label="Coverage" value={`${quality.evidenceCoverage}%`} />
          <MetricCard label="Freshness" value={display(quality.freshness)} />
        </div>
        <h3>Dimension breakdown</h3>
        <div className="metric-grid">{Object.entries(quality.dimensions ?? {}).map(([name, value]) => <MetricCard key={name} label={display(name)} value={value == null ? 'Missing' : value} />)}</div>
        {quality.reasons?.length ? <ul>{quality.reasons.slice(0, 5).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        {quality.missingInputs?.length || quality.blockingReasons?.length ? <details><summary>Evidence and blockers</summary>{quality.blockingReasons?.map((reason) => <p key={reason}>{reason}</p>)}{quality.missingInputs?.length ? <p>Missing: {quality.missingInputs.join(', ')}</p> : null}</details> : null}
        <p>Advisory only. Paper trading remains mandatory; this score cannot rank scanners, activate strategies, place orders, or override risk controls.</p>
      </> : null}
    </WorkspacePanel>
  )
}

export function PaperEvaluationPanel({ state } = {}) {
  const live = usePaperEvaluation(); const resolved = state ?? live
  return <WorkspacePanel id="paper-evaluation" title="Controlled Paper Evaluation" subtitle="Manual, bounded, evaluation only">
    <button type="button" onClick={resolved.run} disabled={resolved.isLoading}>{resolved.isLoading ? 'Evaluating…' : 'Run Paper Evaluation'}</button>
    {resolved.isLoading ? <p role="status">Evaluating up to five reviewed candidates…</p> : null}
    {resolved.error ? <p role="alert">Paper evaluation is unavailable.</p> : null}
    {resolved.evaluations?.map((item) => <article key={item.evaluationId} className="strategy-manager-card"><h3>{item.symbol} · {display(item.status)}</h3><MarketDataStatus provenance={item.marketData} /><p>{item.strategyId} · {item.tradeQuality?.score ?? 'No score'} {display(item.tradeQuality?.band)} · {item.tradeQuality?.confidence ?? 0}% confidence</p><p>Regime: {display(item.regime?.trendRegime)} · Risk: {display(item.riskSafety?.status)} · Freshness: {display(item.freshness)}</p>{item.blockers?.length ? <p>Blockers: {item.blockers.join(', ')}</p> : null}<p>Human paper review required. No order or portfolio action occurred.</p></article>)}
    {!resolved.isLoading && !resolved.error && resolved.evaluations?.length === 0 ? <EmptyWorkspaceState>No eligible reviewed candidates have been evaluated.</EmptyWorkspaceState> : null}
  </WorkspacePanel>
}

export function PaperSimulationPanel({ state }={}) {
  const live=usePaperOrderSimulation();const resolved=state??live
  return <WorkspacePanel id="paper-simulation" title="Guarded Paper Simulation" subtitle="Manual, kill-switched, PAPER ONLY">
    <p><strong>PAPER ONLY</strong> · Kill switch: {resolved.meta?.killSwitchEnabled?'ENABLED':'OFF / unknown'} · Cycle limit: {resolved.meta?.cycleLimit??3}</p>
    <button type="button" onClick={resolved.run} disabled={resolved.isLoading}>{resolved.isLoading?'Simulating…':'Simulate Approved Paper Trades'}</button>
    {resolved.isLoading?<p role="status">Revalidating risk and simulating up to three approved evaluations…</p>:null}
    {resolved.error?<p role="alert">Paper simulation is unavailable.</p>:null}
    {resolved.meta?.blocker?<p role="status">Blocked: {resolved.meta.blocker}</p>:null}
    {resolved.results?.map(item=><article key={`${item.evaluationId}-${item.status}`} className="strategy-manager-card"><h3>{item.symbol} · {display(item.status)}</h3><p>{item.strategyId} · Guardrail: {item.orderPlan?.guardrailResult?.approved?'APPROVED':display(item.orderPlan?.guardrailResult?.reason??'NOT RUN')}</p><p>{item.orderPlan?.quantity?`Quantity: ${item.orderPlan.quantity} · `:''}Simulation: {display(item.simulation?.fillStatus??item.status)}</p>{item.blockers?.length?<p>Blocker: {item.blockers[0]}</p>:null}<p>Simulated paper lifecycle only. No live broker or unattended execution.</p></article>)}
  </WorkspacePanel>
}

export function ScannerSections() {
  const scanners = useScanners()
  const [candidate, setCandidate] = useState(null)
  return (
    <>
      <WorkspacePanel id="signal-panel" title="Signal Panel" subtitle="Selected symbol signal context">
        <SignalPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="scanner" title="Scanner" subtitle="Configured scans and matches">
        <ScannerPanel scannersState={scanners} onReviewOpportunity={setCandidate} />
      </WorkspacePanel>
      <WorkspacePanel id="alerts" title="Alerts" subtitle="Opportunity alert rules">
        <AlertsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="opportunity-ranking" title="Opportunity Ranking" subtitle="Advisory ranking context">
        <div className="metric-grid">
          <MetricCard label="Candidates" value="scanner driven" />
          <MetricCard label="Ranking" value="advisory only" />
          <MetricCard label="Review" value="human gated" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="opportunity-review" title="Opportunity Review" subtitle="Safe review state">
        <EmptyWorkspaceState>No live trading actions are available from scanner opportunities.</EmptyWorkspaceState>
      </WorkspacePanel>
      <TradeQualityPanel candidate={candidate} />
      <PaperEvaluationPanel />
      <PaperSimulationPanel />
    </>
  )
}
