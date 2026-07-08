import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT,
  createPortfolioOptimizationGovernanceEngine,
  reviewPortfolioOptimizationGovernance,
} from './portfolioOptimizationGovernanceEngine.js'

const approvedOptimization = Object.freeze({
  eventType: 'portfolio.optimization.recommended',
  recommendationPriority: 'low',
  optimizationConfidenceScore: 82,
  riskReductionRecommendations: Object.freeze([
    Object.freeze({ id: 'risk-maintain', priority: 'low', paperTrading: true, liveOrders: false, recommendationOnly: true }),
  ]),
})

const approvedRisk = Object.freeze({
  eventType: 'portfolio.risk.evaluated',
  summary: Object.freeze({ riskLevel: 'controlled', riskScore: 24, openRiskPct: 0.8 }),
})

const approvedCorrelation = Object.freeze({
  eventType: 'portfolio.correlation.evaluated',
  correlationRiskStatus: 'clear',
  concentrationRiskFromCorrelatedAssets: Object.freeze({ correlatedWeight: 12, highCorrelationPairs: Object.freeze([]) }),
})

const approvedFactorExposure = Object.freeze({
  eventType: 'portfolio.factorExposure.evaluated',
  factorRiskStatus: 'clear',
  factorConcentrationSummary: Object.freeze({
    elevatedFactors: Object.freeze([]),
    cautionFactors: Object.freeze([]),
  }),
})

const approvedCapitalAllocation = Object.freeze({
  eventType: 'portfolio.capitalAllocation.recommended',
  allocationStatus: 'balanced',
  capital: Object.freeze({ availableCapital: 12000 }),
  allocation: Object.freeze({ bySymbol: Object.freeze([]) }),
})

const approvedAiDecision = Object.freeze({
  eventType: 'ai.decision.orchestrated',
  finalDecision: 'approve',
  blockers: Object.freeze([]),
  cautions: Object.freeze([]),
})

function approvedInput(overrides = {}) {
  return {
    portfolioOptimization: approvedOptimization,
    portfolioRisk: approvedRisk,
    portfolioCorrelation: approvedCorrelation,
    portfolioFactorExposure: approvedFactorExposure,
    capitalAllocation: approvedCapitalAllocation,
    aiDecision: approvedAiDecision,
    ...overrides,
  }
}

describe('portfolio optimization governance engine', () => {
  it('approves reviewed paper-only recommendations when upstream risk is clear', () => {
    const result = reviewPortfolioOptimizationGovernance(approvedInput(), {
      emitEvent: false,
      timestamp: '2026-07-08T06:00:00.000Z',
    })

    expect(result.eventType).toBe(PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.governanceOnly).toBe(true)
    expect(result.governanceStatus).toBe('approved')
    expect(result.recommendationApprovalReview.status).toBe('approved')
    expect(result.operatorActionClassification.classification).toBe('reviewed_recommendation_only')
    expect(result.operatorActionClassification.allowedToInfluenceAiDecision).toBe(true)
    expect(result.sourceEvents.portfolioOptimization).toBe('portfolio.optimization.recommended')
  })

  it('cautions high-priority recommendations when impact reviews require an operator', () => {
    const result = reviewPortfolioOptimizationGovernance(approvedInput({
      portfolioOptimization: {
        ...approvedOptimization,
        recommendationPriority: 'high',
        riskReductionRecommendations: [
          { id: 'risk-reduce', priority: 'high', paperTrading: true, liveOrders: false, recommendationOnly: true },
        ],
      },
      portfolioCorrelation: {
        ...approvedCorrelation,
        correlationRiskStatus: 'elevated',
        concentrationRiskFromCorrelatedAssets: { correlatedWeight: 55, highCorrelationPairs: [{ left: 'SPY', right: 'QQQ' }] },
      },
      portfolioFactorExposure: {
        ...approvedFactorExposure,
        factorRiskStatus: 'elevated',
        factorConcentrationSummary: { elevatedFactors: [{ factor: 'market_beta' }], cautionFactors: [] },
      },
    }), { emitEvent: false })

    expect(result.governanceStatus).toBe('caution')
    expect(result.recommendationApprovalReview.status).toBe('caution')
    expect(result.correlationImpactReview.status).toBe('caution')
    expect(result.factorExposureImpactReview.status).toBe('caution')
    expect(result.operatorActionClassification.classification).toBe('operator_review_required')
    expect(result.operatorActionClassification.allowedToInfluenceAiDecision).toBe(false)
  })

  it('rejects unsafe recommendations or constrained governance inputs', () => {
    const result = reviewPortfolioOptimizationGovernance(approvedInput({
      portfolioOptimization: {
        ...approvedOptimization,
        riskReductionRecommendations: [
          { id: 'unsafe', priority: 'high', paperTrading: false, liveOrders: true, recommendationOnly: false },
        ],
      },
      portfolioRisk: {
        ...approvedRisk,
        summary: { riskLevel: 'critical', riskScore: 90, openRiskPct: 4.5 },
      },
      capitalAllocation: {
        ...approvedCapitalAllocation,
        allocationStatus: 'constrained',
      },
      aiDecision: {
        ...approvedAiDecision,
        finalDecision: 'reject',
        blockers: ['Guardrail rejected'],
      },
    }), { emitEvent: false })

    expect(result.governanceStatus).toBe('rejected')
    expect(result.recommendationApprovalReview.rejectedRecommendations).toBe(1)
    expect(result.riskImpactReview.status).toBe('rejected')
    expect(result.capitalAllocationImpactReview.status).toBe('rejected')
    expect(result.aiDecisionReview.status).toBe('rejected')
    expect(result.operatorActionClassification.allowedForOperatorAction).toBe(false)
  })

  it('emits portfolio optimization governance reviewed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioOptimizationGovernanceEngine({ eventBus }).review(approvedInput())

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT)
  })
})
