import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  createMarketDataWebSocketAdapterRepository,
  evaluateMarketDataWebSocketAdapter,
  MARKET_DATA_WEBSOCKET_ADAPTER_EVALUATED_EVENT,
} from '../lib/market/marketDataWebSocketAdapterEngine.js'
import {
  buildDefaultStreamingProviderAdapters,
  createMockWebSocketProviderAdapter,
  createReferenceWebSocketProviderAdapter,
} from '../lib/market/marketDataStreamingProviderAdapters.js'
import {
  createMarketDataStreamingEventRoutingRepository,
  routeMarketDataStreamingEvents,
  MARKET_DATA_STREAMING_EVENT_ROUTED_EVENT,
} from '../lib/market/marketDataStreamingEventRouter.js'
import { createMarketDataProviderCapabilitiesHandler } from '../netlify/functions/market-data-provider-capabilities.js'
import { createMarketDataProviderAdapterHealthHandler } from '../netlify/functions/market-data-provider-adapter-health.js'
import { createMarketDataStreamingRoutingHealthHandler } from '../netlify/functions/market-data-streaming-routing-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase67fgh',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'analyst') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

describe('Phase 67F provider WebSocket adapter contract', () => {
  it('adds idempotent adapter/routing migrations and parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_websocket_adapters')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_streaming_event_routes')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [] }))
    const adapterRepository = createMarketDataWebSocketAdapterRepository({ database: { connected: true, query } })
    await adapterRepository.create({ id: 'adapter-1', tenantContext, adapterStatus: 'ready', adapterScore: 92 })
    await adapterRepository.list({ tenantContext, adapterStatus: 'ready' })
    const routeRepository = createMarketDataStreamingEventRoutingRepository({ database: { connected: true, query } })
    await routeRepository.create({ id: 'route-1', tenantContext, routingStatus: 'accepted', providerEvent: { symbol: 'SPY', channel: 'quote', sequence: 1 } })
    await routeRepository.list({ tenantContext, routingStatus: 'accepted' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('normalizes adapter lifecycle, capability metadata, acknowledgements, errors, and bounded reconnect state', () => {
    const mock = createMockWebSocketProviderAdapter({ timestamp: '2026-07-13T10:20:00.000Z', maxReconnectAttempts: 3 })
    mock.initialize()
    mock.connect()
    const subscription = mock.subscribe({ channel: 'quote', symbols: ['SPY'] })
    mock.reconnect()
    mock.reconnect()
    mock.reconnect()
    mock.reconnect()

    const result = evaluateMarketDataWebSocketAdapter({
      tenantContext,
      marketDataWebSocketAdapters: [{
        capabilityMetadata: mock.metadata,
        adapterStatus: 'ready',
        adapterScore: 94,
        lifecycleState: { initialized: true, connected: true, heartbeatHealthy: true },
        reconnectPolicy: { reconnectAttempts: 9, maxReconnectAttempts: 3 },
        subscriptionAcknowledgements: subscription.acknowledgements,
        providerEvents: subscription.providerEvents,
      }],
    }, { emitEvent: false })

    expect(result.eventType).toBe(MARKET_DATA_WEBSOCKET_ADAPTER_EVALUATED_EVENT)
    expect(result.marketDataWebSocketAdapters[0].capabilityMetadata.lifecycle).toContain('heartbeat')
    expect(result.marketDataWebSocketAdapters[0].reconnectPolicy.reconnectAttempts).toBe(3)
    expect(result.marketDataWebSocketAdapterSummary.totalAcknowledgements).toBe(1)
    expect(result.liveOrders).toBe(false)
  })
})

describe('Phase 67G mock and reference streaming provider adapters', () => {
  it('keeps the mock provider default and reference provider disabled without explicit configuration', () => {
    const [mock, reference] = buildDefaultStreamingProviderAdapters({ env: {} })
    expect(mock.metadata.mockMode).toBe(true)
    expect(mock.metadata.configured).toBe(true)
    expect(reference.metadata.mockMode).toBe(false)
    expect(reference.metadata.configured).toBe(false)
    expect(reference.connect()).toMatchObject({ ok: false, disabled: true })
    expect(JSON.stringify(reference.connect())).not.toMatch(/token|secret|apiKey/i)
  })

  it('simulates quote, candle, heartbeat, reconnect, stale, duplicate, and out-of-order provider events deterministically', () => {
    const mock = createMockWebSocketProviderAdapter({ timestamp: '2026-07-13T10:20:00.000Z' })
    mock.connect()
    const quote = mock.subscribe({ channel: 'quote', symbols: ['SPY'] })
    const candle = mock.subscribe({ channel: 'candle', symbols: ['SPY'] })
    const simulated = mock.simulateEvents({ channel: 'quote', symbols: ['SPY'] })
    expect(quote.providerEvents[0].channel).toBe('quote')
    expect(candle.providerEvents[0].channel).toBe('candle')
    expect(mock.heartbeat()).toMatchObject({ heartbeatHealthy: true })
    expect(mock.reconnect().boundedReconnect).toBe(true)
    expect(simulated.some((event) => event.stale)).toBe(true)
    expect(simulated.some((event) => event.duplicate)).toBe(true)
    expect(simulated.some((event) => event.outOfOrder)).toBe(true)
  })

  it('allows reference adapter activation only with explicit environment-style configuration', () => {
    const disabled = createReferenceWebSocketProviderAdapter({})
    const enabled = createReferenceWebSocketProviderAdapter({ endpoint: 'configured-endpoint-ref', tokenRef: 'configured-token-ref', enabled: true })
    expect(disabled.metadata.configured).toBe(false)
    expect(enabled.metadata.configured).toBe(true)
    expect(enabled.connect()).toMatchObject({ ok: true, connected: true })
    expect(JSON.stringify(enabled)).not.toMatch(/configured-token-ref|configured-endpoint-ref/)
  })
})

describe('Phase 67H streaming event normalization and routing', () => {
  it('normalizes provider quote/candle events and routes duplicate, stale, and out-of-order events deterministically', () => {
    const mock = createMockWebSocketProviderAdapter({ timestamp: '2026-07-13T10:20:00.000Z' })
    const events = [
      ...mock.simulateEvents({ channel: 'quote', symbols: ['SPY'] }),
      ...mock.simulateEvents({ channel: 'candle', symbols: ['SPY'], includeStale: false, includeDuplicate: false, includeOutOfOrder: false }),
    ]
    const result = routeMarketDataStreamingEvents({ tenantContext, providerEvents: events }, { emitEvent: false, timestamp: '2026-07-13T10:20:30.000Z' })
    expect(result.eventType).toBe(MARKET_DATA_STREAMING_EVENT_ROUTED_EVENT)
    expect(result.marketDataStreamingRoutingSummary.accepted).toBeGreaterThan(0)
    expect(result.marketDataStreamingRoutingSummary.duplicate).toBeGreaterThan(0)
    expect(result.marketDataStreamingRoutingSummary.stale).toBeGreaterThan(0)
    expect(result.marketDataStreamingRoutingSummary.outOfOrderEvents).toBeGreaterThan(0)
    expect(result.marketDataStreamingRoutes.some((route) => route.normalizedQuote?.symbol === 'SPY')).toBe(true)
    expect(result.marketDataStreamingRoutes.some((route) => route.normalizedCandle?.symbol === 'SPY')).toBe(true)
  })

  it('serves tenant-scoped adapter and routing APIs without exposing secrets', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('viewer'), env: { TRADING_MODE: 'paper' } }
    const capabilities = parseResponse(await createMarketDataProviderCapabilitiesHandler(options)(authEvent('GET', {}, 'viewer')))
    const health = parseResponse(await createMarketDataProviderAdapterHealthHandler(options)(authEvent('GET', {}, 'viewer')))
    const routing = parseResponse(await createMarketDataStreamingRoutingHealthHandler(options)(authEvent('GET', {}, 'viewer')))
    const deniedWrite = parseResponse(await createMarketDataStreamingRoutingHealthHandler(options)(authEvent('POST', { route: {} }, 'viewer')))
    expect([capabilities.statusCode, health.statusCode, routing.statusCode]).toEqual([200, 200, 200])
    expect(deniedWrite.statusCode).toBe(403)
    const publicPayload = JSON.stringify({ capabilities: capabilities.json, health: health.json, routing: routing.json })
    expect(publicPayload).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey/i)
    expect(routing.json.data.liveOrders).toBe(false)
    expect(routing.json.data.brokerExecution).toBe(false)
  })
})
