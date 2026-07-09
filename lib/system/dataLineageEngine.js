import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_DATA_LINEAGE_EVALUATED_EVENT = 'system.dataLineage.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function lineageStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed'].includes(status)) return 'invalid'
  if (['ready', 'healthy', 'operational', 'valid', 'release-ready', 'passed', 'clear'].includes(status)) return 'valid'
  return 'caution'
}

function sourceLineage(id, label, eventType, status = 'valid', provenance = 'internal-engine-output') {
  return {
    id,
    label,
    eventType: eventType ?? null,
    status: eventType ? lineageStatus(status) : 'caution',
    provenance,
  }
}

function buildInputSourceLineageSummary(input = {}) {
  return [
    sourceLineage('market-data-adapter', 'Market data adapter', input.marketDataAdapterHealth?.eventType, input.marketDataAdapterHealth?.health?.status, 'mock-or-configured-adapter'),
    sourceLineage('research-intelligence', 'Research intelligence', input.marketIntelligence?.eventType, 'valid', 'mock-demo-research-input'),
    sourceLineage('strategy-blueprint', 'Strategy blueprint', input.strategyBlueprintValidation?.eventType, input.strategyBlueprintValidation?.validationStatus),
    sourceLineage('backtest-performance', 'Backtest performance', input.strategyBacktestPerformance?.eventType, input.strategyBacktestPerformance?.analyticsStatus),
    sourceLineage('portfolio-analytics', 'Portfolio analytics', input.portfolioAnalytics?.eventType, 'valid'),
    sourceLineage('workspace-persistence', 'Workspace persistence', input.workspacePersistence?.eventType, input.workspacePersistence?.persistenceStatus, 'local-adapter-planning'),
  ]
}

function buildEngineOutputLineageSummary(input = {}) {
  return [
    sourceLineage('event-observability', 'Event observability', input.eventObservability?.eventType, input.eventObservability?.observabilityStatus),
    sourceLineage('audit-trail', 'Enterprise audit trail', input.enterpriseAuditTrail?.eventType, input.enterpriseAuditTrail?.auditIntegrityStatus?.status),
    sourceLineage('deployment-readiness', 'Deployment readiness', input.productionDeploymentReadiness?.eventType, input.productionDeploymentReadiness?.deploymentReadinessStatus),
    sourceLineage('security-readiness', 'Security readiness', input.productionSecurityReadiness?.eventType, input.productionSecurityReadiness?.securityReadinessStatus),
    sourceLineage('monitoring-plan', 'Monitoring plan', input.productionMonitoringPlan?.eventType, input.productionMonitoringPlan?.monitoringReadinessStatus),
    sourceLineage('data-quality', 'Data quality readiness', input.dataQualityReadiness?.eventType, input.dataQualityReadiness?.dataQualityStatus),
  ]
}

function buildResearchMockDataProvenanceSummary(input = {}) {
  return {
    status: input.marketIntelligence?.eventType && input.researchDecisionContext?.eventType ? 'valid' : 'caution',
    mockInputsAllowed: true,
    paidApiRequired: false,
    researchEvents: [
      input.marketIntelligence?.eventType,
      input.researchSignalScore?.eventType,
      input.researchDecisionContext?.eventType,
      input.multiTimeframeResearchContext?.eventType,
    ].filter(Boolean),
  }
}

function buildAdapterProvenanceSummary(input = {}) {
  const marketHealth = input.marketDataAdapterHealth?.health ?? {}
  return {
    status: lineageStatus(marketHealth.status),
    marketProvider: marketHealth.provider ?? input.marketDataAdapterHealth?.metadata?.name ?? 'unknown',
    brokerExecution: false,
    paperTrading: true,
    sourceEvents: [
      input.marketDataAdapterHealth?.eventType,
      input.productionSecurityReadiness?.eventType,
    ].filter(Boolean),
  }
}

function buildAuditLineageCompatibility(input = {}, eventLineageReferences = []) {
  const audit = input.enterpriseAuditTrail ?? {}
  const auditReferences = new Set(audit.eventChainReferences ?? [])
  const missingAuditReferences = eventLineageReferences.filter((eventType) => !auditReferences.has(eventType))
  return {
    status: lineageStatus(audit.auditIntegrityStatus?.status),
    auditRecordCount: audit.normalizedAuditRecords?.length ?? 0,
    eventLineageReferenceCount: eventLineageReferences.length,
    missingAuditReferences,
    compatible: lineageStatus(audit.auditIntegrityStatus?.status) !== 'invalid',
  }
}

function resolveLineageStatus(sections) {
  if (sections.some((section) => section.status === 'invalid')) return 'invalid'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'valid'
}

export function evaluateDataLineage(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const inputSourceLineageSummary = buildInputSourceLineageSummary(input)
  const engineOutputLineageSummary = buildEngineOutputLineageSummary(input)
  const eventLineageReferences = [...new Set([
    ...inputSourceLineageSummary.map((item) => item.eventType),
    ...engineOutputLineageSummary.map((item) => item.eventType),
    ...(input.eventObservability?.eventFamilyGrouping ?? []).map((family) => family.family),
  ].filter(Boolean))]
  const researchMockDataProvenanceSummary = buildResearchMockDataProvenanceSummary(input)
  const adapterProvenanceSummary = buildAdapterProvenanceSummary(input)
  const auditLineageCompatibility = buildAuditLineageCompatibility(input, eventLineageReferences)
  const lineageStatusValue = resolveLineageStatus([
    ...inputSourceLineageSummary,
    ...engineOutputLineageSummary,
    researchMockDataProvenanceSummary,
    adapterProvenanceSummary,
    auditLineageCompatibility,
  ])
  const result = {
    eventType: SYSTEM_DATA_LINEAGE_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    databaseMigrationAdded: false,
    userDataMutated: false,
    inputSourceLineageSummary,
    engineOutputLineageSummary,
    eventLineageReferences,
    researchMockDataProvenanceSummary,
    adapterProvenanceSummary,
    auditLineageCompatibility,
    lineageStatus: lineageStatusValue,
    summary: `Data lineage ${lineageStatusValue}: ${eventLineageReferences.length} event references mapped across source, engine, adapter, research, and audit provenance.`,
    sourceEvents: {
      dataQualityReadiness: input.dataQualityReadiness?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      marketDataAdapterHealth: input.marketDataAdapterHealth?.eventType ?? null,
      productionMonitoringPlan: input.productionMonitoringPlan?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_DATA_LINEAGE_EVALUATED_EVENT, result)
  }
  return result
}

export function createDataLineageEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateDataLineage(input, { ...options, ...evaluationOptions })
    },
  }
}
