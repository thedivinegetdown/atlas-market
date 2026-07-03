import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createApiHandler } from '../netlify/functions/_shared/api.js'
import { handler as healthHandler } from '../netlify/functions/health.js'
import { createLogger } from '../lib/logging/logger.js'
import { createEventLogger, TRADING_EVENTS } from '../lib/observability/eventLogger.js'
import { createReadinessService } from '../lib/observability/readiness.js'
import { DiagnosticsPanel } from '../src/components/panels.jsx'

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

describe('Part 12C observability and health monitoring', () => {
  it('returns successful health output with request id and paper trading status', async () => {
    const response = parseResponse(await healthHandler({
      httpMethod: 'GET',
      headers: { 'x-request-id': 'req-health' },
    }))

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-request-id']).toBe('req-health')
    expect(response.json).toMatchObject({
      ok: true,
      data: {
        requestId: 'req-health',
        status: expect.any(String),
        checks: {
          environment: expect.any(Object),
          database: expect.any(Object),
          marketData: expect.any(Object),
          paperTrading: {
            enabled: true,
          },
        },
      },
    })
    expect(response.json.data.timestamp).toEqual(expect.any(String))
  })

  it('returns degraded readiness when optional market data fails', async () => {
    const readiness = createReadinessService({
      env: { TRADING_MODE: 'paper' },
      marketDataService: {
        async getQuote() {
          throw new Error('provider down')
        },
      },
      now: () => '2026-07-02T00:00:00.000Z',
    })

    const result = await readiness.check({ requestId: 'req-degraded' })

    expect(result).toMatchObject({
      status: 'degraded',
      requestId: 'req-degraded',
      timestamp: '2026-07-02T00:00:00.000Z',
      checks: {
        marketData: {
          status: 'degraded',
          provider: 'unavailable',
        },
      },
    })
  })

  it('handles database check failures without exposing secrets', async () => {
    const readiness = createReadinessService({
      env: {
        TRADING_MODE: 'paper',
        DATABASE_URL: 'postgres://user:pass@localhost/db',
      },
      pgClientFactory: () => ({
        connected: true,
        async query() {
          throw new Error('postgres://user:pass@localhost/db failed')
        },
        async end() {},
      }),
      marketDataService: {
        async getQuote() {
          return {
            provider: 'mock',
            health: { available: true, provider: 'mock' },
          }
        },
      },
    })

    const result = await readiness.check({ requestId: 'req-db' })
    const serialized = JSON.stringify(result)

    expect(result.status).toBe('degraded')
    expect(result.checks.database).toMatchObject({
      status: 'degraded',
      connected: false,
    })
    expect(serialized).not.toContain('postgres://')
    expect(serialized).not.toContain('user:pass')
  })

  it('does not leak database connection strings from the health function', async () => {
    const handler = createApiHandler(({ requestId }) => {
      return createReadinessService({
        env: {
          TRADING_MODE: 'paper',
          DATABASE_URL: 'postgres://user:pass@localhost/db',
        },
        pgClientFactory: () => ({
          connected: true,
          async query() {
            throw new Error('postgres://user:pass@localhost/db failed')
          },
          async end() {},
        }),
        marketDataService: {
          async getQuote() {
            return {
              provider: 'mock',
              health: { available: true, provider: 'mock' },
            }
          },
        },
      }).check({ requestId })
    }, {
      env: { TRADING_MODE: 'paper' },
      logger: createLogger({ sink: { error: vi.fn(), log: vi.fn() } }),
    })

    const response = parseResponse(await handler({
      httpMethod: 'GET',
      headers: { 'x-request-id': 'req-health-safe' },
    }))

    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toContain('postgres://')
    expect(JSON.stringify(response.json)).not.toContain('user:pass')
  })

  it('writes structured trading event logs with request ids and redaction', () => {
    const writes = []
    const eventLogger = createEventLogger({
      logger: createLogger({
        name: 'events-test',
        sink: {
          info: (line) => writes.push(line),
          log: (line) => writes.push(line),
        },
        now: () => '2026-07-02T00:00:00.000Z',
      }),
    })

    eventLogger.log(TRADING_EVENTS.ORDER_SUBMITTED, {
      requestId: 'req-order',
      orderId: 'order-1',
      DATABASE_URL: 'postgres://user:pass@localhost/db',
    })

    const entry = JSON.parse(writes[0])
    expect(entry).toMatchObject({
      level: 'info',
      message: 'atlas trading event',
      metadata: {
        eventType: TRADING_EVENTS.ORDER_SUBMITTED,
        requestId: 'req-order',
        orderId: 'order-1',
        DATABASE_URL: '[REDACTED]',
      },
    })
  })

  it('renders diagnostics panel with API status, paper mode, sync time, and errors', () => {
    renderWithRoot(
      <DiagnosticsPanel
        healthState={{
          apiStatus: 'degraded',
          lastSuccessfulSync: '2026-07-02T12:00:00.000Z',
          lastError: 'provider down',
          paperTradingEnabled: true,
          isLoading: false,
          refresh: vi.fn(),
        }}
      />
    )

    expect(container.textContent).toContain('System Diagnostics')
    expect(container.textContent).toContain('API Status')
    expect(container.textContent).toContain('degraded')
    expect(container.textContent).toContain('Paper Trading')
    expect(container.textContent).toContain('Enabled')
    expect(container.textContent).toContain('provider down')
  })

  it('loads diagnostics through the API-backed health panel hook', async () => {
    renderWithRoot(<DiagnosticsPanel />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('System Diagnostics')
    expect(container.textContent).toContain('Paper Trading')
    expect(container.textContent).toContain('Enabled')
  })
})
