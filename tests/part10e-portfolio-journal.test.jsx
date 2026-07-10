import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { PortfolioSummaryPanel } from '../src/components/PortfolioSummaryPanel'
import { EquityCurvePanel } from '../src/components/EquityCurvePanel'
import { JournalSummaryPanel } from '../src/components/panels'
import { usePortfolioAnalytics } from '../src/hooks/usePortfolioAnalytics'
import { useEquityCurve } from '../src/hooks/useEquityCurve'
import { useJournal } from '../src/hooks/useJournal'
import { resetStore } from '../lib/repositories/store'
import { journalRepository, portfolioRepository } from '../src/hooks/tradingRuntime'

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

async function flushApi() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function HookProbe() {
  const portfolio = usePortfolioAnalytics()
  const curve = useEquityCurve()
  const journal = useJournal({ search: 'breakout', symbol: 'AAPL', result: 'win' })

  return (
    <div>
      <span>{portfolio.summary.accountValue}</span>
      <span>{curve.points.length}</span>
      <span>{journal.filteredEntries.length}</span>
      <span>{journal.symbols.join(',')}</span>
    </div>
  )
}

beforeEach(() => {
  resetStore()
  portfolioRepository.create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
  journalRepository.create({
    symbol: 'AAPL',
    strategy: 'Breakout',
    emotion: 'focused',
    notes: 'AAPL breakout followed through.',
    tags: ['breakout', 'momentum'],
    result: 'win',
    duration: '45m',
    pnl: 250,
    createdAt: '2026-06-29T14:00:00.000Z',
  })
  journalRepository.create({
    symbol: 'MSFT',
    strategy: 'Mean Reversion',
    emotion: 'patient',
    notes: 'MSFT reverted slowly.',
    tags: ['reversion'],
    result: 'loss',
    duration: '30m',
    pnl: -100,
    createdAt: '2026-06-29T15:00:00.000Z',
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10E portfolio, equity curve, and journal', () => {
  it('renders all portfolio summary metrics', () => {
    renderWithRoot(<PortfolioSummaryPanel />)

    expect(container.textContent).toContain('Account Value')
    expect(container.textContent).toContain('Cash')
    expect(container.textContent).toContain('Buying Power')
    expect(container.textContent).toContain('Average Winner')
    expect(container.textContent).toContain('Average Loser')
    expect(container.textContent).toContain('Profit Factor')
    expect(container.textContent).toContain('Sharpe Ratio')
    expect(container.textContent).toContain('Expectancy')
    expect(container.textContent).toContain('Open Risk')
  })

  it('renders the equity curve and performance timeline', async () => {
    renderWithRoot(<EquityCurvePanel />)
    await flushApi()

    expect(container.textContent).toContain('Equity Curve')
    expect(container.textContent).toContain('Max DD')
    expect(container.textContent).toContain('AAPL')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a clean empty equity state', () => {
    renderWithRoot(<EquityCurvePanel points={[]} drawdowns={[]} timeline={[]} maxDrawdown={0} />)

    expect(container.textContent).toContain('No equity curve data yet')
  })

  it('renders journal trade details', async () => {
    renderWithRoot(<JournalSummaryPanel />)
    await flushApi()

    expect(container.textContent).toContain('Recent trades')
    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Breakout')
    expect(container.textContent).toContain('focused')
    expect(container.textContent).toContain('breakout, momentum')
    expect(container.textContent).toContain('45m')
  })

  it('filters journal entries by search', async () => {
    renderWithRoot(<JournalSummaryPanel />)
    await flushApi()

    const input = container.querySelector('input')
    act(() => {
      input.value = 'slowly'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flushApi()

    expect(container.textContent).toContain('MSFT')
    expect(container.textContent).not.toContain('AAPL breakout followed through')
  })

  it('filters journal entries by symbol and result', async () => {
    renderWithRoot(<JournalSummaryPanel />)
    await flushApi()

    const [symbolSelect, resultSelect] = container.querySelectorAll('select')
    act(() => {
      symbolSelect.value = 'MSFT'
      symbolSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => {
      resultSelect.value = 'loss'
      resultSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushApi()

    expect(container.textContent).toContain('MSFT')
    expect(container.textContent).toContain('loss')
    expect(container.textContent).not.toContain('AAPL breakout followed through')
  })

  it('exposes portfolio, equity curve, and journal hook behavior', async () => {
    renderWithRoot(<HookProbe />)
    await flushApi()

    expect(container.textContent).toContain('100150')
    expect(container.textContent).toContain('2')
    expect(container.textContent).toContain('AAPL')
  })
})
