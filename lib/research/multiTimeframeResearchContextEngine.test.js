import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT,
  createMultiTimeframeResearchContextEngine,
  evaluateMultiTimeframeResearchContext,
} from './multiTimeframeResearchContextEngine.js'

function buildDecisionContext({ bucket, bias = 'bullish', score = 76, trend = 'upward', volatility = 'contained' } = {}) {
  return {
    bucket,
    researchIntelligence: {
      eventType: 'research.marketIntelligence.evaluated',
      symbol: 'SPY',
      assetType: 'etf',
      trendContext: { direction: trend, score },
      volatilityContext: { label: volatility, score: volatility === 'stressed' ? 28 : 78 },
      riskSentimentSummary: { label: bias === 'avoid' ? 'risk-off' : 'supportive', score: bias === 'avoid' ? 25 : 76 },
      catalystSummary: { count: 2, dominantSentiment: bias === 'bearish' ? 'negative' : 'positive', averageConfidence: 68 },
    },
    researchSignalScore: {
      eventType: 'research.signalScore.evaluated',
      symbol: 'SPY',
      assetType: 'etf',
      finalResearchScore: score,
      trendAlignmentScore: score,
      catalystStrengthScore: bias === 'bearish' ? 35 : 82,
      decisionBias: bias,
      volatilityAdjustment: { label: volatility, score: volatility === 'stressed' ? 28 : 78, adjustment: volatility === 'stressed' ? -18 : 8 },
      riskSentimentAdjustment: { label: bias === 'avoid' ? 'risk-off' : 'supportive', score: bias === 'avoid' ? 25 : 76, adjustment: bias === 'avoid' ? -25 : 10 },
      components: {
        trendAlignment: { direction: trend, summary: `${bucket} trend is ${trend}` },
        catalystStrength: { sentiment: bias === 'bearish' ? 'negative' : 'positive' },
      },
    },
    researchDecisionContext: {
      eventType: 'research.decisionContext.prepared',
      symbol: 'SPY',
      assetType: 'etf',
      researchScoreSummary: {
        finalResearchScore: score,
        trendAlignmentScore: score,
        catalystStrengthScore: bias === 'bearish' ? 35 : 82,
      },
      decisionBiasSummary: {
        decisionBias: bias,
        recommendedUse: bias === 'avoid' ? 'block_research_reliance' : 'directional_context',
      },
      marketContextSummary: {
        trend: { direction: trend, score, alignmentScore: score },
        volatility: { label: volatility, score: volatility === 'stressed' ? 28 : 78, adjustment: volatility === 'stressed' ? -18 : 8 },
        riskSentiment: { label: bias === 'avoid' ? 'risk-off' : 'supportive', score: bias === 'avoid' ? 25 : 76 },
      },
      aiDecisionCompatibility: {
        compatibleWithAIDecisionOrchestrator: true,
        paperTrading: true,
      },
    },
  }
}

describe('multi-timeframe research context engine', () => {
  it('evaluates aligned bullish research context across intraday, swing, and position buckets', () => {
    const result = evaluateMultiTimeframeResearchContext({
      timeframes: [
        buildDecisionContext({ bucket: 'intraday', score: 72 }),
        buildDecisionContext({ bucket: 'swing', score: 78 }),
        buildDecisionContext({ bucket: 'position', score: 82 }),
      ],
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T17:00:00.000Z',
    })

    expect(result.eventType).toBe(RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.timeframeBuckets.map((item) => item.bucket)).toEqual(['intraday', 'swing', 'position'])
    expect(result.timeframeTrendSummary.dominantDirection).toBe('upward')
    expect(result.timeframeVolatilitySummary.overallLabel).toBe('contained')
    expect(result.timeframeResearchScoreAlignment.aligned).toBe(true)
    expect(result.conflictDetection.hasConflicts).toBe(false)
    expect(result.dominantTimeframeBias.bias).toBe('bullish')
    expect(result.finalMultiTimeframeDecisionContext).toMatchObject({
      paperTrading: true,
      decisionBias: 'bullish',
      compatibleWithAIDecisionOrchestrator: true,
    })
    expect(result.aiDecisionCompatibility.scannerSignal).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      direction: 'bullish',
      source: 'multi-timeframe-research-context',
    })
  })

  it('detects conflicts across timeframe trends, scores, and decision biases', () => {
    const result = evaluateMultiTimeframeResearchContext({
      timeframes: [
        buildDecisionContext({ bucket: 'intraday', bias: 'bullish', score: 82, trend: 'upward' }),
        buildDecisionContext({ bucket: 'swing', bias: 'bearish', score: 32, trend: 'downward', volatility: 'stressed' }),
        buildDecisionContext({ bucket: 'position', bias: 'avoid', score: 24, trend: 'downward', volatility: 'stressed' }),
      ],
    }, { emitEvent: false })

    expect(result.conflictDetection.hasConflicts).toBe(true)
    expect(result.conflictDetection.conflicts.map((item) => item.type)).toContain('bias_conflict')
    expect(result.conflictDetection.conflicts.map((item) => item.type)).toContain('trend_conflict')
    expect(result.conflictDetection.conflicts.map((item) => item.type)).toContain('avoid_bias')
    expect(result.timeframeResearchScoreAlignment.aligned).toBe(false)
    expect(result.dominantTimeframeBias.bias).toBe('avoid')
    expect(result.aiDecisionCompatibility.cautions.length).toBeGreaterThan(0)
  })

  it('builds all timeframe buckets from shared Phase 16A through 16C outputs when explicit buckets are omitted', () => {
    const shared = buildDecisionContext({ bucket: 'swing', score: 68 })
    const result = evaluateMultiTimeframeResearchContext(shared, { emitEvent: false })

    expect(result.timeframeBuckets).toHaveLength(3)
    expect(result.timeframeBuckets.map((item) => item.bucket)).toEqual(['intraday', 'swing', 'position'])
    expect(result.sourceEvents.researchDecisionContext).toEqual(['research.decisionContext.prepared'])
  })

  it('emits multi-timeframe context events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createMultiTimeframeResearchContextEngine({ eventBus }).evaluate({
      timeframes: [
        buildDecisionContext({ bucket: 'intraday' }),
        buildDecisionContext({ bucket: 'swing' }),
        buildDecisionContext({ bucket: 'position' }),
      ],
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT)
  })
})
