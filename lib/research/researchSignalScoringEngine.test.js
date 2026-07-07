import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT,
  createResearchSignalScoringEngine,
  evaluateResearchSignalScore,
} from './researchSignalScoringEngine.js'

const constructiveResearch = Object.freeze({
  eventType: 'research.marketIntelligence.evaluated',
  paperTrading: true,
  symbol: 'SPY',
  assetType: 'etf',
  confidenceScore: 72,
  catalystSummary: Object.freeze({
    count: 2,
    dominantSentiment: 'positive',
    averageConfidence: 68,
  }),
  volatilityContext: Object.freeze({
    label: 'contained',
    score: 82,
  }),
  trendContext: Object.freeze({
    direction: 'upward',
    score: 74,
    aiSignalScore: 76,
  }),
  riskSentimentSummary: Object.freeze({
    label: 'supportive',
    score: 76,
  }),
  decisionReadiness: Object.freeze({
    readyForPaperDecision: true,
    status: 'ready',
  }),
})

const aiDecision = Object.freeze({
  eventType: 'ai.decision.orchestrated',
  finalDecision: 'approve',
  signalQuality: Object.freeze({ score: 76 }),
})

describe('research signal scoring engine', () => {
  it('converts constructive research intelligence into bullish paper signal context', () => {
    const result = evaluateResearchSignalScore({
      researchIntelligence: constructiveResearch,
      aiDecision,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T15:00:00.000Z',
    })

    expect(result.eventType).toBe(RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.symbol).toBe('SPY')
    expect(result.assetType).toBe('etf')
    expect(result.bullishScore).toBeGreaterThan(result.bearishScore)
    expect(result.catalystStrengthScore).toBeGreaterThan(70)
    expect(result.trendAlignmentScore).toBeGreaterThan(70)
    expect(result.riskSentimentAdjustment.label).toBe('supportive')
    expect(result.finalResearchScore).toBeGreaterThan(58)
    expect(result.decisionBias).toBe('bullish')
    expect(result.summary).toContain('bullish paper-trading bias')
    expect(result.sourceEvents).toMatchObject({
      researchMarketIntelligence: 'research.marketIntelligence.evaluated',
      aiDecision: 'ai.decision.orchestrated',
    })
  })

  it('marks stressed risk-off research as avoid when paper readiness fails', () => {
    const result = evaluateResearchSignalScore({
      researchIntelligence: {
        ...constructiveResearch,
        confidenceScore: 34,
        catalystSummary: {
          count: 2,
          dominantSentiment: 'negative',
          averageConfidence: 72,
        },
        volatilityContext: {
          label: 'stressed',
          score: 24,
        },
        trendContext: {
          direction: 'downward',
          score: 28,
          aiSignalScore: 35,
        },
        riskSentimentSummary: {
          label: 'risk-off',
          score: 18,
        },
        decisionReadiness: {
          readyForPaperDecision: false,
          status: 'review',
        },
      },
      aiDecision: {
        eventType: 'ai.decision.orchestrated',
        finalDecision: 'caution',
        signalQuality: { score: 35 },
      },
    }, { emitEvent: false })

    expect(result.bearishScore).toBeGreaterThan(result.bullishScore)
    expect(result.volatilityAdjustment.adjustment).toBeLessThan(0)
    expect(result.riskSentimentAdjustment.adjustment).toBeLessThan(0)
    expect(result.finalResearchScore).toBeLessThan(45)
    expect(result.decisionBias).toBe('avoid')
  })

  it('handles neutral defaults without requiring live data or brokerage inputs', () => {
    const result = evaluateResearchSignalScore({}, { emitEvent: false })

    expect(result.symbol).toBe('MARKET')
    expect(result.assetType).toBe('equity')
    expect(result.paperTrading).toBe(true)
    expect(result.decisionBias).toBe('neutral')
    expect(result.sourceEvents).toMatchObject({
      researchMarketIntelligence: null,
      aiDecision: null,
    })
  })

  it('emits research signal score events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createResearchSignalScoringEngine({ eventBus }).evaluate({
      researchIntelligence: constructiveResearch,
      aiDecision,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT)
  })
})
