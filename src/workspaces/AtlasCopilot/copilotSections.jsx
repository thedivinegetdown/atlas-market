import { lazy } from 'react'
import { LazyFeature } from '../../components/LazyFeatureBoundary.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useDecisionIntelligence } from '../../hooks/useDecisionIntelligence.js'

const AtlasCopilotPanel = lazy(() => import('../../components/AtlasCopilotPanel.jsx').then((module) => ({
  default: module.AtlasCopilotPanel,
})))

const display = (value) => String(value ?? 'UNAVAILABLE').replaceAll('_', ' ')
export function ForwardObservationStatus({ observations = [] } = {}) {
  return <WorkspacePanel id="forward-observation" title="Forward Observation" subtitle="Read-only experiment status">
    {(observations ?? []).map((observation) => <section key={observation.experimentId} aria-label={`${observation.experimentId} observation status`}>
      <h3>{observation.strategyId === 'breakout-momentum-v1' ? 'Breakout Momentum' : observation.strategyId === 'range-mean-reversion-v1' ? 'Range Mean Reversion' : 'Pullback'}</h3>
      <p><strong>Experiment:</strong> {observation.experimentId} · <strong>Status:</strong> {display(observation.status)}</p>
      <p><strong>Sessions:</strong> {observation.sessionsElapsed ?? 0} / {observation.minimumSessions ?? 20} · <strong>Outcomes:</strong> {observation.completedOutcomes ?? 0} / {observation.minimumOutcomes ?? 30}</p>
      <p><strong>Strategy:</strong> {observation.strategyId ?? 'UNAVAILABLE'}{observation.reason ? ` · ${display(observation.reason)}` : ''}</p>
    </section>)}
  </WorkspacePanel>
}
export function RangeMeanReversionDecisionPanel({ plan } = {}) {
  const range = plan?.rangeMeanReversion
  if (!range) return null
  return <WorkspacePanel id="range-mean-reversion-decision" title="Range Mean Reversion" subtitle="Deterministic candidate evidence">
    <div className="metric-grid">
      <MetricCard label="Current Price" value={range.currentPrice ?? 'UNAVAILABLE'} /><MetricCard label="SMA20" value={range.sma20 ?? 'UNAVAILABLE'} /><MetricCard label="ATR Stretch" value={range.stretchAtr ?? 'UNAVAILABLE'} /><MetricCard label="Prior 20-session Low" value={range.prior20Low ?? 'UNAVAILABLE'} /><MetricCard label="ADX" value={range.adx14 ?? 'UNAVAILABLE'} /><MetricCard label="RSI" value={range.rsi14 ?? 'UNAVAILABLE'} /><MetricCard label="Relative Volume" value={range.relativeVolume ?? 'UNAVAILABLE'} /><MetricCard label="Relative Strength" value={range.relativeStrength ?? 'UNAVAILABLE'} /><MetricCard label="Market Participation" value={display(range.marketParticipation)} /><MetricCard label="Sector Alignment" value={display(range.sectorAlignment)} /><MetricCard label="Suitability" value={display(plan.strategy?.suitability)} /><MetricCard label="Decision" value={display(plan.decision?.status)} />
    </div>
    <p><strong>Entry:</strong> {plan.structure?.entry ?? 'UNAVAILABLE'} · <strong>Stop:</strong> {plan.structure?.stop ?? 'UNAVAILABLE'} · <strong>Target:</strong> {plan.structure?.target ?? 'UNAVAILABLE'} · <strong>R:R:</strong> {plan.structure?.rMultiple ?? 'UNAVAILABLE'} · <strong>Quantity:</strong> {plan.risk?.allowedQuantity ?? 0}</p>
  </WorkspacePanel>
}
export function DecisionIntelligenceSummary({ state } = {}) {
  const resolved = state ?? { intelligence: null, isLoading: false, error: null }; const intelligence = resolved.intelligence
  return <WorkspacePanel id="decision-intelligence" title="Atlas Decision Intelligence" subtitle="Canonical deterministic paper-trading snapshot">
    {resolved.isLoading ? <p role="status">Loading decision intelligence…</p> : null}{resolved.error ? <p role="alert">Decision intelligence is unavailable.</p> : null}
    {!resolved.isLoading && !resolved.error && !intelligence ? <EmptyWorkspaceState>No decision intelligence evidence is available.</EmptyWorkspaceState> : null}
    {intelligence ? <><p><strong>Market:</strong> {display(intelligence.market?.freshness)} · {display(intelligence.market?.status)} · <strong>Live execution disabled</strong></p><div className="metric-grid"><MetricCard label="Qualified" value={intelligence.opportunities?.qualifiedCount ?? 0}/><MetricCard label="WATCH" value={intelligence.opportunities?.watchCount ?? 0}/><MetricCard label="Decision Quality" value={display(intelligence.decisionQuality?.status)}/><MetricCard label="Recent Trend" value={display(intelligence.decisionQuality?.recentTrend)}/></div><section aria-label="Market intelligence"><h3>Market Intelligence</h3><p><strong>{intelligence.market?.context?.participation?.labels?.display ?? 'SECTOR ETF PARTICIPATION PROXY'}:</strong> {display(intelligence.market?.context?.participation?.status)}</p><p>Leaders: {(intelligence.market?.context?.sectorLeadership?.leaders ?? []).map((entry) => entry.symbol).join(', ') || 'Unavailable'} · Weakness: {(intelligence.market?.context?.sectorLeadership?.laggards ?? []).map((entry) => entry.symbol).join(', ') || 'Unavailable'}</p></section>{intelligence.opportunities?.emptyQualifiedState ? <EmptyWorkspaceState>NO QUALIFIED OPPORTUNITIES</EmptyWorkspaceState> : <ol>{(intelligence.opportunities?.topQualifiedPlans ?? []).map((plan) => <li key={plan.planReference?.planId}><strong>{plan.symbol}</strong> · {display(plan.side)} · {plan.strategyId} · score {plan.rankingScore} · {plan.portfolioEvidence?.status ?? 'portfolio evidence unavailable'}</li>)}</ol>}<p>WATCH: {(intelligence.opportunities?.watchPlans ?? []).map((plan) => plan.symbol).join(', ') || 'None'}.</p><p>Decision Quality: expectancy {intelligence.decisionQuality?.overall?.expectancy ?? 'unavailable'} · R {intelligence.decisionQuality?.rNormalized?.metrics?.averageR ?? 'UNAVAILABLE'} · empirical confidence {intelligence.evidence?.empiricalConfidence ?? 'UNAVAILABLE'}.</p><p>Portfolio evidence: {display(intelligence.portfolio?.exposure?.status)}. Provenance and freshness are preserved from deterministic upstream evidence.</p></> : null}
  </WorkspacePanel>
}

export function CopilotSections() {
  const decisionIntelligence = useDecisionIntelligence()
  return (
    <>
      <LazyFeature label="Atlas Copilot">
        <AtlasCopilotPanel atlasDecisionContext={decisionIntelligence.intelligence?.copilotContext} />
      </LazyFeature>
      <DecisionIntelligenceSummary state={decisionIntelligence} />
      <RangeMeanReversionDecisionPanel plan={decisionIntelligence.intelligence?.selectedDecision?.plan} />
      <ForwardObservationStatus observations={decisionIntelligence.intelligence?.observations} />
      <WorkspacePanel id="copilot-context" title="Context" subtitle="Safe advisory context">
        <div className="metric-grid">
          <MetricCard label="Portfolio Analysis" value="advisory" />
          <MetricCard label="Opportunity Review" value="human gated" />
          <MetricCard label="History" value="read only" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="safe-ai-advisory" title="Safe AI Advisory" subtitle="AI boundary">
        <EmptyWorkspaceState>Atlas Copilot cannot place orders, call brokers, or bypass paper-trading controls.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
