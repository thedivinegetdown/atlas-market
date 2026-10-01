import { describe, expect, it, vi } from 'vitest'
import { buildCanonicalPaperOutcomes } from '../lib/analytics/canonicalPaperOutcomes.js'
import { buildForwardObservationStatus, createForwardObservationExperimentDefinition, createForwardObservationManifest } from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { EDGE2_ACTIVATION_MANIFEST_VERSION, EDGE2_FROZEN_PROTOCOL_FINGERPRINT, EDGE2_FROZEN_PROTOCOL_ID, evaluateEdge2Activation, fingerprintEdge2ActivationManifest } from '../lib/opportunities/forwardTest/edge2ActivationContract.js'
import { INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { createPaperPerformanceReviewHandler } from '../netlify/functions/paper-performance-review.js'
import { createPaperLearningHandler } from '../netlify/functions/paper-learning.js'

const enrolledAt = '2026-10-03T14:00:00.000Z'
const closedAt = '2026-10-20T14:00:00.000Z'
const accountId = 'edge2-paper'
const strategyFingerprint = '1'.repeat(64)
const evidenceHash = '9'.repeat(64)

// Synthetic activation exists only in this test. Production has no activation writer.
function activationRecord() {
  const core = {
    version: EDGE2_ACTIVATION_MANIFEST_VERSION, activationId: 'edge2-test-only', revision: 1,
    immutable: true, status: 'ACTIVATED', collectionAllowed: true, activatedAt: '2026-10-01T13:00:00.000Z',
    protocol: { protocolId: EDGE2_FROZEN_PROTOCOL_ID, protocolFingerprint: EDGE2_FROZEN_PROTOCOL_FINGERPRINT,
      strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', strategyFingerprint,
      exitPolicyVersion: INDEX_PULLBACK_EXIT_POLICY_VERSION, exitPolicyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT },
    account: { accountId, scope: 'dedicated_EDGE.2_paper_account', paperOnly: true, liveBrokerExecution: false },
    economics: { operationsCostDollarsPerLifecycle: 2, capitalCostDollarsPerLifecycle: 3, finalHurdleR: 0.3, ownerApproved: true },
    enrollment: { startAt: '2026-10-02T13:00:00.000Z', endAt: '2026-12-31T21:00:00.000Z', outcomeCutoffAt: '2027-01-31T21:00:00.000Z', reconciliationEndsAt: '2027-02-07T21:00:00.000Z', noBackfill: true },
    sampling: { finalized: true, ownerApproved: true, prospectivePowerInputs: { dispersionAssumption: 1.2, dependenceAssumption: 0.25, validCandidateRate: 0.5, entryRate: 0.5, completionRate: 0.9, attritionAllowance: 0.1 }, requiredValidSessions: 140, requiredCompletedLifecycles: 45 },
    prerequisites: Object.fromEntries([
      ['pa4AuthoritativeChronology', 'QUALIFIED'], ['exchangeCalendar', 'QUALIFIED'], ['dedicatedPaperAccount', 'BOUND'],
      ['economicHurdle', 'APPROVED'], ['enrollmentWindow', 'BOUND'], ['prospectiveSamplingPower', 'FINALIZED'], ['frozenConfiguration', 'MATCHED'],
    ].map(([key, status], index) => [key, { status, evidenceFingerprint: index.toString(16).repeat(64) }])),
  }
  return { manifest: { ...core, activationFingerprint: fingerprintEdge2ActivationManifest(core) }, status: 'activated', serverOwned: true }
}

const record = activationRecord()
const activation = evaluateEdge2Activation(record, { accountId })
const definition = createForwardObservationExperimentDefinition({
  experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', strategyFingerprint,
  observationUniverse: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
  exitPolicy: { id: INDEX_PULLBACK_EXIT_POLICY_VERSION, version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true },
  createdAt: enrolledAt,
})
const manifest = createForwardObservationManifest({
  observationId: 'edge2-outcome-test-only', startedAt: enrolledAt, experimentDefinition: definition,
  regimeEngineVersion: 'market-regime-v1', tradeQualityVersion: 'trade-quality-v1', riskPolicyVersion: 'trade-guardrail-v1',
  startingPaperAccount: { accountId, cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 },
  activationBinding: activation.binding,
  exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, maximumHoldingSessions: 20, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' },
})
const cohort = { experimentId: 'EDGE.2', observationId: manifest.observationId, manifestFingerprint: manifest.manifestFingerprint, activationBinding: activation.binding, enrolledAt }

function lifecycle(entryCohort = cohort, { reduction = true } = {}) {
  const attribution = { strategyFingerprint, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT,
    evaluationFingerprint: 'evaluation-evidence', experimentId: entryCohort?.experimentId ?? null,
    observationId: entryCohort?.observationId ?? null, manifestFingerprint: entryCohort?.manifestFingerprint ?? null }
  const row = (executionType, quantity, time, forwardObservation, cashImpact, realizedPnlDelta) => ({
    executionId: `edge-${executionType}`, positionId: 'edge-position', accountId, executionType, symbol: 'SPY', strategyId: 'index-pullback-v1',
    quantity, fees: 0, cashImpact, realizedPnlDelta, evidenceTimestamp: time,
    payload: { accountId, evaluationId: 'eval-edge2', evaluationEvidenceFingerprint: 'evaluation-evidence', attribution,
      forwardObservation: structuredClone(forwardObservation), plannedRisk: 50, valuation: { equity: 100000 }, accountEquityAfter: 100000,
      exitAttribution: executionType === 'close' ? { policyCompliant: true, countsTowardObservationMinimum: true, evidenceManifestHash: evidenceHash } : null,
      exitEvidenceManifest: executionType === 'close' ? { version: 'pa4-session-chronology-v1', evidenceClass: 'GENUINE', manifestHash: evidenceHash } : null },
  })
  const entry = row('entry', 10, enrolledAt, entryCohort, -1000, 0)
  const partial = row('reduction', 4, '2026-10-10T14:00:00.000Z', entryCohort, 420, 20)
  const close = row('close', reduction ? 6 : 10, closedAt, entryCohort, reduction ? 630 : 1050, reduction ? 30 : 50)
  return reduction ? [entry, partial, close] : [entry, close]
}

function status(rows) {
  return buildForwardObservationStatus({ manifest, snapshots: [], outcomes: buildCanonicalPaperOutcomes(rows).outcomes, activationDecision: activation })
}

async function endpoint(createHandler, rows, activationManifest = record) {
  const handler = createHandler({
    ledgerRepository: { persistenceMode: 'postgresql', readExecutionHistory: async () => ({ executions: rows, history: { status: 'COMPLETE' } }) },
    opportunityRepository: { getForwardObservationManifest: async () => ({ manifest, status: 'collecting' }), getEdge2ActivationManifest: async () => activationManifest, listForwardEvidenceSnapshots: async () => [] },
    authProvider: { authenticate: async () => ({ ok: true, user: { id: 'user-a', status: 'active' }, session: { id: 'session-a', userId: 'user-a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' } }) },
    authorizationService: { assert: () => ({ allowed: true }) },
    organizationMembershipRepository: { getMembership: async () => ({ organizationId: 'org-a', userId: 'user-a', role: 'viewer', status: 'active' }) },
    repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: { NODE_ENV: 'test' },
  })
  const response = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer test' }, queryStringParameters: { organizationId: 'org-a', accountId } })
  expect(response.statusCode).toBe(200)
  return JSON.parse(response.body).data
}

describe('EDGE.2 canonical outcome attribution', () => {
  it('preserves the accepted entry identity through reduction and close, and both consumers count it', async () => {
    expect(activation).toMatchObject({ valid: true, collectionAllowed: true })
    const rows = lifecycle()
    const measurement = buildCanonicalPaperOutcomes(rows)
    const outcome = measurement.outcomes[0]
    expect(outcome).toMatchObject({ accountId, netPnl: 50, reductionExecutionIds: ['edge-reduction'],
      attribution: { status: 'COMPLETE', evaluationIds: ['eval-edge2'], evaluationFingerprints: ['evaluation-evidence'],
        strategyFingerprint, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, activationBinding: activation.binding, enrolledAt },
      forwardObservation: cohort })
    expect(outcome.forwardObservation.activationBinding).toEqual(rows[0].payload.forwardObservation.activationBinding)
    expect(status(rows).completedOutcomes).toBe(1)
    for (const createHandler of [createPaperPerformanceReviewHandler, createPaperLearningHandler]) {
      const response = await endpoint(createHandler, rows)
      expect(response.forwardObservation.completedOutcomes).toBe(1)
    }
  })

  it.each([
    ['missing activation binding', (rows) => { delete rows[0].payload.forwardObservation.activationBinding }],
    ['missing enrollment time', (rows) => { delete rows[0].payload.forwardObservation.enrolledAt }],
    ['wrong activation revision', (rows) => { rows[0].payload.forwardObservation.activationBinding = { ...cohort.activationBinding, activationRevision: 2 } }],
    ['wrong activation fingerprint', (rows) => { rows[0].payload.forwardObservation.activationBinding = { ...cohort.activationBinding, activationFingerprint: 'f'.repeat(64) } }],
    ['wrong activation binding', (rows) => { rows[0].payload.forwardObservation.activationBinding = { ...cohort.activationBinding, activationId: 'other' } }],
    ['mismatched observation', (rows) => { rows[0].payload.forwardObservation.observationId = 'other' }],
    ['mismatched manifest', (rows) => { rows[0].payload.forwardObservation.manifestFingerprint = 'other' }],
    ['close rewrites activation', (rows) => { rows[2].payload.forwardObservation = { ...cohort, activationBinding: { ...cohort.activationBinding, activationId: 'other' } } }],
    ['reduction rewrites activation', (rows) => { rows[1].payload.forwardObservation = { ...cohort, activationBinding: { ...cohort.activationBinding, activationId: 'other' } } }],
    ['close rewrites observation attribution', (rows) => { rows[2].payload.attribution = { ...rows[2].payload.attribution, observationId: 'other' } }],
    ['close rewrites experiment attribution', (rows) => { rows[2].payload.attribution = { ...rows[2].payload.attribution, experimentId: 'BREAKOUT.1' } }],
    ['close rewrites evaluation ID', (rows) => { rows[2].payload.evaluationId = 'other-evaluation' }],
    ['reduction rewrites evaluation fingerprint', (rows) => { rows[1].payload.evaluationEvidenceFingerprint = 'other-evidence' }],
    ['entry evaluation evidence contradicts attribution', (rows) => { rows[0].payload.evaluationEvidenceFingerprint = 'other-evidence' }],
  ])('%s cannot qualify or increment counters', async (_name, change) => {
    const rows = structuredClone(lifecycle())
    change(rows)
    const outcome = buildCanonicalPaperOutcomes(rows).outcomes[0]
    expect(outcome.accountingStatus).toBe('position_closed')
    expect(outcome.attribution.status).not.toBe('COMPLETE')
    expect(outcome.forwardObservation?.activationBinding).toEqual(rows[0].payload.forwardObservation.activationBinding ?? null)
    expect(status(rows).completedOutcomes).toBe(0)
    for (const createHandler of [createPaperPerformanceReviewHandler, createPaperLearningHandler]) {
      expect((await endpoint(createHandler, rows)).forwardObservation.completedOutcomes).toBe(0)
    }
  })

  it('rejects a different current activation and leaves production non-active', async () => {
    const rows = lifecycle()
    const changed = activationRecord()
    changed.manifest.revision = 2
    changed.manifest.activationFingerprint = fingerprintEdge2ActivationManifest(Object.fromEntries(Object.entries(changed.manifest).filter(([key]) => key !== 'activationFingerprint')))
    expect((await endpoint(createPaperPerformanceReviewHandler, rows, changed)).forwardObservation.completedOutcomes).toBe(0)
    expect((await endpoint(createPaperLearningHandler, rows, changed)).forwardObservation.completedOutcomes).toBe(0)
    expect(evaluateEdge2Activation(null, { accountId })).toMatchObject({ valid: false, collectionAllowed: false })
    expect(buildForwardObservationStatus({ experimentId: 'EDGE.2', activationDecision: evaluateEdge2Activation(null, { accountId }) })).toMatchObject({ status: 'NON_ACTIVE', completedOutcomes: 0 })
  })

  it('continues ordinary non-EDGE.2 outcome reconstruction without activation fields', () => {
    const rows = lifecycle({ experimentId: 'BREAKOUT.1', observationId: 'breakout', manifestFingerprint: 'breakout-manifest' }, { reduction: false })
    rows[0].payload.attribution = { ...rows[0].payload.attribution, experimentId: 'BREAKOUT.1', observationId: 'breakout', manifestFingerprint: 'breakout-manifest' }
    rows[1].payload.attribution = { ...rows[0].payload.attribution }
    const result = buildCanonicalPaperOutcomes(rows)
    expect(result.outcomes[0]).toMatchObject({ accountingStatus: 'position_closed', netPnl: 50, attribution: { status: 'COMPLETE' }, forwardObservation: { experimentId: 'BREAKOUT.1' } })
    expect(result.comparableOutcomes).toHaveLength(1)
    expect(status(rows).completedOutcomes).toBe(0)
  })
})
