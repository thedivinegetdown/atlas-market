import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  createMultiStrategyPortfolioManager,
  evaluateMultiStrategyPortfolioManager,
  STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT,
} from './multiStrategyPortfolioManager.js'

const activeStrategies = Object.freeze([
  Object.freeze({
    id: 'index-pullback',
    name: 'Index Pullback',
    priority: 1,
    enabled: true,
    maxExposurePct: 12,
    riskBudgetPct: 1,
  }),
  Object.freeze({
    id: 'vol-breakout',
    name: 'Volatility Breakout',
    priority: 2,
    enabled: true,
    maxExposurePct: 8,
    riskBudgetPct: 0.75,
  }),
])

const baseInput = Object.freeze({
  activeStrategies,
  proposedTrades: Object.freeze([
    Object.freeze({
      id: 'trade-1',
      strategy: 'Index Pullback',
      symbol: 'SPY',
      assetType: 'etf',
      side: 'buy',
      price: 100,
      quantity: 25,
      riskPct: 0.4,
      paperTrading: true,
    }),
  ]),
  aiDecision: Object.freeze({
    eventType: 'ai.decision.orchestrated',
    finalDecision: 'approve',
    decisionInput: Object.freeze({
      proposedTrade: Object.freeze({ strategy: 'Index Pullback', symbol: 'SPY' }),
    }),
  }),
  capitalAllocation: Object.freeze({
    eventType: 'portfolio.capitalAllocation.recommended',
    account: Object.freeze({ accountValue: 100000 }),
    allocation: Object.freeze({
      byStrategy: Object.freeze([
        Object.freeze({ strategy: 'Index Pullback', allocationState: 'balanced' }),
        Object.freeze({ strategy: 'Volatility Breakout', allocationState: 'balanced' }),
      ]),
    }),
  }),
  portfolioAnalytics: Object.freeze({ eventType: 'portfolio.analytics.updated' }),
  strategyAttribution: Object.freeze({
    eventType: 'strategy.attribution.evaluated',
    strategies: Object.freeze([
      Object.freeze({ strategy: 'Index Pullback', trades: 4, winRate: 75, profitFactor: 2, expectancy: 150, netRealizedPnl: 600 }),
      Object.freeze({ strategy: 'Volatility Breakout', trades: 2, winRate: 50, profitFactor: 1.1, expectancy: 20, netRealizedPnl: 40 }),
    ]),
  }),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    account: Object.freeze({ accountValue: 100000 }),
  }),
})

describe('multiStrategyPortfolioManager', () => {
  it('builds an active strategy registry and priority ranking', () => {
    const result = evaluateMultiStrategyPortfolioManager(baseInput, { emitEvent: false })

    expect(result.paperTrading).toBe(true)
    expect(result.eventType).toBe(STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT)
    expect(result.strategyApprovalStatus).toBe('approved')
    expect(result.activeStrategyRegistry).toHaveLength(2)
    expect(result.priorityRanking.map((item) => item.strategy)).toEqual(['Index Pullback', 'Volatility Breakout'])
  })

  it('blocks duplicate symbol trades across strategies', () => {
    const result = evaluateMultiStrategyPortfolioManager({
      ...baseInput,
      proposedTrades: [
        ...baseInput.proposedTrades,
        {
          id: 'trade-2',
          strategy: 'Volatility Breakout',
          symbol: 'SPY',
          assetType: 'etf',
          side: 'buy',
          price: 101,
          quantity: 10,
          riskPct: 0.2,
          paperTrading: true,
        },
      ],
    }, { emitEvent: false })

    expect(result.strategyApprovalStatus).toBe('blocked')
    expect(result.duplicateSymbolTrades).toHaveLength(1)
    expect(result.duplicateSymbolTrades[0].symbol).toBe('SPY')
    expect(result.strategyEvaluations.some((item) => item.blockers.includes('Duplicate symbol trade detected'))).toBe(true)
  })

  it('blocks conflicting long and short signals on the same symbol', () => {
    const result = evaluateMultiStrategyPortfolioManager({
      ...baseInput,
      proposedTrades: [
        {
          id: 'long-spy',
          strategy: 'Index Pullback',
          symbol: 'SPY',
          assetType: 'etf',
          side: 'buy',
          notional: 3000,
          riskPct: 0.2,
          paperTrading: true,
        },
        {
          id: 'short-spy',
          strategy: 'Volatility Breakout',
          symbol: 'SPY',
          assetType: 'etf',
          side: 'short',
          notional: 2000,
          riskPct: 0.2,
          paperTrading: true,
        },
      ],
    }, { emitEvent: false })

    expect(result.strategyApprovalStatus).toBe('blocked')
    expect(result.conflictingSignals).toHaveLength(1)
    expect(result.conflictingSignals[0].directions).toEqual(['long', 'short'])
  })

  it('blocks strategies that exceed exposure limits or risk budgets', () => {
    const result = evaluateMultiStrategyPortfolioManager({
      ...baseInput,
      proposedTrades: [
        {
          id: 'oversized',
          strategy: 'Volatility Breakout',
          symbol: 'ES',
          assetType: 'futures',
          side: 'short',
          notional: 15000,
          riskPct: 1.1,
          paperTrading: true,
        },
      ],
    }, { emitEvent: false })

    const strategy = result.strategyEvaluations.find((item) => item.strategy === 'Volatility Breakout')

    expect(strategy.approvalStatus).toBe('blocked')
    expect(strategy.blockers).toContain('Strategy exposure limit exceeded')
    expect(strategy.blockers).toContain('Strategy risk budget exceeded')
  })

  it('returns caution when AI decision or allocation state requires review', () => {
    const result = evaluateMultiStrategyPortfolioManager({
      ...baseInput,
      aiDecision: {
        ...baseInput.aiDecision,
        finalDecision: 'caution',
      },
      capitalAllocation: {
        ...baseInput.capitalAllocation,
        allocation: {
          byStrategy: [
            { strategy: 'Index Pullback', allocationState: 'underweight' },
          ],
        },
      },
    }, { emitEvent: false })

    const strategy = result.strategyEvaluations.find((item) => item.strategy === 'Index Pullback')

    expect(result.strategyApprovalStatus).toBe('caution')
    expect(strategy.approvalStatus).toBe('caution')
    expect(strategy.cautions).toContain('AI decision is caution')
    expect(strategy.cautions).toContain('Strategy allocation is underweight')
  })

  it('blocks disabled strategies and non-paper trades', () => {
    const result = evaluateMultiStrategyPortfolioManager({
      ...baseInput,
      activeStrategies: [
        { ...activeStrategies[0], enabled: false },
      ],
      proposedTrades: [
        { ...baseInput.proposedTrades[0], paperTrading: false },
      ],
    }, { emitEvent: false })

    const strategy = result.strategyEvaluations[0]

    expect(strategy.approvalStatus).toBe('blocked')
    expect(strategy.blockers).toContain('Strategy is disabled')
    expect(strategy.blockers).toContain('Only paper strategy trades are supported')
  })

  it('references upstream AI, allocation, analytics, attribution, and risk outputs', () => {
    const result = evaluateMultiStrategyPortfolioManager(baseInput, { emitEvent: false })

    expect(result.references).toMatchObject({
      aiDecisionEvents: ['ai.decision.orchestrated'],
      capitalAllocationEvent: 'portfolio.capitalAllocation.recommended',
      portfolioAnalyticsEvent: 'portfolio.analytics.updated',
      strategyAttributionEvent: 'strategy.attribution.evaluated',
      portfolioRiskEvent: 'portfolio.risk.evaluated',
    })
  })

  it('emits the strategy portfolio manager event', () => {
    const eventBus = createEventBus()
    const events = []

    eventBus.subscribe(STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createMultiStrategyPortfolioManager({ eventBus }).evaluate(baseInput, {
      timestamp: '2026-07-03T21:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      eventType: STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT,
      timestamp: '2026-07-03T21:00:00.000Z',
      paperTrading: true,
    })
  })
})
