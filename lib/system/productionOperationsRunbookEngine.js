import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT = 'system.operationsRunbook.generated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed'].includes(status)) return 'blocked'
  if (['ready', 'release-ready', 'operational', 'healthy', 'valid', 'passed'].includes(status)) return 'ready'
  return 'review'
}

function item(id, label, status, operatorAction, source) {
  return {
    id,
    label,
    status: normalizeStatus(status),
    sourceStatus: status ?? 'unknown',
    operatorAction,
    source,
    executable: false,
  }
}

function buildChecklists(input = {}) {
  const deployment = input.productionDeploymentReadiness ?? {}
  const security = input.productionSecurityReadiness ?? {}
  const environment = input.productionEnvironmentConfiguration ?? {}
  const release = input.enterpriseReleaseControl ?? {}
  const audit = input.enterpriseAuditTrail ?? {}
  const health = input.systemHealthCommandCenter ?? {}
  return {
    startupChecklistSummary: [
      item('startup-health', 'Review platform health', health.finalPlatformHealthStatus, 'Confirm all critical modules report expected paper-mode health.', health.eventType),
      item('startup-release', 'Review release control', release.finalReleaseStatus, 'Confirm the enterprise release decision before an operator session.', release.eventType),
      item('startup-audit', 'Confirm audit integrity', audit.auditIntegrityStatus?.status, 'Confirm audit records are valid and traceable.', audit.eventType),
    ],
    deploymentValidationChecklist: [
      item('deployment-readiness', 'Review deployment readiness', deployment.deploymentReadinessStatus, 'Review every deployment planning dependency; do not deploy from this runbook.', deployment.eventType),
      item('deployment-netlify', 'Review Netlify configuration', deployment.netlifyDeploymentReadinessSummary?.status, 'Confirm build, publish, and functions metadata.', deployment.eventType),
      item('deployment-postgres', 'Review PostgreSQL readiness', deployment.postgresqlReadinessSummary?.status, 'Confirm the interface remains a planned dependency until implemented.', deployment.eventType),
    ],
    securityValidationChecklist: [
      item('security-readiness', 'Review production security readiness', security.securityReadinessStatus, 'Resolve security cautions before future production exposure.', security.eventType),
      item('security-secrets', 'Confirm secret handling', security.environmentSecretHandlingSummary?.status, 'Confirm only managed configuration metadata is present; never record values.', security.eventType),
      item('security-api', 'Review API boundaries', security.apiBoundarySecuritySummary?.status, 'Confirm production API exposure remains disabled.', security.eventType),
    ],
    environmentConfigurationChecklist: [
      item('environment-plan', 'Review environment configuration plan', environment.configurationReadinessStatus, 'Review required and optional variable descriptors without adding values.', environment.eventType),
      item(
        'environment-required',
        'Resolve missing required configuration',
        environment.missingConfigurationSummary?.missingRequired?.length === 0 ? 'ready' : 'caution',
        `Review missing names: ${environment.missingConfigurationSummary?.missingRequired?.join(', ') || 'none'}.`,
        environment.eventType,
      ),
    ],
    paperTradingSafetyChecklist: [
      item('paper-lock', 'Confirm paper-trading safety lock', security.paperTradingSafetyLockSummary?.status, 'Confirm trading mode is paper and live orders remain disabled.', security.eventType),
      item('mock-adapters', 'Confirm mock adapter boundary', security.adapterBrokerMockModeSecuritySummary?.status, 'Confirm market and broker adapters remain paper/mock-mode compatible.', security.eventType),
      item(
        'release-paper-only',
        'Confirm release control paper-only boundary',
        release.releaseDecisionSummary?.paperTradingOnly === true && release.liveOrders !== true ? 'ready' : 'blocked',
        'Stop review if any live-order or brokerage execution capability is present.',
        release.eventType,
      ),
    ],
    incidentResponseChecklist: [
      item('incident-health', 'Capture system health snapshot', health.finalPlatformHealthStatus, 'Record the current health summary and affected module references.', health.eventType),
      item('incident-audit', 'Preserve audit traceability', audit.auditIntegrityStatus?.status, 'Preserve event-chain and operator-action references for review.', audit.eventType),
      item('incident-paper-pause', 'Maintain paper-only containment', security.paperTradingSafetyLockSummary?.status, 'Pause operator workflows if the paper safety lock is not healthy.', security.eventType),
    ],
    rollbackReadinessChecklist: [
      item('rollback-release', 'Review last release decision', release.finalReleaseStatus, 'Identify the last reviewed paper-only release state; no rollback is executed here.', release.eventType),
      item('rollback-environment', 'Review configuration descriptors', environment.configurationReadinessStatus, 'Compare descriptor status with the approved planning snapshot; do not expose values.', environment.eventType),
      item('rollback-audit', 'Confirm rollback audit coverage', audit.auditIntegrityStatus?.status, 'Require an auditable operator record before any future rollback procedure.', audit.eventType),
    ],
  }
}

function buildOperatorHandoffSummary(checklists) {
  const items = Object.values(checklists).flat()
  const blockedCount = items.filter((entry) => entry.status === 'blocked').length
  const reviewCount = items.filter((entry) => entry.status === 'review').length
  const readyCount = items.filter((entry) => entry.status === 'ready').length
  const handoffStatus = blockedCount > 0 ? 'blocked' : reviewCount > 0 ? 'caution' : 'ready'
  return {
    handoffStatus,
    totalChecklistItems: items.length,
    readyCount,
    reviewCount,
    blockedCount,
    deploymentAuthorized: false,
    rollbackAuthorized: false,
    secretsIncluded: false,
    operatorReviewRequired: true,
  }
}

export function generateProductionOperationsRunbook(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const checklists = buildChecklists(input)
  const operatorHandoffSummary = buildOperatorHandoffSummary(checklists)
  const result = {
    eventType: SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    deploymentTriggered: false,
    secretsIncluded: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    ...checklists,
    operatorHandoffSummary,
    summary: `Production operations runbook ${operatorHandoffSummary.handoffStatus}: ${operatorHandoffSummary.readyCount} ready, ${operatorHandoffSummary.reviewCount} review, and ${operatorHandoffSummary.blockedCount} blocked checklist items.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionEnvironmentConfiguration: input.productionEnvironmentConfiguration?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT, result)
  }
  return result
}

export function createProductionOperationsRunbookEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return generateProductionOperationsRunbook(input, { ...options, ...evaluationOptions })
    },
  }
}
