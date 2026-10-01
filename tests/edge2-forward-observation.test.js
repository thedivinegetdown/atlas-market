import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import {
  buildForwardObservationStatus,
  createForwardEvidenceSnapshot,
  createForwardObservationManifest,
  EDGE2_FORWARD_EVALUATION_PROTOCOL,
  evaluateForwardObservationConfiguration,
} from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { createIndexPullbackExitPolicy, INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'

const NOW = '2026-08-25T14:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
  accountId: 'paper-portfolio',
  userId: 'user-a',
  ...overrides,
})

function manifestInput(overrides = {}) {
  return {
    observationId: 'edge2-2026-08-25',
    startedAt: NOW,
    strategyVersions: { 'index-pullback-v1': '1.2.0' },
    regimeEngineVersion: 'market-regime-v1',
    tradeQualityVersion: 'trade-quality-v1',
    riskPolicyVersion: 'trade-guardrail-v1',
    startingPaperAccount: { accountId: 'paper-portfolio', cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 },
    exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, manualConfirmationRequired: true, maximumHoldingSessions: 20, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' },
    ...overrides,
  }
}

function manifest(overrides = {}) {
  return createForwardObservationManifest(manifestInput(overrides))
}

function completedOutcomes(observation, count) {
  return Array.from({ length: count }, (_, index) => ({
    executionId: `close-${index}`,
    executionType: 'close',
    forwardObservation: { experimentId: 'EDGE.2', observationId: observation.observationId, manifestFingerprint: observation.manifestFingerprint },
    exitEvidenceManifest: { version: 'pa4-session-chronology-v1', evidenceClass: 'GENUINE', manifestHash: 'a'.repeat(64) }, exitAttribution: { policyCompliant: true, countsTowardObservationMinimum: true, evidenceManifestHash: 'a'.repeat(64) },
  }))
}

function completedSnapshots(observation, count) {
  return Array.from({ length: count }, (_, index) => ({
    experimentId: 'EDGE.2',
    observationId: observation.observationId,
    manifestFingerprint: observation.manifestFingerprint,
    timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T14:00:00Z`,
    quoteFreshness: 'LIVE',
    provider: 'twelvedata',
  }))
}

function eligibleEvidence(overrides = {}) {
  return {
    forwardTestEligible: true,
    symbol: 'SPY',
    strategyId: 'index-pullback-v1',
    timestamp: NOW,
    marketRegime: { trend: 'BULL', volatility: 'NORMAL_VOLATILITY', risk: 'RISK_ON', status: 'COMPLETE', confidence: 82 },
    strategySuitability: { decision: 'ENABLED', confidence: 78 },
    tradeQuality: { score: 84, band: 'STRONG', confidence: 80, status: 'COMPLETE' },
    providerProvenance: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false },
    entryReferenceContext: { referencePrice: 650 },
    blockers: [],
    ...overrides,
  }
}

function snapshot(observation = manifest(), overrides = {}) {
  const exitPolicy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side: 'long', entryPrice: 650, stopPrice: 637, targetPrice: 676, enteredAt: NOW })
  return createForwardEvidenceSnapshot({
    manifest: observation,
    evidence: eligibleEvidence(overrides.evidence),
    tradeQuality: { dimensions: { regimeFit: 15, strategySuitability: 20, liquidity: 5, riskReward: 10 } },
    entryContext: { riskReward: 2, liquidityStatus: 'HEALTHY', referencePrice: 650, stopPrice: 637, targetPrice: 676, exitPolicy },
  })
}

function memoryDatabase() {
  const rows = []
  return {
    connected: true,
    rows,
    async query(sql, params = []) {
      if (sql.includes("'forward_observation_manifest'" ) && sql.startsWith('INSERT')) {
        if (rows.some((row) => row.id === params[0])) return { rows: [] }
        rows.push({ id: params[0], organization: params[1], team: params[2], account: params[3], user: params[4], category: 'manifest', review_state: 'collecting', payload: params[8], created_at: NOW })
        return { rows: [{ id: params[0] }] }
      }
      if (sql.includes("analysis_category='forward_observation_manifest'") && sql.startsWith('SELECT')) {
        const match = rows.filter((row) => row.category === 'manifest' && row.organization === params[0] && (row.team ?? null) === (params[1] ?? null) && row.account === params[2] && row.user === params[3]).at(-1)
        return { rows: match ? [match] : [] }
      }
      if (sql.includes("'forward_evidence_snapshot'") && sql.startsWith('INSERT')) {
        if (rows.some((row) => row.id === params[0])) return { rows: [] }
        rows.push({ id: params[0], organization: params[1], team: params[2], account: params[3], user: params[4], category: 'snapshot', payload: params[11], created_at: NOW })
        return { rows: [{ id: params[0] }] }
      }
      if (sql.includes("analysis_category='forward_evidence_snapshot'") && sql.startsWith('SELECT')) {
        return { rows: rows.filter((row) => row.category === 'snapshot' && row.organization === params[0] && (row.team ?? null) === (params[1] ?? null) && row.account === params[2] && row.user === params[3] && row.payload.forwardEvidenceSnapshot.observationId === params[4]) }
      }
      if (sql.startsWith('UPDATE atlas_ai_opportunity_analysis_history')) {
        const match = rows.find((row) => row.category === 'manifest' && row.organization === params[0] && row.account === params[2] && row.user === params[3] && row.payload.forwardObservationManifest.observationId === params[4] && row.review_state === 'collecting')
        if (match) match.review_state = 'invalidated'
        return { rows: match ? [{ id: match.id }] : [] }
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`)
    },
  }
}

describe('EDGE.2 fixed forward paper observation', () => {
  it('freezes the approved forward-evaluation preregistration without activating or changing counters', () => {
    const before = buildForwardObservationStatus({})
    const protocol = EDGE2_FORWARD_EVALUATION_PROTOCOL
    const after = buildForwardObservationStatus({})

    expect(protocol).toMatchObject({
      protocolId: 'EDGE.2-forward-evaluation-v1',
      status: 'NON_ACTIVE',
      strategy: { id: 'index-pullback-v1', version: '1.2.0' },
      exitPolicy: { version: 'index-pullback-exit-v1.0.0', maximumHoldingSessions: 20 },
      universe: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
      economics: {
        planningRiskDollarsPerLifecycle: 50,
        requiredSurplusDollarsPerLifecycle: 10,
        baseHurdleR: 0.2,
        operationsCostDollarsPerLifecycle: null,
        capitalCostDollarsPerLifecycle: null,
        finalHurdleR: null,
        minimumWorthwhileIncrement: { dollarsPerLifecycle: 10, rMultiple: 0.2 },
        adverseCostScenario: { additionalFrictionMultiplier: 1 },
      },
      statistics: {
        confidenceLevel: 0.95,
        primaryBlockExchangeSessions: 20,
        sensitivityBlockExchangeSessions: 40,
        planningPower: 0.8,
        minimumSensitivityBlockCoverage: 3,
        structuralValidSessionFloor: 120,
        readinessMinimum: { validSessions: 20, policyCompliantOutcomes: 30, provesEdge: false },
        optionalStoppingAllowed: false,
      },
      activation: {
        allowed: false,
        collectionAllowed: false,
        observationCreationAllowed: false,
        outcomeCreationAllowed: false,
        counterMutationAllowed: false,
        blockers: [
          'owner_operations_and_capital_cost_inputs_unbound_numeric_hurdle_unavailable',
          'dedicated_EDGE.2_paper_account_identity_unbound',
          'enrollment_dates_final_cutoff_and_reconciliation_period_unbound',
          'PA.4_authoritative_chronology_not_qualified',
          'prospective_power_inputs_and_required_sample_unfinalized',
        ],
      },
    })
    expect(protocol.fingerprint).toBe('053ead2b554b41cd1c9a57c3898383f98d6d95ebf93d1f2d81b7b6233de7b0b1')
    expect(Object.isFrozen(protocol)).toBe(true)
    expect(Object.isFrozen(protocol.statistics.prospectivePowerInputs)).toBe(true)
    expect(() => { protocol.activation.allowed = true }).toThrow(TypeError)
    expect(after).toEqual(before)
    expect(after).toMatchObject({ status: 'NOT_STARTED', sessionsElapsed: 0, completedOutcomes: 0 })
  })

  it('freezes the approved versions, universe, account state, and minimum sample', () => {
    const result = manifest()
    expect(result).toMatchObject({ minimumSessions: 20, minimumOutcomes: 30, symbolUniverse: ['AAPL', 'IWM', 'MSFT', 'QQQ', 'SPY'] })
    expect(result.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.boundaries).toMatchObject({ paperOnly: true, noOptimizationDuringObservation: true, automaticExecution: false, liveTrading: false })
  })

  it('refuses to start without a deterministic exit policy', () => {
    expect(() => manifest({ exitPolicy: { version: 'manual-only', deterministic: false } })).toThrow(/deterministic exit policy/)
  })

  it('invalidates rather than mixing a changed engine version', () => {
    expect(evaluateForwardObservationConfiguration(manifest(), { tradeQualityVersion: 'trade-quality-v2' })).toMatchObject({ compatible: false, status: 'INVALIDATED', blockers: ['frozen_configuration_changed'] })
  })

  it('creates immutable compact eligible evidence without raw market payloads', () => {
    const result = snapshot()
    expect(result).toMatchObject({ version: 'forward-evidence-snapshot-v1', symbol: 'SPY', liquidityStatus: 'HEALTHY', boundaries: { paperOnly: true, rawCandlesStored: false, providerPayloadStored: false } })
    expect(Object.isFrozen(result)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/"(?:rawCandles|providerPayload|apiKey|credential)"\s*:\s*(?:\[|\{|")/i)
  })

  it.each([
    ['STALE', false],
    ['MOCK', true],
  ])('rejects %s evidence', (dataStatus, mock) => {
    expect(() => snapshot(manifest(), { evidence: { providerProvenance: { provider: mock ? 'mock' : 'twelvedata', dataStatus, mock } } })).toThrow()
  })

  it('rejects insufficient Trade Quality eligibility', () => {
    expect(() => snapshot(manifest(), { evidence: { forwardTestEligible: false } })).toThrow(/only eligible/)
  })

  it('does not classify profitability before both minimums are satisfied', () => {
    const observation = manifest()
    const snapshots = completedSnapshots(observation, 19)
    const result = buildForwardObservationStatus({ manifest: observation, snapshots, outcomes: completedOutcomes(observation, 29), performanceReview: { sample: { completedTrades: 29 }, performance: { expectancyPerTrade: 10, profitFactor: 2 } } })
    expect(result).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0, reviewClassification: null })
  })

  it('cannot enter session or outcome pending states while non-active', () => {
    const observation = manifest()
    const nineteen = completedSnapshots(observation, 19)
    const twenty = completedSnapshots(observation, 20)
    expect(buildForwardObservationStatus({ manifest: observation, snapshots: nineteen, outcomes: completedOutcomes(observation, 30), performanceReview: { sample: { completedTrades: 30 } } })).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0 })
    expect(buildForwardObservationStatus({ manifest: observation, snapshots: twenty, outcomes: completedOutcomes(observation, 29), performanceReview: { sample: { completedTrades: 29 } } })).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0 })
  })

  it('cannot become review-ready while non-active', () => {
    const observation = manifest()
    const snapshots = completedSnapshots(observation, 20)
    const performanceReview = { sample: { completedTrades: 30 }, performance: { expectancyPerTrade: 12, profitFactor: 1.4, maximumDrawdownPct: 4 }, recentTrend: 'STABLE', strategies: [{ value: 'index-pullback-v1' }], trendRegimes: [{ value: 'BULL' }], symbols: [{ value: 'SPY' }] }
    const learningEvidence = { qualityCalibration: { status: 'CONSISTENT' } }
    const outcomes = completedOutcomes(observation, 30)
    const first = buildForwardObservationStatus({ manifest: observation, snapshots, outcomes, performanceReview, learningEvidence })
    const second = buildForwardObservationStatus({ manifest: observation, snapshots, outcomes, performanceReview, learningEvidence })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ status: 'NON_ACTIVE', sessionsElapsed: 0, completedOutcomes: 0, reviewClassification: null })
  })

  it('counts only full policy-compliant closes linked to the exact cohort', () => {
    const observation = manifest()
    const valid = completedOutcomes(observation, 1)[0]
    const records = [valid,
      { ...valid, exitEvidenceManifest: null },
      { ...valid, exitEvidenceManifest: { ...valid.exitEvidenceManifest, evidenceClass: 'SYNTHETIC' } },
      { ...valid, exitEvidenceManifest: { ...valid.exitEvidenceManifest, manifestHash: 'b'.repeat(64) } },
      { ...valid, executionType: 'entry' },
      { ...valid, executionType: 'reduction' },
      { ...valid, exitAttribution: { policyCompliant: false, countsTowardObservationMinimum: false } },
      { ...valid, forwardObservation: { ...valid.forwardObservation, manifestFingerprint: 'other' } },
      { ...valid, forwardObservation: null },
    ]
    expect(buildForwardObservationStatus({ manifest: observation, outcomes: records, performanceReview: { sample: { completedTrades: 30 } } })).toMatchObject({ status: 'NON_ACTIVE', completedOutcomes: 0 })
  })

  it('keeps the production cohort not started until an approved manifest is persisted', () => {
    expect(buildForwardObservationStatus({})).toMatchObject({ status: 'NOT_STARTED', reviewClassification: null, blockers: ['observation_manifest_not_started'] })
  })

  it('excludes synthetic exit manifests from both outcome and session minimums', () => {
    const observation = manifest()
    const outcome = completedOutcomes(observation, 1)[0]
    const synthetic = { ...outcome, evidenceTimestamp: NOW, exitEvidenceManifest: { ...outcome.exitEvidenceManifest, evidenceClass: 'SYNTHETIC' } }
    expect(buildForwardObservationStatus({ manifest: observation, outcomes: [synthetic] })).toMatchObject({ completedOutcomes: 0, sessionsElapsed: 0 })
  })

  it('rejects durable cohort persistence without an activation transaction', async () => {
    const database = memoryDatabase(); const observation = manifest(); const evidenceSnapshot = snapshot(observation)
    const repository = createAtlasAiRepository({ database })
    await expect(repository.saveForwardObservationManifest({ ...scope(), manifest: observation })).rejects.toThrow('durable activation transaction is unavailable')
    await expect(repository.saveForwardEvidenceSnapshot({ ...scope(), snapshot: evidenceSnapshot })).rejects.toThrow('durable activation transaction is unavailable')
    expect(database.rows).toHaveLength(0)
  })

  it.each([
    ['organization', { tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'team-a', userId: 'user-a' } }],
    ['account', { accountId: 'other-account' }],
    ['user', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-b' }, userId: 'user-b' }],
    ['team', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-b', userId: 'user-a' } }],
  ])('isolates forward evidence across %s boundaries', async (_boundary, override) => {
    const database = memoryDatabase(); const observation = manifest()
    database.rows.push({ id: 'manifest', organization: 'org-a', team: 'team-a', account: 'paper-portfolio', user: 'user-a', category: 'manifest', review_state: 'collecting', payload: { forwardObservationManifest: observation }, created_at: NOW })
    expect(await createAtlasAiRepository({ database }).getForwardObservationManifest(scope(override))).toBeNull()
  })

  it('does not call providers, brokers, executions, or configuration mutation callbacks', () => {
    const sideEffect = vi.fn()
    buildForwardObservationStatus({ provider: sideEffect, broker: sideEffect, execution: sideEffect, optimize: sideEffect, strategyMutation: sideEffect })
    expect(sideEffect).not.toHaveBeenCalled()
  })
})
