import { describe, expect, it } from 'vitest'
import { generateAiTradingCopilotPortfolioInsights } from '../lib/system/aiTradingCopilotPortfolioInsightEngine.js'
import { prepareAiTradingCopilotConversation } from '../lib/system/aiTradingCopilotConversationEngine.js'
import { prepareAiTradingCopilotWorkflowAssistance } from '../lib/system/aiTradingCopilotWorkflowAssistanceEngine.js'
import { evaluateDataLineage } from '../lib/system/dataLineageEngine.js'
import { planDataRetention } from '../lib/system/dataRetentionPlanningEngine.js'
import { observeSystemEvents } from '../lib/system/eventObservabilityEngine.js'
import { evaluateSystemHealthCommandCenter } from '../lib/system/systemHealthCommandCenterEngine.js'
import { evaluatePortfolioCorrelation } from '../src/core/analytics/portfolioCorrelationEngine.js'
import { evaluatePortfolioFactorExposure } from '../src/core/analytics/portfolioFactorExposureEngine.js'
import { evaluateBacktestPerformance } from '../src/core/strategy/strategyBacktestPerformanceAnalyticsEngine.js'
import { generateBacktestReport } from '../src/core/strategy/strategyBacktestReportGenerator.js'
import { simulateMonteCarloStrategy } from '../src/core/strategy/strategyMonteCarloSimulationEngine.js'
import { evaluateWalkForwardTesting } from '../src/core/strategy/strategyWalkForwardTestingEngine.js'
import { monteCarloInput } from './fixtures/gap6CanonicalHistory.js'

const options = Object.freeze({ emitEvent: false, timestamp: '2026-09-24T15:00:00.000Z' })

function unavailableComponents() {
  const strategyBacktestPerformance = evaluateBacktestPerformance({}, options)
  const strategyWalkForward = evaluateWalkForwardTesting({}, options)
  const strategyBacktestReport = generateBacktestReport({ strategyBacktestPerformance, strategyWalkForward }, options)
  const strategyMonteCarlo = simulateMonteCarloStrategy({}, options)
  return { strategyBacktestPerformance, strategyWalkForward, strategyBacktestReport, strategyMonteCarlo }
}

function copilotInput(strategyBacktestPerformance) {
  return {
    strategyBacktestPerformance,
    strategySignalComposition: { eventType: 'strategy.signal.composed', signalStrengthScore: 100 },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 100 } },
    portfolioOptimization: { eventType: 'portfolio.optimization.recommended', optimizationConfidenceScore: 100 },
    portfolioRisk: { eventType: 'portfolio.risk.evaluated', summary: { riskScore: 0 } },
    aiTradingCopilotTradeSignalExplanation: { eventType: 'system.aiTradingCopilotTradeSignal.explained', aiTradingCopilotTradeSignalExplanationSummary: { averageExplanationScore: 100 } },
  }
}

const strategyAttribution = Object.freeze({
  eventType: 'strategy.attribution.evaluated',
  strategies: Object.freeze([{ strategy: 'Index Pullback', symbols: Object.freeze(['SPY']), trades: 5, winRate: 60, netRealizedPnl: 100, profitFactor: 1.5, expectancy: 20 }]),
})

describe('Gap 6 unavailable historical evidence propagation', () => {
  it('does not convert unavailable backtest performance into a score or ready insight', () => {
    const { strategyBacktestPerformance } = unavailableComponents()
    const result = generateAiTradingCopilotPortfolioInsights(copilotInput(strategyBacktestPerformance), options)
    const insight = result.aiTradingCopilotPortfolioInsights[0]

    expect(insight).toMatchObject({
      insightStatus: 'caution',
      historicalEvidenceStatus: 'UNAVAILABLE',
      historicalEvidenceScore: null,
      historicalEvidenceContributed: false,
    })
    expect(insight.strategyComparisonSummary).toContain('historical backtest evidence is UNAVAILABLE and contributes no score')
    expect(insight.strategyComparisonSummary).not.toMatch(/backtest performance score \d/)
    expect(result.aiTradingCopilotPortfolioInsightSummary).toMatchObject({ ready: 0, historicalEvidenceUnavailable: 1, historicalEvidenceContributions: 0 })

    const persisted = generateAiTradingCopilotPortfolioInsights({
      ...copilotInput(strategyBacktestPerformance),
      aiTradingCopilotPortfolioInsights: [{ insightStatus: 'ready', insightScore: 95, strategyComparisonSummary: 'backtest performance score 70' }],
    }, options).aiTradingCopilotPortfolioInsights[0]
    expect(persisted).toMatchObject({ insightStatus: 'caution', historicalEvidenceStatus: 'UNAVAILABLE', historicalEvidenceScore: null, historicalEvidenceContributed: false })
    expect(persisted.strategyComparisonSummary).not.toMatch(/backtest performance score \d/)
  })

  it('propagates unavailable backtest P&L without neutral alignment in correlation or factor consumers', () => {
    const { strategyBacktestPerformance } = unavailableComponents()
    const correlation = evaluatePortfolioCorrelation({ strategyAttribution, strategyBacktestPerformance }, options)
    const factor = evaluatePortfolioFactorExposure({ strategyAttribution, strategyBacktestPerformance }, options)

    expect(correlation.strategyCorrelationSummary).toMatchObject({
      historicalEvidenceStatus: 'UNAVAILABLE', historicalNetPnl: null,
      historicalEvidenceContributed: false, alignedStrategies: 0, divergentStrategies: 0, unavailableStrategies: 1,
    })
    expect(correlation.strategyCorrelationSummary.strategies[0].pnlAlignment).toBe('UNAVAILABLE')
    expect(factor.strategyFactorExposure).toMatchObject({ historicalEvidenceStatus: 'UNAVAILABLE', historicalNetPnl: null, historicalEvidenceContributed: false })
    expect(factor.strategyFactorExposure.strategies[0].pnlAlignment).toBe('UNAVAILABLE')
  })

  it('does not promote unavailable walk-forward, robustness, or approval statuses in system consumers', () => {
    const components = unavailableComponents()
    const health = evaluateSystemHealthCommandCenter(components, options)
    const backtestingModules = Object.fromEntries(health.backtestingStackHealthSummary.modules.map((module) => [module.id, module]))
    const retention = planDataRetention({ strategyBacktestReport: components.strategyBacktestReport }, options)
    const lineage = evaluateDataLineage({ strategyBacktestPerformance: components.strategyBacktestPerformance }, options)
    const observed = observeSystemEvents({
      eventOutputs: { walkForward: components.strategyWalkForward, monteCarlo: components.strategyMonteCarlo },
      requiredEventTypes: [], criticalEventTypes: [], now: options.timestamp,
    }, options)

    expect(backtestingModules['walk-forward']).toMatchObject({ sourceStatus: 'UNAVAILABLE', healthStatus: 'caution' })
    expect(backtestingModules['monte-carlo']).toMatchObject({ sourceStatus: 'UNAVAILABLE', healthStatus: 'caution' })
    expect(backtestingModules['backtest-report']).toMatchObject({ sourceStatus: 'UNAVAILABLE', healthStatus: 'caution' })
    expect(health.backtestingStackHealthSummary.status).toBe('degraded')
    expect(retention.backtestRetentionPlanning).toMatchObject({ status: 'caution', sourceEvidenceStatus: 'UNAVAILABLE' })
    expect(planDataRetention({ strategyBacktestReport: { evidenceStatus: 'AVAILABLE', releaseResearchRecommendation: 'UNAVAILABLE' } }, options).backtestRetentionPlanning)
      .toMatchObject({ status: 'caution', sourceEvidenceStatus: 'UNAVAILABLE' })
    expect(lineage.inputSourceLineageSummary.find((item) => item.id === 'backtest-performance')).toMatchObject({ status: 'invalid' })
    expect(observed.eventCatalogSummary).toMatchObject({ cautionEvents: 2, degradedEvents: 0 })
  })

  it('preserves valid canonical Monte Carlo while historical approval remains unavailable', () => {
    const strategyBacktestPerformance = evaluateBacktestPerformance({}, options)
    const strategyWalkForward = evaluateWalkForwardTesting({}, options)
    const strategyMonteCarlo = simulateMonteCarloStrategy(monteCarloInput(), options)
    const report = generateBacktestReport({ strategyBacktestPerformance, strategyWalkForward, strategyMonteCarlo }, options)

    expect(strategyMonteCarlo).toMatchObject({ evidenceStatus: 'AVAILABLE', simulationStatus: 'AVAILABLE', historicalValidationStatus: 'UNAVAILABLE' })
    expect(strategyMonteCarlo.randomizedEquityCurves).toHaveLength(25)
    expect(report).toMatchObject({ evidenceStatus: 'UNAVAILABLE', releaseResearchRecommendation: 'UNAVAILABLE' })
    expect(report.monteCarloRiskSummary).toMatchObject({
      evidenceStatus: 'AVAILABLE', evidenceScope: 'CANONICAL_PAPER_OUTCOME_RESAMPLING_ONLY', historicalValidationStatus: 'UNAVAILABLE', sourceTradeCount: 5,
    })
    expect(report.keyStrengths).toEqual([])
  })

  it('keeps mixed available/unavailable evidence separate instead of fabricating historical confidence', () => {
    const strategyBacktestPerformance = evaluateBacktestPerformance({}, options)
    const strategyMonteCarlo = simulateMonteCarloStrategy(monteCarloInput(), options)
    const portfolioInsight = generateAiTradingCopilotPortfolioInsights(copilotInput(strategyBacktestPerformance), options)
    const insight = portfolioInsight.aiTradingCopilotPortfolioInsights[0]
    const report = generateBacktestReport({ strategyBacktestPerformance, strategyMonteCarlo }, options)
    const conversation = prepareAiTradingCopilotConversation({
      aiTradingCopilotConversations: [{ conversationStatus: 'ready', conversationScore: 95 }],
      aiTradingCopilotPortfolioInsight: portfolioInsight,
      portfolioAnalytics: { diversification: { score: 100 } },
      portfolioRisk: { summary: { riskScore: 0 } },
      researchEnhancedDecision: { researchInfluenceScore: 100 },
      aiTradingCopilotTradeSignalExplanation: { aiTradingCopilotTradeSignalExplanationSummary: { averageExplanationScore: 100 } },
    }, options)
    const workflow = prepareAiTradingCopilotWorkflowAssistance({
      aiTradingCopilotWorkflowAssistanceRecords: [{ workflowStatus: 'ready', workflowScore: 95 }],
      aiTradingCopilotPortfolioInsight: portfolioInsight,
      aiTradingCopilotConversation: conversation,
      aiTradingCopilotTradeSignalExplanation: { aiTradingCopilotTradeSignalExplanationSummary: { averageExplanationScore: 100 } },
      workspaceCommandPalette: { commandExecutionResult: { status: 'ready' } },
    }, options)

    expect(insight.historicalEvidenceScore).toBeNull()
    expect(insight.historicalEvidenceContributed).toBe(false)
    expect(insight.insightStatus).not.toBe('ready')
    expect(conversation.aiTradingCopilotConversationSummary).toMatchObject({ ready: 0, historicalEvidenceUnavailable: 1 })
    expect(workflow.aiTradingCopilotWorkflowAssistanceSummary).toMatchObject({ ready: 0, historicalEvidenceUnavailable: 1 })
    expect(conversation.aiTradingCopilotConversations[0]).toMatchObject({ conversationScore: 100, historicalEvidenceStatus: 'UNAVAILABLE' })
    expect(workflow.aiTradingCopilotWorkflowAssistanceRecords[0]).toMatchObject({ workflowScore: 98, historicalEvidenceStatus: 'UNAVAILABLE' })
    expect(report.monteCarloRiskSummary.evidenceStatus).toBe('AVAILABLE')
    expect(report.releaseResearchRecommendation).toBe('UNAVAILABLE')
  })

  it('keeps genuinely supplied backtest performance usable without changing score thresholds', () => {
    const availablePerformance = { eventType: 'strategy.backtestPerformance.evaluated', evidenceStatus: 'AVAILABLE', analyticsStatus: 'evaluated', metrics: { profitFactor: 1.8, netRealizedPnl: 200 } }
    const result = generateAiTradingCopilotPortfolioInsights(copilotInput(availablePerformance), options)
    const insight = result.aiTradingCopilotPortfolioInsights[0]

    expect(insight).toMatchObject({ historicalEvidenceStatus: 'AVAILABLE', historicalEvidenceScore: 72, historicalEvidenceContributed: true, insightStatus: 'ready' })
    expect(insight.strategyComparisonSummary).toContain('backtest performance score 72')
  })
})
