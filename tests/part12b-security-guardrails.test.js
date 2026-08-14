import { describe, expect, it, vi } from 'vitest'
import { createApiHandler } from '../netlify/functions/_shared/api.js'
import { createRateLimiter } from '../lib/security/rateLimiter.js'
import { createLogger, redactSecrets } from '../lib/logging/logger.js'
import { handler as submitPaperOrderHandler } from '../netlify/functions/submit-paper-order.js'
import { auth2Body, auth2Headers } from './helpers/auth2Fixtures.js'

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

function postEvent(body, headers = {}) {
  const parsedBody = typeof body === 'string' ? body : JSON.stringify(auth2Body(body))
  return {
    httpMethod: 'POST',
    headers: {
      ...auth2Headers(),
      'x-request-id': 'req-security-test',
      ...headers,
    },
    body: parsedBody,
  }
}

function validOrder(overrides = {}) {
  return {
    paperTrading: true,
    symbol: 'AAPL',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 1,
    price: 100,
    limitPrice: 100,
    quote: {
      symbol: 'AAPL',
      price: 100,
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  }
}

describe('Part 12B security and API guardrails', () => {
  it('rejects disallowed methods with consistent request id error shape', async () => {
    const response = parseResponse(await submitPaperOrderHandler({
      httpMethod: 'GET',
      headers: { 'x-request-id': 'req-method' },
    }))

    expect(response.statusCode).toBe(405)
    expect(response.headers['x-request-id']).toBe('req-method')
    expect(response.json).toEqual({
      ok: false,
      error: {
        code: 'method_not_allowed',
        message: 'method is not allowed',
        requestId: 'req-method',
      },
    })
  })

  it('rejects mutation requests without JSON content type', async () => {
    const response = parseResponse(await submitPaperOrderHandler({
      httpMethod: 'POST',
      headers: { 'content-type': 'text/plain', 'x-request-id': 'req-json-only' },
      body: JSON.stringify(validOrder()),
    }))

    expect(response.statusCode).toBe(415)
    expect(response.json.error).toMatchObject({
      code: 'json_required',
      message: 'mutation requests must use application/json',
      requestId: 'req-json-only',
    })
  })

  it('rejects bad JSON and oversized request bodies', async () => {
    const handler = createApiHandler(() => ({ ok: true }), {
      allowedMethods: ['POST'],
      maxRequestBytes: 8,
      env: { TRADING_MODE: 'paper' },
      logger: createLogger({ sink: { error: vi.fn(), log: vi.fn() } }),
    })
    const badJson = parseResponse(await handler(postEvent('{')))
    const oversized = parseResponse(await handler(postEvent({ tooLarge: true })))

    expect(badJson.statusCode).toBe(400)
    expect(badJson.json.error.code).toBe('invalid_json')
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json.error.code).toBe('request_too_large')
  })

  it('rejects unsafe payload keys before resolver execution', async () => {
    const resolver = vi.fn(() => ({ ok: true }))
    const handler = createApiHandler(resolver, {
      allowedMethods: ['POST'],
      env: { TRADING_MODE: 'paper' },
      logger: createLogger({ sink: { error: vi.fn(), log: vi.fn() } }),
    })
    const response = parseResponse(await handler(postEvent('{"symbol":"AAPL","__proto__":{"polluted":true}}')))

    expect(response.statusCode).toBe(400)
    expect(response.json.error.code).toBe('unsafe_payload_key')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('rejects invalid symbols, asset types, numeric payloads, sides, and order types', async () => {
    const invalidSymbol = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ symbol: '../SPY' }))))
    const invalidAssetType = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ assetType: 'bond' }))))
    const invalidQuantity = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ quantity: Number.NaN }))))
    const invalidSide = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ side: 'HOLD' }))))
    const invalidType = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ type: 'TRAILING' }))))

    expect(invalidSymbol.json.error.code).toBe('invalid_symbol')
    expect(invalidAssetType.json.error.code).toBe('invalid_asset_type')
    expect(invalidQuantity.json.error.code).toBe('invalid_number')
    expect(invalidSide.json.error.code).toBe('invalid_order_side')
    expect(invalidType.json.error.code).toBe('invalid_order_type')
  })

  it('allows requests within rate limits and blocks requests beyond the configured limit', async () => {
    let currentTime = 1000
    const rateLimiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      clock: () => currentTime,
    })
    const handler = createApiHandler(() => ({ value: true }), {
      allowedMethods: ['GET'],
      rateLimiter,
      rateLimitKey: () => 'client-1',
      env: { TRADING_MODE: 'paper' },
      logger: createLogger({ sink: { error: vi.fn(), log: vi.fn() } }),
    })

    expect(parseResponse(await handler({ httpMethod: 'GET' })).statusCode).toBe(200)
    expect(parseResponse(await handler({ httpMethod: 'GET' })).statusCode).toBe(200)

    const blocked = parseResponse(await handler({ httpMethod: 'GET', headers: { 'x-request-id': 'req-rate' } }))
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json.error).toMatchObject({
      code: 'rate_limited',
      message: 'too many requests',
      requestId: 'req-rate',
    })

    currentTime += 60_001
    expect(parseResponse(await handler({ httpMethod: 'GET' })).statusCode).toBe(200)
  })

  it('redacts secrets from logs and never exposes stacks or database URLs in API errors', async () => {
    const writes = []
    const logger = createLogger({
      sink: {
        error: (line) => writes.push(line),
        log: (line) => writes.push(line),
      },
    })
    const handler = createApiHandler(() => {
      throw new Error('database failed postgres://user:pass@localhost/db with stack')
    }, {
      logger,
      env: { TRADING_MODE: 'paper', DATABASE_URL: 'postgres://user:pass@localhost/db' },
    })
    const response = parseResponse(await handler({
      httpMethod: 'GET',
      headers: {
        authorization: 'Bearer secret',
        'x-request-id': 'req-secret',
      },
    }))

    expect(response.statusCode).toBe(500)
    expect(response.json.error).toEqual({
      code: 'internal_error',
      message: 'request failed',
      requestId: 'req-secret',
    })
    expect(JSON.stringify(response.json)).not.toContain('postgres://')
    expect(JSON.stringify(response.json)).not.toContain('stack')
    expect(redactSecrets({
      DATABASE_URL: 'postgres://user:pass@localhost/db',
      token: 'secret',
    })).toEqual({
      DATABASE_URL: '[REDACTED]',
      token: '[REDACTED]',
    })
    expect(writes.length).toBe(1)
  })

  it('keeps successful API responses on the standard contract with safe headers', async () => {
    const response = parseResponse(await submitPaperOrderHandler(postEvent(validOrder({ type: 'LIMIT' }), {
      'x-request-id': 'req-success',
    })))

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['x-request-id']).toBe('req-success')
    expect(response.json).toMatchObject({
      ok: true,
      data: {
        paperTrading: true,
        order: {
          symbol: 'AAPL',
        },
      },
    })
  })
})
