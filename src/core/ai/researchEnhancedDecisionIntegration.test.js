import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  AI_DECISION_RESEARCH_ENHANCED_EVENT,
  createResearchEnhancedDecisionIntegration,
  integrateResearchEnhancedDecision,
} from './researchEnhancedDecisionIntegration.js'

const baseDecisionInput = Object.freeze({
  proposedTrade: Object.freeze({
    symbol: 'SPY',
    assetType: 'etf',
    side: 'buy',
    paperTrading: true,
  }),
  scannerSignals: Object.freeze([
    Object.freeze({ symbol: 'SPY', direction: 'bullish', score: 74, confidence: 70, source: 'scanner-foundation' }),
  ]),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({ riskLevel: 'controlled', riskScore: 20 }),
  }),
  guardrailDecision: Object.freeze({
    eventType: 'trade.guardrail.evaluated',
    decision: 'approved',
    approved: true,
    reason: 'Trade passed paper guardrails',
  }),
  positionSizing: Object.freeze({
    eventType: 'trade.positionSize.recommended',
    status: 'recommended',
    suggestedQuantity: 10,
    quantityTerm: 'shares',
    reason: 'Paper size approved',
    metrics: Object.freeze({ riskPct: 0.5, dollarRisk: 500 }),
  }),
  capitalAllocation: Object.freeze({
    eventType: 'portfolio.capitalAllocation.recommended',
    allocationStatus: 'balanced',
    capital: Object.freeze({ availableCapital: 12000, remainingRiskBudget: 1500 }),
    recommendations: Object.freeze([]),
  }),
  drawdownProtection: Object.freeze({
    eventType: 'portfolio.drawdownProtection.evaluated',
    protectionStatus: 'clear',
    recommendedAction: 'continue',
    currentDrawdown: 1.5,
    warnings: Object.freeze([]),
  }),
  performanceSnapshot: Object.freeze({
    eventType: 'portfolio.performance.evaluated',
    metrics: Object.freeze({ profitFactor: 1.8, expectancy: 150 }),
  }),
  riskAdjustedPerformance: Object.freeze({
    eventType: 'portfolio.riskAdjustedPerformance.evaluated',
    metrics: Object.freeze({ riskAdjustedGrade: 'B' }),
  }),
})

const constructiveResearch = Object.freeze({
  marketIntelligence: Object.freeze({
    eventType: 'research.marketIntelligence.evaluated',
    symbol: 'SPY',
    assetType: 'etf',
    confidenceScore: 72,
    marketRegimeSummary: Object.freeze({ label: 'constructive invested' }),
    riskSentimentSummary: Object.freeze({ label: 'supportive' }),
    researchBrief: 'Constructive research context.',
  }),
  researchSignalScore: Object.freeze({
    eventType: 'research.signalScore.evaluated',
    finalResearchScore: 78,
    decisionBias: 'bullish',
    bullishScore: 92,
    bearishScore: 3,
    neutralScore: 11,
  }),
  researchDecisionContext: Object.freeze({
    eventType: 'research.decisionContext.prepared',
    researchScoreSummary: Object.freeze({ finalResearchScore: 78 }),
    decisionBiasSummary: Object.freeze({
      recommendedUse: 'directional_context',
      decisionBias: 'bullish',
    }),
    aiDecisionCompatibility: Object.freeze({
      scannerSignal: Object.freeze({
        symbol: 'SPY',
        assetType: 'etf',
        direction: 'bullish',
        score: 78,
        confidence: 76,
        source: 'research-decision-context',
      }),
      signal: Object.freeze({
        direction: 'bullish',
        score: 78,
        confidence: 76,
        source: 'research-decision-context',
      }),
      compatibleWithAIDecisionOrchestrator: true,
      paperTrading: true,
    }),
  }),
  multiTimeframeContext: Object.freeze({
    eventType: 'research.multiTimeframeContext.evaluated',
    dominantTimeframeBias: Object.freeze({ bias: 'bullish' }),
    timeframeResearchScoreAlignment: Object.freeze({ averageScore: 76 }),
    conflictDetection: Object.freeze({ hasConflicts: false, conflictCount: 0 }),
    aiDecisionCompatibility: Object.freeze({
      scannerSignal: Object.freeze({
        symbol: 'SPY',
        assetType: 'etf',
        direction: 'bullish',
        score: 76,
        confidence: 76,
        source: 'multi-timeframe-research-context',
      }),
    }),
  }),
  marketRegime: Object.freeze({
    eventType: 'market.regime.classified',
    compositeRegimeLabel: 'uptrend/normal/risk-on/healthy',
    regimeConfidenceScore: 70,
    trendRegime: Object.freeze({ regime: 'uptrend' }),
    volatilityRegime: Object.freeze({ regime: 'normal' }),
    riskRegime: Object.freeze({ regime: 'risk-on' }),
    liquidityRegime: Object.freeze({ regime: 'healthy' }),
    aiDecisionCompatibility: Object.freeze({
      scannerSignal: Object.freeze({
        symbol: 'SPY',
        assetType: 'etf',
        direction: 'bullish',
        score: 70,
        confidence: 70,
        source: 'market-regime-classifier',
      }),
    }),
  }),
})

describe('research enhanced decision integration', () => {
  it('confirms an approved paper decision with constructive research context', () => {
    const result = integrateResearchEnhancedDecision({
      baseDecisionInput,
      ...constructiveResearch,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T19:00:00.000Z',
    })

    expect(result.eventType).toBe(AI_DECISION_RESEARCH_ENHANCED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.orchestratedDecision.eventType).toBe('ai.decision.orchestrated')
    expect(result.finalResearchAwareDecisionSummary.finalDecision).toBe('approve')
    expect(result.researchInfluenceScore).toBeGreaterThan(65)
    expect(result.decisionAdjustmentRationale).toContain('Research confirms')
    expect(result.sourceEvents).toMatchObject({
      marketIntelligence: 'research.marketIntelligence.evaluated',
      researchSignalScore: 'research.signalScore.evaluated',
      researchDecisionContext: 'research.decisionContext.prepared',
      multiTimeframeContext: 'research.multiTimeframeContext.evaluated',
      marketRegime: 'market.regime.classified',
    })
  })

  it('downgrades an otherwise approved paper decision when research recommends avoid', () => {
    const result = integrateResearchEnhancedDecision({
      baseDecisionInput,
      ...constructiveResearch,
      researchSignalScore: {
        ...constructiveResearch.researchSignalScore,
        finalResearchScore: 24,
        decisionBias: 'avoid',
      },
      researchDecisionContext: {
        ...constructiveResearch.researchDecisionContext,
        researchScoreSummary: { finalResearchScore: 24 },
        decisionBiasSummary: {
          recommendedUse: 'block_research_reliance',
          decisionBias: 'avoid',
        },
      },
      multiTimeframeContext: {
        ...constructiveResearch.multiTimeframeContext,
        dominantTimeframeBias: { bias: 'avoid' },
        timeframeResearchScoreAlignment: { averageScore: 24 },
        conflictDetection: { hasConflicts: true, conflictCount: 2 },
      },
      marketRegime: {
        ...constructiveResearch.marketRegime,
        riskRegime: { regime: 'risk-off' },
        regimeConfidenceScore: 45,
      },
    }, { emitEvent: false })

    expect(result.orchestratedDecision.finalDecision).toBe('approve')
    expect(result.finalResearchAwareDecisionSummary.finalDecision).toBe('watchlist')
    expect(result.blockers).toContain('Research decision context recommends blocking research reliance')
    expect(result.cautions).toContain('Market regime is risk-off')
    expect(result.decisionAdjustmentRationale).toContain('Research adjusts')
  })

  it('emits research enhanced AI decision events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(AI_DECISION_RESEARCH_ENHANCED_EVENT, (payload) => events.push(payload))

    const result = createResearchEnhancedDecisionIntegration({ eventBus }).integrate({
      baseDecisionInput,
      ...constructiveResearch,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(AI_DECISION_RESEARCH_ENHANCED_EVENT)
  })
})
