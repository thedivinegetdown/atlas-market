import { Fragment, useState } from 'react'
import { AlertsPanel, ScannerPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useScanners } from '../../hooks/useScanners.js'
import { useTradeQuality } from '../../hooks/useTradeQuality.js'
import { usePaperEvaluation } from '../../hooks/usePaperEvaluation.js'
import { usePaperOrderSimulation } from '../../hooks/usePaperOrderSimulation.js'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'
import { composeQualifiedTradePlan, rankQualifiedTradePlans } from '../../../lib/opportunities/qualifiedTradePlan/index.js'

function display(value) {
  return String(value ?? 'UNKNOWN').replaceAll('_', ' ')
}

function value(numberValue) {
  return Number.isFinite(Number(numberValue)) ? Number(numberValue) : 'Unavailable'
}

export function QualifiedTradePlanCard({ evaluation }) {
  const plan = composeQualifiedTradePlan({ evaluation })
  return <article className="strategy-manager-card">
    <h3>Atlas Decision: {plan.symbol ?? 'Unknown'} · {display(plan.decision.status)}</h3>
    <MarketDataStatus provenance={plan.market.provenance} />
    <div className="metric-grid">
      <MetricCard label="Side" value={display(plan.side)} />
      <MetricCard label="Strategy" value={plan.strategyId ?? 'Unavailable'} />
      <MetricCard label="Regime" value={display(plan.regime.trendRegime)} />
      <MetricCard label="TQ" value={plan.quality.score == null ? 'Unavailable' : `${plan.quality.score} ${display(plan.quality.band)}`} />
      <MetricCard label="Entry" value={value(plan.structure.entry)} />
      <MetricCard label="Stop" value={value(plan.structure.stop)} />
      <MetricCard label="Target" value={value(plan.structure.target)} />
      <MetricCard label="R multiple" value={value(plan.structure.rMultiple)} />
      <MetricCard label="Allowed quantity" value={plan.risk.allowedQuantity} />
      <MetricCard label="Maximum planned loss" value={value(plan.risk.maximumPlannedLoss)} />
      <MetricCard label="Potential target gain" value={value(plan.risk.potentialTargetGain)} />
      <MetricCard label="Freshness" value={display(plan.market.freshness)} />
    </div>
    {plan.decision.supportingReasons.length ? <details><summary>Supporting evidence</summary><ul>{plan.decision.supportingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}
    {plan.decision.cautionReasons.length ? <details><summary>Caution and rejection evidence</summary><ul>{plan.decision.cautionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}
    <p>Provenance: {plan.market.provenance?.provider ?? 'Unavailable'} · Evidence: {plan.integrity.evidenceFingerprint ?? 'Unavailable'}</p>
    <p>Read-only decision package. Human paper review remains required; potential target gain is not expected or guaranteed profit.</p>
  </article>
}

export function QualifiedOpportunityRankingPanel({ plans = [] }) {
  const ranking = rankQualifiedTradePlans({ plans })
  return <section aria-label="Qualified opportunities">
    <h3>Qualified Opportunities</h3>
    {ranking.qualified.length === 0 ? <EmptyWorkspaceState>NO QUALIFIED OPPORTUNITIES</EmptyWorkspaceState> : <ol>{ranking.qualified.map((item) => <li key={item.planReference.planId}><strong>{item.symbol}</strong> · {display(item.side)} · {item.strategyId} · score {item.rankingScore} · {display(item.rankingBand)} · TQ {item.tradeQuality.score} · R {value(item.riskReward)} · {display(item.freshness)}</li>)}</ol>}
    <h3>Watchlist / Watch Candidates</h3>
    {ranking.watch.length === 0 ? <p>No WATCH candidates.</p> : <ul>{ranking.watch.map((item) => <li key={item.planReference.planId}><strong>{item.symbol}</strong> · score {item.rankingScore} · {item.cautionReasons.join(', ') || 'Conditional evidence requires review.'}</li>)}</ul>}
    <p>Portfolio exposure evidence: {display(ranking.portfolioEvidence.status)}. Ranking is advisory only and does not change plan status, quantity, or risk controls.</p>
  </section>
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
  const plans = (resolved.evaluations ?? []).map((evaluation) => composeQualifiedTradePlan({ evaluation }))
  return <WorkspacePanel id="paper-evaluation" title="Controlled Paper Evaluation" subtitle="Manual, bounded, evaluation only">
    <button type="button" onClick={resolved.run} disabled={resolved.isLoading}>{resolved.isLoading ? 'Evaluating…' : 'Run Paper Evaluation'}</button>
    {resolved.isLoading ? <p role="status">Evaluating up to five reviewed candidates…</p> : null}
    {resolved.error ? <p role="alert">Paper evaluation is unavailable.</p> : null}
    {resolved.evaluations?.map((item) => <Fragment key={item.evaluationId}><article className="strategy-manager-card"><h3>{item.symbol} · {display(item.status)}</h3><MarketDataStatus provenance={item.marketData} /><p>{item.strategyId} · {item.tradeQuality?.score ?? 'No score'} {display(item.tradeQuality?.band)} · {item.tradeQuality?.confidence ?? 0}% confidence</p><p>Regime: {display(item.regime?.trendRegime)} · Risk: {display(item.riskSafety?.status)} · Freshness: {display(item.freshness)}</p>{item.blockers?.length ? <p>Blockers: {item.blockers.join(', ')}</p> : null}<p>Human paper review required. No order or portfolio action occurred.</p></article><QualifiedTradePlanCard evaluation={item} /></Fragment>)}
    {!resolved.isLoading && !resolved.error ? <QualifiedOpportunityRankingPanel plans={plans} /> : null}
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
