import { describe, expect, it, vi } from 'vitest'
import { createDecisionIntelligenceHandler } from '../netlify/functions/decision-intelligence.js'

const authentication = { authenticate: async () => ({ ok: true, user: { id: 'user-a', status: 'active' }, session: { id: 'session-a', userId: 'user-a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' } }) }
const membership = { getMembership: async (organizationId, userId) => organizationId === 'org-a' && userId === 'user-a' ? { organizationId, userId, role: 'viewer', status: 'active' } : null }
const options = (overrides = {}) => ({ ledgerRepository: { persistenceMode: 'postgresql', getOrCreateAccount: vi.fn(async () => ({ account: { accountId: 'paper-a', equity: 100000 }, positions: [] })), listExecutions: vi.fn(async () => []) }, evidenceRepository: { persistenceMode: 'postgresql', listPaperEvaluations: vi.fn(async () => []) }, authProvider: authentication, authorizationService: { assert: () => ({ allowed: true }) }, organizationMembershipRepository: membership, ...overrides })

describe('decision intelligence endpoint', () => {
  it('requires authentication', async () => {
    const response = await createDecisionIntelligenceHandler(options())({ httpMethod: 'GET', headers: {}, queryStringParameters: { organizationId: 'org-a', accountId: 'paper-a' } })
    expect(response.statusCode).toBe(401)
  })
  it('derives scoped identity and returns a read-only bounded snapshot', async () => {
    const configured = options(); const response = await createDecisionIntelligenceHandler(configured)({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, queryStringParameters: { organizationId: 'org-a', accountId: 'paper-a', planId: 'other-org' } })
    expect(response.statusCode).toBe(200); expect(response.body).toContain('atlas-decision-intelligence-v1'); expect(response.body).toContain('"liveExecutionDisabled":true')
    expect(configured.evidenceRepository.listPaperEvaluations).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-a', tenantContext: expect.objectContaining({ organizationId: 'org-a', userId: 'user-a' }) }))
  })
  it('fails closed when organization access is absent', async () => {
    const response = await createDecisionIntelligenceHandler(options({ organizationMembershipRepository: { getMembership: async () => null } }))({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, queryStringParameters: { organizationId: 'org-b', accountId: 'paper-a' } })
    expect(response.statusCode).toBe(403)
  })
})