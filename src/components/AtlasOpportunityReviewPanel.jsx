import { useMemo, useState } from 'react'
import { ATLAS_AI_NOTICE } from '../../lib/ai/atlasAiGateway.js'
import { rankOpportunityCandidates } from '../../lib/ai/opportunityAnalysisEngine.js'

function safeText(value, fallback = '') {
  return String(value ?? fallback).replace(/<[^>]+>/g, '').slice(0, 500)
}

function buildDemoCandidates({ scannerSummaries, marketDataHealth } = {}) {
  const fallbackTimestamp = '2026-07-20T09:30:00.000Z'
  const scannerCandidates = scannerSummaries?.rankedCandidates ?? scannerSummaries?.candidates ?? []
  const candidates = Array.isArray(scannerCandidates) && scannerCandidates.length ? scannerCandidates : [
    {
      id: 'phase87-aapl-review',
      symbol: 'AAPL',
      asOf: fallbackTimestamp,
      category: 'momentum_pullback',
      direction: 'long_watch',
      thesis: 'Validated scanner context shows momentum, liquidity, and risk alignment for human review.',
      timeframe: 'swing',
      scannerScore: 84,
      strategyQualification: 'qualified',
      marketRegime: { regime: 'trending' },
      liquiditySummary: { status: 'healthy', spreadPct: 0.05 },
      riskSummary: { riskLevel: 'medium', score: 35 },
      dataQuality: { status: marketDataHealth?.marketDataScannerHealthStatus === 'degraded' ? 'partial' : 'healthy' },
      missingData: [],
      stale: marketDataHealth?.marketDataScannerHealthSummary?.staleSymbols > 0,
      invalidationConditions: ['Reassess if scanner score, liquidity, or risk quality deteriorates.'],
      signalSummary: 'Momentum and liquidity support a paper-review candidate.',
    },
    {
      id: 'phase87-msft-watch',
      symbol: 'MSFT',
      asOf: fallbackTimestamp,
      category: 'watchlist_prioritization',
      direction: 'neutral_watch',
      thesis: 'Candidate has partial evidence and requires more market-quality review.',
      timeframe: 'session',
      scannerScore: 63,
      strategyQualification: 'compatible',
      marketRegime: { regime: 'mixed' },
      liquiditySummary: { status: 'adequate' },
      riskSummary: { riskLevel: 'elevated', score: 55 },
      dataQuality: { status: 'partial' },
      missingData: ['recent volatility confirmation'],
      stale: false,
      invalidationConditions: ['Defer if risk score rises or data quality remains partial.'],
      signalSummary: 'Partial evidence supports watchlist review only.',
    },
  ]
  return candidates.slice(0, 6)
}

export function AtlasOpportunityReviewPanel({
  scannerSummaries,
  marketDataHealth,
  MetricCard,
  formatNumber = (value) => String(value),
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [reviewStates, setReviewStates] = useState({})
  const [status, setStatus] = useState('completed')
  const ranked = useMemo(() => rankOpportunityCandidates(buildDemoCandidates({ scannerSummaries, marketDataHealth }), {
    providerMetadata: {
      degraded: marketDataHealth?.marketDataScannerHealthStatus === 'degraded',
      fallbackUsed: false,
    },
    evaluation: { overallStatus: 'passed', warnings: marketDataHealth?.marketDataScannerHealthSummary?.staleSymbols > 0 ? ['stale_data_warning'] : [] },
  }), [marketDataHealth, scannerSummaries])
  const visible = ranked.slice(0, 5)

  function setReview(opportunityId, reviewState) {
    setReviewStates((current) => ({
      ...current,
      [opportunityId]: {
        reviewState,
        reviewedAt: new Date().toISOString(),
      },
    }))
    setStatus('review_updated')
  }

  const expiredCount = visible.filter((opportunity) => opportunity.dataFreshness.stale).length
  const degraded = marketDataHealth?.marketDataScannerHealthStatus === 'degraded'

  return (
    <article id="atlas-opportunity-review" className={`panel atlas-opportunity-review-panel ${degraded ? 'caution' : 'ready'}`} aria-label="Atlas opportunity review workflow">
      <div className="panel-heading">
        <h2>Opportunity Review</h2>
        <span>Ranked advisory opportunities for human paper-trading review.</span>
      </div>
      <p className="empty-state">{ATLAS_AI_NOTICE} Saving or dismissing only changes review metadata.</p>
      <div className="release-validation-summary">
        <MetricCard label="Ranked Opportunities" value={formatNumber(visible.length)} />
        <MetricCard label="Top Tier" value={visible[0]?.rankingTier ?? 'empty'} />
        <MetricCard label="Expired" value={formatNumber(expiredCount)} tone={expiredCount ? 'warning' : 'positive'} />
        <MetricCard label="Provider State" value={degraded ? 'degraded' : 'ready'} tone={degraded ? 'warning' : 'positive'} />
      </div>
      {status === 'loading' ? <p role="status" className="empty-state">Loading opportunity history.</p> : null}
      {status === 'failed' ? <p role="alert" className="empty-state">Opportunity review could not be loaded.</p> : null}
      {visible.length === 0 ? <p className="empty-state">No advisory opportunities are available for review.</p> : null}
      <div className="release-readiness-list">
        {visible.map((opportunity) => {
          const currentReview = reviewStates[opportunity.opportunityId]?.reviewState ?? (opportunity.dataFreshness.stale ? 'expired' : 'new')
          const expanded = expandedId === opportunity.opportunityId
          return (
            <section key={opportunity.opportunityId} aria-label={`${opportunity.symbol} opportunity review`}>
              <div className="guardrail-card-header">
                <div>
                  <span>{opportunity.symbol} / {opportunity.timeframe}</span>
                  <strong>{formatNumber(opportunity.rankingScore)} {opportunity.rankingTier}</strong>
                </div>
                <span className={`decision-pill ${opportunity.rankingTier === 'priority_review' ? 'positive' : opportunity.rankingTier === 'review' ? 'warning' : 'danger'}`}>{currentReview}</span>
              </div>
              <p className="empty-state">{safeText(opportunity.explainability.rankingRationale)}</p>
              <div className="analytics-columns">
                <section>
                  <h3>Supporting Factors</h3>
                  <p className="empty-state">{opportunity.explainability.positiveContributors.join(' / ') || 'No positive contributors available.'}</p>
                </section>
                <section>
                  <h3>Risk Factors</h3>
                  <p className="empty-state">{opportunity.explainability.negativeContributors.join(' / ') || 'No risk reductions applied.'}</p>
                </section>
                <section>
                  <h3>Freshness</h3>
                  <p className="empty-state">{opportunity.dataFreshness.label} / {opportunity.dataFreshness.sourceDataTimestamp}</p>
                </section>
              </div>
              <div className="button-row" aria-label={`${opportunity.symbol} review controls`}>
                <button type="button" onClick={() => setExpandedId(expanded ? null : opportunity.opportunityId)} aria-expanded={expanded} aria-controls={`${opportunity.opportunityId}-explainability`}>
                  {expanded ? 'Hide details' : 'Explain'}
                </button>
                <button type="button" onClick={() => setReview(opportunity.opportunityId, 'saved')} aria-label={`Save ${opportunity.symbol} for later human review`}>Save</button>
                <button type="button" onClick={() => setReview(opportunity.opportunityId, 'dismissed')} aria-label={`Dismiss ${opportunity.symbol} advisory opportunity`}>Dismiss</button>
              </div>
              {expanded ? (
                <div id={`${opportunity.opportunityId}-explainability`} className="analytics-columns">
                  <section>
                    <h3>Observed Evidence</h3>
                    <p className="empty-state">{opportunity.explainability.observedEvidence.join(' / ')}</p>
                  </section>
                  <section>
                    <h3>AI Interpretation</h3>
                    <p className="empty-state">{safeText(opportunity.explainability.modelInterpretation)}</p>
                  </section>
                  <section>
                    <h3>Limitations</h3>
                    <p className="empty-state">{opportunity.explainability.limitations.join(' / ')}</p>
                  </section>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
      <span className="event-line">atlasAi.opportunitiesRanked</span>
      <span className="event-line">atlasAi.opportunityReview.updated</span>
      <span className="event-line">atlasAi.opportunityHistory.listed</span>
    </article>
  )
}
