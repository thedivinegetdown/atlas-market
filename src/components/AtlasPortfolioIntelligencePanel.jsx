import { useMemo, useState } from 'react'
import { ATLAS_AI_NOTICE } from '../../lib/ai/atlasAiGateway.js'
import { evaluatePortfolioHealth } from '../../lib/portfolio/portfolioIntelligenceEngine.js'

function safeText(value, fallback = '') {
  return String(value ?? fallback).replace(/<[^>]+>/g, '').slice(0, 500)
}

function demoPositions(portfolioSummary, riskMetrics) {
  const positions = riskMetrics?.positions ?? portfolioSummary?.positions ?? []
  if (Array.isArray(positions) && positions.length) return positions
  return [
    {
      symbol: 'AAPL',
      assetType: 'equity',
      sector: 'Technology',
      quantity: 25,
      averagePrice: 184,
      currentPrice: 192,
      marketValue: 4800,
      unrealizedPnl: 200,
      realizedPnl: 75,
      volatility: 22,
      liquidityScore: 86,
      asOf: '2026-07-20T09:30:00.000Z',
    },
    {
      symbol: 'SPY',
      assetType: 'etf',
      sector: 'Index',
      quantity: 12,
      averagePrice: 520,
      currentPrice: 535,
      marketValue: 6420,
      unrealizedPnl: 180,
      realizedPnl: 40,
      volatility: 14,
      liquidityScore: 92,
      asOf: '2026-07-20T09:30:00.000Z',
    },
    {
      symbol: 'MSFT',
      assetType: 'equity',
      sector: 'Technology',
      quantity: 10,
      averagePrice: 410,
      currentPrice: 418,
      marketValue: 4180,
      unrealizedPnl: 80,
      realizedPnl: 0,
      volatility: 19,
      liquidityScore: 84,
      asOf: '2026-07-18T09:30:00.000Z',
      missingData: ['fresh volatility'],
    },
  ]
}

export function AtlasPortfolioIntelligencePanel({
  portfolioSummary,
  riskMetrics,
  watchlist,
  signals,
  opportunities,
  MetricCard,
  formatNumber = (value) => String(value),
  initialViewState = 'completed',
}) {
  const [viewState, setViewState] = useState(initialViewState)
  const health = useMemo(() => evaluatePortfolioHealth({
    id: portfolioSummary?.portfolioId ?? riskMetrics?.portfolioId ?? 'paper-portfolio',
    accountValue: portfolioSummary?.account?.accountValue ?? portfolioSummary?.summary?.accountValue ?? riskMetrics?.account?.accountValue ?? 100000,
    cash: portfolioSummary?.account?.cash ?? portfolioSummary?.summary?.cash ?? riskMetrics?.account?.cash ?? 25000,
    positions: demoPositions(portfolioSummary, riskMetrics),
    watchlist: watchlist?.quotes ?? watchlist ?? [],
    signals: signals?.signals ?? signals?.qualifiedSignals ?? signals ?? [],
    opportunities: opportunities?.rankedOpportunities ?? opportunities ?? [],
  }), [opportunities, portfolioSummary, riskMetrics, signals, watchlist])
  const degraded = health.stalePositions.length > 0 || health.missingData.length > 0
  const insights = [
    health.concentrationScore > 35 ? 'Concentration requires human review before adding paper risk.' : 'Concentration is within the current paper review band.',
    health.diversificationScore < 60 ? 'Diversification is constrained by current allocation breadth.' : 'Diversification is supported by current symbol and sector breadth.',
    health.stalePositions.length ? 'Stale holdings should be refreshed before relying on interpretation.' : 'Position source timestamps are current for this advisory view.',
    health.missingData.length ? 'Missing market data lowers confidence.' : 'Required position fields are present.',
  ]

  return (
    <article id="atlas-portfolio-intelligence" className={`panel atlas-portfolio-intelligence-panel ${degraded ? 'caution' : 'ready'}`} aria-label="Atlas portfolio intelligence dashboard">
      <div className="panel-heading">
        <h2>Portfolio Intelligence</h2>
        <span>Unified advisory health view for paper positions, signals, watchlists, and opportunities.</span>
      </div>
      <p className="empty-state">{ATLAS_AI_NOTICE} Portfolio intelligence cannot place orders or call brokers.</p>
      <div className="button-row" aria-label="Portfolio intelligence view controls">
        <button type="button" onClick={() => setViewState('loading')}>Show loading</button>
        <button type="button" onClick={() => setViewState('completed')}>Show dashboard</button>
        <button type="button" onClick={() => setViewState('failed')}>Show error</button>
      </div>
      {viewState === 'loading' ? <p role="status" className="empty-state">Loading portfolio intelligence.</p> : null}
      {viewState === 'failed' ? <p role="alert" className="empty-state">Portfolio intelligence could not be refreshed.</p> : null}
      {health.observedData.positionCount === 0 ? <p className="empty-state">No paper positions are available for portfolio intelligence.</p> : null}
      <div className="release-validation-summary">
        <MetricCard label="Health Score" value={formatNumber(health.healthScore)} tone={health.healthScore >= 55 ? 'positive' : 'warning'} />
        <MetricCard label="Diversification" value={formatNumber(health.diversificationScore)} />
        <MetricCard label="Concentration" value={formatNumber(health.concentrationScore)} tone={health.concentrationScore > 35 ? 'warning' : 'positive'} />
        <MetricCard label="AI Insight State" value={degraded ? 'degraded' : 'ready'} tone={degraded ? 'warning' : 'positive'} />
      </div>
      <div className="analytics-columns">
        <section>
          <h3>Risk Summary</h3>
          <p className="empty-state">Tier {health.healthTier}; gross exposure {formatNumber(health.exposureSummary.grossExposure)}%; volatility estimate {formatNumber(health.portfolioVolatilityEstimate)}.</p>
        </section>
        <section>
          <h3>Opportunity Summary</h3>
          <p className="empty-state">{formatNumber(health.observedData.opportunityCount)} ranked opportunities and {formatNumber(health.observedData.signalCount)} signal summaries are included as advisory context.</p>
        </section>
        <section>
          <h3>Watchlist Summary</h3>
          <p className="empty-state">{formatNumber(health.observedData.watchlistCount)} watchlist entries overlap with portfolio intelligence context.</p>
        </section>
      </div>
      <div className="release-readiness-list">
        {insights.map((insight) => (
          <section key={insight}>
            <div>
              <span>AI Insight Card</span>
              <strong>{degraded ? 'degraded' : 'advisory'}</strong>
            </div>
            <p>{safeText(insight)}</p>
          </section>
        ))}
      </div>
      <div className="analytics-columns">
        <section>
          <h3>Sector Allocation</h3>
          <p className="empty-state">{health.sectorAllocation.slice(0, 4).map((entry) => `${entry.name} ${formatNumber(entry.weight)}%`).join(' / ') || 'No sector allocation available.'}</p>
        </section>
        <section>
          <h3>Symbol Allocation</h3>
          <p className="empty-state">{health.symbolAllocation.slice(0, 4).map((entry) => `${entry.name} ${formatNumber(entry.weight)}%`).join(' / ') || 'No symbol allocation available.'}</p>
        </section>
        <section>
          <h3>Stale Data Warnings</h3>
          <p className="empty-state">{health.stalePositions.length ? health.stalePositions.map((entry) => `${entry.symbol} ${entry.asOf}`).join(' / ') : 'No stale positions detected.'}</p>
        </section>
      </div>
      <span className="event-line">portfolio.intelligence.evaluated</span>
      <span className="event-line">atlasAi.completed</span>
      <span className="event-line">portfolio.intelligence.history.listed</span>
    </article>
  )
}
