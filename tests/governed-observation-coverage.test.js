import { describe, expect, it, vi } from 'vitest'
import {
  createGovernedObservationCoverage,
  GOVERNED_OBSERVATION_CHECK_STATUSES,
  governedObservationAttention,
  recordGovernedObservationCheck,
} from '../lib/workspace/governedObservationCoverage.js'
import { createOrReusePreparation } from '../lib/workspace/governedReviewPreparation.js'
import { runGovernedPreparation } from '../netlify/functions/governed-review-prepare-background.js'

const CREATED_AT = '2026-09-24T14:30:00.000Z'

function memoryRepository() {
  const records = new Map()
  const store = {
    records,
    upsertScoped: vi.fn(async (id, payload, tenantContext) => {
      records.set(id, { id, payload: structuredClone(payload), tenantContext: structuredClone(tenantContext) })
      return { ok: true }
    }),
    getScoped: vi.fn(async (id, tenantContext) => {
      const record = records.get(id)
      if (!record) return null
      if (record.tenantContext.organizationId !== tenantContext.organizationId || record.tenantContext.userId !== tenantContext.userId) return null
      return structuredClone(record)
    }),
    listScoped: vi.fn(async ({ organizationId, userId }) => [...records.values()].filter((record) => record.payload.organizationId === organizationId && record.payload.userId === userId).map((record) => structuredClone(record))),
  }
  return { repository: { getStore: (name) => name === 'governedReviewPreparations' ? store : null }, store }
}

describe('Gap 5 governed observation coverage', () => {
  it('freezes every governed discovery opportunity as missed before dispatch and excludes EDGE.2', () => {
    const coverage = createGovernedObservationCoverage({ preparationId: 'prep-1', createdAt: CREATED_AT })

    expect(coverage.checks).toHaveLength(15)
    expect(new Set(coverage.checks.map((check) => check.checkId)).size).toBe(15)
    expect(coverage.checks.every((check) => check.status === 'MISSED_NOT_EVALUATED')).toBe(true)
    expect(coverage.checks.some((check) => check.experimentId === 'EDGE.2')).toBe(false)
    expect(coverage.summary).toMatchObject({ expected: 15, evaluated: 0, missedNotEvaluated: 15, status: 'INCOMPLETE' })
    expect(coverage.boundaries).toMatchObject({ edge2Included: false, edge2CountersIncremented: false })
  })

  it('preserves completed, no-candidate, degraded, and missed states across a serialized restart', () => {
    let coverage = createGovernedObservationCoverage({ preparationId: 'prep-1', createdAt: CREATED_AT })
    coverage = recordGovernedObservationCheck(coverage, { symbol: 'SPY', strategyId: 'breakout-momentum-v1', experimentId: 'BREAKOUT.1', status: GOVERNED_OBSERVATION_CHECK_STATUSES.candidate, reason: 'candidate_created', evaluatedAt: CREATED_AT, strategyFingerprint: 'strategy-a', evidenceFingerprint: 'evidence-a' })
    coverage = recordGovernedObservationCheck(coverage, { symbol: 'SPY', strategyId: 'range-mean-reversion-v1', experimentId: 'RANGE.1', status: GOVERNED_OBSERVATION_CHECK_STATUSES.noCandidate, reason: 'signal_rejected', evaluatedAt: CREATED_AT })
    coverage = recordGovernedObservationCheck(coverage, { symbol: 'SPY', strategyId: 'volatility-expansion-v1', experimentId: 'VOL.1', status: GOVERNED_OBSERVATION_CHECK_STATUSES.degraded, reason: 'quote_evidence_missing', evaluatedAt: CREATED_AT })

    const restarted = JSON.parse(JSON.stringify(coverage))
    expect(restarted.summary).toMatchObject({ completedCandidate: 1, completedNoCandidate: 1, blockedDegraded: 1, missedNotEvaluated: 12, status: 'INCOMPLETE' })
    expect(governedObservationAttention(restarted)).toMatchObject({ required: true, count: 13, status: 'INCOMPLETE' })
    expect(restarted.checks.find((check) => check.experimentId === 'BREAKOUT.1' && check.symbol === 'SPY')).toMatchObject({ strategyFingerprint: 'strategy-a', evidenceFingerprint: 'evidence-a' })
  })

  it('treats a fully evaluated no-candidate run as complete coverage without a qualifying session', () => {
    let coverage = createGovernedObservationCoverage({ preparationId: 'prep-no-candidate', createdAt: CREATED_AT })
    for (const check of coverage.checks) {
      coverage = recordGovernedObservationCheck(coverage, { ...check, status: GOVERNED_OBSERVATION_CHECK_STATUSES.noCandidate, reason: 'signal_rejected', evaluatedAt: CREATED_AT })
    }

    expect(coverage.summary).toMatchObject({ expected: 15, evaluated: 15, completedCandidate: 0, completedNoCandidate: 15, blockedDegraded: 0, missedNotEvaluated: 0, status: 'COMPLETE' })
    expect(governedObservationAttention(coverage)).toMatchObject({ required: false, count: 0 })
    expect(coverage.boundaries.edge2CountersIncremented).toBe(false)
  })

  it('durably creates the complete missed-check matrix before the worker is claimed', async () => {
    const { repository, store } = memoryRepository()
    const result = await createOrReusePreparation(repository, 'org-a', 'user-a', { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' }, () => new Date(CREATED_AT))
    const saved = store.records.get(result.preparation.id).payload

    expect(saved.status).toBe('pending')
    expect(saved.observationCoverage.summary).toMatchObject({ expected: 15, missedNotEvaluated: 15 })
    expect(saved.observationCoverage.preparationId).toBe(saved.id)
  })

  it('records missing provider evidence as degraded for all checks without creating candidates', async () => {
    const { repository, store } = memoryRepository()
    const preparation = {
      id: 'prep-provider-gap', organizationId: 'org-a', userId: 'user-a',
      tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
      status: 'running', createdAt: CREATED_AT, updatedAt: CREATED_AT, claimToken: 'not-exposed',
      observationCoverage: createGovernedObservationCoverage({ preparationId: 'prep-provider-gap', createdAt: CREATED_AT }),
    }
    await runGovernedPreparation({ ...preparation, repository }, {
      workspaceDataService: { buildMarketEvidencePacket: vi.fn(async () => ({ universe: [], symbols: {}, providerCalls: { credits: 0, http: 0 } })) },
      now: () => new Date(CREATED_AT),
    })
    const saved = store.records.get(preparation.id).payload

    expect(saved.status).toBe('completed')
    expect(saved.queueItems).toEqual([])
    expect(saved.observationCoverage.summary).toMatchObject({ expected: 15, evaluated: 15, blockedDegraded: 15, missedNotEvaluated: 0, status: 'DEGRADED', requiresOperatorAttention: true })
    expect(saved.observationCoverage.boundaries.edge2CountersIncremented).toBe(false)
  })

  it('keeps never-evaluated checks explicit when the provider packet fails before evaluation', async () => {
    const { repository, store } = memoryRepository()
    const preparation = {
      id: 'prep-provider-failure', organizationId: 'org-a', userId: 'user-a',
      tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
      status: 'running', createdAt: CREATED_AT, updatedAt: CREATED_AT,
      observationCoverage: createGovernedObservationCoverage({ preparationId: 'prep-provider-failure', createdAt: CREATED_AT }),
    }
    await runGovernedPreparation({ ...preparation, repository }, {
      workspaceDataService: { buildMarketEvidencePacket: vi.fn(async () => { throw new Error('provider unavailable') }) },
      now: () => new Date(CREATED_AT),
    })
    const saved = store.records.get(preparation.id).payload

    expect(saved.status).toBe('failed')
    expect(saved.observationCoverage.summary).toMatchObject({ evaluated: 0, missedNotEvaluated: 15, status: 'INCOMPLETE', requiresOperatorAttention: true })
    expect(governedObservationAttention(saved.observationCoverage).count).toBe(15)
  })
})
