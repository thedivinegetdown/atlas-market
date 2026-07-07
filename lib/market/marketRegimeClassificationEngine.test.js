import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  MARKET_REGIME_CLASSIFIED_EVENT,
  classifyMarketRegime,
  createMarketRegimeClassificationEngine,
} from './marketRegimeClassificationEngine.js'

const baseInput = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  marketData: Object.freeze({
    symbol: 'SPY',
    assetType: 'etf',
    price: 526,
    high: 528,
    low: 524,
    bid: 525.98,
    ask: 526.02,
    changePercent: 0.9,
    volume: 1200000,
  }),
  marketDataAdapterHealth: Object.freeze({
    eventType: 'marketData.adapter.checked',
    health: Object.freeze({
      available: true,
      stale: false,
    }),
  }),
  researchIntelligence: Object.freeze({
    eventType: 'research.marketIntelligence.evaluated',
    symbol: 'SPY',
    assetType: 'etf',
    trendContext: Object.freeze({ direction: 'upward', score: 74 }),
    volatilityContext: Object.freeze({ label: 'contained', score: 82, rangePct: 0.76 }),
    riskSentimentSummary: Object.freeze({ label: 'supportive', score: 76 }),
  }),
  researchSignalScore: Object.freeze({
    eventType: 'research.signalScore.evaluated',
    decisionBias: 'bullish',
    riskSentimentAdjustment: Object.freeze({ label: 'supportive', score: 76 }),
  }),
  multiTimeframeResearchContext: Object.freeze({
    eventType: 'research.multiTimeframeContext.evaluated',
    symbol: 'SPY',
    assetType: 'etf',
    timeframeTrendSummary: Object.freeze({
      dominantDirection: 'upward',
      averageAlignment: 78,
    }),
    timeframeVolatilitySummary: Object.freeze({
      overallLabel: 'contained',
      averageScore: 78,
    }),
    dominantTimeframeBias: Object.freeze({
      bias: 'bullish',
    }),
    conflictDetection: Object.freeze({
      hasConflicts: false,
    }),
    timeframeBuckets: Object.freeze([
      Object.freeze({ riskSentiment: Object.freeze({ label: 'supportive', score: 76 }) }),
    ]),
  }),
})

describe('market regime classification engine', () => {
  it('classifies constructive market conditions as uptrend, low volatility, risk-on, and healthy liquidity', () => {
    const result = classifyMarketRegime(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-07T18:00:00.000Z',
    })

    expect(result.eventType).toBe(MARKET_REGIME_CLASSIFIED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.symbol).toBe('SPY')
    expect(result.assetType).toBe('etf')
    expect(result.trendRegime.regime).toBe('uptrend')
    expect(result.volatilityRegime.regime).toBe('normal')
    expect(result.riskRegime.regime).toBe('risk-on')
    expect(result.liquidityRegime.regime).toBe('healthy')
    expect(result.compositeRegimeLabel).toBe('uptrend/normal/risk-on/healthy')
    expect(result.regimeConfidenceScore).toBeGreaterThan(50)
    expect(result.aiDecisionCompatibility).toMatchObject({
      compatibleWithAIDecisionOrchestrator: true,
      paperTrading: true,
      scannerSignal: {
        symbol: 'SPY',
        assetType: 'etf',
        direction: 'bullish',
        source: 'market-regime-classifier',
      },
    })
  })

  it('classifies stressed defensive conditions as downtrend, extreme volatility, and risk-off', () => {
    const result = classifyMarketRegime({
      ...baseInput,
      marketData: {
        ...baseInput.marketData,
        high: 540,
        low: 500,
        changePercent: -2.5,
      },
      researchIntelligence: {
        ...baseInput.researchIntelligence,
        trendContext: { direction: 'downward', score: 25 },
        volatilityContext: { label: 'stressed', score: 20, rangePct: 7.6 },
        riskSentimentSummary: { label: 'risk-off', score: 18 },
      },
      researchSignalScore: {
        eventType: 'research.signalScore.evaluated',
        decisionBias: 'avoid',
        riskSentimentAdjustment: { label: 'risk-off', score: 18 },
      },
      multiTimeframeResearchContext: {
        ...baseInput.multiTimeframeResearchContext,
        timeframeTrendSummary: { dominantDirection: 'downward', averageAlignment: 24 },
        timeframeVolatilitySummary: { overallLabel: 'stressed', averageScore: 20 },
        dominantTimeframeBias: { bias: 'avoid' },
        conflictDetection: { hasConflicts: true },
        timeframeBuckets: [{ riskSentiment: { label: 'risk-off', score: 18 } }],
      },
    }, { emitEvent: false })

    expect(result.trendRegime.regime).toBe('downtrend')
    expect(result.volatilityRegime.regime).toBe('extreme')
    expect(result.riskRegime.regime).toBe('risk-off')
    expect(result.aiDecisionCompatibility.scannerSignal.direction).toBe('neutral')
    expect(result.aiDecisionCompatibility.cautions).toContain('Market regime is risk-off')
  })

  it('detects stressed liquidity from stale or unavailable market data', () => {
    const result = classifyMarketRegime({
      ...baseInput,
      marketDataAdapterHealth: {
        eventType: 'marketData.adapter.checked',
        health: {
          available: false,
          stale: true,
        },
      },
    }, { emitEvent: false })

    expect(result.liquidityRegime.regime).toBe('stressed')
    expect(result.liquidityRegime.marketDataAvailable).toBe(false)
    expect(result.liquidityRegime.stale).toBe(true)
  })

  it('normalizes missing context for asset-agnostic paper consumers', () => {
    const result = classifyMarketRegime({}, { emitEvent: false })

    expect(result.symbol).toBe('MARKET')
    expect(result.assetType).toBe('equity')
    expect(result.paperTrading).toBe(true)
    expect(result.compositeRegimeLabel).toContain('/')
  })

  it('emits market regime classified events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(MARKET_REGIME_CLASSIFIED_EVENT, (payload) => events.push(payload))

    const result = createMarketRegimeClassificationEngine({ eventBus }).classify(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(MARKET_REGIME_CLASSIFIED_EVENT)
  })
})
