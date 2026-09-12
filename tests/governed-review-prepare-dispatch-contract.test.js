import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../netlify/functions/_shared/authApi.js', () => ({
  createOrganizationAuthenticatedApiHandler: (resolver) => resolver,
}))

vi.mock('../lib/logging/logger.js', () => ({
  serverLogger: { debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/workspace/governedReviewPreparation.js', () => ({
  createOrReusePreparation: vi.fn(),
}))

import { handler } from '../netlify/functions/governed-review-prepare.js'
import { createOrReusePreparation } from '../lib/workspace/governedReviewPreparation.js'

afterEach(() => vi.unstubAllGlobals())

describe('governed review prepare background dispatch contract', () => {
  it('forwards authenticated bearer, CSRF, and authorized organization scope while treating 202 as enqueue acceptance', async () => {
    const preparation = { id: 'prep-dispatch-1', status: 'pending' }
    createOrReusePreparation.mockResolvedValue({ preparation, created: true, existingId: null })
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await handler({
      organizationId: 'org-1',
      user: { id: 'user-1' },
      token: 'test-bearer-token',
      tenantContext: { organizationId: 'org-1', userId: 'user-1' },
      event: {
        rawUrl: 'https://atlas-market.netlify.app/.netlify/functions/governed-review-prepare',
        headers: { 'x-csrf-token': 'test-csrf-token' },
      },
      repository: { getStore: vi.fn(() => ({})) },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://atlas-market.netlify.app/.netlify/functions/governed-review-prepare-background',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
          'X-CSRF-Token': 'test-csrf-token',
        }),
        body: JSON.stringify({ preparationId: 'prep-dispatch-1', organizationId: 'org-1' }),
      }),
    )
    expect(result).toMatchObject({ ok: true, data: { preparationId: 'prep-dispatch-1', status: 'pending' } })
  })
})
