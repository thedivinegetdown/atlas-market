import './MarketDataStatus.css'

function text(value) { return String(value ?? 'UNKNOWN').replaceAll('_', ' ') }

export function MarketDataStatus({ provenance, compact = false }) {
  const status = provenance?.dataStatus ?? 'UNKNOWN'
  const provider = provenance?.provider ?? 'unknown'
  const observedAt = provenance?.observedAt
  const warning = status === 'MOCK'
    ? 'Development/demo data — not live market information.'
    : status === 'UNKNOWN'
      ? 'Price provenance is unavailable; live status is not assumed.'
      : status === 'UNAVAILABLE'
        ? 'Market data is unavailable.'
        : status !== 'LIVE' ? `Market data is ${text(status).toLowerCase()}; derived guidance is qualified.` : null
  return <div className={`market-data-status status-${status.toLowerCase()}${compact ? ' compact' : ''}`} role="status" aria-label={`Market data status ${status}`}>
    <strong>{status === 'MOCK' ? 'MOCK DATA' : text(status)}</strong><span>Provider: {provider}</span><span>As of: {observedAt ? new Date(observedAt).toLocaleString() : 'unavailable'}</span>
    {!compact && warning ? <span className="market-data-warning">{warning}</span> : null}
  </div>
}
