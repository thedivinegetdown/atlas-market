import { buildCanonicalPaperOutcomes } from '../../lib/analytics/canonicalPaperOutcomes.js'
import { reviewPaperPerformance } from '../../lib/analytics/paperPerformanceReview.js'
import { buildPaperLearningEvidence } from '../../lib/analytics/paperLearning/index.js'
import { buildForwardObservationStatus } from '../../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { edge2BindingMatches, evaluateEdge2Activation } from '../../lib/opportunities/forwardTest/edge2ActivationContract.js'

function matchesManifest(outcome, manifest, activation) {
  const enrolledAt = Date.parse(outcome.forwardObservation?.enrolledAt)
  const closedAt = Date.parse(outcome.closedAt ?? outcome.evidenceTimestamp)
  return outcome.forwardObservation?.experimentId === (manifest?.experiment?.experimentId ?? 'EDGE.2')
    && outcome.forwardObservation?.observationId === manifest?.observationId
    && outcome.forwardObservation?.manifestFingerprint === manifest?.manifestFingerprint
    && edge2BindingMatches(manifest?.activationBinding, activation)
    && edge2BindingMatches(outcome.forwardObservation?.activationBinding, activation)
    && Number.isFinite(enrolledAt) && enrolledAt >= Date.parse(activation.enrollment.startAt) && enrolledAt <= Date.parse(activation.enrollment.endAt)
    && Number.isFinite(closedAt) && closedAt >= enrolledAt && closedAt <= Date.parse(activation.enrollment.outcomeCutoffAt)
    && outcome.exitAttribution?.policyCompliant === true
    && outcome.exitAttribution?.countsTowardObservationMinimum === true
}

export function createPaperLearningHandler({ ledgerRepository: providedLedgerRepository, opportunityRepository, env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ query, tenantContext, user, repository }) => {
    const accountId = requireAccountContext(query.accountId ?? 'paper-portfolio')
    const context = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const ledger = resolveCanonicalPaperLedgerRepository({ persistenceRepository: repository, ledgerRepository: providedLedgerRepository, env })
    const evidenceRepository = opportunityRepository ?? (env.NODE_ENV === 'test' ? null : resolveCanonicalPaperEvidenceRepository({ persistenceRepository: repository, env }))
    const executionHistory = typeof ledger.readExecutionHistory === 'function'
      ? await ledger.readExecutionHistory(context)
      : { executions: await ledger.listExecutions(context), history: { status: 'UNKNOWN', latest: null } }
    const measurement = buildCanonicalPaperOutcomes(executionHistory.executions, { history: executionHistory.history })
    const review = reviewPaperPerformance(measurement.outcomes, { asOf: query.asOf, cohortIsolation: true, equityChronology: measurement.equityChronology })
    const learning = buildPaperLearningEvidence(review)
    const observation = evidenceRepository ? await evidenceRepository.getForwardObservationManifest({ ...context, experimentId: 'EDGE.2' }) : null
    const activation = evaluateEdge2Activation(evidenceRepository ? await evidenceRepository.getEdge2ActivationManifest?.(context) : null, { accountId })
    const snapshots = observation && activation.valid ? await evidenceRepository.listForwardEvidenceSnapshots({ ...context, observationId: observation.manifest.observationId }) : []
    const cohortOutcomes = observation && activation.valid ? measurement.outcomes.filter((outcome) => matchesManifest(outcome, observation.manifest, activation)) : []
    const cohortReview = reviewPaperPerformance(cohortOutcomes, { asOf: query.asOf, cohortIsolation: true, equityChronology: measurement.equityChronology })
    const cohortLearning = buildPaperLearningEvidence(cohortReview)
    return {
      ...learning,
      history: measurement.history,
      outcomeContract: { version: measurement.version, excludedOutcomes: measurement.excludedOutcomes, equityChronology: measurement.equityChronology, boundaries: measurement.boundaries },
      forwardObservation: buildForwardObservationStatus({ manifest: observation?.manifest, manifestStatus: observation?.status, snapshots, outcomes: cohortOutcomes, performanceReview: cohortReview, learningEvidence: cohortLearning, experimentId: 'EDGE.2', activationDecision: activation }),
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-learning', env, ...options })
}

export const handler = createPaperLearningHandler()
