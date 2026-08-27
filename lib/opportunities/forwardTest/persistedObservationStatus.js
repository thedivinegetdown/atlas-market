import { buildForwardObservationStatus, FORWARD_OBSERVATION_MINIMUM_OUTCOMES, FORWARD_OBSERVATION_MINIMUM_SESSIONS } from './forwardObservationEngine.js'

export const SUPPORTED_FORWARD_OBSERVATION_EXPERIMENTS = Object.freeze([
  Object.freeze({ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1' }),
  Object.freeze({ experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1' }),
  Object.freeze({ experimentId: 'RANGE.1', strategyId: 'range-mean-reversion-v1' }),
  Object.freeze({ experimentId: 'VOL.1', strategyId: 'volatility-expansion-v1' }),
])

function experimentIdFromOutcome(outcome = {}) {
  return outcome.experimentId
    ?? outcome.forwardObservation?.experimentId
    ?? outcome.payload?.experimentId
    ?? outcome.payload?.forwardObservation?.experimentId
    ?? outcome.payload?.qualifiedTradePlan?.integrity?.experimentId
    ?? null
}

function notStarted(experiment) {
  return {
    version: 'forward-observation-v1',
    ...experiment,
    status: 'NOT_STARTED',
    sessionsElapsed: 0,
    completedOutcomes: 0,
    minimumSessions: FORWARD_OBSERVATION_MINIMUM_SESSIONS,
    minimumOutcomes: FORWARD_OBSERVATION_MINIMUM_OUTCOMES,
    blockers: ['observation_manifest_not_started'],
    reason: 'observation_manifest_not_started',
    boundaries: { paperOnly: true, noOptimizationDuringObservation: true, automaticExecution: false, liveTrading: false },
  }
}

export async function resolvePersistedForwardObservationStatuses({ evidenceRepository, ledgerRepository, tenantContext, accountId, userId, executions } = {}) {
  const scope = { tenantContext, accountId, userId: userId ?? tenantContext?.userId }
  const loadedExecutions = executions ?? await ledgerRepository?.listExecutions?.(scope) ?? []
  return Promise.all(SUPPORTED_FORWARD_OBSERVATION_EXPERIMENTS.map(async (experiment) => {
    if (typeof evidenceRepository?.getForwardObservationManifest !== 'function' || typeof evidenceRepository?.listForwardEvidenceSnapshots !== 'function') {
      return { ...notStarted(experiment), status: 'UNAVAILABLE', blockers: ['observation_repository_unavailable'], reason: 'observation_repository_unavailable' }
    }
    const persisted = await evidenceRepository.getForwardObservationManifest({ ...scope, experimentId: experiment.experimentId })
    if (!persisted?.manifest) return notStarted(experiment)
    const snapshots = await evidenceRepository.listForwardEvidenceSnapshots({ ...scope, observationId: persisted.manifest.observationId })
    const outcomes = loadedExecutions.filter((outcome) => experimentIdFromOutcome(outcome) === experiment.experimentId)
    return buildForwardObservationStatus({ manifest: persisted.manifest, manifestStatus: persisted.status, snapshots, outcomes })
  }))
}