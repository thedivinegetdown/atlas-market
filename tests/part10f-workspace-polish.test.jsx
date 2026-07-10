import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { OrdersPanel, PositionsPanel, JournalSummaryPanel } from '../src/components/panels'

let root = null
let container = null

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10F workspace polish', () => {
  it('keeps paper mode visible and active symbol wired through the shell', () => {
    renderWithRoot(<App />)

    expect(container.textContent).toContain('Paper Trading')
    expect(container.textContent).toContain('SPY')
    expect(container.textContent).toContain('Market Overview')
    expect(container.textContent).toContain('Signal Panel')
    expect(container.textContent).toContain('Risk Panel')
  })

  it('highlights active-symbol rows in orders, positions, and journal panels', () => {
    renderWithRoot(
      <div>
        <OrdersPanel
          activeSymbol="AAPL"
          orders={[{ id: 'order-1', symbol: 'AAPL', side: 'BUY', type: 'LIMIT', quantity: 1, price: 100, state: 'WORKING', createdAt: Date.now() }]}
          onRefresh={() => {}}
          onCancelOrder={() => {}}
        />
        <PositionsPanel
          activeSymbol="AAPL"
          positions={[{ symbol: 'AAPL', quantity: 1, averageCost: 100, currentPrice: 101, marketValue: 101, unrealizedPnl: 1, realizedPnl: 0, dailyReturn: 1, riskPct: 0.1, weight: 0.1 }]}
          onRefresh={() => {}}
        />
        <JournalSummaryPanel activeSymbol="AAPL" entries={[{ id: 'journal-1', symbol: 'AAPL', strategy: 'Breakout', emotion: 'calm', notes: 'Clean follow through', tags: ['momentum'], result: 'win', duration: '12m', createdAt: Date.now() }]} />
      </div>,
    )

    expect(container.querySelectorAll('.active-row').length).toBe(2)
    expect(container.textContent).toContain('Active: AAPL')
  })

  it('does not retain unused Vite starter assets', () => {
    const assetsDir = resolve(process.cwd(), 'src/assets')

    expect(existsSync(resolve(assetsDir, 'react.svg'))).toBe(false)
    expect(existsSync(resolve(assetsDir, 'vite.svg'))).toBe(false)
    expect(existsSync(resolve(assetsDir, 'hero.png'))).toBe(false)
  })
})
