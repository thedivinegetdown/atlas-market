import { describe, expect, it, vi } from 'vitest'
import {
  createAuthenticationProvider,
  createNetlifyIdentityAuthAdapter,
} from '../lib/auth/authenticationProvider.js'
import { createAuthenticatedApiHandler } from '../netlify/functions/_shared/authApi.js'

function token({ exp = Math.floor(Date.now() / 1000) + 3600, iat = Math.floor(Date.now() / 1000) } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ exp, iat, sub: 'identity-user-1' })}.test-signature`
}

function verifiedUser(overrides = {}) {
  return {
    id: 'identity-user-1',
    email: 'operator@example.test',
    app_metadata: { provider: 'email', roles: ['viewer'] },
    user_metadata: { full_name: 'Atlas Operator' },
    ...overrides,
  }
}

describe('AUTH.1 Netlify Identity server adapter', () => {
  it('accepts only provider-verified bearer sessions and preserves explicitly assigned Atlas roles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => verifiedUser() })
    const adapter = createNetlifyIdentityAuthAdapter({ identityUrl: 'https://atlas.example/.netlify/identity', fetchImpl })
    const accessToken = token()
    const result = await adapter.authenticate({ token: accessToken })

    expect(result.ok).toBe(true)
    expect(result.user).toMatchObject({ provider: 'netlify-identity', providerSubject: 'identity-user-1', role: 'viewer' })
    expect(result.session.metadata.providerVerified).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('https://atlas.example/.netlify/identity/user', expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${accessToken}` }),
    }))
    expect(JSON.stringify(result)).not.toContain(accessToken)
  })

  it.each([
    ['missing', null],
    ['malformed', 'arbitrary-bearer-value'],
    ['expired', token({ exp: Math.floor(Date.now() / 1000) - 30 })],
  ])('rejects %s bearer values before provider access', async (_label, accessToken) => {
    const fetchImpl = vi.fn()
    const adapter = createNetlifyIdentityAuthAdapter({ identityUrl: 'https://atlas.example', fetchImpl })
    const result = await adapter.authenticate({ token: accessToken })
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects invalid provider responses and does not fabricate missing role authority', async () => {
    const rejected = createNetlifyIdentityAuthAdapter({
      identityUrl: 'https://atlas.example',
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    })
    expect((await rejected.authenticate({ token: token() })).ok).toBe(false)

    const unassigned = createNetlifyIdentityAuthAdapter({
      identityUrl: 'https://atlas.example',
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => verifiedUser({ app_metadata: { provider: 'email' } }) }),
    })
    expect((await unassigned.authenticate({ token: token() })).user.role).toBeNull()
  })

  it('makes the development adapter impossible to select in production', () => {
    expect(() => createAuthenticationProvider({ env: { NODE_ENV: 'production', ATLAS_AUTH_MODE: 'development' } })).toThrow('must use Netlify Identity')
    expect(createAuthenticationProvider({
      env: { NODE_ENV: 'production', ATLAS_AUTH_MODE: 'netlify-identity', URL: 'https://atlas.example' },
      netlifyIdentity: { fetchImpl: vi.fn() },
    }).providerId).toBe('netlify-identity')
  })

  it('returns safe 401/403 responses through the shared wrapper without leaking bearer material', async () => {
    const accessToken = token()
    const logger = { info: vi.fn(), error: vi.fn() }
    const repositoryFactory = () => ({ end: vi.fn() })
    const verifiedAdapter = createNetlifyIdentityAuthAdapter({
      identityUrl: 'https://atlas.example',
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => verifiedUser() }),
    })
    const handler = createAuthenticatedApiHandler(({ user }) => ({ userId: user.id }), {
      authProvider: verifiedAdapter,
      logger,
      repositoryFactory,
      env: { NODE_ENV: 'test' },
    })
    const accepted = await handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${accessToken}` } })
    const denied = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer arbitrary-value' } })

    expect(accepted.statusCode).toBe(200)
    expect(denied.statusCode).toBe(401)
    expect(`${accepted.body}${denied.body}${JSON.stringify(logger)}`).not.toContain(accessToken)
  })
})
