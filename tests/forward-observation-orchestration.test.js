import { describe, expect, it, vi } from 'vitest'
import { runForwardObservation } from '../lib/opportunities/forwardTest/forwardObservationOrchestrator.js'
import { createForwardObservationHandler } from '../netlify/functions/forward-observation.js'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'

const NOW = '2026-09-03T19:45:00.000Z'
const scope = { tenantContext: { organizationId: 'org-a', teamWorkspaceId: '', userId: 'user-a' }, accountId: 'paper-portfolio', userId: 'user-a' }

function evaluation(strategyId, overrides = {}) {
  const details = {
    'index-pullback-v1': {},
    'breakout-momentum-v1': { breakoutSignal: { prior20High: 118, ATR14: 3, strategyFingerprint: 'breakout-fingerprint' } },
    'range-mean-reversion-v1': { rangeMeanReversionSignal: { prior20Low: 94, SMA20: 110, ATR14: 4, strategyFingerprint: 'range-fingerprint' }, orderContext: { assetType: 'etf', side: 'buy', orderType: 'market', price: 100, stopPrice: 94, targetPrice: 110, quantity: 10 } },
    'volatility-expansion-v1': { volatilityExpansionSignal: { prior20High: 118, ATR14: 3, strategyFingerprint: 'volatility-fingerprint' } },
  }[strategyId]
  return {
    evaluationId: `evaluation-${strategyId}`,
    candidateId: `candidate-${strategyId}`,
    evidenceFingerprint: `${strategyId}-evidence`,
    symbol: 'SPY',
    strategyId,
    status: 'APPROVED_FOR_PAPER_REVIEW',
    tradeQuality: { score: 86, band: 'STRONG', confidence: 82, status: 'COMPLETE', engineVersion: 'trade-quality-v1', dimensions: { liquidity: 5, riskReward: 10 } },
    regime: { trendRegime: 'BULL', volatilityRegime: 'LOW_VOLATILITY', riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 73, engineVersion: 'market-regime-v1' },
    strategySuitability: { decision: 'ENABLED', confidence: 78, engineVersion: 'adaptive-strategy-v1' },
    riskSafety: { status: 'WITHIN_REVIEW_LIMITS', drawdown: 0 },
    reasons: [], blockers: [], missingEvidence: [], freshness: 'FRESH',
    marketData: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false, observedAt: NOW },
    evaluatedAt: NOW,
    engineVersions: { tradeQuality: 'trade-quality-v1', regime: 'market-regime-v1', strategySuitability: 'adaptive-strategy-v1', riskPolicy: 'trade-guardrail-v1' },
    orderContext: { assetType: 'etf', side: 'buy', orderType: 'market', price: 120, stopPrice: 110, targetPrice: 140, quantity: 10 },
    ...details,
    ...overrides,
  }
}

function evidenceRepository(evaluations = []) {
  const manifests = new Map()
  const snapshots = new Map()
  return {
    persistenceMode: 'postgresql', manifests, snapshots,
    listPaperEvaluations: vi.fn(async () => evaluations),
    getForwardObservationManifest: vi.fn(async ({ experimentId }) => manifests.get(experimentId) ?? null),
    saveForwardObservationManifest: vi.fn(async ({ manifest }) => {
      const experimentId = manifest.experiment.experimentId
      if (manifests.has(experimentId)) return { ok: true, duplicate: true, manifest }
      manifests.set(experimentId, { manifest, status: 'collecting' })
      return { ok: true, created: true, manifest }
    }),
    listForwardEvidenceSnapshots: vi.fn(async ({ observationId }) => [...snapshots.values()].filter((snapshot) => snapshot.observationId === observationId)),
    saveForwardEvidenceSnapshot: vi.fn(async ({ snapshot }) => {
      if (snapshots.has(snapshot.evidenceFingerprint)) return { ok: true, duplicate: true, snapshot }
      snapshots.set(snapshot.evidenceFingerprint, snapshot)
      return { ok: true, created: true, snapshot }
    }),
  }
}

function ledgerRepository(executions = []) {
  return {
    persistenceMode: 'postgresql',
    getOrCreateAccount: vi.fn(async () => ({ account: { accountId: 'paper-portfolio', cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 }, positions: [] })),
    listExecutions: vi.fn(async () => executions),
  }
}

describe('governed forward observation orchestration', () => {
  it('remains passive and creates no cohort without a current qualified evaluation', async () => {
    const evidence = evidenceRepository()
    const result = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledgerRepository(), now: NOW })
    expect(result).toMatchObject({ result: 'PASSIVE_WAIT', boundaries: { paperOnly: true, liveExecutionDisabled: true, callerScientificInputsAccepted: false } })
    expect(result.experiments).toHaveLength(4)
    expect(result.experiments.every((item) => item.statusAfter === 'NOT_STARTED' && item.validSessions === 0 && item.completedOutcomes === 0)).toBe(true)
    expect(result.experiments.every((item) => item.reason === 'no_current_governed_evaluation')).toBe(true)
    expect(evidence.saveForwardObservationManifest).not.toHaveBeenCalled()
    expect(evidence.saveForwardEvidenceSnapshot).not.toHaveBeenCalled()
  })

  it('reuses all four frozen experiment and exit-policy factories for qualified LIVE evidence', async () => {
    const evidence = evidenceRepository(['index-pullback-v1', 'breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1'].map((strategyId) => evaluation(strategyId)))
    const result = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledgerRepository(), now: NOW })
    expect(result.result).toBe('COLLECTING')
    expect(result.experiments.map((item) => item.experimentId)).toEqual(['EDGE.2', 'BREAKOUT.1', 'RANGE.1', 'VOL.1'])
    expect(result.experiments.every((item) => item.statusBefore === 'NOT_STARTED' && item.statusAfter === 'COLLECTING')).toBe(true)
    expect(result.experiments.every((item) => item.sessionRecorded && item.validSessions === 1 && item.requiredSessions === 20)).toBe(true)
    expect(result.experiments.every((item) => item.completedOutcomes === 0 && item.requiredOutcomes === 30 && item.empiricalConfidenceState === 'UNAVAILABLE')).toBe(true)
    expect([...evidence.snapshots.values()].every((item) => item.provider === 'twelvedata' && item.quoteFreshness === 'LIVE' && item.boundaries.liveTrading === false)).toBe(true)
  })

  it('suppresses same-session duplicates without incrementing sessions or outcomes', async () => {
    const evidence = evidenceRepository([evaluation('index-pullback-v1')])
    const ledger = ledgerRepository()
    const first = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledger, now: NOW })
    const second = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledger, now: NOW })
    expect(first.experiments[0]).toMatchObject({ sessionRecorded: true, validSessions: 1, completedOutcomes: 0 })
    expect(second.experiments[0]).toMatchObject({ statusBefore: 'COLLECTING', statusAfter: 'COLLECTING', sessionRecorded: false, validSessions: 1, completedOutcomes: 0, reason: 'duplicate_observation_suppressed' })
    expect(evidence.manifests).toHaveProperty('size', 1)
    expect(evidence.snapshots).toHaveProperty('size', 1)
  })

  it.each([
    ['MOCK', { marketData: { provider: 'mock', dataStatus: 'MOCK', mock: true }, freshness: 'FRESH' }, 'mock_market_evidence'],
    ['STALE', { freshness: 'STALE' }, 'qualified_plan_stale'],
    ['WATCH', { status: 'WATCH' }, 'qualified_plan_watch'],
    ['NO_TRADE', { orderContext: { assetType: 'etf', side: 'buy', price: 120, stopPrice: 110, targetPrice: 140, quantity: 0 } }, 'qualified_plan_no_trade'],
  ])('rejects %s evidence without starting a cohort', async (_label, overrides, reason) => {
    const evidence = evidenceRepository([evaluation('index-pullback-v1', overrides)])
    const result = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledgerRepository(), now: NOW })
    expect(result.experiments[0]).toMatchObject({ statusAfter: 'NOT_STARTED', sessionRecorded: false, validSessions: 0, reason })
    expect(evidence.saveForwardObservationManifest).not.toHaveBeenCalled()
  })

  it('ignores otherwise qualified evidence from a different market session', async () => {
    const evidence = evidenceRepository([evaluation('index-pullback-v1', { evaluatedAt: '2026-09-02T19:45:00.000Z' })])
    const result = await runForwardObservation({ ...scope, evidenceRepository: evidence, ledgerRepository: ledgerRepository(), now: NOW })
    expect(result.experiments[0]).toMatchObject({ statusAfter: 'NOT_STARTED', reason: 'no_current_governed_evaluation' })
  })

  it('does not call market providers, watchlists, brokers, execution, or confidence mutation hooks', async () => {
    const prohibited = { quote: vi.fn(), history: vi.fn(), watchlist: vi.fn(), broker: vi.fn(), execute: vi.fn(), confidence: vi.fn() }
    await runForwardObservation({ ...scope, evidenceRepository: evidenceRepository(), ledgerRepository: ledgerRepository(), now: NOW, ...prohibited })
    Object.values(prohibited).forEach((callback) => expect(callback).not.toHaveBeenCalled())
  })
})

const authentication = { authenticate: async () => ({ ok: true, user: { id: 'user-a', status: 'active' }, session: { id: 'session-a', userId: 'user-a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', metadata: { localDevelopmentOnly: true } } }) }
const authorizationService = { assert: () => ({ allowed: true }) }
const ownerMembership = { getMembership: async (organizationId, userId) => organizationId === 'org-a' && userId === 'user-a' ? { organizationId, userId, role: 'owner', status: 'active' } : null }
const event = (body, token = true) => ({ httpMethod: 'POST', headers: { ...(token ? { authorization: 'Bearer token' } : {}), 'x-csrf-token': 'test-token', 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('forward observation endpoint', () => {
  const options = (overrides = {}) => ({
    evidenceRepository: evidenceRepository(), ledgerRepository: ledgerRepository(), clock: () => NOW,
    authProvider: authentication, authorizationService, organizationMembershipRepository: ownerMembership,
    repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {}, ...overrides,
  })

  it('rejects unauthenticated requests', async () => {
    const response = await createForwardObservationHandler(options())(event({ organizationId: 'org-a', accountId: 'paper-portfolio' }, false))
    expect(response.statusCode).toBe(401)
  })

  it('derives the authorized tenant scope and returns only bounded experiment state', async () => {
    const configured = options()
    const response = await createForwardObservationHandler(configured)(event({ organizationId: 'org-a', accountId: 'paper-portfolio' }))
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.data).toMatchObject({ result: 'PASSIVE_WAIT', boundaries: { callerScientificInputsAccepted: false, liveExecutionDisabled: true } })
    expect(body.data.experiments).toHaveLength(4)
    expect(configured.evidenceRepository.listPaperEvaluations).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-portfolio', tenantContext: expect.objectContaining({ organizationId: 'org-a', userId: 'user-a' }) }))
  })

  it('rejects caller-controlled scientific state', async () => {
    const response = await createForwardObservationHandler(options())(event({ organizationId: 'org-a', accountId: 'paper-portfolio', tradeQuality: { score: 100 }, status: 'READY_FOR_REVIEW' }))
    expect(response.statusCode).toBe(400)
    expect(response.body).toContain('custom observation inputs are not supported')
  })

  it('denies a different organization and exposes no scoped state', async () => {
    const configured = options()
    const response = await createForwardObservationHandler(configured)(event({ organizationId: 'org-b', accountId: 'paper-portfolio' }))
    expect(response.statusCode).toBe(403)
    expect(configured.evidenceRepository.listPaperEvaluations).not.toHaveBeenCalled()
  })
})

describe('forward observation production client', () => {
  it('establishes CSRF and sends only the canonical scope', async () => {
    const fetchImpl = vi.fn(async (url) => url.includes('/csrf-token')
      ? { ok: true, status: 200, json: async () => ({ ok: true, data: { token: 'signed-csrf', expiresAt: '2099-01-01T00:00:00.000Z' } }) }
      : { ok: true, status: 200, json: async () => ({ ok: true, data: { result: 'PASSIVE_WAIT', experiments: [] } }) })
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'identity-token' })

    await client.runForwardObservation()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, options] = fetchImpl.mock.calls[1]
    expect(url).toContain('/forward-observation')
    expect(options).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer identity-token', 'x-csrf-token': 'signed-csrf' } })
    expect(JSON.parse(options.body)).toEqual({ organizationId: 'org-atlas-local', accountId: 'paper-portfolio' })
  })
})
