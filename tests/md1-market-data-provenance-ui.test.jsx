import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { MarketDataStatus } from '../src/components/MarketDataStatus.jsx'

let root
let container
function render(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(ui))
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null })

describe('MD.1 market-data status UI', () => {
  it('labels mock data as development/demo and never live', () => {
    render(<MarketDataStatus provenance={{ dataStatus: 'MOCK', provider: 'mock', observedAt: '2026-08-11T16:00:00.000Z' }} />)
    expect(container.textContent).toContain('MOCK DATA')
    expect(container.textContent).toContain('not live market information')
    expect(container.textContent).not.toContain('LIVE')
  })

  it('defaults absent provenance to UNKNOWN with an unavailable as-of time', () => {
    render(<MarketDataStatus />)
    expect(container.textContent).toContain('UNKNOWN')
    expect(container.textContent).toContain('live status is not assumed')
    expect(container.textContent).toContain('As of: unavailable')
  })
})
