import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT,
  createMarketIntelligenceEngine,
  evaluateMarketIntelligence,
  summarizeMarketRegime,
  summarizeRiskSentiment,
  summarizeTrendContext,
  summarizeVolatilityContext,
} from './marketIntelligenceEngine.js'

const baseInput = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  marketData: Object.freeze({
    symbol: 'SPY',
    assetType: 'etf',
    price: 526,
    high: 528,
    low: 524,
    changePercent: 0.9,
  }),
  portfolioAnalytics: Object.freeze({
    eventType: 'portfolio.analytics.updated',
    exposure: Object.freeze({ grossExposure: 72 }),
  }),
  riskSnapshot: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({
      riskScore: 24,
      riskLevel: 'moderate',
      weightedVolatility: 1.2,
    }),
  }),
  aiDecision: Object.freeze({
    eventType: 'ai.decision.orchestrated',
    finalDecision: 'approve',
    confidenceScore: 74,
    signalQuality: Object.freeze({ score: 76 }),
  }),
  releaseReadiness: Object.freeze({
    eventType: 'system.releaseReadiness.evaluated',
    releaseReadinessStatus: 'ready',
  }),
  marketDataAdapterHealth: Object.freeze({
    eventType: 'marketData.adapter.checked',
    provider: 'mock-market-data-adapter',
  }),
  catalysts: Object.freeze([
    Object.freeze({
      type: 'earnings',
      title: 'Index constituents show broad earnings resilience',
      sentiment: 'positive',
      confidence: 70,
    }),
  ]),
})

describe('market intelligence engine', () => {
  it('summarizes market regime from market, portfolio, and risk context', () => {
    expect(summarizeMarketRegime({
      marketData: baseInput.marketData,
      portfolioAnalytics: baseInput.portfolioAnalytics,
      riskSnapshot: baseInput.riskSnapshot,
    })).toMatchObject({
      trendBias: 'constructive',
      exposureBias: 'invested',
      riskLevel: 'moderate',
    })
  })

  it('summarizes volatility, trend, and risk sentiment', () => {
    expect(summarizeVolatilityContext({
      marketData: baseInput.marketData,
      riskSnapshot: baseInput.riskSnapshot,
    })).toMatchObject({
      label: 'contained',
    })

    expect(summarizeTrendContext({
      marketData: baseInput.marketData,
      aiDecision: baseInput.aiDecision,
    })).toMatchObject({
      direction: 'upward',
      aiSignalScore: 76,
    })

    expect(summarizeRiskSentiment({
      riskSnapshot: baseInput.riskSnapshot,
      aiDecision: baseInput.aiDecision,
      releaseReadiness: baseInput.releaseReadiness,
    })).toMatchObject({
      label: 'supportive',
      aiDecision: 'approve',
      releaseStatus: 'ready',
    })
  })

  it('evaluates a constructive research setup', () => {
    const result = evaluateMarketIntelligence(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-04T13:00:00.000Z',
    })

    expect(result.eventType).toBe(RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.symbol).toBe('SPY')
    expect(result.marketRegimeSummary.label).toContain('constructive')
    expect(result.riskSentimentSummary.label).toBe('supportive')
    expect(result.researchInputSummary).toMatchObject({
      mode: 'mock',
      paperTrading: true,
      provider: 'mock-market-data-adapter',
      liveNewsConnected: false,
      paidApiRequired: false,
    })
    expect(result.catalystSummary).toMatchObject({
      count: 1,
      dominantSentiment: 'positive',
      averageConfidence: 70,
    })
    expect(result.decisionReadiness).toMatchObject({
      readyForPaperDecision: true,
      status: 'ready',
    })
    expect(result.confidenceScore).toBeGreaterThan(60)
    expect(result.researchBrief).toContain('SPY etf research context')
    expect(result.researchBrief).toContain('no paid API or live news dependency')
    expect(result.sourceEvents).toMatchObject({
      marketDataAdapter: 'marketData.adapter.checked',
      portfolioAnalytics: 'portfolio.analytics.updated',
      portfolioRisk: 'portfolio.risk.evaluated',
      aiDecision: 'ai.decision.orchestrated',
      releaseReadiness: 'system.releaseReadiness.evaluated',
    })
  })

  it('evaluates a high-risk defensive setup', () => {
    const result = evaluateMarketIntelligence({
      ...baseInput,
      marketData: {
        ...baseInput.marketData,
        high: 540,
        low: 500,
        changePercent: -2.2,
      },
      riskSnapshot: {
        eventType: 'portfolio.risk.evaluated',
        summary: {
          riskScore: 72,
          riskLevel: 'high',
          weightedVolatility: 4.2,
        },
      },
      aiDecision: {
        eventType: 'ai.decision.orchestrated',
        finalDecision: 'caution',
        signalQuality: { score: 38 },
      },
      releaseReadiness: {
        eventType: 'system.releaseReadiness.evaluated',
        releaseReadinessStatus: 'caution',
      },
    }, { emitEvent: false })

    expect(result.marketRegimeSummary.trendBias).toBe('defensive')
    expect(result.volatilityContext.label).toBe('stressed')
    expect(result.trendContext.direction).toBe('downward')
    expect(result.riskSentimentSummary.label).toBe('risk-off')
    expect(result.decisionReadiness.readyForPaperDecision).toBe(false)
    expect(result.confidenceScore).toBeLessThan(45)
  })

  it('handles missing data with neutral defaults', () => {
    const result = evaluateMarketIntelligence({}, { emitEvent: false })

    expect(result.symbol).toBe('MARKET')
    expect(result.assetType).toBe('etf')
    expect(result.catalysts).toEqual([])
    expect(result.catalystSummary.summary).toContain('No catalyst inputs supplied')
    expect(result.researchInputSummary.provider).toBe('mock-research-input')
    expect(result.researchBrief).toContain('no catalyst inputs supplied')
    expect(result.confidenceScore).toBeGreaterThan(0)
  })

  it('normalizes unsupported asset types for asset-agnostic consumers', () => {
    const result = evaluateMarketIntelligence({
      ...baseInput,
      assetType: 'unsupported-asset',
    }, { emitEvent: false })

    expect(result.assetType).toBe('equity')
    expect(result.paperTrading).toBe(true)
  })

  it('emits market intelligence events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createMarketIntelligenceEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT)
  })
})
