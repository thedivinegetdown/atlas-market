import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'
import { evaluatePaperCandidates } from '../lib/opportunities/paperEvaluation/index.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/index.js'
import {
  assertExplicitNonProductionMemoryAdapter,
  DURABLE_PAPER_EVIDENCE_ERROR,
  resolveCanonicalPaperEvidenceRepository,
} from '../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'

const NOW = '2026-08-11T16:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
  accountId: 'account-a',
  userId: 'user-a',
  ...overrides,
})

function snapshot(overrides = {}) {
  return {
    opportunityId: 'opp-aapl-1', symbol: 'AAPL', strategyId: 'index-pullback-v1', score: 86,
    band: 'STRONG', confidence: 84, status: 'COMPLETE', reasons: ['Deterministic evidence aligned'],
    blockingReasons: [], missingInputs: [], freshness: 'FRESH', asOf: NOW, reviewState: 'reviewed',
    engineVersion: 'trade-quality-v1', orderContext: { assetType: 'equity', side: 'buy', orderType: 'market', price: 100, stopPrice: 98, targetPrice: 104 },
    ...overrides,
  }
}

function evaluation(overrides = {}) {
  return {
    evaluationId: 'paper-evaluation-evidence-a', candidateId: 'opp-aapl-1', symbol: 'AAPL',
    strategyId: 'index-pullback-v1', status: 'APPROVED_FOR_PAPER_REVIEW', freshness: 'FRESH',
    evaluatedAt: NOW, evidenceFingerprint: 'a'.repeat(64), engineVersions: { tradeQuality: 'trade-quality-v1' },
    orderContext: { assetType: 'equity', side: 'buy', orderType: 'market', price: 100, stopPrice: 98, targetPrice: 104 },
    paperTradingOnly: true, advisoryOnly: true, automaticExecution: false,
    ...overrides,
  }
}

function simulation(overrides = {}) {
  return {
    evaluationId: 'paper-evaluation-evidence-a', evaluationEvidenceFingerprint: 'a'.repeat(64),
    candidateId: 'opp-aapl-1', symbol: 'AAPL', strategyId: 'index-pullback-v1',
    status: 'SIMULATED_FILLED', fingerprint: 'b'.repeat(64), simulatedAt: NOW,
    orderPlan: { side: 'buy', quantity: 10, referencePrice: 100, guardrailResult: { approved: true } },
    paperTradingOnly: true, liveOrders: false, brokerExecution: false,
    ...overrides,
  }
}

function createHistoryDatabase() {
  const records = new Map()
  return {
    connected: true,
    records,
    async query(sql, params = []) {
      if (/INSERT INTO atlas_ai_opportunity_analysis_history/.test(sql)) {
        const category = sql.includes("'trade_quality_review'") ? 'trade_quality_review'
          : sql.includes("'paper_evaluation'") ? 'paper_evaluation' : 'paper_simulation'
        const id = params[0]
        const payloadIndex = category === 'trade_quality_review' ? 12 : 10
        if (category !== 'trade_quality_review' && records.has(id)) return { rows: [], rowCount: 0 }
        const record = {
          id, organizationId: params[1], teamWorkspaceId: params[2] ?? null, accountId: params[3], userId: params[4],
          category, reviewState: category === 'trade_quality_review' ? params[7] : 'reviewed',
          reviewedAt: category === 'trade_quality_review' ? params[8] : params[7],
          expiresAt: category === 'trade_quality_review' ? params[13] : null,
          payload: params[payloadIndex],
        }
        records.set(id, record)
        return { rows: [{ id }], rowCount: 1 }
      }
      const category = sql.includes("analysis_category = 'trade_quality_review'") ? 'trade_quality_review'
        : sql.includes("analysis_category='paper_evaluation'") ? 'paper_evaluation' : 'paper_simulation'
      const rows = [...records.values()].filter((record) => record.category === category
        && record.organizationId === params[0] && (record.teamWorkspaceId ?? null) === (params[1] ?? null)
        && record.accountId === params[2] && record.userId === params[3])
      if (category === 'trade_quality_review') {
        return { rows: rows.map(({ id, reviewState, reviewedAt, expiresAt, payload }) => ({ id, review_state: reviewState, reviewState, reviewed_at: reviewedAt, reviewedAt, expires_at: expiresAt, expiresAt, payload })) }
      }
      return { rows: rows.map(({ payload }) => ({ payload })) }
    },
  }
}

describe('PI.2 canonical durable paper evidence', () => {
  it('persists a compact reviewed TQ record across repository re-instantiation', async () => {
    const database = createHistoryDatabase()
    const first = createAtlasAiRepository({ database })
    const saved = await first.saveTradeQualityReview({ ...scope(), qualitySnapshot: { ...snapshot(), rawCandles: [{ close: 100 }], rawProviderPayload: { apiKey: 'secret' }, prompt: 'hidden' }, reviewedAt: NOW })
    const second = createAtlasAiRepository({ database })
    const reviews = await second.listTradeQualityReviews({ ...scope(), now: NOW })
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ opportunityId: 'opp-aapl-1', evidenceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), reviewState: 'reviewed' })
    expect(JSON.stringify(saved.history.payload)).not.toMatch(/"rawCandles":|"rawProviderPayload":|apiKey|secret|"prompt":/i)

    const repeated = await second.saveTradeQualityReview({ ...scope(), qualitySnapshot: saved.history.payload.tradeQualitySnapshot, reviewedAt: NOW })
    expect(repeated.history.payload.tradeQualitySnapshot.evidenceFingerprint).toBe(reviews[0].evidenceFingerprint)
  })

  it('serializes candidate fingerprints as JSON for the PostgreSQL JSONB contract', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'saved' }], rowCount: 1 })
    await createAtlasAiRepository({ database: { connected: true, query } }).saveTradeQualityReview({
      ...scope(), qualitySnapshot: snapshot(), reviewedAt: NOW,
    })

    const [, params] = query.mock.calls[0]
    expect(params[10]).toBe(JSON.stringify(['opp-aapl-1']))
    expect(JSON.parse(params[10])).toEqual(['opp-aapl-1'])
  })

  it('suppresses PA.1 duplicates after restart and accepts changed evidence', async () => {
    const database = createHistoryDatabase()
    const first = await createAtlasAiRepository({ database }).savePaperEvaluation({ ...scope(), evaluation: evaluation() })
    const duplicate = await createAtlasAiRepository({ database }).savePaperEvaluation({ ...scope(), evaluation: evaluation() })
    const changed = await createAtlasAiRepository({ database }).savePaperEvaluation({ ...scope(), evaluation: evaluation({ evaluationId: 'paper-evaluation-evidence-c', evidenceFingerprint: 'c'.repeat(64) }) })
    expect(first).toMatchObject({ created: true, duplicate: false })
    expect(duplicate).toMatchObject({ created: false, duplicate: true })
    expect(changed).toMatchObject({ created: true, duplicate: false })
    expect(await createAtlasAiRepository({ database }).listPaperEvaluations(scope())).toHaveLength(2)
  })

  it('suppresses PA.2 duplicates after restart and preserves PA.1 evidence linkage', async () => {
    const database = createHistoryDatabase()
    const first = await createAtlasAiRepository({ database }).savePaperSimulation({ ...scope(), simulation: simulation() })
    const duplicate = await createAtlasAiRepository({ database }).savePaperSimulation({ ...scope(), simulation: simulation() })
    const changed = await createAtlasAiRepository({ database }).savePaperSimulation({ ...scope(), simulation: simulation({ fingerprint: 'c'.repeat(64), evaluationEvidenceFingerprint: 'c'.repeat(64) }) })
    expect(first.created).toBe(true)
    expect(duplicate.duplicate).toBe(true)
    expect(changed.created).toBe(true)
    expect((await createAtlasAiRepository({ database }).listPaperSimulations(scope()))[0]).toHaveProperty('evaluationEvidenceFingerprint')
  })

  it.each([
    ['organization', { tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'team-a', userId: 'user-a' } }],
    ['account', { accountId: 'account-b' }],
    ['user', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-b' }, userId: 'user-b' }],
    ['team', { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-b', userId: 'user-a' } }],
  ])('denies cross-%s durable reads', async (_boundary, overrides) => {
    const database = createHistoryDatabase()
    await createAtlasAiRepository({ database }).savePaperEvaluation({ ...scope(), evaluation: evaluation() })
    expect(await createAtlasAiRepository({ database }).listPaperEvaluations(scope(overrides))).toEqual([])
  })

  it('fails closed without a connected durable repository and keeps memory adapters explicit', () => {
    expect(() => resolveCanonicalPaperEvidenceRepository({ persistenceRepository: { connected: false }, env: { NODE_ENV: 'production' } })).toThrow(expect.objectContaining({ code: DURABLE_PAPER_EVIDENCE_ERROR, statusCode: 503 }))
    const memory = { persistenceMode: 'memory', listTradeQualityReviews: vi.fn() }
    expect(assertExplicitNonProductionMemoryAdapter(memory, { NODE_ENV: 'test' })).toBe(memory)
    expect(() => resolveCanonicalPaperEvidenceRepository({ opportunityRepository: memory, env: { NODE_ENV: 'production' } })).toThrow(expect.objectContaining({ code: DURABLE_PAPER_EVIDENCE_ERROR, statusCode: 503 }))
  })

  it('reuses the existing PostgreSQL adapter query path', async () => {
    const database = { connected: true, query: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn(), healthCheck: vi.fn(), end: vi.fn() }
    const repository = createPostgresRepository({ database })
    await repository.query('SELECT $1', ['paper-evidence'])
    expect(database.query).toHaveBeenCalledWith('SELECT $1', ['paper-evidence'])
  })

  it('changes downstream fingerprints when reviewed evidence changes and links PA.2 to PA.1', () => {
    const regime = { engineVersion: 'market-regime-v1', asOf: NOW, freshness: 'FRESH', classification: { status: 'COMPLETE', trendRegime: 'BULL' } }
    const suitability = { engineVersion: 'adaptive-strategy-v1', strategies: [{ strategyId: 'index-pullback-v1', decision: 'ENABLED', confidence: 80, blockingReasons: [] }] }
    const base = snapshot({ evidenceFingerprint: 'a'.repeat(64) })
    const changed = snapshot({ evidenceFingerprint: 'c'.repeat(64) })
    const firstEvaluation = evaluatePaperCandidates({ candidates: [base], regime, strategySuitability: suitability, portfolioRisk: { maxDrawdown: 0 } }, { now: NOW })[0]
    const changedEvaluation = evaluatePaperCandidates({ candidates: [changed], regime, strategySuitability: suitability, portfolioRisk: { maxDrawdown: 0 } }, { now: NOW })[0]
    expect(changedEvaluation.evidenceFingerprint).not.toBe(firstEvaluation.evidenceFingerprint)
    const result = simulateApprovedPaperEvaluations({ evaluations: [firstEvaluation], portfolio: { cash: 100000, equity: 100000, buyingPower: 100000 }, portfolioRisk: { account: { accountValue: 100000, cash: 100000, buyingPower: 100000 }, summary: { openRisk: 0, openRiskPct: 0 } }, enabled: true }, { now: NOW }).results[0]
    expect(result.evaluationEvidenceFingerprint).toBe(firstEvaluation.evidenceFingerprint)
    expect(result).toMatchObject({ liveOrders: false, brokerExecution: false, paperTradingOnly: true })
  })

  it('wires eligible browser reviews to the canonical endpoint without the legacy order path', () => {
    const hook = readFileSync('src/hooks/useTradeQuality.js', 'utf8')
    const client = readFileSync('src/api/workspaceApiClient.js', 'utf8')
    const simulationFunction = readFileSync('netlify/functions/paper-order-simulation.js', 'utf8')
    expect(hook).toMatch(/saveReviewedOpportunity/)
    expect(client).toMatch(/request\('opportunity-intelligence'/)
    expect(simulationFunction).not.toMatch(/submit-paper-order|orderRepository|portfolioRepository|journalRepository/)
  })
})
