import { useMemo, useState } from 'react'
import { useJournal } from '../hooks/useJournal.js'
import { useOrderEntry } from '../hooks/useOrderEntry.js'
import { useOrders } from '../hooks/useOrders.js'
import { usePositions } from '../hooks/usePositions.js'
import { usePortfolioAnalytics } from '../hooks/usePortfolioAnalytics.js'
import { useEquityCurve } from '../hooks/useEquityCurve.js'
import { useAlerts } from '../hooks/useAlerts.js'
import { useRisk } from '../hooks/useRisk.js'
import { useSignals } from '../hooks/useSignals.js'
import { useScanners } from '../hooks/useScanners.js'
import { useMarketOverview } from '../hooks/useMarketOverview.js'
import { useSystemHealth } from '../hooks/useSystemHealth.js'
import { useWatchlist } from '../hooks/useWatchlist.js'
import { useDecision } from '../hooks/useDecision.js'
import { createSignalEngine } from '../../lib/signals/signalEngine.js'
import { ErrorDisplay } from './ErrorDisplay.jsx'

const signalEngine = createSignalEngine()

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
}

function formatPercent(value) {
  return `${Number(value ?? 0).toFixed(2)}%`
}

function formatTimestamp(value) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString()
}

function getTrendDirection(quote) {
  const changePercent = Number(quote?.changePercent ?? 0)
  if (changePercent > 0) return 'Up'
  if (changePercent < 0) return 'Down'
  return 'Flat'
}

function EmptyState({ label }) {
  return <p className="empty-state">{label}</p>
}

function StateMessage({ type = 'empty', children }) {
  if (type === 'error') {
    return <ErrorDisplay message={children} />
  }

  return <p className={`${type}-state`} role={type === 'error' ? 'alert' : 'status'}>{children}</p>
}

const defaultPanelQuote = {
  symbol: 'SPY',
  price: 100,
  open: 99.5,
  high: 101,
  low: 99,
  previousClose: 99.7,
  change: 0.3,
  changePercent: 0.3,
  volume: 1000000,
  updatedAt: new Date().toISOString(),
}

export function WatchlistPanel({
  quotes,
  selectedSymbol,
  onSelectSymbol,
  refreshing,
  loading,
  error,
  onRefresh,
  sortKey: initialSortKey = 'symbol',
  sortDirection = 'asc',
}) {
  const fallback = useWatchlist()
  const hasControlledQuotes = quotes !== undefined
  const resolvedQuotes = quotes ?? fallback.quotes
  const resolvedSelected = selectedSymbol ?? fallback.selectedSymbol
  const resolvedLoading = loading ?? (!hasControlledQuotes && fallback.isLoading)
  const resolvedRefreshing = refreshing ?? (!hasControlledQuotes && fallback.isRefreshing)
  const resolvedError = error ?? (!hasControlledQuotes ? fallback.error : null)
  const resolvedOnRefresh = onRefresh ?? fallback.refresh
  const resolvedOnSelect = onSelectSymbol ?? fallback.setSelectedSymbol
  const [sortKey, setSortKey] = useState(initialSortKey)
  const [direction, setDirection] = useState(sortDirection)

  const displayQuotes = useMemo(() => {
    return [...(resolvedQuotes ?? [])].sort((left, right) => {
      const leftValue = sortKey === 'symbol' ? left?.symbol ?? '' : Number(left?.[sortKey] ?? 0)
      const rightValue = sortKey === 'symbol' ? right?.symbol ?? '' : Number(right?.[sortKey] ?? 0)
      const result = typeof leftValue === 'string'
        ? leftValue.localeCompare(rightValue)
        : leftValue - rightValue

      return direction === 'asc' ? result : -result
    })
  }, [direction, resolvedQuotes, sortKey])

  const quotesWithSignals = useMemo(() => {
    return displayQuotes.map((quote) => ({
      ...quote,
      signal: signalEngine.evaluateQuote(quote),
      trendDirection: getTrendDirection(quote),
    }))
  }, [displayQuotes])

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Watchlist</h3>
          <p>Live symbols from the market data layer</p>
        </div>
        <div className="panel-actions-right">
          <label className="inline-control">
            <span>Sort</span>
            <select
              aria-label="Sort watchlist"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
            >
              <option value="symbol">Symbol</option>
              <option value="price">Price</option>
              <option value="changePercent">Change %</option>
              <option value="volume">Volume</option>
            </select>
          </label>
          <button
            type="button"
            aria-label={`Sort watchlist ${direction === 'asc' ? 'descending' : 'ascending'}`}
            onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
          >
            {direction === 'asc' ? 'Ascending' : 'Descending'}
          </button>
          <button type="button" aria-label="Refresh watchlist" onClick={resolvedOnRefresh}>
            {resolvedRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="table-card">
        <table>
          <caption>Watchlist market data</caption>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last price</th>
              <th>Daily %</th>
              <th>Daily $</th>
              <th>Volume</th>
              <th>Trend</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {quotesWithSignals.map((quote) => (
              <tr
                key={quote.symbol}
                className={quote.symbol === resolvedSelected ? 'active-row' : ''}
                onClick={() => resolvedOnSelect(quote.symbol)}
              >
                <td>
                  <button type="button" className="symbol-button" onClick={() => resolvedOnSelect(quote.symbol)}>
                    {quote.symbol}
                  </button>
                </td>
                <td>{formatCurrency(quote.price)}</td>
                <td className={Number(quote.changePercent ?? 0) >= 0 ? 'positive' : 'negative'}>
                  {formatPercent(quote.changePercent)}
                </td>
                <td className={Number(quote.change ?? 0) >= 0 ? 'positive' : 'negative'}>
                  {formatCurrency(quote.change)}
                </td>
                <td>{formatNumber(quote.volume)}</td>
                <td>{quote.trendDirection}</td>
                <td><span className={`signal-badge ${quote.signal.action.toLowerCase()}`}>{quote.signal.action}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {resolvedLoading && quotesWithSignals.length === 0 ? <StateMessage>Loading watchlist quotes...</StateMessage> : null}
        {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
        {!resolvedLoading && !resolvedError && quotesWithSignals.length === 0 ? <EmptyState label="No watchlist symbols available." /> : null}
      </div>
    </div>
  )
}

export function MarketOverviewPanel({
  symbol,
  quote,
  regime,
  loading,
  refreshing,
  error,
  onRefresh,
}) {
  const fallback = useMarketOverview({ symbol: symbol ?? quote?.symbol, initialQuote: quote })
  const selectedQuote = quote ?? fallback.quote
  const selectedRegime = regime ?? fallback.regime
  const resolvedLoading = loading ?? fallback.isLoading
  const resolvedRefreshing = refreshing ?? fallback.isRefreshing
  const resolvedError = error ?? fallback.error
  const refresh = onRefresh ?? fallback.refresh

  if (!symbol && !selectedQuote) {
    return (
      <div className="panel-stack">
        <h3>Market Overview</h3>
        <EmptyState label="Select a symbol to view market details." />
      </div>
    )
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Market Overview</h3>
          <p>{selectedQuote?.symbol ?? symbol}</p>
        </div>
        <button type="button" aria-label={`Refresh ${selectedQuote?.symbol ?? symbol} market overview`} onClick={refresh}>
          {resolvedRefreshing ? 'Refreshing...' : 'Refresh selected'}
        </button>
      </div>
      {resolvedLoading && !selectedQuote ? <StateMessage>Loading market overview...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      <div className="metric-grid">
        <article><span>Active Symbol</span><strong>{selectedQuote?.symbol ?? symbol}</strong></article>
        <article><span>Current Price</span><strong>{formatCurrency(selectedQuote?.price)}</strong></article>
        <article><span>Bid</span><strong>{formatCurrency(selectedQuote?.bid ?? selectedQuote?.price)}</strong></article>
        <article><span>Ask</span><strong>{formatCurrency(selectedQuote?.ask ?? selectedQuote?.price)}</strong></article>
        <article><span>Open</span><strong>{formatCurrency(selectedQuote?.open)}</strong></article>
        <article><span>High</span><strong>{formatCurrency(selectedQuote?.high)}</strong></article>
        <article><span>Low</span><strong>{formatCurrency(selectedQuote?.low)}</strong></article>
        <article><span>Previous Close</span><strong>{formatCurrency(selectedQuote?.previousClose)}</strong></article>
        <article><span>Volume</span><strong>{formatNumber(selectedQuote?.volume)}</strong></article>
        <article><span>ATR</span><strong>{selectedQuote?.atr == null ? 'N/A' : formatNumber(selectedQuote.atr)}</strong></article>
        <article><span>Volatility</span><strong>{selectedQuote?.volatility == null ? 'N/A' : formatPercent(selectedQuote.volatility)}</strong></article>
        <article><span>Last Updated</span><strong>{formatTimestamp(selectedQuote?.updatedAt)}</strong></article>
      </div>
      <MarketRegimeSummary regime={selectedRegime} loading={resolvedLoading} error={resolvedError} />
    </div>
  )
}

function formatRegime(value) {
  return String(value ?? 'UNKNOWN').replaceAll('_', ' ')
}

export function MarketRegimeSummary({ regime, loading = false, error = null }) {
  const classification = regime?.classification
  if (loading && !regime) return <section className="regime-summary" aria-labelledby="regime-heading"><h4 id="regime-heading">Market Regime</h4><StateMessage>Loading regime context...</StateMessage></section>
  if (error && !regime) return <section className="regime-summary" aria-labelledby="regime-heading"><h4 id="regime-heading">Market Regime</h4><StateMessage type="error">Regime context unavailable.</StateMessage></section>
  if (!regime) return null
  const details = [
    ['Missing', regime.inputCoverage?.missing], ['Stale', regime.inputCoverage?.stale],
    ['Incompatible', regime.inputCoverage?.incompatible], ['Invalid', regime.inputCoverage?.invalid],
  ].filter(([, values]) => values?.length)
  return (
    <section className="regime-summary" aria-labelledby="regime-heading">
      <div className="regime-summary__header">
        <div><h4 id="regime-heading">Market Regime</h4><p>Deterministic, read-only market context</p></div>
        <span className="status-pill" role="status">{formatRegime(classification?.status)}</span>
      </div>
      <div className="metric-grid regime-summary__metrics">
        <article><span>Trend</span><strong>{formatRegime(classification?.trendRegime)}</strong></article>
        <article><span>Volatility</span><strong>{formatRegime(classification?.volatilityRegime)}</strong></article>
        <article><span>Risk</span><strong>{formatRegime(classification?.riskRegime)}</strong></article>
        <article><span>Confidence</span><strong>{classification?.confidence ?? 0}%</strong></article>
        <article><span>Freshness</span><strong>{formatRegime(regime.freshness)}</strong></article>
        <article><span>As of</span><strong>{formatTimestamp(regime.asOf)}</strong></article>
      </div>
      {classification?.reasons?.length ? <ul className="regime-summary__reasons">{classification.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {details.length || regime.warnings?.length ? (
        <details><summary>Input coverage details</summary>
          {details.map(([label, values]) => <p key={label}><strong>{label}:</strong> {values.join(', ')}</p>)}
          {regime.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
        </details>
      ) : null}
      <p className="regime-summary__boundary">Context only. Paper trading remains enabled; Atlas Copilot remains advisory.</p>
    </section>
  )
}

export function SymbolOverviewPanel(props) {
  return <MarketOverviewPanel {...props} />
}

export function SignalPanel({
  signal,
  symbol,
  loading,
  refreshing,
  error,
  onRefresh,
}) {
  const fallback = useSignals(defaultPanelQuote)
  const hasControlledSignal = signal !== undefined || symbol !== undefined || loading !== undefined || error !== undefined
  const resolvedSignal = hasControlledSignal ? signal : fallback.signal
  const activeSymbol = symbol ?? resolvedSignal?.symbol
  const resolvedLoading = loading ?? (!hasControlledSignal && fallback.isLoading)
  const resolvedRefreshing = refreshing ?? (!hasControlledSignal && fallback.isRefreshing)
  const resolvedError = error ?? (!hasControlledSignal ? fallback.error : null)
  const refresh = onRefresh ?? (!hasControlledSignal ? fallback.refresh : undefined)

  if (!activeSymbol && !resolvedSignal) {
    return (
      <div className="panel-stack">
        <h3>Signal Panel</h3>
        <EmptyState label="Select a symbol to calculate signal metrics." />
      </div>
    )
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Signal Panel</h3>
          <p>{activeSymbol}</p>
        </div>
        {refresh ? (
          <button type="button" aria-label={`Refresh ${activeSymbol} signal`} onClick={refresh}>
            {resolvedRefreshing ? 'Refreshing...' : 'Refresh signal'}
          </button>
        ) : null}
      </div>
      {resolvedLoading && !resolvedSignal ? <StateMessage>Loading signal metrics...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      {resolvedSignal ? (
        <>
          <div className={`signal-card ${resolvedSignal.action?.toLowerCase() ?? 'hold'}`}>
            <span>Overall Signal</span>
            <strong>{resolvedSignal.action ?? 'HOLD'}</strong>
            <p>{resolvedSignal.thesis ?? 'Awaiting market data.'}</p>
          </div>
          <div className="metric-grid">
            <article><span>Active Symbol</span><strong>{activeSymbol}</strong></article>
            <article><span>Confidence</span><strong>{formatNumber(resolvedSignal.confidence)}</strong></article>
            <article><span>Trend Direction</span><strong>{resolvedSignal.trendDirection ?? 'Flat'}</strong></article>
            <article><span>Momentum</span><strong>{formatNumber(resolvedSignal.momentum)}</strong></article>
            <article><span>Breakout Status</span><strong>{resolvedSignal.breakout ?? 'Contained'}</strong></article>
            <article><span>Mean Reversion</span><strong>{resolvedSignal.meanReversion ?? 'Balanced'}</strong></article>
            <article><span>Bull Score</span><strong>{formatNumber(resolvedSignal.bullScore)}</strong></article>
            <article><span>Bear Score</span><strong>{formatNumber(resolvedSignal.bearScore)}</strong></article>
            <article><span>Signal Strength</span><strong>{formatNumber(resolvedSignal.strength)}</strong></article>
            <article><span>Last Calculated</span><strong>{formatTimestamp(resolvedSignal.updatedAt)}</strong></article>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function RiskPanel({
  risk,
  symbol,
  loading,
  refreshing,
  error,
  onRefresh,
}) {
  const fallback = useRisk({ quote: defaultPanelQuote })
  const hasControlledRisk = risk !== undefined || symbol !== undefined || loading !== undefined || error !== undefined
  const resolvedRisk = hasControlledRisk ? risk : fallback.risk
  const activeSymbol = symbol ?? resolvedRisk?.symbol
  const resolvedLoading = loading ?? (!hasControlledRisk && fallback.isLoading)
  const resolvedRefreshing = refreshing ?? (!hasControlledRisk && fallback.isRefreshing)
  const resolvedError = error ?? (!hasControlledRisk ? fallback.error : null)
  const refresh = onRefresh ?? (!hasControlledRisk ? fallback.refresh : undefined)

  if (!activeSymbol && !resolvedRisk) {
    return (
      <div className="panel-stack">
        <h3>Risk Panel</h3>
        <EmptyState label="Select a symbol to calculate trade risk." />
      </div>
    )
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Risk Panel</h3>
          <p>{activeSymbol}</p>
        </div>
        {refresh ? (
          <button type="button" aria-label={`Refresh ${activeSymbol} risk`} onClick={refresh}>
            {resolvedRefreshing ? 'Refreshing...' : 'Refresh risk'}
          </button>
        ) : null}
      </div>
      {resolvedLoading && !resolvedRisk ? <StateMessage>Loading risk metrics...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      {resolvedRisk?.warning ? <p className="risk-warning">Risk warning: {resolvedRisk.warning}</p> : null}
      {resolvedRisk ? (
        <div className="metric-grid">
          <article><span>Active Symbol</span><strong>{activeSymbol}</strong></article>
          <article><span>Account Value</span><strong>{formatCurrency(resolvedRisk.accountValue)}</strong></article>
          <article><span>Max Risk Per Trade</span><strong>{formatPercent(resolvedRisk.maxRiskPerTrade)}</strong></article>
          <article><span>Position Size</span><strong>{formatNumber(resolvedRisk.positionSize)}</strong></article>
          <article><span>Stop Distance</span><strong>{formatCurrency(resolvedRisk.stopDistance)}</strong></article>
          <article><span>Stop Price</span><strong>{formatCurrency(resolvedRisk.stopPrice)}</strong></article>
          <article><span>Target Price</span><strong>{formatCurrency(resolvedRisk.targetPrice)}</strong></article>
          <article><span>Risk / Reward</span><strong>{formatNumber(resolvedRisk.rewardRatio)}</strong></article>
          <article><span>Dollar Risk</span><strong>{formatCurrency(resolvedRisk.dollarRisk)}</strong></article>
          <article><span>Account Exposure</span><strong>{formatPercent(resolvedRisk.accountExposure)}</strong></article>
          <article><span>Daily Exposure</span><strong>{formatPercent(resolvedRisk.dailyExposure)}</strong></article>
          <article><span>Portfolio Risk</span><strong>{formatPercent(resolvedRisk.portfolioRisk)}</strong></article>
          <article><span>Buying Power Impact</span><strong>{formatPercent(resolvedRisk.buyingPowerImpact)}</strong></article>
          <article><span>Status</span><strong>{resolvedRisk.approved ? 'Approved' : 'Blocked'}</strong></article>
        </div>
      ) : null}
    </div>
  )
}

export function DecisionPanel({
  decision,
  assetProfile,
  symbol,
  loading,
  refreshing,
  error,
  onRefresh,
}) {
  const fallback = useDecision(symbol)
  const hasControlledDecision = decision !== undefined || loading !== undefined || error !== undefined
  const resolvedDecision = hasControlledDecision ? decision : fallback.decision
  const resolvedAssetProfile = assetProfile ?? fallback.assetProfile
  const activeSymbol = symbol ?? fallback.activeSymbol
  const resolvedLoading = loading ?? (!hasControlledDecision && fallback.isLoading)
  const resolvedRefreshing = refreshing ?? (!hasControlledDecision && fallback.isRefreshing)
  const resolvedError = error ?? (!hasControlledDecision ? fallback.error : null)
  const refresh = onRefresh ?? (!hasControlledDecision ? fallback.refresh : undefined)
  const actionClass = String(resolvedDecision?.recommendedAction ?? 'neutral').replace('_', '-')

  if (!activeSymbol) {
    return (
      <div className="panel-stack">
        <h3>Decision Intelligence</h3>
        <EmptyState label="Select a symbol to evaluate trade quality." />
      </div>
    )
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Decision Intelligence</h3>
          <p>{activeSymbol}</p>
        </div>
        {refresh ? (
          <button type="button" aria-label={`Refresh ${activeSymbol} decision intelligence`} onClick={refresh}>
            {resolvedRefreshing ? 'Refreshing...' : 'Refresh decision'}
          </button>
        ) : null}
      </div>
      {resolvedLoading && !resolvedDecision ? <StateMessage>Loading decision intelligence...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      {!resolvedLoading && !resolvedError && !resolvedDecision ? <EmptyState label="No decision available for this symbol." /> : null}
      {resolvedDecision ? (
        <>
          <div className={`signal-card ${actionClass}`}>
            <span>Overall Decision</span>
            <strong>{resolvedDecision.overallDecision}</strong>
            <p>{resolvedDecision.confidenceExplanation}</p>
          </div>
          <div className="metric-grid">
            <article><span>Overall Score</span><strong>{formatNumber(resolvedDecision.overallScore)}</strong></article>
            <article><span>Confidence</span><strong>{formatPercent(resolvedDecision.confidence)}</strong></article>
            <article><span>Trend Score</span><strong>{formatNumber(resolvedDecision.trendScore)}</strong></article>
            <article><span>Momentum Score</span><strong>{formatNumber(resolvedDecision.momentumScore)}</strong></article>
            <article><span>Risk Score</span><strong>{formatNumber(resolvedDecision.riskScore)}</strong></article>
            <article><span>Volatility Score</span><strong>{formatNumber(resolvedDecision.volatilityScore)}</strong></article>
            <article><span>Liquidity Score</span><strong>{formatNumber(resolvedDecision.liquidityScore)}</strong></article>
            <article><span>Exposure Score</span><strong>{formatNumber(resolvedDecision.portfolioExposureScore)}</strong></article>
            <article><span>Position Size</span><strong>{formatNumber(resolvedDecision.recommendedPositionSize)} {resolvedAssetProfile?.quantityLabel ?? 'shares'}</strong></article>
            <article><span>Recommended Stop</span><strong>{formatCurrency(resolvedDecision.recommendedStop)}</strong></article>
            <article><span>Recommended Target</span><strong>{formatCurrency(resolvedDecision.recommendedTarget)}</strong></article>
            <article><span>Risk / Reward</span><strong>{formatNumber(resolvedDecision.riskRewardRatio)}</strong></article>
          </div>
          <div className="insight-columns">
            <section>
              <h4>Positive Factors</h4>
              {resolvedDecision.positiveFactors?.length ? (
                <ul>{resolvedDecision.positiveFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
              ) : <EmptyState label="No dominant positive factors." />}
            </section>
            <section>
              <h4>Negative Factors</h4>
              {resolvedDecision.negativeFactors?.length ? (
                <ul>{resolvedDecision.negativeFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
              ) : <EmptyState label="No dominant negative factors." />}
            </section>
            <section>
              <h4>Warnings</h4>
              {resolvedDecision.warnings?.length ? (
                <ul>{resolvedDecision.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              ) : <EmptyState label="No active warnings." />}
            </section>
          </div>
          <p className="timestamp-line">Last evaluated {formatTimestamp(resolvedDecision.timestamp)}</p>
        </>
      ) : null}
    </div>
  )
}

export function PortfolioSummaryPanel({ summary, loading, error }) {
  const fallback = usePortfolioAnalytics()
  const resolvedSummary = summary ?? fallback.summary
  const resolvedLoading = loading ?? fallback.isLoading
  const resolvedError = error ?? fallback.error

  return (
    <div className="panel-stack">
      <h3>Portfolio Summary</h3>
      {resolvedLoading ? <StateMessage>Loading portfolio summary...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      <div className="metric-grid large-grid">
        <article><span>Account Value</span><strong>{formatCurrency(resolvedSummary.accountValue)}</strong></article>
        <article><span>Cash</span><strong>{formatCurrency(resolvedSummary.cash)}</strong></article>
        <article><span>Buying Power</span><strong>{formatCurrency(resolvedSummary.buyingPower)}</strong></article>
        <article><span>Daily Return</span><strong>{formatPercent(resolvedSummary.dailyReturn)}</strong></article>
        <article><span>Total Return</span><strong>{formatPercent(resolvedSummary.totalReturn)}</strong></article>
        <article><span>Win Rate</span><strong>{formatPercent(resolvedSummary.winRate)}</strong></article>
        <article><span>Average Winner</span><strong>{formatCurrency(resolvedSummary.averageWinner)}</strong></article>
        <article><span>Average Loser</span><strong>{formatCurrency(resolvedSummary.averageLoser)}</strong></article>
        <article><span>Profit Factor</span><strong>{formatNumber(resolvedSummary.profitFactor)}</strong></article>
        <article><span>Sharpe Ratio</span><strong>{formatNumber(resolvedSummary.sharpeRatio)}</strong></article>
        <article><span>Max Drawdown</span><strong>{formatPercent(resolvedSummary.maxDrawdown)}</strong></article>
        <article><span>Expectancy</span><strong>{formatCurrency(resolvedSummary.expectancy)}</strong></article>
        <article><span>Largest Winner</span><strong>{formatCurrency(resolvedSummary.largestWinner)}</strong></article>
        <article><span>Largest Loser</span><strong>{formatCurrency(resolvedSummary.largestLoser)}</strong></article>
        <article><span>Open Risk</span><strong>{formatCurrency(resolvedSummary.openRisk)}</strong></article>
      </div>
    </div>
  )
}

function buildChartPoints(points, width, height) {
  if (!points.length) return ''
  const values = points.map((point) => Number(point.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)

  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
    const y = height - (((Number(point.value) - min) / range) * height)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function buildDrawdownBars(drawdowns, height) {
  const maxDrawdown = Math.max(1, ...drawdowns.map((point) => Number(point.value)))
  return drawdowns.map((point) => ({
    ...point,
    height: (Number(point.value) / maxDrawdown) * height,
  }))
}

export function EquityCurvePanel({
  points,
  drawdowns,
  timeline,
  maxDrawdown,
  loading,
  error,
}) {
  const fallback = useEquityCurve()
  const hasControlledCurve = points !== undefined || drawdowns !== undefined || timeline !== undefined
  const resolvedPoints = points ?? fallback.points
  const resolvedDrawdowns = drawdowns ?? fallback.drawdowns
  const resolvedTimeline = timeline ?? fallback.timeline
  const resolvedMaxDrawdown = maxDrawdown ?? fallback.maxDrawdown
  const resolvedLoading = loading ?? (!hasControlledCurve && fallback.isLoading)
  const resolvedError = error ?? (!hasControlledCurve ? fallback.error : null)
  const chartPoints = buildChartPoints(resolvedPoints, 360, 150)
  const drawdownBars = buildDrawdownBars(resolvedDrawdowns, 48)

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Equity Curve</h3>
          <p>Portfolio equity, drawdown, and performance timeline</p>
        </div>
        <span className="status-pill warning">Max DD {formatPercent(resolvedMaxDrawdown)}</span>
      </div>
      {resolvedLoading ? <StateMessage>Loading equity curve...</StateMessage> : null}
      {resolvedError ? <StateMessage type="error">{resolvedError}</StateMessage> : null}
      {!resolvedLoading && !resolvedError && resolvedPoints.length === 0 ? (
        <EmptyState label="No equity curve data yet." />
      ) : null}
      {resolvedPoints.length > 0 ? (
        <div className="equity-chart-card">
          <svg viewBox="0 0 360 150" role="img" aria-label="Portfolio equity over time">
            <line x1="0" y1="149" x2="360" y2="149" className="chart-axis" />
            <polyline points={chartPoints} className="equity-line" />
          </svg>
          <div className="drawdown-strip" aria-label="Drawdown over time">
            {drawdownBars.map((bar) => (
              <span key={bar.index} style={{ height: `${Math.max(3, bar.height)}px` }} title={`Drawdown ${formatPercent(bar.value)}`} />
            ))}
          </div>
          <div className="timeline-list">
            {resolvedTimeline.slice(-5).map((item) => (
              <article key={`${item.index}-${item.label}`}>
                <strong>{item.label}</strong>
                <span>{formatCurrency(item.value)}</span>
                <span className={Number(item.pnl) >= 0 ? 'positive' : 'negative'}>{formatCurrency(item.pnl)}</span>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function OrderEntryPanel({ onSubmitOrder, onMutationSuccess, portfolio, quote }) {
  const orderEntry = useOrderEntry({
    activeSymbol: quote?.symbol,
    quote,
    portfolio,
    submitOrder: onSubmitOrder,
  })

  const getFormSnapshot = (formElement) => {
    const data = new FormData(formElement)
    const readField = (name, fallback) => {
      const value = data.get(name)
      return value === null || value === '' ? fallback : String(value)
    }

    return {
      ...orderEntry.form,
      symbol: readField('ticker', orderEntry.form.symbol),
      orderIntent: readField('orderIntent', orderEntry.form.orderIntent),
      quantity: readField('quantity', orderEntry.form.quantity),
      limitPrice: readField('limitPrice', orderEntry.form.limitPrice),
      stopPrice: readField('stopPrice', orderEntry.form.stopPrice),
      riskPct: readField('riskPct', orderEntry.form.riskPct),
      timeInForce: readField('timeInForce', orderEntry.form.timeInForce),
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    void orderEntry.submit(getFormSnapshot(event.currentTarget)).then((result) => {
      if (result?.order && !result?.error) {
        onMutationSuccess?.(result.order)
      }
    })
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Order Entry</h3>
          <p>Paper trading only</p>
        </div>
      </div>
      <form className="order-form" onSubmit={handleSubmit}>
        <label>
          <span>Symbol</span>
          <input
            name="ticker"
            value={orderEntry.form.symbol}
            onChange={(event) => orderEntry.updateField('symbol', event.target.value)}
          />
          {orderEntry.validationErrors.symbol ? <span className="validation-message">{orderEntry.validationErrors.symbol}</span> : null}
        </label>
        <label>
          <span>Order</span>
          <select
            name="orderIntent"
            value={orderEntry.form.orderIntent}
            onChange={(event) => orderEntry.updateField('orderIntent', event.target.value)}
          >
            <option value="BUY_MARKET">Buy Market</option>
            <option value="SELL_MARKET">Sell Market</option>
            <option value="BUY_LIMIT">Buy Limit</option>
            <option value="SELL_LIMIT">Sell Limit</option>
            <option value="BUY_STOP">Stop</option>
            <option value="BUY_STOP_LIMIT">Stop Limit</option>
          </select>
        </label>
        <label>
          <span>Quantity</span>
          <input
            name="quantity"
            type="number"
            min="1"
            value={orderEntry.form.quantity}
            onChange={(event) => orderEntry.updateField('quantity', event.target.value)}
          />
          {orderEntry.validationErrors.quantity ? <span className="validation-message">{orderEntry.validationErrors.quantity}</span> : null}
        </label>
        <label>
          <span>Limit Price</span>
          <input
            name="limitPrice"
            type="number"
            min="0"
            step="0.01"
            value={orderEntry.form.limitPrice}
            onChange={(event) => orderEntry.updateField('limitPrice', event.target.value)}
          />
          {orderEntry.validationErrors.limitPrice ? <span className="validation-message">{orderEntry.validationErrors.limitPrice}</span> : null}
        </label>
        <label>
          <span>Stop Price</span>
          <input
            name="stopPrice"
            type="number"
            min="0"
            step="0.01"
            value={orderEntry.form.stopPrice}
            onChange={(event) => orderEntry.updateField('stopPrice', event.target.value)}
          />
          {orderEntry.validationErrors.stopPrice ? <span className="validation-message">{orderEntry.validationErrors.stopPrice}</span> : null}
        </label>
        <label>
          <span>Risk %</span>
          <input
            name="riskPct"
            type="number"
            min="0.1"
            step="0.1"
            value={orderEntry.form.riskPct}
            onChange={(event) => orderEntry.updateField('riskPct', event.target.value)}
          />
          {orderEntry.validationErrors.riskPct ? <span className="validation-message">{orderEntry.validationErrors.riskPct}</span> : null}
        </label>
        <label>
          <span>Time In Force</span>
          <select
            name="timeInForce"
            value={orderEntry.form.timeInForce}
            onChange={(event) => orderEntry.updateField('timeInForce', event.target.value)}
          >
            <option value="DAY">DAY</option>
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={(event) => orderEntry.previewOrder(getFormSnapshot(event.currentTarget.form))}>Preview Order</button>
          <button type="submit" className={orderEntry.payload.side === 'SELL' ? 'sell-action' : 'buy-action'}>
            Submit Paper Order
          </button>
        </div>
      </form>
      {orderEntry.preview ? (
        <div className="order-preview">
          <strong>Order Preview</strong>
          <span>{orderEntry.preview.side} {orderEntry.preview.quantity} {orderEntry.preview.symbol}</span>
          <span>{orderEntry.preview.type} at {formatCurrency(orderEntry.preview.price)}</span>
          <span>Notional {formatCurrency(orderEntry.preview.notional)} | TIF {orderEntry.preview.timeInForce}</span>
        </div>
      ) : null}
      {orderEntry.notification ? (
        <p className={`notification-line ${orderEntry.notification.type}`}>{orderEntry.notification.message}</p>
      ) : null}
    </div>
  )
}

export function OrdersPanel({ orders, activeSymbol, onCancelOrder, onRefresh, onMutationSuccess }) {
  const fallback = useOrders()
  const resolvedOrders = orders ?? fallback.orders
  const cancelOrder = onCancelOrder ?? fallback.cancelOrder
  const refresh = onRefresh ?? fallback.refresh
  const handleCancel = (orderId) => {
    void Promise.resolve(cancelOrder(orderId)).then((order) => {
      if (order) {
        onMutationSuccess?.(order)
      }
    })
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Orders</h3>
          <p>Open, pending, filled, and cancelled paper orders</p>
        </div>
        <button type="button" aria-label="Refresh orders" onClick={refresh}>Refresh</button>
      </div>
      <div className="table-card">
        <table>
          <caption>Paper orders</caption>
          <thead>
            <tr>
              <th>Status</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Time</th>
              <th>P/L</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {resolvedOrders.map((order) => (
              <tr key={order.id} className={order.symbol === activeSymbol ? 'active-row' : ''}>
                <td><span className={`order-status ${String(order.state).toLowerCase()}`}>{order.state === 'WORKING' ? 'Pending' : order.state}</span></td>
                <td>{order.symbol}</td>
                <td><span className={order.side === 'SELL' ? 'side-sell' : 'side-buy'}>{order.side}</span></td>
                <td>{order.type}</td>
                <td>{order.quantity}</td>
                <td>{formatCurrency(order.filledPrice ?? order.price)}</td>
                <td>{new Date(order.createdAt).toLocaleTimeString()}</td>
                <td>{formatCurrency(order.pnl ?? 0)}</td>
                <td>
                  {order.state === 'WORKING' || order.state === 'NEW' ? (
                    <button type="button" aria-label={`Cancel ${order.symbol} order`} onClick={() => handleCancel(order.id)}>Cancel</button>
                  ) : (
                    <span className="muted-cell">Closed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resolvedOrders.length === 0 ? <EmptyState label="No paper orders submitted." /> : null}
      </div>
    </div>
  )
}

export function PositionsPanel({ positions, activeSymbol, onRefresh }) {
  const fallback = usePositions()
  const resolvedPositions = positions ?? fallback.positions
  const refresh = onRefresh ?? fallback.refresh

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Positions</h3>
          <p>Open paper positions from filled orders</p>
        </div>
        <button type="button" aria-label="Refresh positions" onClick={refresh}>Refresh</button>
      </div>
      <div className="table-card">
        <table>
          <caption>Open paper positions</caption>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Quantity / Shares</th>
              <th>Entry Price</th>
              <th>Current</th>
              <th>Market Value</th>
              <th>Unrealized P/L</th>
              <th>Realized P/L</th>
              <th>Daily %</th>
              <th>Risk %</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {resolvedPositions.map((position) => (
              <tr key={position.symbol} className={position.symbol === activeSymbol ? 'active-row' : ''}>
                <td>{position.symbol}</td>
                <td>{position.quantity}</td>
                <td>{formatCurrency(position.averageCost)}</td>
                <td>{formatCurrency(position.currentPrice)}</td>
                <td>{formatCurrency(position.marketValue)}</td>
                <td className={Number(position.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatCurrency(position.unrealizedPnl)}</td>
                <td>{formatCurrency(position.realizedPnl)}</td>
                <td>{formatPercent(position.dailyReturn)}</td>
                <td>{formatPercent(position.riskPct)}</td>
                <td>{formatPercent(position.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {resolvedPositions.length === 0 ? <EmptyState label="No open paper positions." /> : null}
      </div>
    </div>
  )
}

export function JournalSummaryPanel({ entries, activeSymbol }) {
  const [search, setSearch] = useState('')
  const [symbolFilter, setSymbolFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState('all')
  const fallback = useJournal({ search, symbol: symbolFilter, result: resultFilter })
  const resolvedEntries = entries ?? fallback.filteredEntries
  const symbols = fallback.symbols

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Journal Summary</h3>
          <p>Recent trades and execution notes</p>
          {activeSymbol ? <span className="active-symbol-label">Active: {activeSymbol}</span> : null}
        </div>
        <div className="panel-actions-right">
          <input
            aria-label="Search journal notes"
            value={search}
            onInput={(event) => setSearch(event.target.value)}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search notes"
          />
          <select aria-label="Filter journal by symbol" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
            <option value="all">All Symbols</option>
            {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
          <select aria-label="Filter journal by result" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
            <option value="all">All Results</option>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>
      </div>
      <div className="journal-list">
        {resolvedEntries.map((entry) => (
          <article key={entry.id} className="journal-item">
            <div className={`journal-row ${entry.symbol === activeSymbol ? 'active-symbol-row' : ''}`}>
              <strong>{entry.symbol}</strong>
              <span>{entry.strategy}</span>
              <span>{entry.emotion}</span>
              <span className={`result-pill ${entry.result}`}>{entry.result}</span>
            </div>
            <p>{entry.notes}</p>
            <div className="journal-row">
              <span>{entry.tags.join(', ') || 'untagged'}</span>
              <span>{entry.duration}</span>
            </div>
            <span>{new Date(entry.createdAt).toLocaleString()}</span>
          </article>
        ))}
        {resolvedEntries.length === 0 ? <EmptyState label="No journal entries match the current filters." /> : null}
      </div>
    </div>
  )
}

const alertTypes = [
  'price_above',
  'price_below',
  'percent_change',
  'volume_above',
  'signal_change',
  'risk_limit',
  'portfolio_drawdown',
]

const defaultAlertForm = {
  id: '',
  symbol: 'AAPL',
  assetType: 'equity',
  alertType: 'price_above',
  threshold: '100',
  enabled: true,
}

export function AlertsPanel({ activeSymbol, alertsState }) {
  const fallback = useAlerts()
  const alerts = alertsState ?? fallback
  const [form, setForm] = useState(() => ({
    ...defaultAlertForm,
    symbol: activeSymbol ?? defaultAlertForm.symbol,
  }))

  const updateForm = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
  }

  const resetForm = () => {
    setForm({
      ...defaultAlertForm,
      symbol: activeSymbol ?? defaultAlertForm.symbol,
    })
  }

  const editAlert = (alert) => {
    setForm({
      id: alert.id,
      symbol: alert.symbol,
      assetType: alert.assetType,
      alertType: alert.alertType,
      threshold: String(alert.threshold),
      enabled: alert.enabled !== false,
    })
  }

  const submitAlert = (event) => {
    event.preventDefault()
    const payload = {
      id: form.id || undefined,
      symbol: form.symbol,
      assetType: form.assetType,
      alertType: form.alertType,
      threshold: form.threshold,
      enabled: form.enabled,
      channels: { inApp: true },
    }
    const action = form.id ? alerts.updateAlert(payload) : alerts.createAlert(payload)
    void Promise.resolve(action).then(resetForm)
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Alerts</h3>
          <p>In-app alert foundation for market, signal, risk, and portfolio triggers</p>
        </div>
        <div className="panel-actions-right">
          <button type="button" aria-label="Evaluate alerts" onClick={() => alerts.evaluateAlerts()}>
            Evaluate
          </button>
          <button type="button" aria-label="Refresh alerts" onClick={alerts.refresh}>
            {alerts.isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <form className="alert-form" onSubmit={submitAlert}>
        <label>
          <span>Symbol</span>
          <input value={form.symbol} onChange={(event) => updateForm('symbol', event.target.value)} />
        </label>
        <label>
          <span>Asset</span>
          <select value={form.assetType} onChange={(event) => updateForm('assetType', event.target.value)}>
            <option value="equity">Equity</option>
            <option value="etf">ETF</option>
            <option value="forex">Forex</option>
            <option value="crypto">Crypto</option>
            <option value="futures">Futures</option>
            <option value="options">Options</option>
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={form.alertType} onChange={(event) => updateForm('alertType', event.target.value)}>
            {alertTypes.map((alertType) => <option key={alertType} value={alertType}>{alertType}</option>)}
          </select>
        </label>
        <label>
          <span>Threshold</span>
          <input value={form.threshold} onChange={(event) => updateForm('threshold', event.target.value)} />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => updateForm('enabled', event.target.checked)}
          />
          <span>Enabled</span>
        </label>
        <div className="button-row">
          <button type="submit">{form.id ? 'Update Alert' : 'Create Alert'}</button>
          {form.id ? <button type="button" onClick={resetForm}>Cancel Edit</button> : null}
        </div>
      </form>

      {alerts.error ? <StateMessage type="error">{alerts.error}</StateMessage> : null}
      {alerts.isLoading ? <StateMessage>Loading alerts...</StateMessage> : null}
      {!alerts.isLoading && alerts.alerts.length === 0 ? <EmptyState label="No alerts configured." /> : null}

      {alerts.triggeredAlerts.length > 0 ? (
        <div className="triggered-alerts">
          {alerts.triggeredAlerts.map((alert) => (
            <p key={`${alert.alertId}-${alert.triggeredAt}`} className="notification-line success">{alert.message}</p>
          ))}
        </div>
      ) : null}

      <div className="table-card">
        <table>
          <caption>Configured alerts</caption>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Type</th>
              <th>Threshold</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.alerts.map((alert) => (
              <tr key={alert.id} className={alert.symbol === activeSymbol ? 'active-row' : ''}>
                <td>{alert.symbol}</td>
                <td>{alert.alertType}</td>
                <td>{alert.threshold}</td>
                <td>{alert.enabled === false ? 'Disabled' : 'Enabled'}</td>
                <td>
                  <div className="button-row">
                    <button type="button" onClick={() => editAlert(alert)}>Edit</button>
                    <button type="button" onClick={() => alerts.setAlertEnabled(alert, alert.enabled === false)}>
                      {alert.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button type="button" onClick={() => alerts.deleteAlert(alert.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const scannerCriteria = [
  'price_above',
  'price_below',
  'percent_change_above',
  'percent_change_below',
  'volume_above',
  'signal_bullish',
  'signal_bearish',
  'volatility_above',
  'risk_acceptable',
]

const defaultScannerForm = {
  id: '',
  name: 'Momentum Scan',
  assetType: 'equity',
  symbols: 'SPY,QQQ,AAPL',
  criterionType: 'price_above',
  threshold: '100',
  enabled: true,
}

export function ScannerPanel({ scannersState }) {
  const fallback = useScanners()
  const scanners = scannersState ?? fallback
  const [form, setForm] = useState(defaultScannerForm)

  const updateForm = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
  }

  const resetForm = () => setForm(defaultScannerForm)

  const editScanner = (scanner) => {
    const criterion = scanner.criteria[0] ?? { type: 'price_above', threshold: 100 }
    setForm({
      id: scanner.id,
      name: scanner.name,
      assetType: scanner.assetType,
      symbols: scanner.symbols.join(','),
      criterionType: criterion.type,
      threshold: criterion.threshold == null ? '' : String(criterion.threshold),
      enabled: scanner.enabled !== false,
    })
  }

  const submitScanner = (event) => {
    event.preventDefault()
    const thresholdless = ['signal_bullish', 'signal_bearish', 'risk_acceptable']
    const payload = {
      id: form.id || undefined,
      name: form.name,
      assetType: form.assetType,
      symbols: form.symbols.split(',').map((symbol) => symbol.trim()).filter(Boolean),
      criteria: [{
        type: form.criterionType,
        threshold: thresholdless.includes(form.criterionType) ? undefined : form.threshold,
      }],
      enabled: form.enabled,
    }
    const action = form.id ? scanners.updateScanner(payload) : scanners.createScanner(payload)
    void Promise.resolve(action).then(resetForm)
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Scanner</h3>
          <p>Market scanner foundation for asset-aware opportunity discovery</p>
        </div>
        <div className="panel-actions-right">
          <button type="button" aria-label="Evaluate scanners" onClick={scanners.evaluateScanners}>Evaluate</button>
          <button type="button" aria-label="Refresh scanners" onClick={scanners.refresh}>
            {scanners.isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <form className="scanner-form" onSubmit={submitScanner}>
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
        </label>
        <label>
          <span>Asset</span>
          <select value={form.assetType} onChange={(event) => updateForm('assetType', event.target.value)}>
            <option value="equity">Equity</option>
            <option value="etf">ETF</option>
            <option value="forex">Forex</option>
            <option value="crypto">Crypto</option>
            <option value="futures">Futures</option>
            <option value="options">Options</option>
          </select>
        </label>
        <label>
          <span>Universe</span>
          <input value={form.symbols} onChange={(event) => updateForm('symbols', event.target.value)} />
        </label>
        <label>
          <span>Criterion</span>
          <select value={form.criterionType} onChange={(event) => updateForm('criterionType', event.target.value)}>
            {scannerCriteria.map((criterion) => <option key={criterion} value={criterion}>{criterion}</option>)}
          </select>
        </label>
        <label>
          <span>Threshold</span>
          <input value={form.threshold} onChange={(event) => updateForm('threshold', event.target.value)} />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} />
          <span>Enabled</span>
        </label>
        <div className="button-row">
          <button type="submit">{form.id ? 'Update Scanner' : 'Create Scanner'}</button>
          {form.id ? <button type="button" onClick={resetForm}>Cancel Edit</button> : null}
        </div>
      </form>

      {scanners.error ? <StateMessage type="error">{scanners.error}</StateMessage> : null}
      {scanners.isLoading ? <StateMessage>Loading scanners...</StateMessage> : null}
      {!scanners.isLoading && scanners.scanners.length === 0 ? <EmptyState label="No scanners configured." /> : null}

      <div className="table-card">
        <table>
          <caption>Configured scanners</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Universe</th>
              <th>Criteria</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {scanners.scanners.map((scanner) => (
              <tr key={scanner.id}>
                <td>{scanner.name}</td>
                <td>{scanner.symbols.join(', ')}</td>
                <td>{scanner.criteria.map((criterion) => criterion.type).join(', ')}</td>
                <td>{scanner.enabled === false ? 'Disabled' : 'Enabled'}</td>
                <td>
                  <div className="button-row">
                    <button type="button" onClick={() => editScanner(scanner)}>Edit</button>
                    <button type="button" onClick={() => scanners.setScannerEnabled(scanner, scanner.enabled === false)}>
                      {scanner.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button type="button" onClick={() => scanners.deleteScanner(scanner.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <table>
          <caption>Scanner results</caption>
          <thead>
            <tr>
              <th>Scanner</th>
              <th>Symbol</th>
              <th>Asset</th>
              <th>Matched Criteria</th>
              <th>Evaluated</th>
            </tr>
          </thead>
          <tbody>
            {scanners.matches.map((match) => (
              <tr key={`${match.scannerId}-${match.symbol}-${match.evaluatedAt}`}>
                <td>{match.scannerName}</td>
                <td>{match.symbol}</td>
                <td>{match.assetType}</td>
                <td>{match.matchedCriteria.join(', ')}</td>
                <td>{formatTimestamp(match.evaluatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {scanners.matches.length === 0 ? <EmptyState label="No scanner matches yet." /> : null}
      </div>
    </div>
  )
}

export function DiagnosticsPanel({ healthState }) {
  const fallback = useSystemHealth()
  const system = healthState ?? fallback
  const status = system.apiStatus ?? system.health?.status ?? 'unknown'
  const lastSync = system.lastSuccessfulSync ? formatTimestamp(system.lastSuccessfulSync) : 'N/A'
  const paperTrading = system.paperTradingEnabled ? 'Enabled' : 'Disabled'

  return (
    <div className="panel-stack diagnostics-panel">
      <div className="panel-actions">
        <div>
          <h3>System Diagnostics</h3>
          <p>Health, sync, and paper trading status</p>
        </div>
        <button type="button" aria-label="Refresh system health" onClick={system.refresh}>
          {system.isLoading ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      <div className="diagnostics-grid">
        <article>
          <span>API Status</span>
          <strong className={status === 'healthy' ? 'positive' : status === 'degraded' ? 'negative' : ''}>{status}</strong>
        </article>
        <article>
          <span>Paper Trading</span>
          <strong>{paperTrading}</strong>
        </article>
        <article>
          <span>Last Sync</span>
          <strong>{lastSync}</strong>
        </article>
        <article>
          <span>Last Error</span>
          <strong>{system.lastError ?? 'None'}</strong>
        </article>
      </div>
    </div>
  )
}
