import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import {
  buildForwardObservationStatus,
  createForwardEvidenceSnapshot,
  createForwardObservationExperimentDefinition,
  createForwardObservationManifest,
  EDGE2_FORWARD_EVALUATION_PROTOCOL,
} from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import {
  EDGE2_ACTIVATION_MANIFEST_VERSION,
  EDGE2_FROZEN_PROTOCOL_FINGERPRINT,
  EDGE2_FROZEN_PROTOCOL_ID,
  evaluateEdge2Activation,
  fingerprintEdge2ActivationManifest,
} from '../lib/opportunities/forwardTest/edge2ActivationContract.js'
import { runForwardObservation } from '../lib/opportunities/forwardTest/forwardObservationOrchestrator.js'
import { admitEdge2ForwardObservation } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { createIndexPullbackExitPolicy, INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { edge2CohortFor } from '../netlify/functions/paper-order-simulation.js'
import { createForwardObservationHandler } from '../netlify/functions/forward-observation.js'

const NOW = '2026-10-03T14:00:00.000Z'
const BEFORE_ENROLLMENT = '2026-10-01T12:00:00.000Z'
const STRATEGY_FINGERPRINT = '1'.repeat(64)
const scope = { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' }, accountId: 'edge2-paper', userId: 'user-a' }

function activationRecord(change) {
  const core = {
    version: EDGE2_ACTIVATION_MANIFEST_VERSION,
    activationId: 'edge2-activation-test-only',
    revision: 1,
    immutable: true,
    status: 'ACTIVATED',
    collectionAllowed: true,
    activatedAt: '2026-10-01T13:00:00.000Z',
    protocol: {
      protocolId: EDGE2_FROZEN_PROTOCOL_ID,
      protocolFingerprint: EDGE2_FROZEN_PROTOCOL_FINGERPRINT,
      strategyId: 'index-pullback-v1',
      strategyVersion: '1.2.0',
      strategyFingerprint: STRATEGY_FINGERPRINT,
      exitPolicyVersion: INDEX_PULLBACK_EXIT_POLICY_VERSION,
      exitPolicyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT,
    },
    account: { accountId: 'edge2-paper', scope: 'dedicated_EDGE.2_paper_account', paperOnly: true, liveBrokerExecution: false },
    economics: { operationsCostDollarsPerLifecycle: 2, capitalCostDollarsPerLifecycle: 3, finalHurdleR: 0.3, ownerApproved: true },
    enrollment: { startAt: '2026-10-02T13:00:00.000Z', endAt: '2026-12-31T21:00:00.000Z', outcomeCutoffAt: '2027-01-31T21:00:00.000Z', reconciliationEndsAt: '2027-02-07T21:00:00.000Z', noBackfill: true },
    sampling: {
      finalized: true,
      ownerApproved: true,
      prospectivePowerInputs: { dispersionAssumption: 1.2, dependenceAssumption: 0.25, validCandidateRate: 0.5, entryRate: 0.5, completionRate: 0.9, attritionAllowance: 0.1 },
      requiredValidSessions: 140,
      requiredCompletedLifecycles: 45,
    },
    prerequisites: {
      pa4AuthoritativeChronology: { status: 'QUALIFIED', evidenceFingerprint: 'a'.repeat(64) },
      exchangeCalendar: { status: 'QUALIFIED', evidenceFingerprint: 'b'.repeat(64) },
      dedicatedPaperAccount: { status: 'BOUND', evidenceFingerprint: 'c'.repeat(64) },
      economicHurdle: { status: 'APPROVED', evidenceFingerprint: 'd'.repeat(64) },
      enrollmentWindow: { status: 'BOUND', evidenceFingerprint: 'e'.repeat(64) },
      prospectiveSamplingPower: { status: 'FINALIZED', evidenceFingerprint: 'f'.repeat(64) },
      frozenConfiguration: { status: 'MATCHED', evidenceFingerprint: '0'.repeat(64) },
    },
  }
  change?.(core)
  return { manifest: { ...core, activationFingerprint: fingerprintEdge2ActivationManifest(core) }, status: 'activated', serverOwned: true }
}

function edgeManifest(record = activationRecord()) {
  const activation = evaluateEdge2Activation(record, { accountId: scope.accountId })
  const definition = createForwardObservationExperimentDefinition({
    experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', strategyFingerprint: STRATEGY_FINGERPRINT,
    observationUniverse: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
    exitPolicy: { id: INDEX_PULLBACK_EXIT_POLICY_VERSION, version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true },
    createdAt: NOW,
  })
  return createForwardObservationManifest({
    observationId: 'edge2-test-only', startedAt: NOW, experimentDefinition: definition,
    regimeEngineVersion: 'market-regime-v1', tradeQualityVersion: 'trade-quality-v1', riskPolicyVersion: 'trade-guardrail-v1',
    startingPaperAccount: { accountId: scope.accountId, cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 },
    activationBinding: activation.binding,
    exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, maximumHoldingSessions: 20, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' },
  })
}

function edgeSnapshot(manifest = edgeManifest(), timestamp = NOW) {
  const exitPolicy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', strategyFingerprint: STRATEGY_FINGERPRINT, side: 'long', entryPrice: 100, stopPrice: 95, targetPrice: 110, enteredAt: timestamp })
  return createForwardEvidenceSnapshot({
    manifest,
    evidence: { forwardTestEligible: true, symbol: 'SPY', strategyId: 'index-pullback-v1', timestamp, providerProvenance: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false }, tradeQuality: { score: 85, band: 'STRONG', confidence: 80, status: 'COMPLETE' } },
    entryContext: { evaluationId: 'eval-edge2', evaluationEvidenceFingerprint: 'evaluation-evidence', referencePrice: 100, stopPrice: 95, targetPrice: 110, riskReward: 2, liquidityStatus: 'PASSED', exitPolicy },
  })
}

function qualifyingOutcome(manifest, enrolledAt = NOW, closedAt = '2026-10-20T14:00:00.000Z') {
  return {
    executionType: 'close', evidenceTimestamp: closedAt,
    forwardObservation: { experimentId: 'EDGE.2', observationId: manifest.observationId, manifestFingerprint: manifest.manifestFingerprint, activationBinding: manifest.activationBinding, enrolledAt },
    exitEvidenceManifest: { version: 'pa4-session-chronology-v1', evidenceClass: 'GENUINE', manifestHash: '9'.repeat(64) },
    exitAttribution: { policyCompliant: true, countsTowardObservationMinimum: true, evidenceManifestHash: '9'.repeat(64) },
  }
}

function testDatabase(record) {
  const state = { rows: [] }
  if (record) state.rows.push({ id: 'activation', category: 'activation', organization: 'org-a', team: 'team-a', account: 'edge2-paper', user: 'user-a', review_state: record.status, payload: { edge2ActivationManifest: record.manifest }, created_at: record.manifest.activatedAt })
  const queryRows = async (rows, sql, params = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: true }] }
    if (sql.startsWith('LOCK TABLE atlas_ai_opportunity_analysis_history')) return { rows: [] }
    if (sql.includes("analysis_category='edge2_activation_manifest'")) {
      const found = rows.filter((row) => row.category === 'activation' && row.organization === params[0] && row.team === params[1] && row.account === params[2] && row.user === params[3]).at(-1)
      return { rows: found ? [found] : [] }
    }
    if (sql.includes("'forward_observation_manifest'") && sql.includes('INSERT INTO')) {
      if (rows.some((row) => row.id === params[0])) return { rows: [] }
      rows.push({ id: params[0], category: 'manifest', organization: params[1], team: params[2], account: params[3], user: params[4], review_state: 'collecting', payload: params[8], created_at: params[6] })
      return { rows: [{ id: params[0] }] }
    }
    if (sql.includes("analysis_category='forward_observation_manifest'")) {
      const found = rows.filter((row) => row.category === 'manifest' && row.organization === params[0] && row.team === params[1] && row.account === params[2] && row.user === params[3]).at(-1)
      return { rows: found ? [found] : [] }
    }
    if (sql.includes("'forward_evidence_snapshot'") && sql.includes('INSERT INTO')) {
      if (rows.some((row) => row.id === params[0])) return { rows: [] }
      rows.push({ id: params[0], category: 'snapshot', organization: params[1], team: params[2], account: params[3], user: params[4], payload: params[11], created_at: params[7] })
      return { rows: [{ id: params[0] }] }
    }
    if (sql.includes("analysis_category='forward_evidence_snapshot'")) {
      const found = rows.filter((row) => row.category === 'snapshot' && row.organization === params[0] && row.team === params[1] && row.account === params[2] && row.user === params[3] && row.payload.forwardEvidenceSnapshot.observationId === params[4])
      if (params.length >= 7) return { rows: found.filter((row) => row.payload.forwardEvidenceSnapshot.evaluationId === params[5] && row.payload.forwardEvidenceSnapshot.evaluationEvidenceFingerprint === params[6]).slice(-1) }
      return { rows: found }
    }
    throw new Error(`unexpected query: ${sql.slice(0, 100)}`)
  }
  return {
    connected: true,
    get rows() { return state.rows },
    query(sql, params) { return queryRows(state.rows, sql, params) },
    async transaction(callback) {
      const draft = structuredClone(state.rows)
      const result = await callback({ query: (sql, params) => queryRows(draft, sql, params) })
      state.rows = draft
      return result
    },
  }
}

function breakoutEvaluation(overrides = {}) {
  return {
    evaluationId: 'eval-breakout', candidateId: 'candidate-breakout', evidenceFingerprint: 'breakout-evidence', symbol: 'SPY', strategyId: 'breakout-momentum-v1', strategyFingerprint: 'breakout-fingerprint', status: 'APPROVED_FOR_PAPER_REVIEW',
    tradeQuality: { score: 86, band: 'STRONG', confidence: 82, status: 'COMPLETE', engineVersion: 'trade-quality-v1', dimensions: { liquidity: 5, riskReward: 10 } },
    regime: { trendRegime: 'BULL', volatilityRegime: 'LOW_VOLATILITY', riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 73, engineVersion: 'market-regime-v1' },
    strategySuitability: { decision: 'ENABLED', confidence: 78, engineVersion: 'adaptive-strategy-v1' }, riskSafety: { status: 'WITHIN_REVIEW_LIMITS', drawdown: 0 }, reasons: [], blockers: [], missingEvidence: [], freshness: 'FRESH',
    marketData: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false, observedAt: NOW }, evaluatedAt: NOW,
    engineVersions: { tradeQuality: 'trade-quality-v1', regime: 'market-regime-v1', strategySuitability: 'adaptive-strategy-v1', riskPolicy: 'trade-guardrail-v1' },
    orderContext: { assetType: 'etf', side: 'buy', orderType: 'market', price: 120, stopPrice: 110, targetPrice: 140, quantity: 10 },
    breakoutSignal: { prior20High: 118, ATR14: 3, strategyFingerprint: 'breakout-fingerprint' },
    ...overrides,
  }
}

function orchestrationRepository(evaluations) {
  const manifests = new Map(); const snapshots = []
  return {
    manifests, snapshots, persistenceMode: 'postgresql',
    listPaperEvaluations: vi.fn(async () => evaluations),
    getEdge2ActivationManifest: vi.fn(async () => null),
    getForwardObservationManifest: vi.fn(async ({ experimentId }) => manifests.get(experimentId) ?? null),
    saveForwardObservationManifest: vi.fn(async ({ manifest }) => { manifests.set(manifest.experiment.experimentId, { manifest, status: 'collecting' }); return { ok: true, created: true } }),
    listForwardEvidenceSnapshots: vi.fn(async ({ observationId }) => snapshots.filter((item) => item.observationId === observationId)),
    saveForwardEvidenceSnapshot: vi.fn(async ({ snapshot }) => { snapshots.push(snapshot); return { ok: true, created: true } }),
  }
}

describe('EDGE.2 durable activation enforcement', () => {
  it('keeps the frozen production protocol NON_ACTIVE and fails closed when the durable activation manifest is missing', () => {
    expect(EDGE2_FORWARD_EVALUATION_PROTOCOL).toMatchObject({ protocolId: EDGE2_FROZEN_PROTOCOL_ID, fingerprint: EDGE2_FROZEN_PROTOCOL_FINGERPRINT, status: 'NON_ACTIVE', activation: { collectionAllowed: false } })
    const decision = evaluateEdge2Activation(null, { accountId: scope.accountId, at: NOW })
    expect(decision).toMatchObject({ valid: false, collectionAllowed: false, blockers: ['edge2_activation_manifest_missing'] })
    expect(buildForwardObservationStatus({ experimentId: 'EDGE.2', activationDecision: decision })).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0 })
  })

  it('blocks collectionAllowed=false and leaves unresolved PA.4/calendar prerequisites as blockers', () => {
    const record = activationRecord((core) => {
      core.collectionAllowed = false
      core.prerequisites.pa4AuthoritativeChronology.status = 'UNQUALIFIED'
      core.prerequisites.exchangeCalendar.status = 'UNQUALIFIED'
    })
    const decision = evaluateEdge2Activation(record, { accountId: scope.accountId, at: NOW })
    expect(decision.collectionAllowed).toBe(false)
    expect(decision.blockers).toEqual(expect.arrayContaining(['edge2_collection_not_allowed', 'activation_prerequisite_pa4_authoritative_chronology_unresolved', 'activation_prerequisite_exchange_calendar_unresolved']))
  })

  it('forces session, outcome, and policy-compliant counts to zero for old unactivated evidence', () => {
    const record = activationRecord(); const manifest = edgeManifest(record); const snapshot = edgeSnapshot(manifest); const outcome = qualifyingOutcome(manifest)
    const result = buildForwardObservationStatus({ manifest, snapshots: [snapshot], outcomes: [outcome], activationDecision: evaluateEdge2Activation(null, { accountId: scope.accountId }) })
    expect(result).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0, sessionProgressPct: 0, outcomeProgressPct: 0 })
  })

  it('continues ordinary governed PAPER analysis while refusing caller and AI assertions of EDGE.2 activation', async () => {
    const edgeAssertion = breakoutEvaluation({ evaluationId: 'eval-edge', strategyId: 'index-pullback-v1', strategyFingerprint: STRATEGY_FINGERPRINT, activation: { status: 'ACTIVATED', collectionAllowed: true }, copilot: { edge2Active: true } })
    const evidence = orchestrationRepository([edgeAssertion, breakoutEvaluation()])
    const ledger = { getOrCreateAccount: vi.fn(async () => ({ account: { accountId: scope.accountId, cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 } })), listExecutions: vi.fn(async () => []) }
    const result = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledger, now: NOW })
    expect(result.experiments.find((item) => item.experimentId === 'EDGE.2')).toMatchObject({ statusAfter: 'NON_ACTIVE', sessionRecorded: false, validSessions: 0, reason: 'edge2_activation_manifest_missing' })
    expect(result.experiments.find((item) => item.experimentId === 'BREAKOUT.1')).toMatchObject({ statusAfter: 'COLLECTING', sessionRecorded: true, validSessions: 1 })
    expect(evidence.manifests.has('EDGE.2')).toBe(false)
    expect(evidence.manifests.has('BREAKOUT.1')).toBe(true)
  })

  it('rejects caller-supplied active fields at the authenticated HTTP boundary', async () => {
    const evidenceRepository = orchestrationRepository([])
    const options = {
      evidenceRepository,
      ledgerRepository: { getOrCreateAccount: async () => ({ account: { accountId: scope.accountId, cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 } }), listExecutions: async () => [] },
      clock: () => NOW,
      authProvider: { authenticate: async () => ({ ok: true, user: { id: 'user-a', status: 'active' }, session: { id: 'session-a', userId: 'user-a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', metadata: { localDevelopmentOnly: true } } }) },
      authorizationService: { assert: () => ({ allowed: true }) },
      organizationMembershipRepository: { getMembership: async () => ({ organizationId: 'org-a', userId: 'user-a', role: 'owner', status: 'active' }) },
      repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {},
    }
    const event = { httpMethod: 'POST', headers: { authorization: 'Bearer token', 'x-csrf-token': 'test-token', 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: 'org-a', accountId: scope.accountId, status: 'ACTIVATED', collectionAllowed: true }) }
    const response = await createForwardObservationHandler(options)(event)
    expect(response.statusCode).toBe(400)
    expect(response.body).toContain('custom observation inputs are not supported')
    expect(evidenceRepository.saveForwardObservationManifest).not.toHaveBeenCalled()
  })

  it('rejects stale/wrong activation revisions and never backfills pre-activation observations', () => {
    const wrong = activationRecord((core) => { core.protocol.protocolFingerprint = '2'.repeat(64) })
    expect(evaluateEdge2Activation(wrong, { accountId: scope.accountId, at: NOW })).toMatchObject({ valid: false, collectionAllowed: false, blockers: expect.arrayContaining(['edge2_frozen_protocol_mismatch']) })

    const record = activationRecord(); const activation = evaluateEdge2Activation(record, { accountId: scope.accountId }); const manifest = edgeManifest(record)
    const result = buildForwardObservationStatus({ manifest, snapshots: [edgeSnapshot(manifest, BEFORE_ENROLLMENT)], outcomes: [qualifyingOutcome(manifest, BEFORE_ENROLLMENT)], activationDecision: activation })
    expect(result).toMatchObject({ status: 'COLLECTING', sessionsElapsed: 0, completedOutcomes: 0 })
  })

  it('does not silently attribute an ordinary paper entry and atomically rejects missing activation with zero cohort mutation', async () => {
    const manifest = edgeManifest(); const snapshot = edgeSnapshot(manifest)
    const repository = { getEdge2ActivationManifest: async () => null, getForwardObservationManifest: async () => ({ status: 'collecting', manifest }), listForwardEvidenceSnapshots: async () => [snapshot] }
    const evaluation = { evaluationId: 'eval-edge2', evidenceFingerprint: 'evaluation-evidence', evaluatedAt: NOW, symbol: 'SPY', strategyId: 'index-pullback-v1', strategyFingerprint: STRATEGY_FINGERPRINT }
    const simulation = { simulatedAt: NOW, strategyFingerprint: STRATEGY_FINGERPRINT, evaluationId: evaluation.evaluationId, evaluationEvidenceFingerprint: evaluation.evidenceFingerprint, exitPolicy: snapshot.exitPolicy }
    await expect(edge2CohortFor(repository, scope, evaluation, simulation)).resolves.toBeNull()

    const db = testDatabase(null); const durableRepository = createAtlasAiRepository({ database: db })
    await expect(durableRepository.saveForwardObservationManifest({ ...scope, manifest })).rejects.toThrow('EDGE.2 collection blocked')
    expect(db.rows.filter((row) => row.category === 'manifest' || row.category === 'snapshot')).toHaveLength(0)

    const admitted = await admitEdge2ForwardObservation({ query: (sql, params) => db.query(sql, params) }, { organizationId: 'org-a', teamWorkspaceId: 'team-a', accountId: scope.accountId, userId: 'user-a' }, { ...simulation, forwardObservation: { experimentId: 'EDGE.2', observationId: manifest.observationId, manifestFingerprint: manifest.manifestFingerprint, activationBinding: manifest.activationBinding, enrolledAt: NOW } })
    expect(admitted).toBeNull()
  })

  it('allows only a TEST-ONLY fully valid durable activation through manifest, snapshot, and cohort boundaries', async () => {
    const record = activationRecord(); const activation = evaluateEdge2Activation(record, { accountId: scope.accountId, at: NOW })
    expect(activation).toMatchObject({ valid: true, collectionAllowed: true })
    const manifest = edgeManifest(record); const snapshot = edgeSnapshot(manifest)
    const db = testDatabase(record); const repository = createAtlasAiRepository({ database: db })
    await expect(repository.saveForwardObservationManifest({ ...scope, manifest })).resolves.toMatchObject({ created: true })
    await expect(repository.saveForwardEvidenceSnapshot({ ...scope, snapshot })).resolves.toMatchObject({ created: true })
    expect(await repository.listForwardEvidenceSnapshots({ ...scope, observationId: manifest.observationId })).toHaveLength(1)

    const evaluation = { evaluationId: 'eval-edge2', evidenceFingerprint: 'evaluation-evidence', evaluatedAt: NOW, symbol: 'SPY', strategyId: 'index-pullback-v1', strategyFingerprint: STRATEGY_FINGERPRINT }
    const simulation = { simulatedAt: NOW, strategyFingerprint: STRATEGY_FINGERPRINT, evaluationId: evaluation.evaluationId, evaluationEvidenceFingerprint: evaluation.evidenceFingerprint, exitPolicy: snapshot.exitPolicy }
    const cohort = await edge2CohortFor(repository, scope, evaluation, simulation)
    expect(cohort).toMatchObject({ experimentId: 'EDGE.2', activationBinding: activation.binding, enrolledAt: NOW })
    await expect(admitEdge2ForwardObservation(db, { organizationId: 'org-a', teamWorkspaceId: 'team-a', accountId: scope.accountId, userId: 'user-a' }, { ...simulation, forwardObservation: cohort })).resolves.toEqual(cohort)
  })
})
