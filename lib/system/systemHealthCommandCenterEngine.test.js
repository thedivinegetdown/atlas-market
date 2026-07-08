import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT,
  createSystemHealthCommandCenterEngine,
  evaluateSystemHealthCommandCenter,
} from './systemHealthCommandCenterEngine.js'

const operationalInput = Object.freeze({
  portfolioRisk: Object.freeze({ eventType: 'portfolio.risk.evaluated', summary: Object.freeze({ riskLevel: 'controlled' }) }),
  tradeGuardrail: Object.freeze({ eventType: 'trade.guardrail.evaluated', decision: 'approved' }),
  executionSimulation: Object.freeze({ eventType: 'trade.execution.simulated', finalStatus: 'filled' }),
  accounting: Object.freeze({ eventType: 'portfolio.accounting.updated', status: 'updated' }),
  journal: Object.freeze({ eventType: 'trade.journal.recorded', journalStatus: 'recorded' }),
  aiDecision: Object.freeze({ eventType: 'ai.decision.orchestrated', finalDecision: 'approve' }),
  marketIntelligence: Object.freeze({ eventType: 'research.marketIntelligence.evaluated', riskSentimentSummary: Object.freeze({ label: 'supportive' }) }),
  researchSignalScore: Object.freeze({ eventType: 'research.signalScore.evaluated', decisionBias: 'bullish' }),
  researchDecisionContext: Object.freeze({ eventType: 'research.decisionContext.prepared', decisionBiasSummary: Object.freeze({ recommendedUse: 'approved' }) }),
  multiTimeframeResearch: Object.freeze({ eventType: 'research.multiTimeframeContext.evaluated', dominantTimeframeBias: Object.freeze({ bias: 'bullish' }) }),
  marketRegime: Object.freeze({ eventType: 'market.regime.classified', riskRegime: Object.freeze({ regime: 'risk-on' }) }),
  researchEnhancedDecision: Object.freeze({ eventType: 'ai.decision.researchEnhanced', finalResearchAwareDecisionSummary: Object.freeze({ finalDecision: 'approve' }) }),
  strategyBlueprint: Object.freeze({ eventType: 'strategy.blueprint.validated', validationStatus: 'valid' }),
  strategyRuleEvaluation: Object.freeze({ eventType: 'strategy.rules.evaluated', strategyEvaluationStatus: 'eligible' }),
  strategySignal: Object.freeze({ eventType: 'strategy.signal.composed', signalStatus: 'composed' }),
  strategyLifecycle: Object.freeze({ eventType: 'strategy.lifecycle.updated', lifecycleState: 'active' }),
  strategyRegistry: Object.freeze({ eventType: 'strategy.registry.updated', status: 'updated' }),
  strategyPortfolioManager: Object.freeze({ eventType: 'strategy.portfolioManager.evaluated', strategyApprovalStatus: 'approved' }),
  strategyBacktestInput: Object.freeze({ eventType: 'strategy.backtestInput.prepared', readinessStatus: 'ready' }),
  historicalReplay: Object.freeze({ eventType: 'market.replay.stepPrepared', replayStepOutput: Object.freeze({ status: 'ready' }) }),
  strategyBacktestExecution: Object.freeze({ eventType: 'strategy.backtest.executed', backtestExecutionStatus: 'completed' }),
  strategyBacktestPerformance: Object.freeze({ eventType: 'strategy.backtestPerformance.evaluated', analyticsStatus: 'evaluated' }),
  strategyWalkForward: Object.freeze({ eventType: 'strategy.walkForward.evaluated', finalWalkForwardStatus: 'robust' }),
  strategyMonteCarlo: Object.freeze({ eventType: 'strategy.monteCarlo.simulated', robustnessClassification: 'robust' }),
  strategyBacktestReport: Object.freeze({ eventType: 'strategy.backtestReport.generated', releaseResearchRecommendation: 'approve' }),
  portfolioAnalytics: Object.freeze({ eventType: 'portfolio.analytics.updated', status: 'updated', diversification: Object.freeze({ label: 'strong' }) }),
  portfolioCorrelation: Object.freeze({ eventType: 'portfolio.correlation.evaluated', correlationRiskStatus: 'clear' }),
  portfolioFactorExposure: Object.freeze({ eventType: 'portfolio.factorExposure.evaluated', factorRiskStatus: 'clear' }),
  portfolioOptimization: Object.freeze({ eventType: 'portfolio.optimization.recommended', recommendationPriority: 'low' }),
  portfolioOptimizationGovernance: Object.freeze({ eventType: 'portfolio.optimizationGovernance.reviewed', governanceStatus: 'approved' }),
  rebalancing: Object.freeze({ eventType: 'portfolio.rebalance.recommended', status: 'recommended' }),
  strategyAttribution: Object.freeze({ eventType: 'strategy.attribution.evaluated', status: 'evaluated' }),
  marketDataAdapterHealth: Object.freeze({ eventType: 'marketData.adapter.checked', health: Object.freeze({ status: 'healthy', provider: 'mock', paperTrading: true }) }),
  brokerAdapterHealth: Object.freeze({ eventType: 'broker.adapter.checked', health: Object.freeze({ status: 'healthy', provider: 'mock-paper-broker', paperTrading: true, liveOrders: false }) }),
  releaseReadiness: Object.freeze({ eventType: 'system.releaseReadiness.evaluated', releaseReadinessStatus: 'ready' }),
  releaseCandidateStabilization: Object.freeze({ eventType: 'system.releaseCandidate.stabilized', finalStatus: 'stable' }),
  eventObservability: Object.freeze({ eventType: 'system.events.observed', observabilityStatus: 'healthy' }),
})

describe('system health command center engine', () => {
  it('evaluates operational platform health across major Atlas stacks', () => {
    const result = evaluateSystemHealthCommandCenter(operationalInput, {
      emitEvent: false,
      timestamp: '2026-07-08T12:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.finalPlatformHealthStatus).toBe('operational')
    expect(result.moduleHealthRegistry.length).toBeGreaterThan(20)
    expect(result.tradingLifecycleHealthSummary.status).toBe('operational')
    expect(result.researchStackHealthSummary.status).toBe('operational')
    expect(result.strategyStackHealthSummary.status).toBe('operational')
    expect(result.backtestingStackHealthSummary.status).toBe('operational')
    expect(result.portfolioAnalyticsHealthSummary.status).toBe('operational')
    expect(result.adapterMockModeHealthSummary.status).toBe('operational')
    expect(result.eventObservabilityHealthSummary.status).toBe('operational')
  })

  it('returns caution when one stack needs review but no stack is degraded', () => {
    const result = evaluateSystemHealthCommandCenter({
      ...operationalInput,
      portfolioOptimization: { ...operationalInput.portfolioOptimization, recommendationPriority: 'medium' },
      eventObservability: { ...operationalInput.eventObservability, observabilityStatus: 'caution' },
    }, { emitEvent: false })

    expect(result.finalPlatformHealthStatus).toBe('caution')
    expect(result.eventObservabilityHealthSummary.status).toBe('caution')
  })

  it('returns degraded when critical paper safety or module health is degraded', () => {
    const result = evaluateSystemHealthCommandCenter({
      ...operationalInput,
      brokerAdapterHealth: {
        eventType: 'broker.adapter.checked',
        health: { status: 'healthy', provider: 'live-broker', paperTrading: false, liveOrders: true },
      },
      aiDecision: { ...operationalInput.aiDecision, finalDecision: 'reject' },
    }, { emitEvent: false })

    expect(result.finalPlatformHealthStatus).toBe('degraded')
    expect(result.adapterMockModeHealthSummary.status).toBe('degraded')
    expect(result.tradingLifecycleHealthSummary.status).toBe('degraded')
  })

  it('emits system health command center evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createSystemHealthCommandCenterEngine({ eventBus }).evaluate(operationalInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT)
  })
})
