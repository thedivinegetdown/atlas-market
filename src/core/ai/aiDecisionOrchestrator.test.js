import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  AI_DECISION_ORCHESTRATED_EVENT,
  createAIDecisionOrchestrator,
  orchestrateAIDecision,
} from './aiDecisionOrchestrator.js'

const baseInput = Object.freeze({
  proposedTrade: Object.freeze({
    symbol: 'spy',
    assetType: 'etf',
    side: 'buy',
    paperTrading: true,
  }),
  scannerSignals: Object.freeze([
    Object.freeze({ symbol: 'SPY', direction: 'bullish', score: 78, confidence: 76, source: 'scanner' }),
  ]),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({ riskLevel: 'controlled', riskScore: 20 }),
  }),
  guardrailDecision: Object.freeze({
    eventType: 'trade.guardrail.evaluated',
    decision: 'approved',
    approved: true,
    reason: 'Trade passed all paper guardrails',
  }),
  positionSizing: Object.freeze({
    eventType: 'trade.positionSize.recommended',
    status: 'recommended',
    suggestedQuantity: 10,
    quantityTerm: 'shares',
    reason: 'Paper position size recommended within configured constraints',
    metrics: Object.freeze({ riskPct: 0.5, dollarRisk: 500 }),
  }),
  capitalAllocation: Object.freeze({
    eventType: 'portfolio.capitalAllocation.recommended',
    allocationStatus: 'balanced',
    capital: Object.freeze({ availableCapital: 12000, remainingRiskBudget: 1500 }),
    recommendations: Object.freeze(['Capital allocation is balanced against configured paper targets']),
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

describe('aiDecisionOrchestrator', () => {
  it('normalizes decision input and approves a high-quality paper setup', () => {
    const result = orchestrateAIDecision(baseInput, { emitEvent: false })

    expect(result.paperTrading).toBe(true)
    expect(result.eventType).toBe(AI_DECISION_ORCHESTRATED_EVENT)
    expect(result.decisionInput.symbol).toBe('SPY')
    expect(result.decisionInput.assetType).toBe('etf')
    expect(result.finalDecision).toBe('approve')
    expect(result.confidenceScore).toBeGreaterThan(70)
    expect(result.rationale).toContain('Approve paper decision')
  })

  it('scores signal quality from scanner and signal inputs', () => {
    const result = orchestrateAIDecision({
      ...baseInput,
      scannerSignals: [
        { symbol: 'SPY', direction: 'bullish', score: 80, confidence: 70 },
        { symbol: 'AAPL', direction: 'bearish', score: 95, confidence: 95 },
      ],
      signal: { direction: 'bullish', score: 72, confidence: 68 },
    }, { emitEvent: false })

    expect(result.signalQuality.signals).toHaveLength(2)
    expect(result.signalQuality.label).toBe('strong')
    expect(result.signalQuality.score).toBeGreaterThan(70)
  })

  it('returns caution when upstream controls are cautious but still usable', () => {
    const result = orchestrateAIDecision({
      ...baseInput,
      portfolioRisk: {
        eventType: 'portfolio.risk.evaluated',
        summary: { riskLevel: 'elevated', riskScore: 38 },
      },
      capitalAllocation: {
        ...baseInput.capitalAllocation,
        allocationStatus: 'caution',
      },
      drawdownProtection: {
        ...baseInput.drawdownProtection,
        protectionStatus: 'caution',
        recommendedAction: 'reduce risk',
      },
    }, { emitEvent: false })

    expect(result.finalDecision).toBe('caution')
    expect(result.cautions.length).toBeGreaterThan(0)
    expect(result.rationale).toContain('Proceed with caution')
  })

  it('rejects when guardrails or sizing reject the proposed paper trade', () => {
    const result = orchestrateAIDecision({
      ...baseInput,
      guardrailDecision: {
        eventType: 'trade.guardrail.evaluated',
        decision: 'rejected',
        approved: false,
        reason: 'Trade risk exceeds per-trade limit',
      },
      positionSizing: {
        ...baseInput.positionSizing,
        status: 'rejected',
        reason: 'drawdown protection is locked',
      },
    }, { emitEvent: false })

    expect(result.finalDecision).toBe('reject')
    expect(result.blockers).toContain('Trade risk exceeds per-trade limit')
    expect(result.blockers).toContain('drawdown protection is locked')
  })

  it('returns watchlist when signal quality is weak without hard blockers', () => {
    const result = orchestrateAIDecision({
      ...baseInput,
      scannerSignals: [
        { symbol: 'SPY', direction: 'bearish', score: 28, confidence: 35 },
      ],
      signal: { direction: 'neutral', score: 35, confidence: 40 },
    }, { emitEvent: false })

    expect(result.finalDecision).toBe('watchlist')
    expect(result.rationale).toContain('Watchlist only')
  })

  it('summarizes upstream risk, sizing, allocation, drawdown, and performance context', () => {
    const result = orchestrateAIDecision(baseInput, { emitEvent: false })

    expect(result.riskApprovalSummary).toMatchObject({
      approved: true,
      guardrailDecision: 'approved',
      riskLevel: 'controlled',
    })
    expect(result.positionSizingSummary).toMatchObject({
      approved: true,
      suggestedQuantity: 10,
      quantityTerm: 'shares',
    })
    expect(result.capitalAllocationSummary).toMatchObject({
      approved: true,
      allocationStatus: 'balanced',
      availableCapital: 12000,
    })
    expect(result.drawdownProtectionSummary).toMatchObject({
      approved: true,
      protectionStatus: 'clear',
    })
    expect(result.performanceContext.riskAdjustedGrade).toBe('B')
  })

  it('references upstream event outputs without recalculating domains', () => {
    const result = orchestrateAIDecision(baseInput, { emitEvent: false })

    expect(result.references).toMatchObject({
      portfolioRiskEvent: 'portfolio.risk.evaluated',
      drawdownProtectionEvent: 'portfolio.drawdownProtection.evaluated',
      positionSizingEvent: 'trade.positionSize.recommended',
      capitalAllocationEvent: 'portfolio.capitalAllocation.recommended',
      guardrailEvent: 'trade.guardrail.evaluated',
      performanceEvent: 'portfolio.performance.evaluated',
      riskAdjustedPerformanceEvent: 'portfolio.riskAdjustedPerformance.evaluated',
    })
  })

  it('emits the AI decision orchestrated event', () => {
    const eventBus = createEventBus()
    const events = []

    eventBus.subscribe(AI_DECISION_ORCHESTRATED_EVENT, (payload) => events.push(payload))

    const result = createAIDecisionOrchestrator({ eventBus }).orchestrate(baseInput, {
      timestamp: '2026-07-03T20:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      eventType: AI_DECISION_ORCHESTRATED_EVENT,
      timestamp: '2026-07-03T20:00:00.000Z',
      paperTrading: true,
    })
  })
})
