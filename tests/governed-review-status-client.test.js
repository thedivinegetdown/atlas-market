import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'

describe('governed review status client', () => {
  it('sends the required organization scope while polling a preparation id', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { preparationId: 'prep-1', status: 'running' } }) }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'token' })

    await client.getGovernedReviewPreparationStatus('prep-1')

    expect(fetchImpl.mock.calls[0][0]).toContain('preparationId=prep-1')
    expect(fetchImpl.mock.calls[0][0]).toContain('organizationId=org-atlas-local')
  })

  it('returns preparation status with attempt and claimTokenPresent observability fields', async () => {
    const mockResponse = {
      preparationId: 'prep-1',
      status: 'running',
      attempt: 2,
      claimTokenPresent: true,
      createdAt: '2026-09-12T12:00:00.000Z',
      startedAt: '2026-09-12T12:00:05.000Z',
      completedAt: null,
      failedAt: null,
      error: null,
      queueItems: [],
      providerCalls: null,
    }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: mockResponse }) }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'token' })

    const result = await client.getGovernedReviewPreparationStatus('prep-1')

    expect(result.preparationId).toBe('prep-1')
    expect(result.status).toBe('running')
    expect(result.attempt).toBe(2)
    expect(result.claimTokenPresent).toBe(true)
  })
})
