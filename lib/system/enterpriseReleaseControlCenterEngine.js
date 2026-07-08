import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT = 'system.releaseControl.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function makeGateReview({ gate, status, sourceStatus, eventType, summary, references = [] }) {
  return {
    gate,
    status,
    sourceStatus: sourceStatus ?? 'unknown',
    eventType: eventType ?? null,
    summary,
    references: references.filter(Boolean),
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildReadinessGateReview(releaseReadiness = {}) {
  const sourceStatus = releaseReadiness.releaseReadinessStatus ?? 'unknown'
  const status = sourceStatus === 'ready' ? 'passed' : sourceStatus === 'blocked' ? 'blocked' : 'caution'

  return makeGateReview({
    gate: 'readiness',
    status,
    sourceStatus,
    eventType: releaseReadiness.eventType,
    summary: status === 'passed'
      ? 'Readiness gate is ready for paper-only release control review.'
      : releaseReadiness.summary ?? 'Readiness gate requires operator review.',
    references: [
      releaseReadiness.eventType,
      ...(releaseReadiness.blockers ?? []),
      ...(releaseReadiness.cautions ?? []),
    ],
  })
}

function buildStabilizationGateReview(releaseCandidateStabilization = {}) {
  const sourceStatus = releaseCandidateStabilization.finalStatus ?? 'unknown'
  const status = sourceStatus === 'stable' ? 'passed' : sourceStatus === 'blocked' ? 'blocked' : 'caution'

  return makeGateReview({
    gate: 'stabilization',
    status,
    sourceStatus,
    eventType: releaseCandidateStabilization.eventType,
    summary: status === 'passed'
      ? 'Stabilization gate is stable for paper-only release control review.'
      : releaseCandidateStabilization.summary ?? 'Stabilization gate requires operator review.',
    references: [
      releaseCandidateStabilization.eventType,
      ...(releaseCandidateStabilization.releaseBlockers ?? []),
      ...(releaseCandidateStabilization.cautions ?? []),
    ],
  })
}

function buildSystemHealthGateReview(systemHealthCommandCenter = {}) {
  const sourceStatus = systemHealthCommandCenter.finalPlatformHealthStatus ?? 'unknown'
  const status = sourceStatus === 'operational' ? 'passed' : sourceStatus === 'degraded' ? 'blocked' : 'caution'

  return makeGateReview({
    gate: 'system health',
    status,
    sourceStatus,
    eventType: systemHealthCommandCenter.eventType,
    summary: systemHealthCommandCenter.summary ?? 'System health gate reviewed.',
    references: [
      systemHealthCommandCenter.eventType,
      ...Object.values(systemHealthCommandCenter.sourceEvents ?? {}),
    ],
  })
}

function buildEventObservabilityGateReview(eventObservability = {}) {
  const sourceStatus = eventObservability.observabilityStatus ?? 'unknown'
  const status = sourceStatus === 'healthy' ? 'passed' : sourceStatus === 'degraded' ? 'blocked' : 'caution'

  return makeGateReview({
    gate: 'event observability',
    status,
    sourceStatus,
    eventType: eventObservability.eventType,
    summary: eventObservability.summary ?? 'Event observability gate reviewed.',
    references: [
      eventObservability.eventType,
      ...(eventObservability.missingEventDetection?.missingEventTypes ?? []),
      ...(eventObservability.duplicateEventDetection?.duplicateEventTypes ?? []),
    ],
  })
}

function buildOperatorActionGateReview(operatorActionCenter = {}) {
  const topSeverity = operatorActionCenter.platformActionSummary?.topSeverity ?? 'low'
  const openActions = operatorActionCenter.platformActionSummary?.openActions ?? 0
  const status = topSeverity === 'critical'
    ? 'blocked'
    : topSeverity === 'high' || (openActions > 0 && topSeverity !== 'low')
      ? 'caution'
      : 'passed'

  return makeGateReview({
    gate: 'operator action',
    status,
    sourceStatus: topSeverity,
    eventType: operatorActionCenter.eventType,
    summary: operatorActionCenter.summary ?? `Operator action gate reviewed with ${openActions} open actions.`,
    references: [
      operatorActionCenter.eventType,
      ...(operatorActionCenter.prioritizedOperatorActions ?? []).map((action) => action.id),
      ...Object.values(operatorActionCenter.sourceEvents ?? {}),
    ],
  })
}

function buildAuditTrailGateReview(enterpriseAuditTrail = {}) {
  const sourceStatus = enterpriseAuditTrail.auditIntegrityStatus?.status ?? 'unknown'
  const status = sourceStatus === 'valid' ? 'passed' : sourceStatus === 'invalid' ? 'blocked' : 'caution'

  return makeGateReview({
    gate: 'audit trail',
    status,
    sourceStatus,
    eventType: enterpriseAuditTrail.eventType,
    summary: enterpriseAuditTrail.summary ?? 'Enterprise audit trail gate reviewed.',
    references: [
      enterpriseAuditTrail.eventType,
      ...(enterpriseAuditTrail.eventChainReferences ?? []),
      ...(enterpriseAuditTrail.operatorActionReferences ?? []),
      ...(enterpriseAuditTrail.riskDecisionReferences ?? []),
    ],
  })
}

function resolveFinalReleaseStatus(gates = []) {
  if (gates.some((gate) => gate.status === 'blocked')) return 'blocked'
  if (gates.some((gate) => gate.status === 'caution')) return 'caution'
  return 'release-ready'
}

function summarizeDecision(finalReleaseStatus, gates = []) {
  const blocked = gates.filter((gate) => gate.status === 'blocked')
  const caution = gates.filter((gate) => gate.status === 'caution')

  if (finalReleaseStatus === 'release-ready') {
    return 'Enterprise release control is release-ready for the paper-only Atlas workspace.'
  }

  if (finalReleaseStatus === 'blocked') {
    return `Enterprise release control is blocked by ${blocked.map((gate) => gate.gate).join(', ')}.`
  }

  return `Enterprise release control requires caution review for ${caution.map((gate) => gate.gate).join(', ')}.`
}

export function evaluateEnterpriseReleaseControl(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const readinessGateReview = buildReadinessGateReview(input.releaseReadiness)
  const stabilizationGateReview = buildStabilizationGateReview(input.releaseCandidateStabilization)
  const systemHealthGateReview = buildSystemHealthGateReview(input.systemHealthCommandCenter ?? input.systemHealth)
  const eventObservabilityGateReview = buildEventObservabilityGateReview(input.eventObservability)
  const operatorActionGateReview = buildOperatorActionGateReview(input.operatorActionCenter ?? input.operatorActions)
  const auditTrailGateReview = buildAuditTrailGateReview(input.enterpriseAuditTrail ?? input.auditTrail)
  const gateReviews = [
    readinessGateReview,
    stabilizationGateReview,
    systemHealthGateReview,
    eventObservabilityGateReview,
    operatorActionGateReview,
    auditTrailGateReview,
  ]
  const finalReleaseStatus = resolveFinalReleaseStatus(gateReviews)
  const releaseRationaleSummary = summarizeDecision(finalReleaseStatus, gateReviews)
  const releaseDecisionSummary = {
    finalReleaseStatus,
    passedGateCount: gateReviews.filter((gate) => gate.status === 'passed').length,
    cautionGateCount: gateReviews.filter((gate) => gate.status === 'caution').length,
    blockedGateCount: gateReviews.filter((gate) => gate.status === 'blocked').length,
    paperTradingOnly: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
  const result = {
    eventType: SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    timestamp,
    releaseDecisionSummary,
    readinessGateReview,
    stabilizationGateReview,
    systemHealthGateReview,
    eventObservabilityGateReview,
    operatorActionGateReview,
    auditTrailGateReview,
    finalReleaseStatus,
    releaseRationaleSummary,
    sourceEvents: {
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
      releaseCandidateStabilization: input.releaseCandidateStabilization?.eventType ?? null,
      systemHealthCommandCenter: (input.systemHealthCommandCenter ?? input.systemHealth)?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      operatorActionCenter: (input.operatorActionCenter ?? input.operatorActions)?.eventType ?? null,
      enterpriseAuditTrail: (input.enterpriseAuditTrail ?? input.auditTrail)?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT, result)
  }

  return result
}

export function createEnterpriseReleaseControlCenterEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateEnterpriseReleaseControl(input, { ...options, ...evaluationOptions })
    },
  }
}
