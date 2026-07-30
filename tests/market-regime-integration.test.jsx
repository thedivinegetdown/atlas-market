import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarketRegimeSummary } from '../src/components/panels.jsx'

const base = {
  symbol: 'SPY', timeframe: '1D', asOf: '2026-07-30T14:00:00.000Z', freshness: 'FRESH',
  classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 82, status: 'COMPLETE', reasons: ['Price is above its long-term average'] },
  inputCoverage: { missing: [], stale: [], incompatible: [], invalid: [] }, warnings: [],
}

describe('Markets regime summary', () => {
  let container
  let root
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const render = (element) => act(() => root.render(element))

  it('renders complete read-only classifications and boundaries', () => {
    render(<MarketRegimeSummary regime={base} />)
    expect(container.textContent).toContain('BULL')
    expect(container.textContent).toContain('82%')
    expect(container.textContent).toContain('Paper trading remains enabled')
    expect(container.textContent).not.toContain('Buy')
  })

  it('renders loading and error states', () => {
    render(<MarketRegimeSummary loading />)
    expect(container.textContent).toContain('Loading regime context')
    render(<MarketRegimeSummary error="failed" />)
    expect(container.textContent).toContain('Regime context unavailable')
  })

  it.each([
    ['PARTIAL', 'STALE', 'Stale', ['volatilityIndex']],
    ['INSUFFICIENT_DATA', 'UNKNOWN', 'Missing', ['shortMovingAverage']],
  ])('renders %s coverage and freshness states', (status, freshness, label, values) => {
    const regime = { ...base, freshness, classification: { ...base.classification, status }, inputCoverage: { ...base.inputCoverage, [label.toLowerCase()]: values } }
    render(<MarketRegimeSummary regime={regime} />)
    expect(container.textContent).toContain(status.replaceAll('_', ' '))
    expect(container.textContent).toContain(freshness)
    expect(container.textContent).toContain(label)
  })
})
