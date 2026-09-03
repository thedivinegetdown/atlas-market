import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeAuthenticatedSession, normalizeUserIdentity } from '../lib/auth/authenticationProvider.js'
import { issueCsrfToken, verifyCsrfToken } from '../lib/security/csrfProtection.js'
import { assertOriginAllowed, createAuthenticatedApiHandler, createOrganizationAuthenticatedApiHandler } from '../netlify/functions/_shared/authApi.js'
import { createProtectedWorkspaceApiHandler } from '../netlify/functions/_shared/protectedWorkspaceApi.js'
import { buildApiControlInventory } from '../scripts/generate-api-control-inventory.mjs'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'

const BEARER = 'verified-provider-token'
const ORGANIZATION_ID = 'org-auth2'

function identity(subject = 'owner-user', role = 'owner', { sessionId = `session-${subject}` } = {}) {
  const user = normalizeUserIdentity({ provider: 'netlify-identity', providerSubject: subject, role })
  const session = normalizeAuthenticatedSession({
    id: sessionId,
    provider: 'netlify-identity',
    userId: user.id,
    token: BEARER,
    user,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    metadata: { providerVerified: true },
  })
  return { user, session }
}

function authProvider(current = identity()) {
  return {
    authenticate: vi.fn(async ({ token }) => token === BEARER
      ? { ok: true, ...current }
      : { ok: false, user: null, session: null }),
  }
}

function csrfFor(current = identity(), options = {}) {
  return issueCsrfToken({ bearerToken: BEARER, ...current, ...options }).token
}

function event(method = 'GET', { body = {}, query = {}, bearer = BEARER, csrfToken } = {}) {
  return {
    httpMethod: method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    queryStringParameters: query,
    body: method === 'GET' ? '' : JSON.stringify(body),
  }
}

function handlerOptions(current = identity()) {
  return {
    authProvider: authProvider(current),
    repositoryFactory: () => ({ end: vi.fn(async () => {}) }),
    logger: { info: vi.fn(), error: vi.fn() },
    env: { NODE_ENV: 'test' },
  }
}

function parse(response) {
  return { ...response, json: JSON.parse(response.body) }
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

describe('AUTH.2 server-bound CSRF control', () => {
  it('accepts a valid, unexpired token for the verified user and session', () => {
    const current = identity()
    expect(verifyCsrfToken(csrfFor(current), { bearerToken: BEARER, ...current })).toMatchObject({ valid: true })
  })

  it.each([
    ['missing', null, 'csrf_required'],
    ['malformed', 'not-a-token', 'csrf_invalid'],
    ['invalid signature', `${csrfFor(identity())}x`, 'csrf_invalid'],
  ])('rejects %s CSRF input safely', (_label, token, code) => {
    const current = identity()
    expect(() => verifyCsrfToken(token, { bearerToken: BEARER, ...current })).toThrow(expect.objectContaining({ code }))
  })

  it('rejects expired CSRF tokens', () => {
    const current = identity()
    const token = csrfFor(current, { now: new Date(Date.now() - 120_000), ttlMs: 1_000 })
    expect(() => verifyCsrfToken(token, { bearerToken: BEARER, ...current })).toThrow(expect.objectContaining({ code: 'csrf_expired' }))
  })

  it('rejects tokens bound to another user, session, or bearer', () => {
    const owner = identity('owner-user')
    const otherUser = identity('other-user')
    const otherSession = identity('owner-user', 'owner', { sessionId: 'different-session' })
    const token = csrfFor(owner)
    expect(() => verifyCsrfToken(token, { bearerToken: BEARER, ...otherUser })).toThrow(expect.objectContaining({ code: 'csrf_invalid' }))
    expect(() => verifyCsrfToken(token, { bearerToken: BEARER, ...otherSession })).toThrow(expect.objectContaining({ code: 'csrf_invalid' }))
    expect(() => verifyCsrfToken(token, { bearerToken: 'different-bearer', ...owner })).toThrow(expect.objectContaining({ code: 'csrf_invalid' }))
  })

  it('does not expose bearer or CSRF values in verification errors', () => {
    const current = identity()
    const token = csrfFor(current)
    try {
      verifyCsrfToken(`${token}x`, { bearerToken: BEARER, ...current })
    } catch (error) {
      expect(JSON.stringify({ message: error.message, metadata: error.metadata })).not.toContain(token)
      expect(JSON.stringify({ message: error.message, metadata: error.metadata })).not.toContain(BEARER)
    }
  })
})

describe('AUTH.2 authentication, authorization, and tenant controls', () => {
  it('rejects missing auth for reads and mutations and rejects an arbitrary production bearer', async () => {
    const current = identity()
    const read = createAuthenticatedApiHandler(() => ({ allowed: true }), { ...handlerOptions(current), routeId: 'auth2-read' })
    const mutation = createAuthenticatedApiHandler(() => ({ allowed: true }), { ...handlerOptions(current), allowedMethods: ['POST'], routeId: 'auth2-write' })
    expect(parse(await read(event('GET', { bearer: null }))).json.error.code).toBe('authentication_required')
    expect(parse(await mutation(event('POST', { bearer: null, csrfToken: csrfFor(current) }))).json.error.code).toBe('authentication_required')
    expect(parse(await read(event('GET', { bearer: 'arbitrary' }))).json.error.code).toBe('authentication_required')
  })

  it('permits authorized reads and requires valid auth plus independent CSRF for mutations', async () => {
    const current = identity()
    const read = createAuthenticatedApiHandler(() => ({ allowed: true }), { ...handlerOptions(current), routeId: 'auth2-read' })
    const mutation = createAuthenticatedApiHandler(() => ({ allowed: true }), { ...handlerOptions(current), allowedMethods: ['POST'], routeId: 'auth2-write' })
    expect(parse(await read(event())).statusCode).toBe(200)
    expect(parse(await mutation(event('POST'))).json.error.code).toBe('csrf_required')
    expect(parse(await mutation(event('POST', { csrfToken: 'malformed' }))).json.error.code).toBe('csrf_invalid')
    expect(parse(await mutation(event('POST', { csrfToken: csrfFor(current) }))).statusCode).toBe(200)
  })

  it('does not allow a CSRF token to substitute for authentication', async () => {
    const current = identity()
    const mutation = createAuthenticatedApiHandler(() => ({ allowed: true }), { ...handlerOptions(current), allowedMethods: ['POST'], routeId: 'auth2-write' })
    const response = parse(await mutation(event('POST', { bearer: null, csrfToken: csrfFor(current) })))
    expect(response.statusCode).toBe(401)
    expect(response.json.error.code).toBe('authentication_required')
  })

  it('permits viewer reads, rejects viewer writes, and permits owner/admin writes through authoritative membership', async () => {
    const current = identity()
    const createHandler = (workspaceAction, membershipRole) => createOrganizationAuthenticatedApiHandler(() => ({ allowed: true }), {
      ...handlerOptions(current),
      allowedMethods: workspaceAction === 'read' ? ['GET'] : ['POST'],
      workspaceAction,
      routeId: `auth2-org-${workspaceAction}`,
      organizationMembershipRepository: {
        getMembership: vi.fn(async (_organizationId, userId) => ({ id: 'membership', organizationId: ORGANIZATION_ID, userId, role: membershipRole, status: 'active' })),
      },
    })
    const read = await createHandler('read', 'viewer')(event('GET', { query: { organizationId: ORGANIZATION_ID } }))
    const viewerWrite = await createHandler('write', 'viewer')(event('POST', { body: { organizationId: ORGANIZATION_ID }, csrfToken: csrfFor(current) }))
    const ownerWrite = await createHandler('write', 'owner')(event('POST', { body: { organizationId: ORGANIZATION_ID }, csrfToken: csrfFor(current) }))
    const adminWrite = await createHandler('write', 'admin')(event('POST', { body: { organizationId: ORGANIZATION_ID }, csrfToken: csrfFor(current) }))
    expect(parse(read).statusCode).toBe(200)
    expect(parse(viewerWrite).json.error.code).toBe('authorization_denied')
    expect(parse(ownerWrite).statusCode).toBe(200)
    expect(parse(adminWrite).statusCode).toBe(200)
  })

  it('rejects cross-organization and cross-user access after valid auth and CSRF', async () => {
    const current = identity()
    const createHandler = (userId = current.user.id) => createOrganizationAuthenticatedApiHandler(() => ({ allowed: true }), {
      ...handlerOptions(current),
      allowedMethods: ['GET', 'POST'],
      workspaceAction: 'write',
      routeId: 'auth2-org-boundary',
      organizationMembershipRepository: {
        getMembership: vi.fn(async () => ({ id: 'membership', organizationId: ORGANIZATION_ID, userId, role: 'owner', status: 'active' })),
      },
    })
    const crossOrganization = parse(await createHandler()(event('POST', {
      body: { organizationId: ORGANIZATION_ID, requestedOrganizationId: 'org-other' },
      csrfToken: csrfFor(current),
    })))
    const crossUser = parse(await createHandler('netlify-identity:other-user')(event('GET', { query: { organizationId: ORGANIZATION_ID } })))
    expect(crossOrganization.statusCode).toBe(403)
    expect(crossOrganization.json.error.code).toBe('authorization_denied')
    expect(crossUser.statusCode).toBe(403)
    expect(crossUser.json.error.code).toBe('authorization_denied')
  })

  it('rejects missing and mismatched account scope on compatibility mutations', async () => {
    const current = identity()
    const handler = createProtectedWorkspaceApiHandler(() => ({ allowed: true }), {
      ...handlerOptions(current),
      allowedMethods: ['POST'],
      mutation: true,
      routeId: 'auth2-compatibility-account',
      serviceFactory: () => ({}),
      organizationMembershipRepository: {
        getMembership: vi.fn(async (_organizationId, userId) => ({ id: 'membership', organizationId: ORGANIZATION_ID, userId, role: 'owner', status: 'active' })),
      },
    })
    const missing = parse(await handler(event('POST', { body: { organizationId: ORGANIZATION_ID }, csrfToken: csrfFor(current) })))
    const mismatch = parse(await handler(event('POST', {
      body: { organizationId: ORGANIZATION_ID, accountId: 'account-one', requestedAccountId: 'account-two' },
      csrfToken: csrfFor(current),
    })))
    expect(missing.statusCode).toBe(400)
    expect(mismatch.statusCode).toBe(403)
    expect(mismatch.json.error.code).toBe('tenant_scope_required')
  })

  it('allows the configured deploy-preview origin and rejects unknown origins', () => {
    expect(assertOriginAllowed({ headers: { origin: 'https://deploy-preview.example' } }, undefined, { DEPLOY_PRIME_URL: 'https://deploy-preview.example/path' })).toBe(true)
    expect(() => assertOriginAllowed({ headers: { origin: 'https://attacker.example' } }, undefined, { URL: 'https://atlas.example' }))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('allows the exact Netlify request origin when deploy URL variables are unavailable', () => {
    const event = {
      rawUrl: 'https://deploy-preview-1--atlas-market.netlify.app/.netlify/functions/scanner-configurations',
      headers: { origin: 'https://deploy-preview-1--atlas-market.netlify.app' },
    }
    expect(assertOriginAllowed(event, undefined, {})).toBe(true)
    expect(() => assertOriginAllowed({ ...event, headers: { origin: 'https://attacker.example' } }, undefined, {}))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})

describe('AUTH.2 browser CSRF transport', () => {
  it('establishes CSRF only for mutations and attaches it automatically', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { token: 'csrf-one', expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { paperTrading: true } }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'browser-access' })
    await client.recalculatePortfolio()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toContain('/csrf-token')
    expect(fetchImpl.mock.calls[1][1].headers['x-csrf-token']).toBe('csrf-one')
  })

  it('refreshes and retries an expired/invalid CSRF token exactly once', async () => {
    const tokenPayload = (token) => ({ ok: true, data: { token, expiresAt: new Date(Date.now() + 60_000).toISOString() } })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenPayload('csrf-one')))
      .mockResolvedValueOnce(jsonResponse(403, { ok: false, error: { code: 'csrf_expired', message: 'expired' } }))
      .mockResolvedValueOnce(jsonResponse(200, tokenPayload('csrf-two')))
      .mockResolvedValueOnce(jsonResponse(403, { ok: false, error: { code: 'csrf_invalid', message: 'invalid' } }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'browser-access' })
    await expect(client.recalculatePortfolio()).rejects.toThrow('invalid')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/csrf-token'))).toHaveLength(2)
  })

  it('clears local CSRF state on logout and never reuses it after a user switch', async () => {
    let accessToken = 'user-one-access'
    let csrfCounter = 0
    const fetchImpl = vi.fn(async (url) => url.includes('/csrf-token')
      ? jsonResponse(200, { ok: true, data: { token: `csrf-${++csrfCounter}`, expiresAt: new Date(Date.now() + 60_000).toISOString() } })
      : jsonResponse(200, { ok: true, data: { paperTrading: true } }))
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => accessToken })
    await client.recalculatePortfolio()
    accessToken = 'user-two-access'
    await client.recalculatePortfolio()
    client.clearCsrfState()
    await client.recalculatePortfolio()
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/csrf-token'))).toHaveLength(3)
    expect(fetchImpl.mock.calls.filter(([url]) => !url.includes('/csrf-token')).map(([, options]) => options.headers['x-csrf-token']))
      .toEqual(['csrf-1', 'csrf-2', 'csrf-3'])
  })
})

describe('AUTH.2 API surface regression', () => {
  it('protects every former P0 mutation and former P1 sensitive read', () => {
    const inventory = buildApiControlInventory()
    const formerP0 = ['cancel-paper-order', 'create-alert', 'create-scanner', 'delete-alert', 'delete-scanner', 'evaluate-alerts', 'evaluate-scanners', 'recalculate-portfolio', 'submit-paper-order', 'update-alert', 'update-scanner', 'workspace-configurations']
    const formerP1 = ['journal-summary', 'operator-actions', 'orders', 'portfolio-summary', 'positions', 'risk-summary', 'signals', 'system-events']
    for (const name of formerP0) {
      const endpoint = inventory.functions.find((entry) => entry.function === name)
      expect(endpoint.wrapper).not.toBe('plain-api')
      expect(endpoint.csrfRequired).toBe(true)
    }
    for (const name of formerP1) expect(inventory.functions.find((entry) => entry.function === name).wrapper).not.toBe('plain-api')
  })

  it('leaves only documented non-sensitive public reads and no unexplained risks', () => {
    const inventory = buildApiControlInventory()
    expect(inventory.functions.filter((entry) => entry.wrapper === 'plain-api').map((entry) => entry.function)).toEqual(['health', 'watchlist'])
    expect(inventory.functions.filter((entry) => entry.wrapper === 'plain-api').every((entry) => entry.endpointClassification === 'PUBLIC_READ' && entry.access === 'read')).toBe(true)
    expect(inventory.summary.byPriority).toEqual({ P0: 0, P1: 0, P2: 0, P3: 276 })
  })

  it('forces Netlify Identity for non-production deploy and branch previews', () => {
    const configuration = readFileSync(join(process.cwd(), 'netlify.toml'), 'utf8')
    expect(configuration).toMatch(/\[context\.deploy-preview\.environment\][\s\S]*ATLAS_AUTH_MODE\s*=\s*"netlify-identity"/)
    expect(configuration).toMatch(/\[context\.branch-deploy\.environment\][\s\S]*ATLAS_AUTH_MODE\s*=\s*"netlify-identity"/)
  })

  it('keeps legacy paper mutations compatibility-only and preserves paper-only boundaries', () => {
    const inventory = buildApiControlInventory()
    for (const name of ['submit-paper-order', 'cancel-paper-order', 'recalculate-portfolio']) {
      expect(inventory.functions.find((entry) => entry.function === name)).toMatchObject({ endpointClassification: 'COMPATIBILITY_ONLY', wrapper: 'organization-authenticated' })
    }
    const sources = ['submit-paper-order.js', 'cancel-paper-order.js', 'recalculate-portfolio.js']
      .map((name) => readFileSync(join(process.cwd(), 'netlify', 'functions', name), 'utf8')).join('\n')
    expect(sources).toContain('createProtectedWorkspaceApiHandler')
    expect(sources).not.toMatch(/broker|live[-_ ]?order/i)
  })
})
