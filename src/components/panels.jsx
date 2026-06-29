import { useMemo, useState } from 'react'
import { useJournal } from '../hooks/useJournal.js'
import { useOrders } from '../hooks/useOrders.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useRisk } from '../hooks/useRisk.js'
import { useSignals } from '../hooks/useSignals.js'
import { useWatchlist } from '../hooks/useWatchlist.js'

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
}

function formatPercent(value) {
  return `${Number(value ?? 0).toFixed(2)}%`
}

function EmptyState({ label }) {
  return <p className="empty-state">{label}</p>
}

export function WatchlistPanel({
  quotes,
  selectedSymbol,
  onSelectSymbol,
  refreshing,
  onRefresh,
  sortDirection = 'desc',
}) {
  const fallback = useWatchlist()
  const resolvedQuotes = quotes ?? fallback.quotes
  const resolvedSelected = selectedSymbol ?? fallback.selectedSymbol
  const resolvedRefreshing = refreshing ?? fallback.isRefreshing
  const resolvedOnRefresh = onRefresh ?? fallback.refresh
  const resolvedOnSelect = onSelectSymbol ?? fallback.setSelectedSymbol
  const [sort, setSort] = useState(sortDirection)

  const displayQuotes = useMemo(() => {
    return [...(resolvedQuotes ?? [])].sort((left, right) => {
      const leftValue = Number(left?.changePercent ?? 0)
      const rightValue = Number(right?.changePercent ?? 0)
      return sort === 'asc' ? leftValue - rightValue : rightValue - leftValue
    })
  }, [resolvedQuotes, sort])

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Watchlist</h3>
          <p>Live symbols from the market data layer</p>
        </div>
        <div className="panel-actions-right">
          <button type="button" onClick={() => setSort(sort === 'asc' ? 'desc' : 'asc')}>
            Sort {sort === 'asc' ? 'up' : 'down'}
          </button>
          <button type="button" onClick={resolvedOnRefresh}>
            {resolvedRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>Daily %</th>
              <th>Volume</th>
              <th>Provider</th>
            </tr>
          </thead>
          <tbody>
            {displayQuotes.map((quote) => (
              <tr
                key={quote.symbol}
                className={quote.symbol === resolvedSelected ? 'active-row' : ''}
                onClick={() => resolvedOnSelect(quote.symbol)}
              >
                <td>{quote.symbol}</td>
                <td>{formatCurrency(quote.price)}</td>
                <td className={Number(quote.changePercent ?? 0) >= 0 ? 'positive' : 'negative'}>
                  {formatPercent(quote.changePercent)}
                </td>
                <td>{formatNumber(quote.volume)}</td>
                <td>{quote.provider ?? quote.health?.provider ?? 'mock'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayQuotes.length === 0 ? <EmptyState label="Loading watchlist quotes..." /> : null}
      </div>
    </div>
  )
}

export function SymbolOverviewPanel({ quote }) {
  const fallback = useWatchlist()
  const selectedQuote = quote ?? fallback.selectedQuote

  return (
    <div className="panel-stack">
      <h3>Symbol Overview</h3>
      <div className="metric-grid">
        <article><span>Current</span><strong>{formatCurrency(selectedQuote?.price)}</strong></article>
        <article><span>Open</span><strong>{formatCurrency(selectedQuote?.open)}</strong></article>
        <article><span>High</span><strong>{formatCurrency(selectedQuote?.high)}</strong></article>
        <article><span>Low</span><strong>{formatCurrency(selectedQuote?.low)}</strong></article>
        <article><span>Prev Close</span><strong>{formatCurrency(selectedQuote?.previousClose)}</strong></article>
        <article><span>Volume</span><strong>{formatNumber(selectedQuote?.volume)}</strong></article>
      </div>
    </div>
  )
}

export function SignalPanel({ signal }) {
  const fallback = useSignals()
  const resolvedSignal = signal ?? fallback.signal

  return (
    <div className="panel-stack">
      <h3>Signal Panel</h3>
      <div className={`signal-card ${resolvedSignal?.action?.toLowerCase() ?? 'hold'}`}>
        <span>Overall Signal</span>
        <strong>{resolvedSignal?.action ?? 'HOLD'}</strong>
        <p>{resolvedSignal?.thesis ?? 'Awaiting market data.'}</p>
      </div>
      <div className="metric-grid compact-grid">
        <article><span>Score</span><strong>{formatNumber(resolvedSignal?.score)}</strong></article>
        <article><span>Confidence</span><strong>{formatNumber(resolvedSignal?.confidence)}</strong></article>
        <article><span>Risk Flags</span><strong>{resolvedSignal?.riskFlags?.length ?? 0}</strong></article>
      </div>
    </div>
  )
}

export function RiskPanel({ risk }) {
  const fallback = useRisk()
  const resolvedRisk = risk ?? fallback.risk

  return (
    <div className="panel-stack">
      <h3>Risk Panel</h3>
      <div className="metric-grid">
        <article><span>Status</span><strong>{resolvedRisk.approved ? 'Approved' : 'Blocked'}</strong></article>
        <article><span>Position Size</span><strong>{formatNumber(resolvedRisk.positionSize)}</strong></article>
        <article><span>Dollar Risk</span><strong>{formatCurrency(resolvedRisk.dollarRisk)}</strong></article>
        <article><span>Exposure</span><strong>{formatPercent(resolvedRisk.accountExposure)}</strong></article>
        <article><span>Max Risk</span><strong>{formatPercent(resolvedRisk.maxRisk)}</strong></article>
        <article><span>Stop Distance</span><strong>{formatNumber(resolvedRisk.stopDistance)}</strong></article>
      </div>
    </div>
  )
}

export function PortfolioSummaryPanel({ summary }) {
  const fallback = usePortfolio()
  const resolvedSummary = summary ?? fallback.summary

  return (
    <div className="panel-stack">
      <h3>Portfolio Summary</h3>
      <div className="metric-grid large-grid">
        <article><span>Account Value</span><strong>{formatCurrency(resolvedSummary.accountValue)}</strong></article>
        <article><span>Cash</span><strong>{formatCurrency(resolvedSummary.cash)}</strong></article>
        <article><span>Buying Power</span><strong>{formatCurrency(resolvedSummary.buyingPower)}</strong></article>
        <article><span>Daily Return</span><strong>{formatPercent(resolvedSummary.dailyReturn)}</strong></article>
        <article><span>Total Return</span><strong>{formatPercent(resolvedSummary.totalReturn)}</strong></article>
        <article><span>Win Rate</span><strong>{formatPercent(resolvedSummary.winRate)}</strong></article>
        <article><span>Profit Factor</span><strong>{formatNumber(resolvedSummary.profitFactor)}</strong></article>
        <article><span>Max Drawdown</span><strong>{formatPercent(resolvedSummary.maxDrawdown)}</strong></article>
      </div>
    </div>
  )
}

export function OrderEntryPanel({ onSubmitOrder, portfolio, quote }) {
  const orders = useOrders()
  const [form, setForm] = useState({
    ticker: 'AAPL',
    quantity: '10',
    limitPrice: '190',
    type: 'LIMIT',
    side: 'BUY',
    timeInForce: 'DAY',
  })
  const [preview, setPreview] = useState(null)

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const buildPayload = () => ({
    symbol: form.ticker.toUpperCase(),
    quantity: Number(form.quantity),
    price: Number(form.limitPrice),
    type: form.type,
    side: form.side,
    timeInForce: form.timeInForce,
  })

  const submit = (event) => {
    event.preventDefault()
    const payload = buildPayload()
    const submitOrder = onSubmitOrder ?? orders.submitOrder
    const result = submitOrder(payload, quote ?? { price: payload.price, updatedAt: new Date().toISOString() }, portfolio)
    setPreview(
      result?.error
        ? `Pending risk review failed: ${payload.symbol} ${result.error.message}`
        : `Pending: ${payload.side} ${payload.quantity} ${payload.symbol} submitted`,
    )
  }

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Order Entry</h3>
          <p>Paper trading only</p>
        </div>
      </div>
      <form className="order-form" onSubmit={submit}>
        <label><span>Ticker</span><input name="ticker" value={form.ticker} onChange={handleChange} /></label>
        <label><span>Quantity</span><input name="quantity" type="number" min="1" value={form.quantity} onChange={handleChange} /></label>
        <label><span>Limit Price</span><input name="limitPrice" type="number" min="0" step="0.01" value={form.limitPrice} onChange={handleChange} /></label>
        <label>
          <span>Order Type</span>
          <select name="type" value={form.type} onChange={handleChange}>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
            <option value="STOP">Stop</option>
          </select>
        </label>
        <label>
          <span>Side</span>
          <select name="side" value={form.side} onChange={handleChange}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </label>
        <label>
          <span>Time In Force</span>
          <select name="timeInForce" value={form.timeInForce} onChange={handleChange}>
            <option value="DAY">DAY</option>
            <option value="GTC">GTC</option>
          </select>
        </label>
        <button type="submit">Submit Paper Order</button>
      </form>
      {preview ? <p className="preview-text">{preview}</p> : null}
    </div>
  )
}

export function OrdersPanel({ orders, onCancelOrder, onRefresh }) {
  const fallback = useOrders()
  const resolvedOrders = orders ?? fallback.orders
  const cancelOrder = onCancelOrder ?? fallback.cancelOrder
  const refresh = onRefresh ?? fallback.refresh

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Orders</h3>
          <p>Open, pending, filled, and cancelled paper orders</p>
        </div>
        <button type="button" onClick={refresh}>Refresh</button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {resolvedOrders.map((order) => (
              <tr key={order.id}>
                <td>{order.state === 'WORKING' ? 'Pending' : order.state}</td>
                <td>{order.symbol}</td>
                <td>{order.side}</td>
                <td>{order.quantity}</td>
                <td>{formatCurrency(order.price)}</td>
                <td>{new Date(order.createdAt).toLocaleTimeString()}</td>
                <td><button type="button" onClick={() => cancelOrder(order.id)}>Cancel</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {resolvedOrders.length === 0 ? <EmptyState label="No paper orders submitted." /> : null}
      </div>
    </div>
  )
}

export function PositionsPanel({ positions }) {
  const fallback = usePortfolio()
  const resolvedPositions = positions ?? fallback.summary.openPositions ?? []

  return (
    <div className="panel-stack">
      <h3>Positions</h3>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Shares</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Market Value</th>
              <th>Unrealized P/L</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {resolvedPositions.map((position) => (
              <tr key={position.symbol}>
                <td>{position.symbol}</td>
                <td>{position.quantity}</td>
                <td>{formatCurrency(position.averageCost)}</td>
                <td>{formatCurrency(position.currentPrice)}</td>
                <td>{formatCurrency(position.marketValue)}</td>
                <td>{formatCurrency(position.unrealizedPnl)}</td>
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

export function JournalSummaryPanel({ entries }) {
  const fallback = useJournal()
  const resolvedEntries = entries ?? fallback.entries
  const [search, setSearch] = useState('')

  const filteredEntries = useMemo(() => {
    return resolvedEntries.filter((entry) => {
      return search.length === 0 || entry.message?.toLowerCase().includes(search.toLowerCase())
    })
  }, [resolvedEntries, search])

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <div>
          <h3>Journal Summary</h3>
          <p>Recent notes from the paper trading journal</p>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" />
      </div>
      <div className="journal-list">
        {filteredEntries.map((entry) => (
          <article key={entry.id} className="journal-item">
            <strong>{entry.strategy ?? 'Systematic'}</strong>
            <p>{entry.message}</p>
            <span>{new Date(entry.createdAt).toLocaleString()}</span>
          </article>
        ))}
        {filteredEntries.length === 0 ? <EmptyState label="No journal entries yet." /> : null}
      </div>
    </div>
  )
}
