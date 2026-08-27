import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DecisionQualityPanel } from '../src/workspaces/Reports/reportSections.jsx'

let root
let container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)); return container }
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('Decision Quality panel', () => {
  it('shows an explicit unavailable R state for incomplete paper evidence', () => {
    const view = render(<DecisionQualityPanel state={{ isLoading: false, error: null, review: { asOf: '2026-08-27T00:00:00.000Z', sample: { status: 'INSUFFICIENT_SAMPLE', completedTrades: 0, wins: 0, losses: 0 }, performance: {}, recentTrend: 'INSUFFICIENT_DATA' } }} />)
    expect(view.textContent).toContain('Decision Quality')
    expect(view.textContent).toContain('PAST PAPER EVIDENCE')
    expect(view.textContent).toContain('R-normalized evidence: UNAVAILABLE')
  })
})