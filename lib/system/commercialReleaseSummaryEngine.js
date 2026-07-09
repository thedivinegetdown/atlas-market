import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT = 'system.commercialRelease.summarized'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'release-ready'
  return 'caution'
}

function summarySection(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    ...details,
  }
}

function buildRemainingBlockerSummary(sections) {
  const blockers = sections.filter((section) => section.status === 'blocked')
  const cautions = sections.filter((section) => section.status === 'caution')
  return {
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    blockedSections: blockers.map((section) => section.id),
    cautionSections: cautions.map((section) => section.id),
    deploymentAuthorized: false,
    billingAuthorized: false,
    liveTradingAuthorized: false,
  }
}

function resolveFinalCommercialReleaseStatus(blockerSummary) {
  if (blockerSummary.blockerCount > 0) return 'blocked'
  if (blockerSummary.cautionCount > 0) return 'caution'
  return 'release-ready'
}

export function summarizeCommercialRelease(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const releaseCandidateSummary = summarySection(
    'release-candidate',
    'Release candidate summary',
    input.enterpriseReleaseControl?.finalReleaseStatus,
    input.enterpriseReleaseControl?.eventType,
    { releaseReadinessStatus: input.releaseReadiness?.releaseReadinessStatus ?? 'unknown' },
  )
  const launchReadinessSummary = summarySection(
    'launch-readiness',
    'Launch readiness summary',
    input.launchReadinessReview?.launchReadinessStatus,
    input.launchReadinessReview?.eventType,
  )
  const commercialReadinessSummary = summarySection(
    'commercial-readiness',
    'Commercial readiness summary',
    input.commercialReadiness?.commercialReadinessStatus,
    input.commercialReadiness?.eventType,
  )
  const supportReadinessSummary = summarySection(
    'support-readiness',
    'Support readiness summary',
    input.supportOperationsReadiness?.supportReadinessStatus,
    input.supportOperationsReadiness?.eventType,
  )
  const sections = [
    releaseCandidateSummary,
    launchReadinessSummary,
    commercialReadinessSummary,
    supportReadinessSummary,
  ]
  const remainingBlockerSummary = buildRemainingBlockerSummary(sections)
  const finalCommercialReleaseStatus = resolveFinalCommercialReleaseStatus(remainingBlockerSummary)
  const result = {
    eventType: SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT,
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
    releaseCandidateSummary,
    launchReadinessSummary,
    commercialReadinessSummary,
    supportReadinessSummary,
    remainingBlockerSummary,
    finalCommercialReleaseStatus,
    summary: `Commercial release ${finalCommercialReleaseStatus}: release candidate, launch, commercial, and support readiness summarized with ${remainingBlockerSummary.blockerCount} blockers and ${remainingBlockerSummary.cautionCount} cautions.`,
    sourceEvents: {
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
      launchReadinessReview: input.launchReadinessReview?.eventType ?? null,
      commercialReadiness: input.commercialReadiness?.eventType ?? null,
      supportOperationsReadiness: input.supportOperationsReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT, result)
  }
  return result
}

export function createCommercialReleaseSummaryEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return summarizeCommercialRelease(input, { ...options, ...evaluationOptions })
    },
  }
}
