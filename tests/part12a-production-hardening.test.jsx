import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createApiHandler } from '../netlify/functions/_shared/api.js'
import { validateEnvironment } from '../lib/config/environment.js'
import { AppError, ERROR_CODES, toPublicError } from '../lib/errors/appError.js'
import { createLogger, redactSecrets } from '../lib/logging/logger.js'
import {
  requireField,
  requireSymbol,
  validateAssetType,
  validateNumberBounds,
  validateOrderPayload,
  validatePagination,
} from '../lib/validation/requestValidators.js'
import { ErrorDisplay } from '../src/components/ErrorDisplay.jsx'

let root = null
let container = null

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 12A production hardening foundation', () => {
  it('creates safe AppError responses while retaining internal metadata', () => {
    const error = new AppError('broker_secret_failed', 'Token abc123 failed', {
      statusCode: 502,
      publicMessage: 'broker request failed',
      metadata: { token: 'abc123', accountId: 'acct-1' },
    })
    const publicError = toPublicError(error)

    expect(error.metadata.accountId).toBe('acct-1')
    expect(publicError).toEqual({
      statusCode: 502,
      code: 'broker_secret_failed',
      message: 'broker request failed',
    })
  })

  it('validates request symbols, asset types, required fields, pagination, bounds, and order payloads', () => {
    expect(requireSymbol('spy')).toEqual({ ok: true, symbol: 'SPY' })
    expect(requireSymbol('../spy').error.code).toBe('invalid_symbol')
    expect(validateAssetType('forex')).toEqual({ ok: true, assetType: 'forex' })
    expect(validateAssetType('bond').error.code).toBe('invalid_asset_type')
    expect(requireField({ symbol: 'AAPL' }, 'symbol')).toEqual({ ok: true, value: 'AAPL' })
    expect(requireField({}, 'symbol').error.code).toBe('required')
    expect(validatePagination({ page: '2', pageSize: '25' }).pagination).toMatchObject({
      page: 2,
      pageSize: 25,
      offset: 25,
      limit: 25,
    })
    expect(validateNumberBounds(101, { fieldName: 'risk', min: 0, max: 100 }).error.code).toBe('number_out_of_bounds')
    expect(validateOrderPayload({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
    }).order).toMatchObject({
      symbol: 'AAPL',
      assetType: 'equity',
    })
  })

  it('logs structured records and redacts secrets', () => {
    const writes = []
    const logger = createLogger({
      name: 'test',
      level: 'debug',
      sink: {
        log: (line) => writes.push(line),
        info: (line) => writes.push(line),
      },
      now: () => '2026-07-02T00:00:00.000Z',
    })

    const entry = logger.info('request received', {
      requestId: 'req-1',
      authorization: 'Bearer secret',
      nested: { apiKey: 'abc' },
    })

    expect(entry).toMatchObject({
      timestamp: '2026-07-02T00:00:00.000Z',
      level: 'info',
      logger: 'test',
      message: 'request received',
    })
    expect(entry.metadata.authorization).toBe('[REDACTED]')
    expect(entry.metadata.nested.apiKey).toBe('[REDACTED]')
    expect(JSON.parse(writes[0]).metadata.authorization).toBe('[REDACTED]')
    expect(redactSecrets({ password: 'pw', visible: 'ok' })).toEqual({
      password: '[REDACTED]',
      visible: 'ok',
    })
  })

  it('validates environment with local defaults and production config errors', () => {
    expect(validateEnvironment({}).tradingMode).toBe('paper')
    expect(() => validateEnvironment({ NODE_ENV: 'production', TRADING_MODE: 'paper' })).toThrow(AppError)
    expect(() => validateEnvironment({ TRADING_MODE: 'live' })).toThrow('unsupported trading mode configured')
    expect(validateEnvironment({
      NODE_ENV: 'production',
      TRADING_MODE: 'paper',
      DATABASE_URL: 'postgres://local/test',
    }).isProduction).toBe(true)
  })

  it('enforces API method validation, request ids, CORS headers, and JSON parsing failures', async () => {
    const logger = createLogger({ sink: { error: vi.fn(), log: vi.fn() } })
    const handler = createApiHandler(() => ({ value: 1 }), {
      allowedMethods: ['POST'],
      logger,
      env: { TRADING_MODE: 'paper' },
    })

    const methodFailure = parseResponse(await handler({ httpMethod: 'GET' }))
    const invalidJson = parseResponse(await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }))
    const success = parseResponse(await handler({
      httpMethod: 'POST',
      headers: { 'x-request-id': 'req-test' },
      body: JSON.stringify({ ok: true }),
    }))
    const options = await handler({ httpMethod: 'OPTIONS' })

    expect(methodFailure.statusCode).toBe(405)
    expect(methodFailure.json).toMatchObject({
      ok: false,
      error: {
        code: ERROR_CODES.METHOD_NOT_ALLOWED,
        message: 'method is not allowed',
        requestId: expect.any(String),
      },
    })
    expect(invalidJson.statusCode).toBe(400)
    expect(invalidJson.json.error.code).toBe(ERROR_CODES.INVALID_JSON)
    expect(success.headers['x-request-id']).toBe('req-test')
    expect(success.headers['access-control-allow-origin']).toBe('*')
    expect(options.statusCode).toBe(204)
  })

  it('renders a shared frontend error display with retry behavior', () => {
    const onRetry = vi.fn()
    renderWithRoot(<ErrorDisplay message="Unable to load orders" onRetry={onRetry} />)

    expect(container.textContent).toContain('Unable to load data')
    expect(container.textContent).toContain('Unable to load orders')

    act(() => {
      container.querySelector('button').click()
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
