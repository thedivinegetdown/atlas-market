import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  RESEARCH_DECISION_CONTEXT_PREPARED_EVENT,
  createResearchDecisionContextEngine,
  prepareResearchDecisionContext,
} from './researchDecisionContextEngine.js'

const researchIntelligence = Object.freeze({
  eventType: 'research.marketIntelligence.evaluated',
  paperTrading: true,
  symbol: 'SPY',
  assetType: 'etf',
  researchBrief: 'SPY etf research context is constructive.',
  marketRegimeSummary: Object.freeze({
    label: 'constructive invested',
    trendBias: 'constructive',
    exposureBias: 'invested',
    summary: 'Market regime is constructive invested with moderate portfolio risk.',
  }),
  volatilityContext: Object.freeze({
    label: 'contained',
    score: 82,
    summary: 'Volatility is contained.',
  }),
  trendContext: Object.freeze({
    direction: 'upward',
    score: 74,
    summary: 'Trend context is upward.',
  }),
  riskSentimentSummary: Object.freeze({
    label: 'supportive',
    score: 76,
    summary: 'Risk sentiment is supportive.',
  }),
  catalystSummary: Object.freeze({
    count: 2,
    dominantSentiment: 'positive',
    averageConfidence: 68,
    sources: Object.freeze(['demo-research-input']),
    liveNewsConnected: false,
    paidApiRequired: false,
    summary: '2 mock catalyst inputs reviewed with positive sentiment.',
  }),
})

const researchSignalScore = Object.freeze({
  eventType: 'research.signalScore.evaluated',
  paperTrading: true,
  symbol: 'SPY',
  assetType: 'etf',
  bullishScore: 92,
  bearishScore: 3,
  neutralScore: 11,
  catalystStrengthScore: 88,
  trendAlignmentScore: 86,
  finalResearchScore: 84,
  decisionBias: 'bullish',
  volatilityAdjustment: Object.freeze({
    label: 'contained',
    score: 82,
    adjustment: 8,
    summary: 'Volatility context is contained with 82 score.',
  }),
  riskSentimentAdjustment: Object.freeze({
    label: 'supportive',
    score: 76,
    adjustment: 10,
    summary: 'Risk sentiment is supportive with 76 score.',
  }),
  components: Object.freeze({
    catalystStrength: Object.freeze({
      sentiment: 'positive',
      catalystCount: 2,
      summary: '2 catalyst inputs create positive catalyst strength.',
    }),
    trendAlignment: Object.freeze({
      direction: 'upward',
      aiSignalScore: 76,
      summary: 'Trend alignment is upward with AI signal quality at 76.',
    }),
  }),
  sourceEvents: Object.freeze({
    aiDecision: 'ai.decision.orchestrated',
  }),
})

describe('research decision context engine', () => {
  it('packages research intelligence and signal score into normalized decision context', () => {
    const result = prepareResearchDecisionContext({
      researchIntelligence,
      researchSignalScore,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T16:00:00.000Z',
    })

    expect(result.eventType).toBe(RESEARCH_DECISION_CONTEXT_PREPARED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.symbol).toBe('SPY')
    expect(result.assetType).toBe('etf')
    expect(result.normalizedResearchContext.paperTrading).toBe(true)
    expect(result.researchScoreSummary).toMatchObject({
      finalResearchScore: 84,
      bullishScore: 92,
      catalystStrengthScore: 88,
      trendAlignmentScore: 86,
    })
    expect(result.decisionBiasSummary).toMatchObject({
      decisionBias: 'bullish',
      recommendedUse: 'directional_context',
      directional: true,
      avoid: false,
      confidenceBand: 'high',
    })
    expect(result.catalystContextSummary).toMatchObject({
      count: 2,
      dominantSentiment: 'positive',
      strengthScore: 88,
      liveNewsConnected: false,
      paidApiRequired: false,
    })
    expect(result.marketContextSummary.trend).toMatchObject({
      direction: 'upward',
      alignmentScore: 86,
    })
  })

  it('creates AI decision orchestrator-compatible signal context', () => {
    const result = prepareResearchDecisionContext({
      researchIntelligence,
      researchSignalScore,
    }, { emitEvent: false })

    expect(result.aiDecisionCompatibility).toMatchObject({
      compatibleWithAIDecisionOrchestrator: true,
      paperTrading: true,
      scannerSignal: {
        symbol: 'SPY',
        assetType: 'etf',
        direction: 'bullish',
        score: 84,
        source: 'research-decision-context',
      },
      signal: {
        source: 'research-decision-context',
        direction: 'bullish',
        score: 84,
      },
    })
  })

  it('marks avoid context as a research reliance blocker without brokerage behavior', () => {
    const result = prepareResearchDecisionContext({
      researchIntelligence,
      researchSignalScore: {
        ...researchSignalScore,
        decisionBias: 'avoid',
        finalResearchScore: 22,
        bullishScore: 8,
        bearishScore: 80,
      },
    }, { emitEvent: false })

    expect(result.paperTrading).toBe(true)
    expect(result.decisionBiasSummary).toMatchObject({
      decisionBias: 'avoid',
      recommendedUse: 'block_research_reliance',
      avoid: true,
      confidenceBand: 'low',
    })
    expect(result.aiDecisionCompatibility.cautions).toContain('Research decision context recommends avoid')
  })

  it('normalizes missing context for asset-agnostic consumers', () => {
    const result = prepareResearchDecisionContext({}, { emitEvent: false })

    expect(result.symbol).toBe('MARKET')
    expect(result.assetType).toBe('equity')
    expect(result.researchScoreSummary.finalResearchScore).toBe(0)
    expect(result.decisionBiasSummary.decisionBias).toBe('neutral')
    expect(result.aiDecisionCompatibility.scannerSignal.direction).toBe('neutral')
  })

  it('emits research decision context events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(RESEARCH_DECISION_CONTEXT_PREPARED_EVENT, (payload) => events.push(payload))

    const result = createResearchDecisionContextEngine({ eventBus }).prepare({
      researchIntelligence,
      researchSignalScore,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(RESEARCH_DECISION_CONTEXT_PREPARED_EVENT)
  })
})
