import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createMarketDataAdapter, MARKET_DATA_ADAPTER_CHECKED_EVENT } from '../lib/market/marketDataAdapter.js'
import { createMarketDataContractRepository, normalizeMarketDataContracts, MARKET_DATA_CONTRACTS_NORMALIZED_EVENT } from '../lib/market/marketDataContractEngine.js'
import { createMarketDataCacheRepository, prepareMarketDataCache, MARKET_DATA_CACHE_PREPARED_EVENT } from '../lib/market/marketDataCacheEngine.js'
import { createMarketDataContractsHandler } from '../netlify/functions/market-data-contracts.js'
import { createMarketDataCacheHandler } from '../netlify/functions/market-data-cache.js'

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
      'x-request-id': 'req-phase66ab',
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
  const scannerSignal = {
    quote: {
      symbol: 'SPY',
      assetType: 'etf',
      price: 525.15,
      open: 524.8,
      high: 526,
      low: 523.9,
      previousClose: 524.66,
      change: 0.49,
      changePercent: 0.09,
      volume: 1240000,
      timestamp: '2026-07-13T10:00:00.000Z',
    },
  }
  const historicalReplay = {
    eventType: 'market.replay.stepPrepared',
    normalizedHistoricalCandles: Array.from({ length: 24 }, (_, index) => ({
      symbol: 'SPY',
      assetType: 'etf',
      open: 520 + index,
      high: 521 + index,
      low: 519 + index,
      close: 520.5 + index,
      volume: 1000000 + index,
      interval: '1d',
      timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })),
  }
  const marketDataContracts = normalizeMarketDataContracts({ tenantContext, marketDataAdapterHealth, scannerSignal, historicalReplay }, { emitEvent: false })
  const marketDataCache = prepareMarketDataCache({ tenantContext, marketDataContracts }, { emitEvent: false })
  return { marketDataAdapterHealth, scannerSignal, historicalReplay, marketDataContracts, marketDataCache }
}

describe('Phase 66A normalized market-data contracts', () => {
  it('adds idempotent market-data contract/cache migration and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_contracts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_cache_snapshots')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataContractRepository({ database: { connected: true, query } })
    await repository.create({ id: 'market-contract-1', tenantContext, contractStatus: 'ready', contractScore: 92 })
    await repository.list({ tenantContext, contractStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('normalizes quote, candle, request, and symbol metadata contracts without execution paths', () => {
    const result = upstream().marketDataContracts
    expect(result.eventType).toBe(MARKET_DATA_CONTRACTS_NORMALIZED_EVENT)
    expect(result.marketDataContracts[0].normalizedRequests.length).toBeGreaterThan(1)
    expect(result.marketDataContracts[0].normalizedQuotes[0]).toMatchObject({ symbol: 'SPY', provider: 'mock-market-data-adapter' })
    expect(result.marketDataContracts[0].normalizedCandles.length).toBeGreaterThan(10)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.automaticTrading).toBe(false)
  })

  it('serves market-data contract APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createMarketDataContractsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createMarketDataContractsHandler(options)(authEvent('POST', { contract: { id: 'market-contract-1' } })))
    const denied = parseResponse(await createMarketDataContractsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.marketDataContracts.paperTrading).toBe(true)
    expect(create.json.data.contract.liveOrders).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 66B quote and candle cache readiness', () => {
  it('prepares quote and candle cache entries with stale-data handling', async () => {
    const result = upstream().marketDataCache
    expect(result.eventType).toBe(MARKET_DATA_CACHE_PREPARED_EVENT)
    expect(result.marketDataCaches[0].cacheEntries.length).toBeGreaterThan(10)
    expect(result.marketDataCaches[0].cachePolicy.localFallbackReady).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataCacheRepository({ database: { connected: true, query } })
    await repository.create({ id: 'market-cache-1', tenantContext, cacheStatus: 'ready', cacheScore: 92 })
    await repository.list({ tenantContext, cacheStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves market-data cache APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createMarketDataCacheHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createMarketDataCacheHandler(options)(authEvent('POST', { cache: { id: 'market-cache-1' } }, 'admin')))
    const denied = parseResponse(await createMarketDataCacheHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.marketDataCache.paperTrading).toBe(true)
    expect(create.json.data.cache.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps market-data platform API responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createMarketDataCacheHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
