import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import {
  buildForwardObservationStatus,
  createForwardEvidenceSnapshot,
  createForwardObservationManifest,
  evaluateForwardObservationConfiguration,
} from '../lib/opportunities/forwardTest/forwardObservationEngine.js'

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
    exitPolicy: { version: 'fixed-exit-v1', deterministic: true, manualConfirmationRequired: true },
    ...overrides,
  }
}

function manifest(overrides = {}) {
  return createForwardObservationManifest(manifestInput(overrides))
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
  return createForwardEvidenceSnapshot({
    manifest: observation,
    evidence: eligibleEvidence(overrides.evidence),
    tradeQuality: { dimensions: { regimeFit: 15, strategySuitability: 20, liquidity: 5, riskReward: 10 } },
    entryContext: { riskReward: 2, liquidityStatus: 'HEALTHY', referencePrice: 650, stopPrice: 637, targetPrice: 676 },
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
    const snapshots = Array.from({ length: 19 }, (_, index) => ({ timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T14:00:00Z`, quoteFreshness: 'LIVE', provider: 'twelvedata' }))
    const result = buildForwardObservationStatus({ manifest: observation, snapshots, performanceReview: { sample: { completedTrades: 29 }, performance: { expectancyPerTrade: 10, profitFactor: 2 } } })
    expect(result).toMatchObject({ status: 'COLLECTING', sessionsElapsed: 19, completedOutcomes: 29, reviewClassification: null })
  })

  it('uses the separate session and outcome pending states', () => {
    const observation = manifest()
    const nineteen = Array.from({ length: 19 }, (_, index) => ({ timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T14:00:00Z`, quoteFreshness: 'LIVE', provider: 'twelvedata' }))
    const twenty = [...nineteen, { timestamp: '2026-09-20T14:00:00Z', quoteFreshness: 'LIVE', provider: 'twelvedata' }]
    expect(buildForwardObservationStatus({ manifest: observation, snapshots: nineteen, performanceReview: { sample: { completedTrades: 30 } } }).status).toBe('MINIMUM_SESSIONS_PENDING')
    expect(buildForwardObservationStatus({ manifest: observation, snapshots: twenty, performanceReview: { sample: { completedTrades: 29 } } }).status).toBe('MINIMUM_OUTCOMES_PENDING')
  })

  it('becomes review-ready deterministically and reuses PA.3/PA.5 analytics', () => {
    const observation = manifest()
    const snapshots = Array.from({ length: 20 }, (_, index) => ({ timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T14:00:00Z`, quoteFreshness: 'LIVE', provider: 'twelvedata' }))
    const performanceReview = { sample: { completedTrades: 30 }, performance: { expectancyPerTrade: 12, profitFactor: 1.4, maximumDrawdownPct: 4 }, recentTrend: 'STABLE', strategies: [{ value: 'index-pullback-v1' }], trendRegimes: [{ value: 'BULL' }], symbols: [{ value: 'SPY' }] }
    const learningEvidence = { qualityCalibration: { status: 'CONSISTENT' } }
    const first = buildForwardObservationStatus({ manifest: observation, snapshots, performanceReview, learningEvidence })
    const second = buildForwardObservationStatus({ manifest: observation, snapshots, performanceReview, learningEvidence })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ status: 'READY_FOR_REVIEW', reviewClassification: 'PROMISING', metrics: performanceReview.performance, tradeQualityCalibration: { status: 'CONSISTENT' } })
  })

  it('keeps the production cohort not started while current exit and strategy blockers remain', () => {
    expect(buildForwardObservationStatus({})).toMatchObject({ status: 'NOT_STARTED', reviewClassification: null, blockers: ['deterministic_exit_policy_required', 'strategy_lifecycle_not_active'] })
  })

  it('persists manifests and snapshots across repository re-instantiation and suppresses duplicates', async () => {
    const database = memoryDatabase(); const observation = manifest(); const evidenceSnapshot = snapshot(observation)
    const first = createAtlasAiRepository({ database })
    expect((await first.saveForwardObservationManifest({ ...scope(), manifest: observation })).created).toBe(true)
    const second = createAtlasAiRepository({ database })
    expect((await second.saveForwardObservationManifest({ ...scope(), manifest: observation })).duplicate).toBe(true)
    expect((await second.saveForwardEvidenceSnapshot({ ...scope(), snapshot: evidenceSnapshot })).created).toBe(true)
    const third = createAtlasAiRepository({ database })
    expect((await third.saveForwardEvidenceSnapshot({ ...scope(), snapshot: evidenceSnapshot })).duplicate).toBe(true)
    expect(await third.listForwardEvidenceSnapshots({ ...scope(), observationId: observation.observationId })).toHaveLength(1)
  })

  it.each([
    ['organization', { tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'team-a', userId: 'user-a' } }],
    ['account', { accountId: 'other-account' }],
    ['user', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-b' }, userId: 'user-b' }],
    ['team', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-b', userId: 'user-a' } }],
  ])('isolates forward evidence across %s boundaries', async (_boundary, override) => {
    const database = memoryDatabase(); const observation = manifest()
    await createAtlasAiRepository({ database }).saveForwardObservationManifest({ ...scope(), manifest: observation })
    expect(await createAtlasAiRepository({ database }).getForwardObservationManifest(scope(override))).toBeNull()
  })

  it('does not call providers, brokers, executions, or configuration mutation callbacks', () => {
    const sideEffect = vi.fn()
    buildForwardObservationStatus({ provider: sideEffect, broker: sideEffect, execution: sideEffect, optimize: sideEffect, strategyMutation: sideEffect })
    expect(sideEffect).not.toHaveBeenCalled()
  })
})
