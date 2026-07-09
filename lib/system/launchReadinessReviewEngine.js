import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT = 'system.launchReadiness.reviewed'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeGateStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'ready'
  return 'caution'
}

function gate(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeGateStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    ...details,
  }
}

function resolveLaunchReadinessStatus(gates) {
  if (gates.some((item) => item.status === 'blocked')) return 'blocked'
  if (gates.some((item) => item.status === 'caution')) return 'caution'
  return 'ready'
}

export function reviewLaunchReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const productReadinessGate = gate(
    'product-readiness',
    'Product readiness gate',
    input.systemHealthCommandCenter?.finalPlatformHealthStatus,
    input.systemHealthCommandCenter?.eventType,
    { releaseControlStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown' },
  )
  const deploymentReadinessGate = gate(
    'deployment-readiness',
    'Deployment readiness gate',
    input.productionDeploymentReadiness?.deploymentReadinessStatus,
    input.productionDeploymentReadiness?.eventType,
    { deploymentTriggered: false },
  )
  const securityReadinessGate = gate(
    'security-readiness',
    'Security readiness gate',
    input.productionSecurityReadiness?.securityReadinessStatus,
    input.productionSecurityReadiness?.eventType,
    { authenticationEnforced: false },
  )
  const governanceReadinessGate = gate(
    'governance-readiness',
    'Governance readiness gate',
    input.governanceReviewBoard?.governanceDecision,
    input.governanceReviewBoard?.eventType,
    { policyEnforced: false },
  )
  const commercialReadinessGate = gate(
    'commercial-readiness',
    'Commercial readiness gate',
    input.commercialReadiness?.commercialReadinessStatus,
    input.commercialReadiness?.eventType,
    { billingEnabled: false, paymentsEnabled: false },
  )
  const supportReadinessGate = gate(
    'support-readiness',
    'Support readiness gate',
    input.supportOperationsReadiness?.supportReadinessStatus,
    input.supportOperationsReadiness?.eventType,
    { supportWorkflowImplemented: input.supportOperationsReadiness?.supportWorkflowPlaceholder?.implemented === true },
  )
  const gates = [
    productReadinessGate,
    deploymentReadinessGate,
    securityReadinessGate,
    governanceReadinessGate,
    commercialReadinessGate,
    supportReadinessGate,
  ]
  const launchReadinessStatus = resolveLaunchReadinessStatus(gates)
  const result = {
    eventType: SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentTriggered: false,
    billingEnabled: false,
    paymentsEnabled: false,
    authenticationEnforced: false,
    userAccountsAdded: false,
    productReadinessGate,
    deploymentReadinessGate,
    securityReadinessGate,
    governanceReadinessGate,
    commercialReadinessGate,
    supportReadinessGate,
    launchReadinessStatus,
    summary: `Launch readiness ${launchReadinessStatus}: product, deployment, security, governance, commercial, and support gates reviewed without deploying.`,
    sourceEvents: {
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      governanceReviewBoard: input.governanceReviewBoard?.eventType ?? null,
      commercialReadiness: input.commercialReadiness?.eventType ?? null,
      supportOperationsReadiness: input.supportOperationsReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT, result)
  }
  return result
}

export function createLaunchReadinessReviewEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return reviewLaunchReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
