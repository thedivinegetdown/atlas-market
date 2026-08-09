import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TradeQualityPanel } from '../src/workspaces/Scanner/scannerSections.jsx'

let root
let container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)); return container }
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null })

function quality(overrides = {}) {
  return { symbol: 'AAPL', score: 82, band: 'STRONG', confidence: 78, status: 'COMPLETE', evidenceCoverage: 90, freshness: 'FRESH', dimensions: { regimeFit: 13, trend: 12 }, reasons: ['Bull regime is aligned'], blockingReasons: [], missingInputs: [], ...overrides }
}

describe('Scanner Trade Quality review', () => {
  it('renders empty and explicit loading states without evaluating automatically', () => {
    const evaluate = vi.fn()
    expect(render(<TradeQualityPanel state={{ evaluate, isLoading: false }} />).textContent).toContain('Select Review quality')
    expect(evaluate).not.toHaveBeenCalled()
    act(() => root.unmount()); root = createRoot(container)
    act(() => root.render(<TradeQualityPanel candidate={{ symbol: 'AAPL' }} state={{ evaluate, isLoading: true }} />))
    expect(container.querySelector('[role="status"]').textContent).toContain('Evaluating')
  })

  it('renders complete and partial evidence accessibly', () => {
    const view = render(<TradeQualityPanel candidate={{ symbol: 'AAPL' }} state={{ quality: quality(), isLoading: false }} />)
    expect(view.textContent).toContain('82/100')
    expect(view.textContent).toContain('Paper trading remains mandatory')
    act(() => root.unmount()); root = createRoot(container)
    act(() => root.render(<TradeQualityPanel candidate={{ symbol: 'AAPL' }} state={{ quality: quality({ score: null, band: 'UNKNOWN', status: 'INSUFFICIENT_DATA', missingInputs: ['riskReward'] }), isLoading: false }} />))
    expect(container.textContent).toContain('Not scored')
    expect(container.textContent).toContain('Missing: riskReward')
  })

  it('renders an error state without trading controls', () => {
    const view = render(<TradeQualityPanel candidate={{ symbol: 'AAPL' }} state={{ error: 'failed', isLoading: false }} />)
    expect(view.querySelector('[role="alert"]').textContent).toContain('unavailable')
    expect(view.textContent).not.toMatch(/buy|sell|place order/i)
  })
})
