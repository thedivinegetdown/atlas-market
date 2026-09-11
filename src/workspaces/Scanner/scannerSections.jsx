import { Fragment, useState, useCallback, useEffect } from 'react'
import { AlertsPanel, ScannerPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useScanners } from '../../hooks/useScanners.js'
import { useTradeQuality } from '../../hooks/useTradeQuality.js'
import { usePaperEvaluation } from '../../hooks/usePaperEvaluation.js'
import { usePaperOrderSimulation } from '../../hooks/usePaperOrderSimulation.js'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'
import { workspaceApiClient } from '../../api/workspaceApiClient.js'
import { serverLogger } from '../../../lib/logging/logger.js'
import { BREAKOUT_OBSERVATION_UNIVERSE } from '../../../lib/opportunities/forwardTest/forwardObservationEngine.js'
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

export function GovernedReviewQueue() {
  const [preparationId, setPreparationId] = useState(null)
  const [preparationStatus, setPreparationStatus] = useState('idle')
  const [queueItems, setQueueItems] = useState([])
  const [error, setError] = useState(null)
  const [selectedStrategies, setSelectedStrategies] = useState({})
  const [pollInterval, setPollInterval] = useState(null)

  const displayStrategyName = (strategyId) => {
    const names = {
      'breakout-momentum-v1': 'Breakout Momentum (BREAKOUT.1)',
      'range-mean-reversion-v1': 'Range Mean Reversion (RANGE.1)',
      'volatility-expansion-v1': 'Volatility Expansion (VOL.1)',
    }
    return names[strategyId] || strategyId
  }

  const clearPolling = useCallback(() => {
    if (pollInterval) {
      clearInterval(pollInterval)
      setPollInterval(null)
    }
  }, [pollInterval])

  const handlePrepareQueue = useCallback(async () => {
    clearPolling()
    setError(null)
    setQueueItems([])
    setSelectedStrategies({})
    setPreparationStatus('preparing')

    try {
      const response = await workspaceApiClient.startGovernedReviewPreparation()
      if (!response.ok || !response.data?.preparationId) {
        throw new Error(response?.error?.message || 'Failed to start preparation')
      }
      const pid = response.data.preparationId
      setPreparationId(pid)
      setPreparationStatus('preparing')

      // Poll for completion
      const interval = setInterval(async () => {
        try {
          const statusResponse = await workspaceApiClient.getGovernedReviewPreparationStatus(pid)
          if (statusResponse.ok && statusResponse.data) {
            const { status, queueItems: items, error: prepError, providerCalls } = statusResponse.data
            setPreparationStatus(status)
            if (status === 'completed') {
              clearPolling()
              setQueueItems(items || [])
            } else if (status === 'failed') {
              clearPolling()
              setError(prepError || 'Preparation failed')
              setPreparationStatus('failed')
            }
          }
        } catch (err) {
          serverLogger?.warn?.('governed review status poll failed', { error: err?.message })
        }
      }, 3000)
      setPollInterval(interval)
    } catch (err) {
      clearPolling()
      setError(err instanceof Error ? err.message : 'Failed to start preparation')
      setPreparationStatus('failed')
    }
  }, [clearPolling])

  const handleSelectStrategy = useCallback((symbol, strategyId) => {
    setSelectedStrategies(prev => ({ ...prev, [symbol]: strategyId }))
  }, [])

  const handleSaveReview = useCallback(async (symbol, item) => {
    const strategyId = selectedStrategies[symbol]
    if (!strategyId || !item.quality) return

    try {
      await workspaceApiClient.saveReviewedOpportunity({
        ...item.quality,
        strategyId,
        reviewState: 'saved',
        orderContext: item.quality.orderContext ?? null,
      })
      setQueueItems(prev => prev.map(i =>
        i.symbol === symbol ? { ...i, reviewSaved: true } : i
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review')
    }
  }, [selectedStrategies])

  const getPrimaryEligible = useCallback((item) => {
    const q = item.quality
    return q?.score != null && q?.opportunityId && q?.strategyId && q.strategyId !== 'strategy-unknown'
  }, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => clearPolling()
  }, [clearPolling])

  return (
    <WorkspacePanel id="governed-review-queue" title="Governed Review Queue" subtitle="BREAKOUT.1 · RANGE.1 · VOL.1 · Human review required">
      <div style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={handlePrepareQueue}
          disabled={preparationStatus === 'preparing'}
          style={{ marginRight: '1rem' }}
        >
          {preparationStatus === 'preparing' ? 'Preparing…' : 'Prepare Governed Review'}
        </button>
        {preparationStatus === 'preparing' && <span style={{ color: '#666', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
          Acquiring evidence & evaluating strategies… (may take ≥60s cold)
        </span>}
        {preparationStatus === 'completed' && <span style={{ color: 'green', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
          Ready — {queueItems.length} governed match{queueItems.length === 1 ? '' : 'es'}
        </span>}
        {preparationStatus === 'failed' && <span style={{ color: 'var(--color-error, #c00)', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
          Failed — click to retry
        </span>}
      </div>

      {error && <p role="alert" style={{ color: 'var(--color-error, #c00)' }}>{error}</p>}

      {preparationStatus === 'idle' && (
        <EmptyWorkspaceState>Click "Prepare Governed Review" to evaluate BREAKOUT.1, RANGE.1, and VOL.1 strategies across the governed universe.</EmptyWorkspaceState>
      )}

      {preparationStatus === 'preparing' && (
        <p role="status">Acquiring shared market evidence and evaluating governed strategies…</p>
      )}

      {preparationStatus === 'completed' && queueItems.length === 0 && (
        <EmptyWorkspaceState>
          <strong>No governed strategy opportunities currently have deterministic evidence.</strong>
          <br />The governed strategies (BREAKOUT.1, RANGE.1, VOL.1) found no legitimate matches in the current market regime.
        </EmptyWorkspaceState>
      )}

      {queueItems.map((item) => (
        <article key={`${item.symbol}-${item.strategyId}`} className="strategy-manager-card" style={{ marginBottom: '1rem' }}>
          <h3>{item.symbol} — {displayStrategyName(item.strategyId)}</h3>

          <div className="metric-grid">
            <MetricCard label="TQ Score" value={item.quality?.score == null ? 'Not scored' : `${item.quality.score}/100`} />
            <MetricCard label="Band" value={item.quality?.band ? item.quality.band : 'N/A'} />
            <MetricCard label="Confidence" value={item.quality?.confidence != null ? `${item.quality.confidence}%` : 'N/A'} />
            <MetricCard label="Coverage" value={item.quality?.evidenceCoverage != null ? `${item.quality.evidenceCoverage}%` : 'N/A'} />
            <MetricCard label="Suitability" value={item.suitabilityStatus} />
            <MetricCard label="Regime" value={item.regime?.classification?.trendRegime ?? 'N/A'} />
          </div>

          <details style={{ marginBottom: '0.5rem' }}>
            <summary>Signal Details</summary>
            <div style={{ fontSize: '0.875rem' }}>
              <p><strong>Side:</strong> {item.signal?.side ?? 'N/A'}</p>
              <p><strong>Current Price:</strong> {item.signal?.currentPrice ?? 'N/A'}</p>
              <p><strong>Prior 20H:</strong> {item.signal?.prior20High ?? 'N/A'}</p>
              <p><strong>Prior 20L:</strong> {item.signal?.prior20Low ?? 'N/A'}</p>
              <p><strong>SMA20 / SMA50 / SMA200:</strong> {item.signal?.SMA20 ?? 'N/A'} / {item.signal?.SMA50 ?? 'N/A'} / {item.signal?.SMA200 ?? 'N/A'}</p>
              <p><strong>ADX / RSI / ATR:</strong> {item.signal?.ADX ?? 'N/A'} / {item.signal?.RSI ?? 'N/A'} / {item.signal?.ATR ?? 'N/A'}</p>
              <p><strong>ATR %ile / Rel Vol / Rel Str:</strong> {item.signal?.ATRPercentile ?? 'N/A'} / {item.signal?.relativeVolume ?? 'N/A'} / {item.signal?.relativeStrengthPct ?? 'N/A'}</p>
              <p><strong>Strategy Fingerprint:</strong> {item.signal?.strategyFingerprint ?? 'N/A'}</p>
            </div>
          </details>

          <details style={{ marginBottom: '0.5rem' }}>
            <summary>Regime & Provenance</summary>
            <div style={{ fontSize: '0.875rem' }}>
              <p><strong>Trend Regime:</strong> {item.regime?.classification?.trendRegime ?? 'N/A'}</p>
              <p><strong>Volatility Regime:</strong> {item.regime?.classification?.volatilityRegime ?? 'N/A'}</p>
              <p><strong>Risk Regime:</strong> {item.regime?.classification?.riskRegime ?? 'N/A'}</p>
              <p><strong>Regime Status:</strong> {item.regime?.classification?.status ?? 'N/A'}</p>
              <p><strong>Freshness:</strong> {item.regime?.freshness ?? 'N/A'}</p>
              <p><strong>Quote Provider:</strong> {item.provenance?.quote?.provider ?? 'N/A'} · {item.provenance?.quote?.dataStatus ?? 'N/A'}</p>
              <p><strong>Candles:</strong> {item.provenance?.candles?.candleCount ?? 'N/A'} · {item.provenance?.candles?.provider ?? 'N/A'}</p>
            </div>
          </details>

          {item.missingInputs?.length || item.blockingReasons?.length ? (
            <details style={{ marginBottom: '0.5rem' }}>
              <summary>Evidence Gaps</summary>
              {item.blockingReasons?.map((reason) => <p key={reason} style={{ color: 'var(--color-error, #c00)' }}>{reason}</p>)}
              {item.missingInputs?.length ? <p>Missing: {item.missingInputs.join(', ')}</p> : null}
            </details>
          ) : null}

          {getPrimaryEligible(item) && !item.reviewSaved && (
            <button
              type="button"
              onClick={() => handleSaveReview(item.symbol, item)}
              style={{ marginTop: '0.5rem' }}
            >
              Save Review
            </button>
          )}
          {item.reviewSaved && <p style={{ color: 'green', marginTop: '0.5rem' }}>✓ Review saved</p>}

          <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
            Advisory only. Paper trading remains mandatory; this score cannot rank scanners, activate strategies,
            place orders, or override risk controls.
          </p>
        </article>
      ))}
    </WorkspacePanel>
  )
}

export function TradeQualityPanel({ candidate, state }) {
  const liveState = useTradeQuality(state ? null : candidate)
  const resolved = state ?? liveState
  const quality = resolved.quality
  const strategyAttribution = resolved.strategyAttribution ?? []
  const [selectedStrategyId, setSelectedStrategyId] = useState(null)
  const [showStrategySelection, setShowStrategySelection] = useState(false)

  const candidateWithStrategy = selectedStrategyId
    ? { ...candidate, strategyId: selectedStrategyId }
    : candidate

  const evalState = useTradeQuality(candidateWithStrategy)
  const evalQuality = evalState.quality

  const handleEvaluate = async () => {
    if (!candidate?.symbol) return
    const result = await resolved.evaluate()
    if (result?.strategyAttribution?.length) {
      if (result.strategyAttribution.length === 1) {
        setSelectedStrategyId(result.strategyAttribution[0].strategyId)
        setShowStrategySelection(false)
      } else {
        setShowStrategySelection(true)
      }
    }
  }

  const handleSelectStrategy = (strategyId) => {
    setSelectedStrategyId(strategyId)
    setShowStrategySelection(false)
  }

  const handleReviewSelected = async () => {
    if (!selectedStrategyId || !candidate?.symbol) return
    await evalState.evaluate()
  }

  const displayStrategyName = (strategyId) => {
    const names = {
      'index-pullback-v1': 'Index Pullback (EDGE.2)',
      'breakout-momentum-v1': 'Breakout Momentum (BREAKOUT.1)',
      'range-mean-reversion-v1': 'Range Mean Reversion (RANGE.1)',
      'volatility-expansion-v1': 'Volatility Expansion (VOL.1)',
    }
    return names[strategyId] || strategyId
  }

  return (
    <WorkspacePanel id="trade-quality" title="Trade Quality" subtitle="Deterministic, read-only opportunity review">
      {!candidate && !quality ? <EmptyWorkspaceState>Select Review quality on a scanner match. No score affects scanner order.</EmptyWorkspaceState> : null}
      {candidate && !quality && !resolved.isLoading && !resolved.error && !showStrategySelection ? (
        <button type="button" onClick={handleEvaluate}>Evaluate {candidate.symbol}</button>
      ) : null}
      {resolved.isLoading ? <p role="status">Evaluating trade quality…</p> : null}
      {resolved.error ? <p role="alert">Trade quality is unavailable.</p> : null}
      {showStrategySelection && strategyAttribution.length > 0 && (
        <div className="strategy-selection">
          <h3>Attributed Strategies for {candidate.symbol}</h3>
          <p>Select one strategy to review. Only strategies with deterministic evidence are shown.</p>
          <ul>
            {strategyAttribution.map((attr) => (
              <li key={attr.strategyId}>
                <label>
                  <input
                    type="radio"
                    name="strategy-selection"
                    value={attr.strategyId}
                    checked={selectedStrategyId === attr.strategyId}
                    onChange={() => handleSelectStrategy(attr.strategyId)}
                  />
                  <strong>{displayStrategyName(attr.strategyId)}</strong>
                  <span> · Suitability: {attr.suitabilityStatus}</span>
                  <span> · TQ: {attr.quality?.score ?? 'N/A'} {display(attr.quality?.band)}</span>
                </label>
              </li>
            ))}
          </ul>
          {strategyAttribution.length === 0 && <p>No strategies have deterministic evidence for this candidate.</p>}
        </div>
      )}
      {selectedStrategyId && !showStrategySelection && (
        <>
          <p><strong>Reviewing: {displayStrategyName(selectedStrategyId)}</strong></p>
          <button type="button" onClick={() => setShowStrategySelection(true)}>Change strategy</button>
          <hr />
          {evalState.isLoading ? <p role="status">Evaluating trade quality…</p> : null}
          {evalState.error ? <p role="alert">Trade quality is unavailable.</p> : null}
          {evalQuality ? <>
            <MarketDataStatus provenance={evalQuality.marketData} />
            <div className="metric-grid">
              <MetricCard label="Symbol" value={evalQuality.symbol} />
              <MetricCard label="Score" value={evalQuality.score == null ? 'Not scored' : `${evalQuality.score}/100`} />
              <MetricCard label="Band" value={display(evalQuality.band)} />
              <MetricCard label="Confidence" value={`${evalQuality.confidence}%`} />
              <MetricCard label="Coverage" value={`${evalQuality.evidenceCoverage}%`} />
              <MetricCard label="Freshness" value={display(evalQuality.freshness)} />
            </div>
            <h3>Dimension breakdown</h3>
            <div className="metric-grid">{Object.entries(evalQuality.dimensions ?? {}).map(([name, value]) => <MetricCard key={name} label={display(name)} value={value == null ? 'Missing' : value} />)}</div>
            {evalQuality.reasons?.length ? <ul>{evalQuality.reasons.slice(0, 5).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            {evalQuality.missingInputs?.length || evalQuality.blockingReasons?.length ? <details><summary>Evidence and blockers</summary>{evalQuality.blockingReasons?.map((reason) => <p key={reason}>{reason}</p>)}{evalQuality.missingInputs?.length ? <p>Missing: {evalQuality.missingInputs.join(', ')}</p> : null}</details> : null}
            <button type="button" onClick={handleReviewSelected}>Save Review</button>
            <p>Advisory only. Paper trading remains mandatory; this score cannot rank scanners, activate strategies, place orders, or override risk controls.</p>
          </> : (
            <button type="button" onClick={handleReviewSelected}>Evaluate & Save Review</button>
          )}
        </>
      )}
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
      <GovernedReviewQueue />
      <TradeQualityPanel candidate={candidate} />
      <PaperEvaluationPanel />
      <PaperSimulationPanel />
    </>
  )
}
