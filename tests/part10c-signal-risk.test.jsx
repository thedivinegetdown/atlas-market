import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { SignalPanel } from '../src/components/SignalPanel'
import { RiskPanel } from '../src/components/RiskPanel'
import { useSignals } from '../src/hooks/useSignals'
import { useRisk } from '../src/hooks/useRisk'

const quote = {
  symbol: 'NVDA',
  price: 140,
  open: 130,
  high: 140.5,
  low: 128,
  previousClose: 125,
  change: 15,
  changePercent: 12,
  volume: 8000000,
  updatedAt: new Date().toISOString(),
}

const safeRisk = {
  symbol: 'NVDA',
  approved: true,
  accountValue: 100000,
  maxRiskPerTrade: 1,
  positionSize: 2,
  stopDistance: 2.8,
  stopPrice: 137.2,
  targetPrice: 145.6,
  rewardRatio: 2,
  dollarRisk: 5.6,
  accountExposure: 0.28,
  dailyExposure: 0.06,
  portfolioRisk: 10,
  buyingPowerImpact: 0.28,
  warning: null,
}

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

function SignalHookProbe() {
  const { signal } = useSignals(quote)
  return (
    <div>
      <span>{signal.symbol}</span>
      <span>{signal.action}</span>
      <span>{signal.trendDirection}</span>
      <span>{signal.breakout}</span>
      <span>{signal.bullScore}</span>
    </div>
  )
}

function RiskHookProbe() {
  const { risk } = useRisk({
    quote,
    portfolio: { cash: 100000, exposure: 0.1 },
    accountSummary: { accountValue: 100000, buyingPower: 100000 },
  })
  return (
    <div>
      <span>{risk.symbol}</span>
      <span>{risk.warning}</span>
      <span>{risk.stopPrice}</span>
      <span>{risk.targetPrice}</span>
    </div>
  )
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10C signal and risk panels', () => {
  it('renders the full signal panel metric set', () => {
    renderWithRoot(<SignalPanel signal={{
      symbol: 'NVDA',
      action: 'BUY',
      confidence: 92,
      trendDirection: 'Up',
      momentum: 12,
      breakout: 'Breakout',
      meanReversion: 'Extended',
      bullScore: 95,
      bearScore: 5,
      strength: 90,
      thesis: 'Strong bullish setup.',
      updatedAt: quote.updatedAt,
    }} />)

    expect(container.textContent).toContain('Active Symbol')
    expect(container.textContent).toContain('Overall Signal')
    expect(container.textContent).toContain('Confidence')
    expect(container.textContent).toContain('Trend Direction')
    expect(container.textContent).toContain('Momentum')
    expect(container.textContent).toContain('Breakout Status')
    expect(container.textContent).toContain('Mean Reversion')
    expect(container.textContent).toContain('Bull Score')
    expect(container.textContent).toContain('Bear Score')
    expect(container.textContent).toContain('Signal Strength')
    expect(container.textContent).toContain('Last Calculated')
  })

  it('renders signal loading, error, and empty states', () => {
    renderWithRoot(<SignalPanel symbol="NVDA" loading error="Signal unavailable" />)

    expect(container.textContent).toContain('Loading signal metrics')
    expect(container.textContent).toContain('Signal unavailable')

    act(() => {
      root.render(<SignalPanel symbol="" signal={null} />)
    })

    expect(container.textContent).toContain('Select a symbol')
  })

  it('calls refresh from the signal panel', () => {
    const onRefresh = vi.fn()
    renderWithRoot(<SignalPanel signal={{ symbol: 'NVDA', action: 'BUY', updatedAt: quote.updatedAt }} onRefresh={onRefresh} />)

    act(() => {
      container.querySelector('button').click()
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders the full risk panel metric set', () => {
    renderWithRoot(<RiskPanel risk={safeRisk} />)

    expect(container.textContent).toContain('Active Symbol')
    expect(container.textContent).toContain('Account Value')
    expect(container.textContent).toContain('Max Risk Per Trade')
    expect(container.textContent).toContain('Position Size')
    expect(container.textContent).toContain('Stop Distance')
    expect(container.textContent).toContain('Stop Price')
    expect(container.textContent).toContain('Target Price')
    expect(container.textContent).toContain('Risk / Reward')
    expect(container.textContent).toContain('Dollar Risk')
    expect(container.textContent).toContain('Account Exposure')
    expect(container.textContent).toContain('Daily Exposure')
    expect(container.textContent).toContain('Portfolio Risk')
    expect(container.textContent).toContain('Buying Power Impact')
  })

  it('renders a risk warning when the trade exceeds limits', () => {
    renderWithRoot(<RiskPanel risk={{ ...safeRisk, approved: false, warning: 'order notional exceeds limit' }} />)

    expect(container.textContent).toContain('Risk warning')
    expect(container.textContent).toContain('order notional exceeds limit')
    expect(container.textContent).toContain('Blocked')
  })

  it('calculates signal metrics through the signal hook', () => {
    renderWithRoot(<SignalHookProbe />)

    expect(container.textContent).toContain('NVDA')
    expect(container.textContent).toContain('BUY')
    expect(container.textContent).toContain('Up')
    expect(container.textContent).toContain('Breakout')
  })

  it('integrates risk calculations through the risk hook', () => {
    renderWithRoot(<RiskHookProbe />)

    expect(container.textContent).toContain('NVDA')
    expect(container.textContent).toContain('order notional exceeds limit')
    expect(container.textContent).toContain('137.2')
    expect(container.textContent).toContain('145.6')
  })
})
