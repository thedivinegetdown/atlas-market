import { buildCanonicalPaperOutcomes } from '../../lib/analytics/canonicalPaperOutcomes.js'
import { reviewPaperPerformance } from '../../lib/analytics/paperPerformanceReview.js'
import { buildForwardObservationStatus } from '../../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function matchesManifest(outcome, manifest) {
  return outcome.forwardObservation?.experimentId === (manifest?.experiment?.experimentId ?? 'EDGE.2')
    && outcome.forwardObservation?.observationId === manifest?.observationId
    && outcome.forwardObservation?.manifestFingerprint === manifest?.manifestFingerprint
    && outcome.exitAttribution?.policyCompliant === true
    && outcome.exitAttribution?.countsTowardObservationMinimum === true
}

export function createPaperPerformanceReviewHandler({ ledgerRepository: providedLedgerRepository, opportunityRepository, env = process.env, ...options } = {}) {
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
    const observation = evidenceRepository ? await evidenceRepository.getForwardObservationManifest({ ...context, experimentId: 'EDGE.2' }) : null
    const snapshots = observation ? await evidenceRepository.listForwardEvidenceSnapshots({ ...context, observationId: observation.manifest.observationId }) : []
    const cohortOutcomes = observation ? measurement.outcomes.filter((outcome) => matchesManifest(outcome, observation.manifest)) : []
    const cohortReview = reviewPaperPerformance(cohortOutcomes, { asOf: query.asOf, cohortIsolation: true, equityChronology: measurement.equityChronology })
    return {
      ...review,
      history: measurement.history,
      outcomeContract: { version: measurement.version, excludedOutcomes: measurement.excludedOutcomes, equityChronology: measurement.equityChronology, boundaries: measurement.boundaries },
      forwardObservation: buildForwardObservationStatus({ manifest: observation?.manifest, manifestStatus: observation?.status, snapshots, outcomes: cohortOutcomes, performanceReview: cohortReview }),
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-performance-review', env, ...options })
}

export const handler = createPaperPerformanceReviewHandler()
