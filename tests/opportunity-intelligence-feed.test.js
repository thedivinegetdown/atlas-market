import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import { buildBoundedOpportunityFeed, normalizeTradeQualitySnapshot } from '../lib/opportunities/feed/index.js'
import { createOpportunityIntelligenceHandler } from '../netlify/functions/opportunity-intelligence.js'

const NOW = '2026-08-09T14:00:00.000Z'
function snapshot(overrides = {}) { return { opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'index-pullback-v1', score: 84, band: 'STRONG', confidence: 79, status: 'COMPLETE', reasons: ['Trend evidence aligned'], blockingReasons: [], missingInputs: [], freshness: 'FRESH', asOf: '2026-08-09T13:30:00.000Z', reviewState: 'saved', engineVersion: 'trade-quality-v1', ...overrides } }
function record(overrides = {}) { const { quality = {}, ...rest } = overrides; return { id: 'history-aapl', reviewState: 'saved', reviewedAt: NOW, expiresAt: '2026-08-10T14:00:00.000Z', payload: { tradeQualitySnapshot: snapshot(quality) }, ...rest } }
const membership = (organizationId = 'org-atlas-local', role = 'owner') => ({ getMembership: vi.fn(async (_org, userId) => ({ organizationId, userId, role, status: 'active' })) })

describe('bounded opportunity intelligence feed', () => {
  it('includes saved and reviewed deterministic quality results', () => {
    expect(buildBoundedOpportunityFeed([record(), record({ id: 'reviewed', reviewState: 'reviewed', quality: { opportunityId: 'opp-msft', symbol: 'MSFT' } })], { now: NOW })).toHaveLength(2)
  })
  it.each(['dismissed', 'expired'])('excludes %s review state', (reviewState) => expect(buildBoundedOpportunityFeed([record({ reviewState })], { now: NOW })).toEqual([]))
  it('excludes records whose retention expiry has passed', () => expect(buildBoundedOpportunityFeed([record({ expiresAt: '2026-08-08T14:00:00.000Z' })], { now: NOW })).toEqual([]))
  it('preserves stale evidence and does not upgrade freshness', () => expect(buildBoundedOpportunityFeed([record({ quality: { freshness: 'STALE' } })], { now: NOW })[0]).toMatchObject({ freshness: 'STALE', stale: true }))
  it('excludes a missing or invalid score', () => expect(buildBoundedOpportunityFeed([record({ quality: { score: undefined } })], { now: NOW })).toEqual([]))
  it('caps results at five', () => {
    const records = Array.from({ length: 8 }, (_, index) => record({ id: `${index}`, quality: { opportunityId: `opp-${index}`, symbol: `A${index}`, score: 90 - index } }))
    expect(buildBoundedOpportunityFeed(records, { limit: 20, now: NOW })).toHaveLength(5)
  })
  it('orders by score, confidence, freshness, and stable opportunity ID', () => {
    const records = [record({ quality: { opportunityId: 'opp-low', symbol: 'LOW', score: 70 } }), record({ quality: { opportunityId: 'opp-b', symbol: 'BBB', score: 90, confidence: 80 } }), record({ quality: { opportunityId: 'opp-a', symbol: 'AAA', score: 90, confidence: 80, asOf: '2026-08-09T13:30:00Z' } }), record({ quality: { opportunityId: 'opp-conf', symbol: 'CCC', score: 90, confidence: 90 } })]
    expect(buildBoundedOpportunityFeed(records, { limit: 5, now: NOW }).map((item) => item.opportunityId)).toEqual(['opp-conf', 'opp-a', 'opp-b', 'opp-low'])
  })
  it('normalizes a compact read model and rejects missing strategy context', () => {
    expect(normalizeTradeQualitySnapshot(snapshot())).toEqual(expect.objectContaining({ score: 84, confidence: 79, engineVersion: 'trade-quality-v1', boundaries: { advisoryOnly: true, paperTradingOnly: true } }))
    expect(() => normalizeTradeQualitySnapshot(snapshot({ strategyId: 'strategy-unknown' }))).toThrow('strategy context')
  })
  it('reuses existing opportunity history storage without raw data persistence', async () => {
    const repository = createAtlasAiRepository({ database: { connected: false } })
    const saved = await repository.saveTradeQualityReview({ tenantContext: { organizationId: 'org-a', userId: 'user-a' }, accountId: 'paper-portfolio', userId: 'user-a', qualitySnapshot: { ...snapshot(), rawCandles: [{ close: 1 }], rawProviderPayload: { secret: true } } })
    expect(saved.history.analysisCategory).toBe('trade_quality_review')
    expect(JSON.stringify(saved.history.payload)).not.toMatch(/"rawCandles":|"rawProviderPayload":|secret/)
    expect(saved.history.payload).toMatchObject({ rawCandlesStored: false, rawProviderPayloadStored: false, rawPromptStored: false })
  })
  it('uses tenant, account, and user constraints in the bounded SQL read', async () => {
    const database = { connected: true, query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repository = createAtlasAiRepository({ database })
    await repository.listTradeQualityReviews({ tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' }, accountId: 'account-a', userId: 'user-a', limit: 3, now: NOW })
    const [sql, params] = database.query.mock.calls[0]
    expect(sql).toMatch(/organization_id = \$1.*account_id = \$3.*user_id = \$4/s)
    expect(params.slice(0, 4)).toEqual(['org-a', 'team-a', 'account-a', 'user-a'])
  })
  it('rejects unauthorized access and preserves tenant context on authorized reads', async () => {
    const repository = { listTradeQualityReviews: vi.fn().mockResolvedValue([normalizeTradeQualitySnapshot(snapshot())]) }
    const handler = createOpportunityIntelligenceHandler({ opportunityRepository: repository, organizationMembershipRepository: membership(), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    expect((await handler({ httpMethod: 'GET', queryStringParameters: { organizationId: 'org-atlas-local' }, headers: {} })).statusCode).toBe(401)
    const response = await handler({ httpMethod: 'GET', queryStringParameters: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, headers: { authorization: 'Bearer private-session' } })
    expect(response.statusCode).toBe(200)
    expect(repository.listTradeQualityReviews).toHaveBeenCalledWith(expect.objectContaining({ tenantContext: expect.objectContaining({ organizationId: 'org-atlas-local' }), accountId: 'paper-portfolio' }))
  })
  it('rejects cross-tenant organization access', async () => {
    const repository = { listTradeQualityReviews: vi.fn() }
    const handler = createOpportunityIntelligenceHandler({ opportunityRepository: repository, organizationMembershipRepository: membership('org-other'), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    const response = await handler({ httpMethod: 'GET', queryStringParameters: { organizationId: 'org-atlas-local', requestedOrganizationId: 'org-other' }, headers: { authorization: 'Bearer private-session' } })
    expect(response.statusCode).toBe(403)
    expect(repository.listTradeQualityReviews).not.toHaveBeenCalled()
  })
  it('does not invoke scoring, scanner ranking, providers, AI, orders, portfolios, or strategies', () => {
    const callbacks = { scoreTradeQuality: vi.fn(), scannerRank: vi.fn(), provider: vi.fn(), ai: vi.fn(), order: vi.fn(), portfolio: vi.fn(), strategy: vi.fn() }
    buildBoundedOpportunityFeed([record()], { now: NOW, ...callbacks })
    Object.values(callbacks).forEach((callback) => expect(callback).not.toHaveBeenCalled())
  })
})
