import { Fragment, useState, useCallback } from 'react'
import { AlertsPanel, ScannerPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useScanners } from '../../hooks/useScanners.js'
import { useTradeQuality } from '../../hooks/useTradeQuality.js'
import { usePaperEvaluation } from '../../hooks/usePaperEvaluation.js'
import { usePaperOrderSimulation } from '../../hooks/usePaperOrderSimulation.js'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'
import { workspaceApiClient } from '../../api/workspaceApiClient.js'
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
  const [queue, setQueue] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedStrategies, setSelectedStrategies] = useState({})
  const [showStrategySelection, setShowStrategySelection] = useState({})

  const { evaluateScanners } = useScanners()

  const FORWARD_OBSERVATION_SYMBOLS = new Set(BREAKOUT_OBSERVATION_UNIVERSE)

  const displayStrategyName = (strategyId) => {
    const names = {
      'index-pullback-v1': 'Index Pullback (EDGE.2)',
      'breakout-momentum-v1': 'Breakout Momentum (BREAKOUT.1)',
      'range-mean-reversion-v1': 'Range Mean Reversion (RANGE.1)',
      'volatility-expansion-v1': 'Volatility Expansion (VOL.1)',
    }
    return names[strategyId] || strategyId
  }

  const handlePrepareQueue = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setQueue([])
    setSelectedStrategies({})
    setShowStrategySelection({})

    try {
      // Step 1: Run authoritative scanner evaluation to get legitimate matches
      const scannerMatches = await evaluateScanners()

      // Step 2: Filter to only forward-observation universe symbols that are actual scanner matches
      const eligibleMatches = scannerMatches.filter((match) =>
        FORWARD_OBSERVATION_SYMBOLS.has(match.symbol)
      )

      if (eligibleMatches.length === 0) {
        setQueue([])
        setIsLoading(false)
        return
      }

      // Step 3: Evaluate trade quality for each legitimate match
      // Pass the full match as candidate to preserve scanner evidence, provenance, fingerprints
      const results = await Promise.all(
        eligibleMatches.map(async (match) => {
          try {
            const response = await workspaceApiClient.getTradeQuality({
              symbol: match.symbol,
              scannerSource: match.scannerName,
              opportunityId: match.scannerId ? `${match.scannerId}-${match.symbol}-${match.evaluatedAt}` : undefined,
              strategyId: match.strategyId, // may be undefined, getTradeQuality will evaluate all strategies
            })
            return {
              symbol: match.symbol,
              quality: response.quality ?? null,
              strategyAttribution: response.strategyAttribution ?? [],
              error: null,
              scannerMatch: match, // preserve original scanner evidence
            }
          } catch (err) {
            return {
              symbol: match.symbol,
              quality: null,
              strategyAttribution: [],
              error: err instanceof Error ? err.message : 'Evaluation failed',
              scannerMatch: match,
            }
          }
        })
      )
      setQueue(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare review queue')
    } finally {
      setIsLoading(false)
    }
  }, [evaluateScanners])

  const handleSelectStrategy = (symbol, strategyId) => {
    setSelectedStrategies(prev => ({ ...prev, [symbol]: strategyId }))
    setShowStrategySelection(prev => ({ ...prev, [symbol]: false }))
  }

  const handleSaveReview = async (symbol, item) => {
    const strategyId = selectedStrategies[symbol]
    if (!strategyId || !item.quality) return

    try {
      await workspaceApiClient.saveReviewedOpportunity({
        ...item.quality,
        strategyId,
        reviewState: 'saved',
        orderContext: item.quality.orderContext ?? null,
      })
      setQueue(prev => prev.map(i =>
        i.symbol === symbol ? { ...i, reviewSaved: true } : i
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review')
    }
  }

  const getPrimaryEligible = (item) => {
    const q = item.quality
    return q?.score != null && q?.opportunityId && q?.strategyId && q.strategyId !== 'strategy-unknown'
  }

  return (
    <WorkspacePanel id="governed-review-queue" title="Governed Review Queue" subtitle="Fixed forward-observation universe · Human review required">
      <div style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={handlePrepareQueue}
          disabled={isLoading}
          style={{ marginRight: '1rem' }}
        >
          {isLoading ? 'Preparing Queue…' : 'Prepare Governed Review'}
        </button>
        {queue.length > 0 && <span style={{ color: '#666', fontSize: '0.875rem' }}>
          {queue.length} legitimate scanner match{queue.length === 1 ? '' : 'es'} in forward-observation universe
        </span>}
      </div>

      {error && <p role="alert" style={{ color: 'var(--color-error, #c00)' }}>{error}</p>}

      {!isLoading && queue.length === 0 && !error && (
        <EmptyWorkspaceState>Click "Prepare Governed Review" to evaluate legitimate scanner matches in the forward-observation universe.</EmptyWorkspaceState>
      )}

      {isLoading && <p role="status">Evaluating scanner matches and trade quality…</p>}

      {queue.map((item, index) => (
        <article key={item.symbol} className="strategy-manager-card" style={{ marginBottom: '1rem' }}>
          <h3>{item.symbol}</h3>

          {item.error && (
            <p role="alert" style={{ color: 'var(--color-error, #c00)' }}>Error: {item.error}</p>
          )}

          {!item.error && !item.quality && (
            <p>No trade quality evidence available for this symbol.</p>
          )}

          {!item.error && item.quality && (
            <>
              <MarketDataStatus provenance={item.quality.marketData} />
              <div className="metric-grid">
                <MetricCard label="Score" value={item.quality.score == null ? 'Not scored' : `${item.quality.score}/100`} />
                <MetricCard label="Band" value={display(item.quality.band)} />
                <MetricCard label="Confidence" value={`${item.quality.confidence}%`} />
                <MetricCard label="Coverage" value={`${item.quality.evidenceCoverage}%`} />
                <MetricCard label="Freshness" value={display(item.quality.freshness)} />
                <MetricCard label="Primary Strategy" value={item.quality.strategyId ?? 'None'} />
              </div>

              {item.scannerMatch && (
                <details style={{ marginBottom: '0.5rem' }}>
                  <summary>Scanner Evidence</summary>
                  <div style={{ fontSize: '0.875rem' }}>
                    <p><strong>Scanner:</strong> {item.scannerMatch.scannerName} ({item.scannerMatch.scannerId})</p>
                    <p><strong>Matched Criteria:</strong> {item.scannerMatch.matchedCriteria?.join(', ') || 'N/A'}</p>
                    <p><strong>Evaluated At:</strong> {item.scannerMatch.evaluatedAt ? new Date(item.scannerMatch.evaluatedAt).toLocaleString() : 'N/A'}</p>
                    <p><strong>Provenance:</strong> {item.scannerMatch.marketData?.provider || 'Unknown'} · {item.scannerMatch.marketData?.dataStatus || 'Unknown'}</p>
                  </div>
                </details>
              )}

              {item.strategyAttribution.length === 0 && (
                <p style={{ color: 'var(--color-warning, #b80)' }}>
                  <strong>Zero Attribution:</strong> No strategies have deterministic evidence for this symbol.
                  Save Review is not available.
                </p>
              )}

              {item.strategyAttribution.length === 1 && (
                <>
                  <p><strong>Single Attribution: {displayStrategyName(item.strategyAttribution[0].strategyId)}</strong></p>
                  <p>Suitability: {item.strategyAttribution[0].suitabilityStatus} · TQ: {item.strategyAttribution[0].quality?.score ?? 'N/A'} {display(item.strategyAttribution[0].quality?.band)}</p>
                  {getPrimaryEligible(item) && !item.reviewSaved && (
                    <button
                      type="button"
                      onClick={() => handleSaveReview(item.symbol, item)}
                    >
                      Save Review
                    </button>
                  )}
                  {item.reviewSaved && <p style={{ color: 'green' }}>✓ Review saved</p>}
                </>
              )}

              {item.strategyAttribution.length > 1 && (
                <div className="strategy-selection">
                  <h4>Multiple Attributions — Select One</h4>
                  <p>Select exactly one strategy to review. Only strategies with deterministic evidence are shown.</p>
                  <ul>
                    {item.strategyAttribution.map((attr) => (
                      <li key={attr.strategyId}>
                        <label>
                          <input
                            type="radio"
                            name={`strategy-selection-${item.symbol}`}
                            value={attr.strategyId}
                            checked={selectedStrategies[item.symbol] === attr.strategyId}
                            onChange={() => handleSelectStrategy(item.symbol, attr.strategyId)}
                          />
                          <strong>{displayStrategyName(attr.strategyId)}</strong>
                          <span> · Suitability: {attr.suitabilityStatus}</span>
                          <span> · TQ: {attr.quality?.score ?? 'N/A'} {display(attr.quality?.band)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {selectedStrategies[item.symbol] && getPrimaryEligible(item) && !item.reviewSaved && (
                    <button
                      type="button"
                      onClick={() => handleSaveReview(item.symbol, item)}
                    >
                      Save Review for {displayStrategyName(selectedStrategies[item.symbol])}
                    </button>
                  )}
                  {selectedStrategies[item.symbol] && item.reviewSaved && <p style={{ color: 'green' }}>✓ Review saved</p>}
                </div>
              )}

              {item.quality.reasons?.length ? <details><summary>Supporting reasons</summary><ul>{item.quality.reasons.slice(0, 5).map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}
              {item.quality.missingInputs?.length || item.quality.blockingReasons?.length ? <details><summary>Evidence and blockers</summary>{item.quality.blockingReasons?.map((reason) => <p key={reason}>{reason}</p>)}{item.quality.missingInputs?.length ? <p>Missing: {item.quality.missingInputs.join(', ')}</p> : null}</details> : null}

              <p style={{ fontSize: '0.875rem', color: '#666' }}>
                Advisory only. Paper trading remains mandatory; this score cannot rank scanners, activate strategies,
                place orders, or override risk controls.
              </p>
            </>
          )}
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
