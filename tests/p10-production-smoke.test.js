import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  READ_ONLY_METHODS,
  assertReadOnlyMethod,
  parseArguments,
  sanitizeEvidence,
  sanitizeUrl,
  summarizeSmoke,
} from '../scripts/production-smoke.mjs'

describe('P10 production smoke safety and evidence', () => {
  it('allows only read-only request methods and fails closed for mutation methods', () => {
    expect(READ_ONLY_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS'])
    expect(assertReadOnlyMethod('get')).toBe('GET')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => assertReadOnlyMethod(method)).toThrow(`blocked non-read-only request method: ${method}`)
    }
  })

  it('removes secrets, identity details, query values, and tenant identifiers from evidence', () => {
    const evidence = sanitizeEvidence({
      authorization: 'Bearer private-token',
      cookie: 'nf_jwt=private-token',
      emailAddress: 'operator@example.com',
      tenantId: 'tenant-private',
      message: 'Bearer abc.def.ghi failed for operator@example.com at https://atlas-market.netlify.app/path?token=secret',
    })
    expect(evidence).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      emailAddress: '[REDACTED]',
      tenantId: '[REDACTED]',
      message: 'Bearer [REDACTED] failed for [REDACTED_EMAIL] at https://atlas-market.netlify.app/path?token=[REDACTED]',
    })
    expect(sanitizeUrl('https://atlas-market.netlify.app/dashboard?token=secret')).toBe('/dashboard')
    expect(sanitizeUrl('https://identity.example.test/user?id=private')).toBe('https://identity.example.test')
  })

  it('uses an explicit production target and accepts session/browser inputs without persisting them', () => {
    const options = parseArguments(['--base-url=https://example.test/path', '--cdp-url=http://127.0.0.1:9222', '--timeout-ms=5000'], {})
    expect(options).toMatchObject({ baseUrl: 'https://example.test', cdpUrl: 'http://127.0.0.1:9222', timeoutMs: 5000 })
    expect(() => parseArguments(['--unknown=value'], {})).toThrow('unknown production smoke option')
  })

  it('requires every route, health boundary, authenticated access, asset, console, and network gate', () => {
    const passingRoute = { navigationRendered: true, refreshRendered: true, documentStatuses: [200, 200], lazyAssetCount: 1, httpFailureCount: 0, consoleFailureCount: 0, blockedMutationCount: 0 }
    const health = { public: { passed: true }, protectedUnauthenticated: { passed: true } }
    const browser = { authenticated: true, protectedHealth: { passed: true }, routes: [passingRoute], consoleFailures: [], failedRequests: [], blockedMutations: [] }
    expect(summarizeSmoke({ health, browser })).toMatchObject({ passed: true, productionProof: 'COMPLETE', routeCount: 1 })
    expect(summarizeSmoke({ health, browser: { ...browser, routes: [{ ...passingRoute, lazyAssetCount: 0 }] } })).toMatchObject({ passed: false, productionProof: 'PENDING' })
  })

  it('contains no application mutation endpoint or credential serialization path', () => {
    const source = readFileSync('scripts/production-smoke.mjs', 'utf8')
    expect(source).not.toMatch(/submit-paper-order|paper-evaluation|forward-observation|saveReviewed|workspace-configurations/)
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage|Network\.getAllCookies|Network\.getCookies/)
    expect(source).not.toMatch(/consoleFailures\.push\([^\n]*message:/)
  })
})
