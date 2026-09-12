import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'

describe('governed review status client', () => {
  it('sends the required organization scope while polling a preparation id', async () => {
    const fetchImpl = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { preparationId: 'prep-1', status: 'running' } }) }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'token' })

    await client.getGovernedReviewPreparationStatus('prep-1')

    expect(fetchImpl.mock.calls[0][0]).toContain('preparationId=prep-1')
    expect(fetchImpl.mock.calls[0][0]).toContain('organizationId=org-atlas-local')
  })
})
