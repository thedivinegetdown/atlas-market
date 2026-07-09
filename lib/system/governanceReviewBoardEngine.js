import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT = 'system.governanceReview.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReviewStatus(status) {
  if (['blocked', 'rejected', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'approved', 'valid', 'healthy', 'operational', 'release-ready', 'passed'].includes(status)) return 'approved'
  return 'caution'
}

function reviewSummary(id, label, sourceStatus, sourceEvent, reviewer = 'future-review-board') {
  return {
    id,
    label,
    status: normalizeReviewStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    reviewer,
    decisionEnforced: false,
  }
}

function buildReviewBoardModelPlaceholder() {
  return {
    boardId: 'future-enterprise-governance-review-board',
    implemented: false,
    membersConfigured: false,
    authenticationRequired: false,
    userAccountsRequired: false,
    decisionEnforcementEnabled: false,
  }
}

function buildReviewDomainSummary(reviews) {
  const blockedCount = reviews.filter((review) => review.status === 'blocked').length
  const cautionCount = reviews.filter((review) => review.status === 'caution').length
  return {
    totalDomains: reviews.length,
    approvedCount: reviews.filter((review) => review.status === 'approved').length,
    cautionCount,
    blockedCount,
    decisionEnforced: false,
  }
}

function resolveGovernanceDecision(reviewDomainSummary) {
  if (reviewDomainSummary.blockedCount > 0) return 'blocked'
  if (reviewDomainSummary.cautionCount > 0) return 'caution'
  return 'approved'
}

export function evaluateGovernanceReviewBoard(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const reviewBoardModelPlaceholder = buildReviewBoardModelPlaceholder()
  const complianceReviewSummary = reviewSummary(
    'compliance-review',
    'Compliance review summary',
    input.complianceReadiness?.complianceReadinessStatus,
    input.complianceReadiness?.eventType,
  )
  const policyReviewSummary = reviewSummary(
    'policy-review',
    'Policy review summary',
    input.policyControlPlanning?.policyReadinessStatus,
    input.policyControlPlanning?.eventType,
  )
  const releaseReviewSummary = reviewSummary(
    'release-review',
    'Release review summary',
    input.enterpriseReleaseControl?.finalReleaseStatus,
    input.enterpriseReleaseControl?.eventType,
  )
  const riskReviewSummary = reviewSummary(
    'risk-review',
    'Risk review summary',
    input.operatorActionCenter?.platformActionSummary?.topSeverity === 'critical'
      ? 'blocked'
      : input.systemHealthCommandCenter?.finalPlatformHealthStatus,
    input.operatorActionCenter?.eventType ?? input.systemHealthCommandCenter?.eventType,
    'future-risk-review-board',
  )
  const reviews = [
    complianceReviewSummary,
    policyReviewSummary,
    releaseReviewSummary,
    riskReviewSummary,
  ]
  const reviewDomainSummary = buildReviewDomainSummary(reviews)
  const governanceDecision = resolveGovernanceDecision(reviewDomainSummary)
  const result = {
    eventType: SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    legalClaimMade: false,
    policyEnforced: false,
    authenticationAdded: false,
    userAccountsAdded: false,
    reviewBoardModelPlaceholder,
    reviewDomainSummary,
    complianceReviewSummary,
    policyReviewSummary,
    releaseReviewSummary,
    riskReviewSummary,
    governanceDecision,
    summary: `Governance review ${governanceDecision}: ${reviewDomainSummary.totalDomains} review domains evaluated by a placeholder board with no enforcement.`,
    sourceEvents: {
      complianceReadiness: input.complianceReadiness?.eventType ?? null,
      policyControlPlanning: input.policyControlPlanning?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT, result)
  }
  return result
}

export function createGovernanceReviewBoardEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateGovernanceReviewBoard(input, { ...options, ...evaluationOptions })
    },
  }
}
