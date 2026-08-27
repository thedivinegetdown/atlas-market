import { describe, expect, it, vi } from 'vitest'
import { createDecisionIntelligenceHandler } from '../netlify/functions/decision-intelligence.js'

const authentication = { authenticate: async () => ({ ok: true, user: { id: 'user-a', status: 'active' }, session: { id: 'session-a', userId: 'user-a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' } }) }
const membership = { getMembership: async (organizationId, userId) => organizationId === 'org-a' && userId === 'user-a' ? { organizationId, userId, role: 'viewer', status: 'active' } : null }
const options = (overrides = {}) => ({ ledgerRepository: { persistenceMode: 'postgresql', getOrCreateAccount: vi.fn(async () => ({ account: { accountId: 'paper-a', equity: 100000 }, positions: [] })), listExecutions: vi.fn(async () => []) }, evidenceRepository: { persistenceMode: 'postgresql', listPaperEvaluations: vi.fn(async () => []) }, marketContextService: { refresh: vi.fn(async () => ({ evidenceAvailability: { sectorLeadership: 'UNAVAILABLE' }, benchmarks: [], participation: { status: 'INSUFFICIENT_DATA', labels: { display: 'SECTOR ETF PARTICIPATION PROXY' } }, sectorLeadership: { leaders: [], laggards: [] }, provenance: {} })) }, authProvider: authentication, authorizationService: { assert: () => ({ allowed: true }) }, organizationMembershipRepository: membership, ...overrides })

describe('decision intelligence endpoint', () => {
  it('requires authentication', async () => {
    const response = await createDecisionIntelligenceHandler(options())({ httpMethod: 'GET', headers: {}, queryStringParameters: { organizationId: 'org-a', accountId: 'paper-a' } })
    expect(response.statusCode).toBe(401)
  })
  it('derives scoped identity and returns a read-only bounded snapshot', async () => {
    const configured = options(); const response = await createDecisionIntelligenceHandler(configured)({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, queryStringParameters: { organizationId: 'org-a', accountId: 'paper-a', planId: 'other-org' } })
    expect(response.statusCode).toBe(200); expect(response.body).toContain('atlas-decision-intelligence-v1'); expect(response.body).toContain('"liveExecutionDisabled":true')
    expect(configured.evidenceRepository.listPaperEvaluations).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-a', tenantContext: expect.objectContaining({ organizationId: 'org-a', userId: 'user-a' }) }))
    expect(configured.marketContextService.refresh).toHaveBeenCalledTimes(1)
  })
  it('fails closed when organization access is absent', async () => {
    const response = await createDecisionIntelligenceHandler(options({ organizationMembershipRepository: { getMembership: async () => null } }))({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, queryStringParameters: { organizationId: 'org-b', accountId: 'paper-a' } })
    expect(response.statusCode).toBe(403)
  })
  it('returns bounded, read-only experiment statuses from the authorized account scope', async () => {
    const observationStatusResolver = vi.fn(async () => [{ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', status: 'COLLECTING', sessionsElapsed: 2, completedOutcomes: 1, minimumSessions: 20, minimumOutcomes: 30 }, { experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'NOT_STARTED', sessionsElapsed: 0, completedOutcomes: 0, minimumSessions: 20, minimumOutcomes: 30 }])
    const response = await createDecisionIntelligenceHandler(options({ observationStatusResolver }))({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, queryStringParameters: { organizationId: 'org-a', accountId: 'paper-a' } })
    expect(response.statusCode).toBe(200); expect(response.body).toContain('"experimentId":"EDGE.2"'); expect(response.body).toContain('"experimentId":"BREAKOUT.1"'); expect(response.body).not.toContain('forwardObservationManifest')
    expect(observationStatusResolver).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-a', tenantContext: expect.objectContaining({ organizationId: 'org-a', userId: 'user-a' }) }))
  })
})