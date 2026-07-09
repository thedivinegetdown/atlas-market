import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT = 'system.commercialReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'ready'
  return 'caution'
}

function readinessSummary(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    ...details,
  }
}

function resolveCommercialReadinessStatus(summaries) {
  if (summaries.some((summary) => summary.status === 'blocked')) return 'blocked'
  if (summaries.some((summary) => summary.status === 'caution')) return 'caution'
  return 'ready'
}

export function evaluateCommercialReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const productReadinessSummary = readinessSummary(
    'product-readiness',
    'Product readiness summary',
    input.systemHealthCommandCenter?.finalPlatformHealthStatus,
    input.systemHealthCommandCenter?.eventType,
    {
      releaseStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
      paperTradingOnly: true,
    },
  )
  const saasReadinessSummary = readinessSummary(
    'saas-readiness',
    'SaaS readiness summary',
    input.enterpriseSaasReadiness?.saasReadinessStatus,
    input.enterpriseSaasReadiness?.eventType,
    {
      billingEnabled: false,
      userAccountsEnabled: false,
    },
  )
  const deploymentReadinessSummary = readinessSummary(
    'deployment-readiness',
    'Deployment readiness summary',
    input.productionDeploymentReadiness?.deploymentReadinessStatus,
    input.productionDeploymentReadiness?.eventType,
    {
      deploymentTriggered: false,
    },
  )
  const securityReadinessSummary = readinessSummary(
    'security-readiness',
    'Security readiness summary',
    input.productionSecurityReadiness?.securityReadinessStatus,
    input.productionSecurityReadiness?.eventType,
    {
      authenticationEnforced: false,
      secretsExposed: false,
    },
  )
  const complianceGovernanceReadinessSummary = readinessSummary(
    'compliance-governance-readiness',
    'Compliance / governance readiness summary',
    input.complianceReadiness?.complianceReadinessStatus === 'blocked'
      || input.governanceReviewBoard?.governanceDecision === 'blocked'
      ? 'blocked'
      : input.complianceReadiness?.complianceReadinessStatus === 'ready'
        && input.governanceReviewBoard?.governanceDecision === 'approved'
          ? 'ready'
          : 'caution',
    input.governanceReviewBoard?.eventType ?? input.complianceReadiness?.eventType,
    {
      complianceStatus: input.complianceReadiness?.complianceReadinessStatus ?? 'unknown',
      governanceDecision: input.governanceReviewBoard?.governanceDecision ?? 'unknown',
      legalClaimMade: false,
    },
  )
  const operatorReadinessSummary = readinessSummary(
    'operator-readiness',
    'Operator readiness summary',
    input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus
      ?? input.operatorActionCenter?.platformActionSummary?.topSeverity,
    input.productionOperationsRunbook?.eventType ?? input.operatorActionCenter?.eventType,
    {
      runbookStatus: input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus ?? 'unknown',
      operatorActionSeverity: input.operatorActionCenter?.platformActionSummary?.topSeverity ?? 'unknown',
    },
  )
  const summaries = [
    productReadinessSummary,
    saasReadinessSummary,
    deploymentReadinessSummary,
    securityReadinessSummary,
    complianceGovernanceReadinessSummary,
    operatorReadinessSummary,
  ]
  const commercialReadinessStatus = resolveCommercialReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    paymentsEnabled: false,
    authenticationEnforced: false,
    userAccountsAdded: false,
    productReadinessSummary,
    saasReadinessSummary,
    deploymentReadinessSummary,
    securityReadinessSummary,
    complianceGovernanceReadinessSummary,
    operatorReadinessSummary,
    commercialReadinessStatus,
    summary: `Commercial readiness ${commercialReadinessStatus}: product, SaaS, deployment, security, governance, and operator readiness reviewed with billing and accounts disabled.`,
    sourceEvents: {
      enterpriseSaasReadiness: input.enterpriseSaasReadiness?.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      complianceReadiness: input.complianceReadiness?.eventType ?? null,
      governanceReviewBoard: input.governanceReviewBoard?.eventType ?? null,
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createCommercialReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateCommercialReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
