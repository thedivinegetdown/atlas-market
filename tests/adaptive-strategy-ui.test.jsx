import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { StrategySuitabilityPanel } from '../src/workspaces/Strategies/strategySections.jsx'

let root
let container

function render(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(element))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function suitability(decision = 'CONDITIONAL', status = 'COMPLETE') {
  return {
    status,
    regime: {
      trendRegime: status === 'INSUFFICIENT_DATA' ? 'UNKNOWN' : 'BULL',
      volatilityRegime: 'NORMAL_VOLATILITY',
      riskRegime: 'RISK_ON',
      confidence: status === 'INSUFFICIENT_DATA' ? 0 : 82,
    },
    summary: {
      enabled: decision === 'ENABLED' ? 1 : 0,
      conditional: decision === 'CONDITIONAL' ? 1 : 0,
      disabled: decision === 'DISABLED' ? 1 : 0,
      unknown: decision === 'UNKNOWN' ? 1 : 0,
    },
    strategies: [{
      strategyId: 'index-pullback-v1',
      strategyName: 'Index Pullback',
      decision,
      confidence: 72,
      lifecycleState: 'validated',
      reasons: ['Bull trend is compatible', 'Lifecycle remains validated'],
      blockingReasons: decision === 'DISABLED' ? ['Risk regime is incompatible'] : [],
      missingInputs: status === 'INSUFFICIENT_DATA' ? ['price'] : [],
    }],
  }
}

describe('Strategies workspace adaptive suitability', () => {
  it('renders loading and error states accessibly', () => {
    expect(render(<StrategySuitabilityPanel state={{ isLoading: true }} />).querySelector('[role="status"]').textContent).toContain('Loading')
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<StrategySuitabilityPanel state={{ error: 'failed', isLoading: false }} />))
    expect(container.querySelector('[role="alert"]').textContent).toContain('unavailable')
  })

  it.each([
    ['ENABLED', 'COMPLETE'],
    ['CONDITIONAL', 'COMPLETE'],
    ['UNKNOWN', 'INSUFFICIENT_DATA'],
  ])('renders %s strategy state for %s evidence', (decision, status) => {
    const view = render(<StrategySuitabilityPanel state={{ suitability: suitability(decision, status), isLoading: false }} />)
    expect(view.textContent).toContain('Index Pullback')
    expect(view.textContent).toContain(decision)
    expect(view.textContent).toContain('Paper trading remains mandatory')
    expect(view.textContent).toContain('selection cannot activate strategies')
  })
})
