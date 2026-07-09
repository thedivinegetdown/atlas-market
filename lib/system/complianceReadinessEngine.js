import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT = 'system.complianceReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'ready'
  return 'caution'
}

function compatibilitySummary(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    legalClaimMade: false,
    ...details,
  }
}

function resolveComplianceReadinessStatus(summaries) {
  if (summaries.some((summary) => summary.status === 'blocked')) return 'blocked'
  if (summaries.some((summary) => summary.status === 'caution')) return 'caution'
  return 'ready'
}

export function evaluateComplianceReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const release = input.enterpriseReleaseControl ?? {}
  const security = input.productionSecurityReadiness ?? {}

  const paperTradingComplianceBoundarySummary = compatibilitySummary(
    'paper-trading-boundary',
    'Paper-trading compliance boundary summary',
    release.liveOrders === true || security.paperTradingSafetyLockSummary?.liveOrders === true ? 'blocked' : 'ready',
    release.eventType ?? security.eventType,
    {
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      boundaryOnly: true,
    },
  )
  const auditCompatibilitySummary = compatibilitySummary(
    'audit-compatibility',
    'Audit compatibility summary',
    input.enterpriseAuditTrail?.auditIntegrityStatus?.status,
    input.enterpriseAuditTrail?.eventType,
    {
      auditRecordCount: input.enterpriseAuditTrail?.normalizedAuditRecords?.length ?? 0,
    },
  )
  const dataGovernanceCompatibilitySummary = compatibilitySummary(
    'data-governance-compatibility',
    'Data governance compatibility summary',
    input.dataQualityReadiness?.dataQualityStatus === 'blocked'
      || input.dataLineage?.lineageStatus === 'invalid'
      || input.dataRetentionPlanning?.retentionReadinessStatus === 'blocked'
      ? 'blocked'
      : input.dataQualityReadiness?.dataQualityStatus === 'ready'
        && input.dataLineage?.lineageStatus === 'valid'
        && input.dataRetentionPlanning?.retentionReadinessStatus === 'ready'
          ? 'ready'
          : 'caution',
    input.dataQualityReadiness?.eventType ?? input.dataLineage?.eventType,
    {
      dataQualityStatus: input.dataQualityReadiness?.dataQualityStatus ?? 'unknown',
      lineageStatus: input.dataLineage?.lineageStatus ?? 'unknown',
      retentionStatus: input.dataRetentionPlanning?.retentionReadinessStatus ?? 'unknown',
    },
  )
  const securityReadinessCompatibilitySummary = compatibilitySummary(
    'security-readiness-compatibility',
    'Security readiness compatibility summary',
    security.securityReadinessStatus,
    security.eventType,
    {
      secretsExposed: security.secretsExposed === true,
      authEnforced: false,
    },
  )
  const releaseControlCompatibilitySummary = compatibilitySummary(
    'release-control-compatibility',
    'Release control compatibility summary',
    release.finalReleaseStatus,
    release.eventType,
    {
      releaseDecision: release.finalReleaseStatus ?? 'unknown',
      deploymentAuthorized: false,
    },
  )
  const summaries = [
    paperTradingComplianceBoundarySummary,
    auditCompatibilitySummary,
    dataGovernanceCompatibilitySummary,
    securityReadinessCompatibilitySummary,
    releaseControlCompatibilitySummary,
  ]
  const complianceReadinessStatus = resolveComplianceReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    legalClaimMade: false,
    policyEnforced: false,
    authenticationAdded: false,
    userAccountsAdded: false,
    paperTradingComplianceBoundarySummary,
    auditCompatibilitySummary,
    dataGovernanceCompatibilitySummary,
    securityReadinessCompatibilitySummary,
    releaseControlCompatibilitySummary,
    complianceReadinessStatus,
    summary: `Compliance readiness ${complianceReadinessStatus}: paper-mode, audit, data governance, security, and release-control planning reviewed without legal claims or enforcement.`,
    sourceEvents: {
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      dataQualityReadiness: input.dataQualityReadiness?.eventType ?? null,
      dataLineage: input.dataLineage?.eventType ?? null,
      dataRetentionPlanning: input.dataRetentionPlanning?.eventType ?? null,
      productionSecurityReadiness: security.eventType ?? null,
      enterpriseReleaseControl: release.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createComplianceReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateComplianceReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
