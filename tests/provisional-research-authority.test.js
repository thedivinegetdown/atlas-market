import { describe, expect, it, vi } from 'vitest'
import { createResearchHistoryHandler } from '../netlify/functions/research-history.js'
import { createOpportunityIntelligenceHandler } from '../netlify/functions/opportunity-intelligence.js'
import { normalizeTradeQualitySnapshot } from '../lib/opportunities/feed/opportunityIntelligenceFeed.js'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'
import { researchOverview } from './helpers/provisionalResearchFixtures.js'

const options = () => ({ organizationMembershipRepository: { getMembership: vi.fn(async (_org, userId) => ({ organizationId: 'org-atlas-local', userId, role: 'owner', status: 'active' })) }, repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
const event = (query = {}, body) => ({ httpMethod: body ? 'POST' : 'GET', headers: { authorization: 'Bearer private-session', 'x-csrf-token': 'fixture', 'content-type': 'application/json' }, queryStringParameters: { organizationId: 'org-atlas-local', ...query }, ...(body ? { body: JSON.stringify(body) } : {}) })
const reference = { symbol: 'AAPL', opportunityId: 'opp-aapl', strategyId: 'breakout-momentum-v1' }
const quality = { ...reference, score: 80, confidence: 80, engineVersion: 'trade-quality-v1', status: 'COMPLETE', asOf: '2026-10-20T17:14:00Z', freshness: 'FRESH' }

describe('provisional Research authority boundaries', () => {
  it('requires authenticated organization membership and validates all query inputs', async () => {
    const read = vi.fn(async () => researchOverview())
    const handler = createResearchHistoryHandler({ ...options(), serviceFactory: () => ({ read }) })
    expect((await handler({ ...event({ symbol: 'AAPL' }), headers: {} })).statusCode).toBe(401)
    expect((await handler(event({ symbol: 'AAPL', organizationId: 'org-other' }))).statusCode).toBe(403)
    expect((await handler(event({ symbol: '../bad' }))).statusCode).toBe(400)
    expect((await handler(event({ symbol: 'AAPL', completion: 'CONFIRMED_COMPLETED' }))).statusCode).toBe(400)
    expect((await handler(event({}, { symbol: 'AAPL', organizationId: 'org-atlas-local' }))).statusCode).toBe(405)
    expect(read).not.toHaveBeenCalled()
    expect((await handler(event({ symbol: 'AAPL', skipQuote: 'true' }))).statusCode).toBe(200)
    expect(read).toHaveBeenCalledExactlyOnceWith('AAPL', { skipQuote: true })
  })
  it.each([
    { qualitySnapshot: { evidenceClass: 'PROVISIONAL_RESEARCH_ESTIMATE', completion: { status: 'UNKNOWN' } } },
    { qualitySnapshot: quality }, // Markings stripped and fields rewrapped: still not authority.
    { reviewReference: { ...reference, score: 100 } },
    { reviewReference: { ...reference, orderContext: { price: 123 } } },
    { reviewReference: { ...reference, extra: { evidenceClass: 'PROVISIONAL_RESEARCH_ESTIMATE' } } },
  ])('rejects client evidence before scoring, normalization or writes: %j', async (payload) => {
    const getTradeQuality = vi.fn(); const saveTradeQualityReview = vi.fn()
    const handler = createOpportunityIntelligenceHandler({ ...options(), opportunityRepository: { saveTradeQualityReview }, serviceFactory: () => ({ getTradeQuality }) })
    const response = await handler(event({}, { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', ...payload }))
    expect(response.statusCode).toBe(400)
    expect(getTradeQuality).not.toHaveBeenCalled(); expect(saveTradeQualityReview).not.toHaveBeenCalled()
  })
  it('accepts only server recomputed matching evidence, never client-derived metrics', async () => {
    const getTradeQuality = vi.fn(async () => ({ quality }))
    const saveTradeQualityReview = vi.fn(async input => ({ ok: true, history: { reviewState: 'saved', payload: { tradeQualitySnapshot: input.qualitySnapshot } } }))
    const handler = createOpportunityIntelligenceHandler({ ...options(), opportunityRepository: { saveTradeQualityReview }, serviceFactory: () => ({ getTradeQuality }) })
    expect((await handler(event({}, { organizationId: 'org-atlas-local', reviewReference: reference }))).statusCode).toBe(200)
    expect(getTradeQuality).toHaveBeenCalledExactlyOnceWith({ ...reference, scannerSource: 'deterministic-scanner', asOf: expect.any(String) }, { timeframe: '1D', now: expect.any(String) })
    expect(saveTradeQualityReview).toHaveBeenCalledWith(expect.objectContaining({ tenantContext: expect.objectContaining({ organizationId: 'org-atlas-local' }), qualitySnapshot: { ...quality, reviewState: 'saved' } }))
  })
  it.each([{ status: 'INSUFFICIENT_DATA' }, { symbol: 'MSFT' }, { strategyId: 'strategy-unknown' }, { opportunityId: 'other' }, { provenance: { evidenceClass: 'PROVISIONAL_RESEARCH_ESTIMATE' } }])('refuses mismatched or unqualified server result %j', async (change) => {
    const saveTradeQualityReview = vi.fn()
    const handler = createOpportunityIntelligenceHandler({ ...options(), opportunityRepository: { saveTradeQualityReview }, serviceFactory: () => ({ getTradeQuality: async () => ({ quality: { ...quality, ...change } }) }) })
    expect((await handler(event({}, { organizationId: 'org-atlas-local', reviewReference: reference }))).statusCode).toBe(400)
    expect(saveTradeQualityReview).not.toHaveBeenCalled()
  })
  it('rejects nested provisional markings before lossy snapshot normalization', () => {
    expect(() => normalizeTradeQualitySnapshot({ ...quality, evidence: { history: researchOverview().provisionalResearch } })).toThrow(/Provisional Research/)
  })
  it('browser save transmits a reference, not estimates, prices, provenance or scores', async () => {
    const transport = vi.fn(async url => ({ ok: true, status: 200, json: async () => ({ ok: true, data: url.includes('csrf-token') ? { token: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } : {} }) }))
    const client = createWorkspaceApiClient({ fetchImpl: transport, accessTokenProvider: () => 'fixture' })
    await client.saveReviewedOpportunity({ ...quality, estimates: { atr: 123 }, orderContext: { price: 123 } })
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ organizationId: 'org-atlas-local', accountId: 'paper-portfolio', reviewState: 'saved', reviewReference: reference })
  })
})
