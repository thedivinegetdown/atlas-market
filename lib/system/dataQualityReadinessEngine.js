import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_DATA_QUALITY_EVALUATED_EVENT = 'system.dataQuality.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeQualityStatus(status) {
  if (['blocked', 'degraded', 'invalid', 'failed', 'critical', 'extreme'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'operational', 'valid', 'release-ready', 'passed', 'clear', 'low'].includes(status)) return 'ready'
  return 'caution'
}

function qualitySummary(id, label, sourceStatus, sourceEvent, checks = {}) {
  const missingCount = Number(checks.missingCount ?? 0)
  const staleCount = Number(checks.staleCount ?? 0)
  const incompleteCount = Number(checks.incompleteCount ?? 0)
  const baseStatus = normalizeQualityStatus(sourceStatus)
  const status = baseStatus === 'blocked' || missingCount > 0
    ? 'blocked'
    : baseStatus === 'caution' || staleCount > 0 || incompleteCount > 0
      ? 'caution'
      : 'ready'
  return {
    id,
    label,
    status,
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    missingCount,
    staleCount,
    incompleteCount,
    plannedOnly: true,
  }
}

function buildSummaries(input = {}) {
  const marketData = input.marketDataAdapterHealth ?? {}
  const marketHealth = marketData.health ?? {}
  const researchOutputs = [
    input.marketIntelligence,
    input.researchSignalScore,
    input.researchDecisionContext,
    input.multiTimeframeResearchContext,
  ].filter(Boolean)
  const strategyOutputs = [
    input.strategyBlueprintValidation,
    input.strategyRuleEvaluation,
    input.strategySignalComposition,
    input.strategyBacktestInput,
  ].filter(Boolean)
  const portfolioOutputs = [
    input.portfolioAnalytics,
    input.portfolioCorrelation,
    input.portfolioFactorExposure,
  ].filter(Boolean)
  const eventObservability = input.eventObservability ?? {}

  return {
    marketDataQualitySummary: qualitySummary(
      'market-data',
      'Market data quality summary',
      marketHealth.status,
      marketData.eventType,
      {
        staleCount: marketHealth.stale ? 1 : 0,
        incompleteCount: marketHealth.available === false ? 1 : 0,
      },
    ),
    researchDataQualitySummary: qualitySummary(
      'research',
      'Research data quality summary',
      researchOutputs.length >= 3 ? 'ready' : 'caution',
      input.researchDecisionContext?.eventType ?? input.marketIntelligence?.eventType,
      {
        missingCount: Math.max(0, 3 - researchOutputs.length),
        incompleteCount: researchOutputs.filter((output) => !output.eventType).length,
      },
    ),
    strategyDataQualitySummary: qualitySummary(
      'strategy',
      'Strategy data quality summary',
      input.strategyBacktestInput?.readinessStatus ?? input.strategyBlueprintValidation?.validationStatus,
      input.strategyBacktestInput?.eventType ?? input.strategyBlueprintValidation?.eventType,
      {
        missingCount: Math.max(0, 4 - strategyOutputs.length),
      },
    ),
    portfolioAnalyticsDataQualitySummary: qualitySummary(
      'portfolio-analytics',
      'Portfolio analytics data quality summary',
      input.portfolioAnalytics?.diversification?.label ? 'ready' : 'caution',
      input.portfolioAnalytics?.eventType,
      {
        missingCount: Math.max(0, 2 - portfolioOutputs.length),
      },
    ),
    eventDataQualitySummary: qualitySummary(
      'events',
      'Event data quality summary',
      eventObservability.observabilityStatus,
      eventObservability.eventType,
      {
        missingCount: eventObservability.missingEventDetection?.missingCount ?? 0,
        staleCount: eventObservability.eventFreshnessCheck?.staleCount ?? 0,
        incompleteCount: eventObservability.duplicateEventDetection?.duplicateCount ?? 0,
      },
    ),
  }
}

function buildMissingStaleIncompleteDataSummary(summaries) {
  const values = Object.values(summaries)
  return {
    missingDataCount: values.reduce((total, summary) => total + summary.missingCount, 0),
    staleDataCount: values.reduce((total, summary) => total + summary.staleCount, 0),
    incompleteDataCount: values.reduce((total, summary) => total + summary.incompleteCount, 0),
    affectedDomains: values
      .filter((summary) => summary.missingCount > 0 || summary.staleCount > 0 || summary.incompleteCount > 0)
      .map((summary) => summary.id),
    userDataMutated: false,
  }
}

function resolveDataQualityStatus(summaries, missingStaleIncompleteDataSummary) {
  if (Object.values(summaries).some((summary) => summary.status === 'blocked')) return 'blocked'
  if (
    Object.values(summaries).some((summary) => summary.status === 'caution')
    || missingStaleIncompleteDataSummary.staleDataCount > 0
    || missingStaleIncompleteDataSummary.incompleteDataCount > 0
  ) return 'caution'
  return 'ready'
}

export function evaluateDataQualityReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const summaries = buildSummaries(input)
  const missingStaleIncompleteDataSummary = buildMissingStaleIncompleteDataSummary(summaries)
  const dataQualityStatus = resolveDataQualityStatus(summaries, missingStaleIncompleteDataSummary)
  const result = {
    eventType: SYSTEM_DATA_QUALITY_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    databaseMigrationAdded: false,
    userDataMutated: false,
    ...summaries,
    missingStaleIncompleteDataSummary,
    dataQualityStatus,
    summary: `Data quality ${dataQualityStatus}: ${missingStaleIncompleteDataSummary.missingDataCount} missing, ${missingStaleIncompleteDataSummary.staleDataCount} stale, and ${missingStaleIncompleteDataSummary.incompleteDataCount} incomplete data findings across enterprise domains.`,
    sourceEvents: {
      marketDataAdapterHealth: input.marketDataAdapterHealth?.eventType ?? null,
      marketIntelligence: input.marketIntelligence?.eventType ?? null,
      researchSignalScore: input.researchSignalScore?.eventType ?? null,
      researchDecisionContext: input.researchDecisionContext?.eventType ?? null,
      multiTimeframeResearchContext: input.multiTimeframeResearchContext?.eventType ?? null,
      strategyBacktestInput: input.strategyBacktestInput?.eventType ?? null,
      portfolioAnalytics: input.portfolioAnalytics?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      productionMonitoringPlan: input.productionMonitoringPlan?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_DATA_QUALITY_EVALUATED_EVENT, result)
  }
  return result
}

export function createDataQualityReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateDataQualityReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
