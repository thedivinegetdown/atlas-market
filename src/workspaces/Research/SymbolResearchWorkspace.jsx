import { useMemo, useState } from 'react'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'
import { WorkspacePage, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useSymbolResearch } from '../../hooks/useSymbolResearch.js'
import { calculateTechnicalLevels } from '../../../lib/market/technicalLevels.js'
import './SymbolResearchWorkspace.css'

const TIMEFRAMES = Object.freeze([
  { id: '1M', label: '1 month', candles: 22 },
  { id: '3M', label: '3 months', candles: 66 },
  { id: '1Y', label: '1 year', candles: 260 },
])

const STRATEGY_LABELS = Object.freeze({
  'breakout-momentum-v1': 'BREAKOUT.1',
  'range-mean-reversion-v1': 'RANGE.1',
  'volatility-expansion-v1': 'VOL.1',
})

function currency(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value))
    : 'Unavailable'
}

function percent(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : 'Unavailable'
}

function timestamp(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Unavailable'
  return new Date(value).toLocaleString()
}

function chartPath(values, width, top, height, minimum, maximum) {
  const span = Math.max(maximum - minimum, 0.0001)
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = top + height - ((value - minimum) / span) * height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

export function PriceVolumeChart({ candles = [], timeframe }) {
  if (candles.length < 2) {
    return <p className="research-insufficient" role="status">INSUFFICIENT — at least two valid historical candles are required for a price and volume chart.</p>
  }
  const width = 640
  const priceTop = 12
  const priceHeight = 190
  const volumeTop = 226
  const volumeHeight = 62
  const closes = candles.map((candle) => Number(candle.close))
  const lows = candles.map((candle) => Number(candle.low))
  const highs = candles.map((candle) => Number(candle.high))
  const volumes = candles.map((candle) => Number(candle.volume))
  const minimum = Math.min(...lows)
  const maximum = Math.max(...highs)
  const maxVolume = Math.max(...volumes, 1)
  const barWidth = Math.max(1, (width / candles.length) * 0.68)
  const firstDate = candles[0]?.timestamp?.slice(0, 10)
  const lastDate = candles.at(-1)?.timestamp?.slice(0, 10)
  return (
    <figure className="research-chart" aria-label={`${timeframe} historical price and volume chart`}>
      <svg viewBox={`0 0 ${width} 305`} role="img" aria-labelledby="research-chart-title research-chart-description" preserveAspectRatio="none">
        <title id="research-chart-title">{timeframe} close price and daily volume</title>
        <desc id="research-chart-description">{candles.length} supplied daily candles from {firstDate} through {lastDate}</desc>
        <line className="research-chart__divider" x1="0" x2={width} y1="214" y2="214" />
        <path className="research-chart__price" d={chartPath(closes, width, priceTop, priceHeight, minimum, maximum)} />
        {volumes.map((volume, index) => {
          const x = (index / candles.length) * width
          const height = (volume / maxVolume) * volumeHeight
          return <rect className="research-chart__volume" key={`${candles[index].timestamp}-${index}`} x={x} y={volumeTop + volumeHeight - height} width={barWidth} height={height} />
        })}
      </svg>
      <figcaption>
        <span>{firstDate}</span><strong>{currency(closes.at(-1))} close</strong><span>{lastDate}</span>
      </figcaption>
    </figure>
  )
}

function EvidenceMetric({ label, value, requirement }) {
  const available = value !== null && value !== undefined && Number.isFinite(Number(value))
  return <article className={`research-metric ${available ? '' : 'is-insufficient'}`}>
    <span>{label}</span>
    <strong>{available ? currency(value) : 'INSUFFICIENT'}</strong>
    {!available ? <small>Requires {requirement}</small> : null}
  </article>
}

function ScannerContext({ scanner, error, symbol }) {
  if (error) return <p className="research-insufficient" role="status">UNAVAILABLE — {error}</p>
  const checks = scanner?.observationCoverage?.checks?.filter((check) => check.symbol === symbol) ?? []
  if (!checks.length) {
    const prepared = scanner?.createdAt ? ` Latest preparation ${scanner.preparationId ?? 'identity unavailable'} was created ${timestamp(scanner.createdAt)}.` : ''
    return <p className="research-insufficient" role="status">UNAVAILABLE — no tenant-scoped stored Scanner dispositions were found for {symbol}.{prepared}</p>
  }
  return <div className="scanner-context-list">
    <p className="research-boundary">HISTORICAL stored results from preparation {scanner.preparationId ?? 'identity unavailable'} · prepared {timestamp(scanner.createdAt)}</p>
    {checks.map((check) => <article className="scanner-context-card" key={`${check.experimentId}-${check.symbol}`}>
      <div><strong>{check.experimentId ?? STRATEGY_LABELS[check.strategyId] ?? check.strategyId}</strong><span>{STRATEGY_LABELS[check.strategyId] ? check.strategyId : 'Governed strategy'}</span></div>
      <div><strong>{check.status ?? 'UNKNOWN'}</strong><span>{check.reason ?? 'Reason unavailable'}</span></div>
      <time dateTime={check.evaluatedAt ?? undefined}>{check.evaluatedAt ? `Evaluated ${timestamp(check.evaluatedAt)}` : 'HISTORICAL — evaluation timestamp unavailable'}</time>
    </article>)}
  </div>
}

export default function SymbolResearchWorkspace({
  symbol,
  initialOverview = null,
  initialScanner = null,
  autoLoad = true,
}) {
  const [timeframe, setTimeframe] = useState('3M')
  const research = useSymbolResearch({ symbol, initialOverview, initialScanner, autoLoad })
  const overview = research.overview?.quote?.symbol === symbol ? research.overview : null
  const quote = overview?.quote ?? null
  const history = overview?.research?.history
  const allCandles = Array.isArray(history?.candles) ? history.candles : []
  const selected = TIMEFRAMES.find((item) => item.id === timeframe) ?? TIMEFRAMES[1]
  const candles = allCandles.slice(-selected.candles)
  const indicators = overview?.research?.indicators?.values ?? {}
  const levels = useMemo(() => calculateTechnicalLevels(candles), [candles])
  const quoteStatus = quote?.provenance?.dataStatus ?? 'INSUFFICIENT'
  const changeTone = Number(quote?.change ?? 0) >= 0 ? 'positive' : 'negative'

  return <WorkspacePage
    eyebrow="Symbol research"
    title={symbol}
    description="Mobile technical evidence workspace for human research. Technical levels are references, not predictions or trade instructions."
  >
    <WorkspacePanel id="symbol-research-quote" className="symbol-research-panel" title="Quote & provenance" subtitle="Latest available evidence">
      <div className="research-quote-header">
        <div><span className="research-symbol">{symbol}</span><strong>{currency(quote?.price)}</strong></div>
        <div className={changeTone}><strong>{quote?.change == null ? 'Change unavailable' : `${Number(quote.change) >= 0 ? '+' : ''}${currency(quote.change)}`}</strong><span>{quote?.changePercent == null ? 'Percent unavailable' : `${Number(quote.changePercent) >= 0 ? '+' : ''}${percent(quote.changePercent)}`}</span></div>
      </div>
      {quote ? <MarketDataStatus provenance={quote.provenance} /> : <div className="market-data-status status-insufficient" role="status"><strong>{quoteStatus}</strong><span>Provider: unavailable</span><span>As of: unavailable</span></div>}
      {research.overviewError ? <p className="research-insufficient" role="alert">Quote evidence unavailable — {research.overviewError}</p> : null}
    </WorkspacePanel>

    <WorkspacePanel id="symbol-research-chart" className="symbol-research-panel" title="Price & volume history" subtitle={`${history?.provider ?? 'unknown'} daily candles`}>
      <div className="research-timeframes" role="group" aria-label="Historical timeframe">
        {TIMEFRAMES.map((item) => <button type="button" aria-pressed={timeframe === item.id} key={item.id} onClick={() => setTimeframe(item.id)}>{item.id}<span>{item.label}</span></button>)}
      </div>
      {history?.historyCompleteness === 'TRUNCATED' ? <p className="research-evidence-note">Partial history: {history.candleCount} of {history.requestedCount} requested daily candles.</p> : null}
      <PriceVolumeChart candles={candles} timeframe={timeframe} />
      <p className="research-evidence-note">Volume is displayed beneath the close-price line. Historical as of {timestamp(history?.asOf)}.</p>
    </WorkspacePanel>

    <WorkspacePanel id="symbol-research-trend" className="symbol-research-panel" title="Trend & volatility" subtitle="Deterministic daily indicators">
      <div className="research-metric-grid">
        <EvidenceMetric label="SMA20" value={indicators.shortMovingAverage} requirement="20 completed daily closes" />
        <EvidenceMetric label="SMA50" value={indicators.mediumMovingAverage} requirement="50 completed daily closes" />
        <EvidenceMetric label="SMA200" value={indicators.longMovingAverage} requirement="200 completed daily closes" />
        <EvidenceMetric label="ATR14" value={indicators.atr} requirement="15 completed daily candles" />
        <article className={`research-metric ${indicators.atrPct != null && Number.isFinite(Number(indicators.atrPct)) ? '' : 'is-insufficient'}`}><span>ATR % of close</span><strong>{indicators.atrPct != null && Number.isFinite(Number(indicators.atrPct)) ? percent(indicators.atrPct) : 'INSUFFICIENT'}</strong><small>{indicators.atrPct != null && Number.isFinite(Number(indicators.atrPct)) ? 'Wilder ATR14' : 'Requires ATR and latest close'}</small></article>
        <article className={`research-metric ${indicators.relativeStrengthPct != null && Number.isFinite(Number(indicators.relativeStrengthPct)) ? '' : 'is-insufficient'}`}><span>20-day relative strength vs SPY</span><strong>{indicators.relativeStrengthPct != null && Number.isFinite(Number(indicators.relativeStrengthPct)) ? percent(indicators.relativeStrengthPct) : 'INSUFFICIENT'}</strong><small>{indicators.relativeStrengthPct != null && Number.isFinite(Number(indicators.relativeStrengthPct)) ? 'Aligned return difference' : 'Requires aligned symbol and SPY history'}</small></article>
      </div>
      <p className="research-evidence-note">Indicator evidence as of {timestamp(overview?.research?.indicators?.asOf)}. Missing inputs remain insufficient and are not inferred from the quote.</p>
    </WorkspacePanel>

    <WorkspacePanel id="symbol-research-levels" className="symbol-research-panel" title="Support & resistance" subtitle={timeframe}>
      {levels.status === 'INSUFFICIENT' ? <p className="research-insufficient" role="status">INSUFFICIENT — {levels.reason}.</p> : <>
        <div className="research-level-columns">
          <section><h3>Support</h3>{levels.support.length ? levels.support.map((level) => <div className="research-level" key={`support-${level.value}`}><strong>{currency(level.value)}</strong><span>{level.kind} · {level.timestamp?.slice(0, 10)}</span></div>) : <p>Unavailable in selected window.</p>}</section>
          <section><h3>Resistance</h3>{levels.resistance.length ? levels.resistance.map((level) => <div className="research-level" key={`resistance-${level.value}`}><strong>{currency(level.value)}</strong><span>{level.kind} · {level.timestamp?.slice(0, 10)}</span></div>) : <p>Unavailable in selected window.</p>}</section>
        </div>
        <p className="research-evidence-note">Method: {levels.method}. Technical reference levels only—not predictions, entries, stops, targets, or recommendations.</p>
      </>}
    </WorkspacePanel>

    <WorkspacePanel id="symbol-research-scanner" className="symbol-research-panel" title="Stored Scanner context" subtitle="BREAKOUT.1 · RANGE.1 · VOL.1">
      <ScannerContext scanner={research.scanner} error={research.scannerError} symbol={symbol} />
    </WorkspacePanel>

    <section className="research-boundary-card" aria-label="Decision support boundary">
      <strong>Human research boundary</strong>
      <p>No BUY/SELL instruction, trade selection, entry, stop, target, order placement, or live execution is produced here. LIVE_BROKER_EXECUTION=NEVER.</p>
    </section>
  </WorkspacePage>
}
