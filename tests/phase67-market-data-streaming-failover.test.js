import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createMarketDataAdapter, MARKET_DATA_ADAPTER_CHECKED_EVENT } from '../lib/market/marketDataAdapter.js'
import { normalizeMarketDataContracts } from '../lib/market/marketDataContractEngine.js'
import { prepareMarketDataCache } from '../lib/market/marketDataCacheEngine.js'
import { createMarketDataStreamingRepository, prepareMarketDataStreaming, MARKET_DATA_STREAMING_PREPARED_EVENT } from '../lib/market/marketDataStreamingEngine.js'
import { createMarketDataProviderFailoverRepository, evaluateMarketDataProviderFailover, MARKET_DATA_PROVIDER_FAILOVER_EVALUATED_EVENT } from '../lib/market/marketDataProviderFailoverEngine.js'
import { createMarketDataStreamingHandler } from '../netlify/functions/market-data-streaming.js'
import { createMarketDataProviderFailoverHandler } from '../netlify/functions/market-data-provider-failover.js'

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
      'x-request-id': 'req-phase67ab',
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

function upstream() {
  const adapter = createMarketDataAdapter()
  const marketDataAdapterHealth = { metadata: adapter.metadata, health: adapter.getProviderHealth(), eventType: MARKET_DATA_ADAPTER_CHECKED_EVENT }
  const scannerSignal = { quote: { symbol: 'SPY', assetType: 'etf', price: 525.15, open: 524.8, high: 526, low: 523.9, previousClose: 524.66, volume: 1240000, timestamp: '2026-07-13T10:00:00.000Z' } }
  const historicalReplay = {
    eventType: 'market.replay.stepPrepared',
    normalizedHistoricalCandles: Array.from({ length: 10 }, (_, index) => ({ symbol: 'SPY', assetType: 'etf', open: 520 + index, high: 521 + index, low: 519 + index, close: 520.5 + index, volume: 1000000 + index, interval: '1d', timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` })),
  }
  const marketDataContracts = normalizeMarketDataContracts({ tenantContext, marketDataAdapterHealth, scannerSignal, historicalReplay }, { emitEvent: false })
  const marketDataCache = prepareMarketDataCache({ tenantContext, marketDataContracts }, { emitEvent: false })
  const marketDataStreaming = prepareMarketDataStreaming({ tenantContext, marketDataContracts, marketDataAdapterHealth }, { emitEvent: false })
  const marketDataProviderFailover = evaluateMarketDataProviderFailover({ tenantContext, marketDataAdapterHealth, marketDataCache, marketDataStreaming }, { emitEvent: false })
  return { marketDataAdapterHealth, marketDataContracts, marketDataCache, marketDataStreaming, marketDataProviderFailover }
}

describe('Phase 67A streaming market-data architecture', () => {
  it('adds idempotent streaming/failover migrations and parameterized streaming repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_streaming_configs')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_provider_failover')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataStreamingRepository({ database: { connected: true, query } })
    await repository.create({ id: 'streaming-1', tenantContext, streamingStatus: 'ready', streamingScore: 92 })
    await repository.list({ tenantContext, streamingStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares quote and candle streaming channels without live execution paths', () => {
    const result = upstream().marketDataStreaming
    expect(result.eventType).toBe(MARKET_DATA_STREAMING_PREPARED_EVENT)
    expect(result.marketDataStreamingConfigs[0].streamChannels.map((channel) => channel.dataType)).toEqual(expect.arrayContaining(['quote', 'candle']))
    expect(result.marketDataStreamingConfigs[0].connectionPolicy.externalProviderRequired).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.automaticTrading).toBe(false)
  })

  it('serves streaming APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createMarketDataStreamingHandler(options)(authEvent('GET')))
    const create = parseResponse(await createMarketDataStreamingHandler(options)(authEvent('POST', { streaming: { id: 'streaming-1' } })))
    const denied = parseResponse(await createMarketDataStreamingHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.marketDataStreaming.paperTrading).toBe(true)
    expect(create.json.data.streaming.liveOrders).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 67B provider failover and health monitoring', () => {
  it('evaluates provider health and failover readiness with parameterized repository access', async () => {
    const result = upstream().marketDataProviderFailover
    expect(result.eventType).toBe(MARKET_DATA_PROVIDER_FAILOVER_EVALUATED_EVENT)
    expect(result.marketDataProviderFailovers[0].providerHealthRegistry.length).toBeGreaterThan(1)
    expect(result.marketDataProviderFailovers[0].failoverPolicy.mockFallbackAllowed).toBe(true)
    expect(result.liveOrders).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataProviderFailoverRepository({ database: { connected: true, query } })
    await repository.create({ id: 'failover-1', tenantContext, failoverStatus: 'ready', failoverScore: 92 })
    await repository.list({ tenantContext, failoverStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves provider failover APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createMarketDataProviderFailoverHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createMarketDataProviderFailoverHandler(options)(authEvent('POST', { failover: { id: 'failover-1' } }, 'admin')))
    const denied = parseResponse(await createMarketDataProviderFailoverHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.marketDataProviderFailover.paperTrading).toBe(true)
    expect(create.json.data.failover.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps streaming and failover responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createMarketDataProviderFailoverHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
