import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AUDIT_TRAIL_RECORDED_EVENT = 'system.auditTrail.recorded'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function severityRank(severity) {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  }[severity] ?? 0
}

function classifySeverity(status, fallback = 'low') {
  if (['invalid', 'degraded', 'critical', 'rejected', 'blocked', 'locked'].includes(status)) return 'critical'
  if (['high', 'caution', 'warning', 'elevated'].includes(status)) return 'high'
  if (['medium', 'review', 'monitor'].includes(status)) return 'medium'
  return fallback
}

function makeAuditRecord({ id, category, eventType, timestamp, actor = 'atlas-system', source = 'system', severity = 'low', summary, references = {} }) {
  return {
    id,
    category,
    severity,
    actor,
    source,
    eventType,
    timestamp: timestamp ?? null,
    summary,
    eventChainReferences: references.eventChainReferences ?? [],
    operatorActionReferences: references.operatorActionReferences ?? [],
    strategyLifecycleReferences: references.strategyLifecycleReferences ?? [],
    riskDecisionReferences: references.riskDecisionReferences ?? [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function getEventObservability(input = {}) {
  return input.eventObservability ?? {}
}

function getOperatorActionCenter(input = {}) {
  return input.operatorActionCenter ?? input.operatorActions ?? {}
}

function getStrategyLifecycle(input = {}) {
  return input.strategyLifecycle ?? {}
}

function getPortfolioRisk(input = {}) {
  return input.portfolioRisk ?? input.risk ?? {}
}

function getTradeGuardrail(input = {}) {
  return input.tradeGuardrail ?? input.guardrailDecision ?? {}
}

function getReleaseReadiness(input = {}) {
  return input.releaseReadiness ?? {}
}

function getSystemHealth(input = {}) {
  return input.systemHealthCommandCenter ?? input.systemHealth ?? {}
}

function buildEventAuditRecords(eventObservability = {}, timestamp) {
  const records = []
  records.push(makeAuditRecord({
    id: 'audit-event-observability',
    category: 'system_event',
    eventType: eventObservability.eventType,
    timestamp: eventObservability.timestamp ?? timestamp,
    actor: 'event-observability-engine',
    source: 'event-observability',
    severity: classifySeverity(eventObservability.observabilityStatus),
    summary: eventObservability.summary ?? 'System event observability reviewed.',
    references: {
      eventChainReferences: [eventObservability.eventType],
    },
  }))

  for (const missingEventType of eventObservability.missingEventDetection?.missingEventTypes ?? []) {
    records.push(makeAuditRecord({
      id: `audit-missing-${missingEventType}`,
      category: 'system_event',
      eventType: missingEventType,
      timestamp,
      actor: 'event-observability-engine',
      source: 'missing-event-detection',
      severity: 'critical',
      summary: `Required event contract missing: ${missingEventType}.`,
      references: {
        eventChainReferences: [eventObservability.eventType, missingEventType],
      },
    }))
  }

  return records
}

function buildOperatorActionAuditRecords(operatorActionCenter = {}, timestamp) {
  return (operatorActionCenter.prioritizedOperatorActions ?? []).map((action) => makeAuditRecord({
    id: `audit-action-${action.id}`,
    category: 'operator_action',
    eventType: operatorActionCenter.eventType,
    timestamp: operatorActionCenter.timestamp ?? timestamp,
    actor: 'operator-action-center',
    source: action.category,
    severity: action.severity,
    summary: `${action.title}: ${action.rationale}`,
    references: {
      eventChainReferences: [operatorActionCenter.eventType],
      operatorActionReferences: [action.id, ...(action.sourceReferences ?? [])],
    },
  }))
}

function buildStrategyLifecycleAuditRecord(strategyLifecycle = {}, timestamp) {
  return makeAuditRecord({
    id: `audit-strategy-lifecycle-${strategyLifecycle.strategyId ?? 'strategy'}`,
    category: 'strategy_lifecycle',
    eventType: strategyLifecycle.eventType,
    timestamp: strategyLifecycle.timestamp ?? timestamp,
    actor: 'strategy-lifecycle-manager',
    source: strategyLifecycle.lifecycleState ?? 'unknown',
    severity: strategyLifecycle.lifecycleState === 'paused' || strategyLifecycle.lifecycleState === 'archived' ? 'medium' : 'low',
    summary: strategyLifecycle.lifecycleAuditEvent?.transition
      ? `Strategy lifecycle transition ${strategyLifecycle.lifecycleAuditEvent.transition}.`
      : strategyLifecycle.summary ?? 'Strategy lifecycle reviewed.',
    references: {
      eventChainReferences: [strategyLifecycle.eventType, ...Object.values(strategyLifecycle.sourceEvents ?? {}).filter(Boolean)],
      strategyLifecycleReferences: [
        strategyLifecycle.strategyId,
        strategyLifecycle.lifecycleAuditEvent?.transition,
      ].filter(Boolean),
    },
  })
}

function buildRiskAuditRecords({ portfolioRisk = {}, tradeGuardrail = {}, timestamp }) {
  return [
    makeAuditRecord({
      id: 'audit-portfolio-risk',
      category: 'risk_decision',
      eventType: portfolioRisk.eventType,
      timestamp: portfolioRisk.timestamp ?? timestamp,
      actor: 'portfolio-risk-engine',
      source: portfolioRisk.summary?.riskLevel ?? 'unknown',
      severity: classifySeverity(portfolioRisk.summary?.riskLevel),
      summary: `Portfolio risk reviewed as ${portfolioRisk.summary?.riskLevel ?? 'unknown'}.`,
      references: {
        eventChainReferences: [portfolioRisk.eventType],
        riskDecisionReferences: [portfolioRisk.eventType, portfolioRisk.summary?.riskLevel].filter(Boolean),
      },
    }),
    makeAuditRecord({
      id: 'audit-trade-guardrail',
      category: 'risk_decision',
      eventType: tradeGuardrail.eventType,
      timestamp: tradeGuardrail.timestamp ?? timestamp,
      actor: 'trade-guardrail-engine',
      source: tradeGuardrail.decision ?? 'unknown',
      severity: tradeGuardrail.decision === 'rejected' ? 'critical' : tradeGuardrail.decision === 'review' ? 'medium' : 'low',
      summary: `Trade guardrail decision is ${tradeGuardrail.decision ?? 'unknown'}.`,
      references: {
        eventChainReferences: [tradeGuardrail.eventType],
        riskDecisionReferences: [tradeGuardrail.eventType, tradeGuardrail.decision].filter(Boolean),
      },
    }),
  ]
}

function buildReleaseAuditRecord(releaseReadiness = {}, timestamp) {
  return makeAuditRecord({
    id: 'audit-release-readiness',
    category: 'release_readiness',
    eventType: releaseReadiness.eventType,
    timestamp: releaseReadiness.timestamp ?? timestamp,
    actor: 'release-readiness-engine',
    source: releaseReadiness.releaseReadinessStatus ?? 'unknown',
    severity: classifySeverity(releaseReadiness.releaseReadinessStatus),
    summary: releaseReadiness.summary ?? 'Release readiness reviewed.',
    references: {
      eventChainReferences: [releaseReadiness.eventType],
    },
  })
}

function buildSystemHealthAuditRecord(systemHealth = {}, timestamp) {
  return makeAuditRecord({
    id: 'audit-system-health-command-center',
    category: 'system_health',
    eventType: systemHealth.eventType,
    timestamp: systemHealth.timestamp ?? timestamp,
    actor: 'system-health-command-center',
    source: systemHealth.finalPlatformHealthStatus ?? 'unknown',
    severity: classifySeverity(systemHealth.finalPlatformHealthStatus),
    summary: systemHealth.summary ?? 'System health command center reviewed.',
    references: {
      eventChainReferences: [systemHealth.eventType, ...Object.values(systemHealth.sourceEvents ?? {}).filter(Boolean)],
    },
  })
}

function groupAuditCategories(records = []) {
  const groups = new Map()
  for (const record of records) {
    const current = groups.get(record.category) ?? {
      category: record.category,
      recordCount: 0,
      highestSeverity: 'low',
      eventTypes: new Set(),
    }
    current.recordCount += 1
    if (severityRank(record.severity) > severityRank(current.highestSeverity)) current.highestSeverity = record.severity
    if (record.eventType) current.eventTypes.add(record.eventType)
    groups.set(record.category, current)
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    eventTypes: Array.from(group.eventTypes),
  }))
}

function buildIntegrityStatus(records = []) {
  const missingEventType = records.filter((record) => !record.eventType)
  const unsafe = records.filter((record) => record.paperTrading !== true || record.liveOrders === true || record.brokerageIntegration === true)
  const duplicateIds = records
    .filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) !== index)
    .map((record) => record.id)
  const criticalRecords = records.filter((record) => record.severity === 'critical')
  const status = missingEventType.length > 0 || unsafe.length > 0 || duplicateIds.length > 0
    ? 'invalid'
    : criticalRecords.length > 0
      ? 'caution'
      : 'valid'

  return {
    status,
    missingEventTypeCount: missingEventType.length,
    unsafeRecordCount: unsafe.length,
    duplicateIds: [...new Set(duplicateIds)],
    criticalRecordCount: criticalRecords.length,
  }
}

export function recordEnterpriseAuditTrail(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const eventObservability = getEventObservability(input)
  const operatorActionCenter = getOperatorActionCenter(input)
  const strategyLifecycle = getStrategyLifecycle(input)
  const portfolioRisk = getPortfolioRisk(input)
  const tradeGuardrail = getTradeGuardrail(input)
  const releaseReadiness = getReleaseReadiness(input)
  const systemHealth = getSystemHealth(input)
  const normalizedAuditRecords = [
    ...buildEventAuditRecords(eventObservability, timestamp),
    ...buildOperatorActionAuditRecords(operatorActionCenter, timestamp),
    buildStrategyLifecycleAuditRecord(strategyLifecycle, timestamp),
    ...buildRiskAuditRecords({ portfolioRisk, tradeGuardrail, timestamp }),
    buildReleaseAuditRecord(releaseReadiness, timestamp),
    buildSystemHealthAuditRecord(systemHealth, timestamp),
  ]
  const auditCategoryGrouping = groupAuditCategories(normalizedAuditRecords)
  const auditIntegrityStatus = buildIntegrityStatus(normalizedAuditRecords)
  const auditSeverityClassification = {
    low: normalizedAuditRecords.filter((record) => record.severity === 'low').length,
    medium: normalizedAuditRecords.filter((record) => record.severity === 'medium').length,
    high: normalizedAuditRecords.filter((record) => record.severity === 'high').length,
    critical: normalizedAuditRecords.filter((record) => record.severity === 'critical').length,
    highestSeverity: [...normalizedAuditRecords].sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0]?.severity ?? 'low',
  }
  const actorSourceAttribution = normalizedAuditRecords.map((record) => ({
    auditRecordId: record.id,
    actor: record.actor,
    source: record.source,
    category: record.category,
  }))
  const result = {
    eventType: SYSTEM_AUDIT_TRAIL_RECORDED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    timestamp,
    normalizedAuditRecords,
    auditCategoryGrouping,
    auditSeverityClassification,
    actorSourceAttribution,
    eventChainReferences: [...new Set(normalizedAuditRecords.flatMap((record) => record.eventChainReferences).filter(Boolean))],
    operatorActionReferences: [...new Set(normalizedAuditRecords.flatMap((record) => record.operatorActionReferences).filter(Boolean))],
    strategyLifecycleReferences: [...new Set(normalizedAuditRecords.flatMap((record) => record.strategyLifecycleReferences).filter(Boolean))],
    riskDecisionReferences: [...new Set(normalizedAuditRecords.flatMap((record) => record.riskDecisionReferences).filter(Boolean))],
    auditIntegrityStatus,
    summary: `Enterprise audit trail ${auditIntegrityStatus.status}: ${normalizedAuditRecords.length} records across ${auditCategoryGrouping.length} categories.`,
    sourceEvents: {
      eventObservability: eventObservability.eventType ?? null,
      operatorActionCenter: operatorActionCenter.eventType ?? null,
      strategyLifecycle: strategyLifecycle.eventType ?? null,
      portfolioRisk: portfolioRisk.eventType ?? null,
      tradeGuardrail: tradeGuardrail.eventType ?? null,
      releaseReadiness: releaseReadiness.eventType ?? null,
      systemHealthCommandCenter: systemHealth.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_AUDIT_TRAIL_RECORDED_EVENT, result)
  }

  return result
}

export function createEnterpriseAuditTrailEngine(options = {}) {
  return {
    record(input, recordOptions = {}) {
      return recordEnterpriseAuditTrail(input, { ...options, ...recordOptions })
    },
  }
}
