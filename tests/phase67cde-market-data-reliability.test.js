import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createMarketDataAdapter, MARKET_DATA_ADAPTER_CHECKED_EVENT } from '../lib/market/marketDataAdapter.js'
import { normalizeMarketDataContracts } from '../lib/market/marketDataContractEngine.js'
import { prepareMarketDataCache } from '../lib/market/marketDataCacheEngine.js'
import { prepareMarketDataStreaming } from '../lib/market/marketDataStreamingEngine.js'
import { evaluateMarketDataProviderFailover } from '../lib/market/marketDataProviderFailoverEngine.js'
import { createMarketDataStreamingSessionRepository, evaluateMarketDataStreamingSession, MARKET_DATA_STREAMING_SESSION_EVALUATED_EVENT } from '../lib/market/marketDataStreamingSessionEngine.js'
import { createMarketDataFreshnessGapRecoveryRepository, evaluateMarketDataFreshnessGapRecovery, MARKET_DATA_GAP_RECOVERY_EVALUATED_EVENT } from '../lib/market/marketDataFreshnessGapRecoveryEngine.js'
import { evaluateMarketDataStreamingOperations, MARKET_DATA_STREAMING_OPERATIONS_EVALUATED_EVENT } from '../lib/market/marketDataStreamingOperationsEngine.js'
import { createMarketDataStreamingSessionsHandler } from '../netlify/functions/market-data-streaming-sessions.js'
import { createMarketDataFreshnessHandler } from '../netlify/functions/market-data-freshness.js'
import { createMarketDataStreamingOperationsHandler } from '../netlify/functions/market-data-streaming-operations.js'

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
      'x-request-id': 'req-phase67cde',
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
    normalizedHistoricalCandles: Array.from({ length: 8 }, (_, index) => ({ symbol: 'SPY', assetType: 'etf', open: 520 + index, high: 521 + index, low: 519 + index, close: 520.5 + index, volume: 1000000 + index, interval: '1d', timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` })),
  }
  const marketDataContracts = normalizeMarketDataContracts({ tenantContext, marketDataAdapterHealth, scannerSignal, historicalReplay }, { emitEvent: false, timestamp: '2026-07-13T10:00:00.000Z' })
  const marketDataCache = prepareMarketDataCache({ tenantContext, marketDataContracts }, { emitEvent: false, timestamp: '2026-07-13T10:01:00.000Z' })
  const marketDataStreaming = prepareMarketDataStreaming({ tenantContext, marketDataContracts, marketDataAdapterHealth }, { emitEvent: false, timestamp: '2026-07-13T10:02:00.000Z' })
  const marketDataProviderFailover = evaluateMarketDataProviderFailover({ tenantContext, marketDataAdapterHealth, marketDataCache, marketDataStreaming }, { emitEvent: false, timestamp: '2026-07-13T10:03:00.000Z' })
  const marketDataStreamingSession = evaluateMarketDataStreamingSession({ tenantContext, marketDataStreaming, marketDataProviderFailover }, { emitEvent: false, timestamp: '2026-07-13T10:04:00.000Z' })
  const marketDataGapRecovery = evaluateMarketDataFreshnessGapRecovery({ tenantContext, marketDataCache, historicalReplay }, { emitEvent: false, timestamp: '2026-07-13T10:05:00.000Z' })
  const marketDataStreamingOperations = evaluateMarketDataStreamingOperations({ tenantContext, marketDataStreamingSession, marketDataProviderFailover, marketDataStreaming, marketDataGapRecovery, marketDataCache }, { emitEvent: false, timestamp: '2026-07-13T10:06:00.000Z' })
  return { marketDataAdapterHealth, marketDataContracts, marketDataCache, marketDataStreaming, marketDataProviderFailover, marketDataStreamingSession, marketDataGapRecovery, marketDataStreamingOperations, historicalReplay }
}

describe('Phase 67C streaming session coordinator', () => {
  it('adds idempotent session/recovery migrations and parameterized session repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_streaming_sessions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_gap_recovery')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataStreamingSessionRepository({ database: { connected: true, query } })
    await repository.create({ id: 'session-1', tenantContext, sessionStatus: 'active', sessionScore: 92 })
    await repository.list({ tenantContext, sessionStatus: 'active' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('coordinates subscriptions, heartbeat, backpressure, and bounded reconnect state', () => {
    const result = evaluateMarketDataStreamingSession({
      tenantContext,
      marketDataStreaming: upstream().marketDataStreaming,
      marketDataProviderFailover: upstream().marketDataProviderFailover,
      reconnectState: { reconnectAttempts: 2, maxReconnectAttempts: 3 },
      heartbeatMonitoring: { missedHeartbeats: 1 },
      backpressureStatus: { queuedMessages: 5, maxQueueDepth: 1000 },
    }, { emitEvent: false })
    expect(result.eventType).toBe(MARKET_DATA_STREAMING_SESSION_EVALUATED_EVENT)
    expect(result.marketDataStreamingSessions[0].reconnectState.boundedReconnect).toBe(true)
    expect(result.marketDataStreamingSessions[0].channelSubscriptions.length).toBeGreaterThan(0)
    expect(result.marketDataStreamingSessionStatus).toBe('reconnecting')
    expect(result.liveOrders).toBe(false)
  })

  it('stops sessions when reconnect attempts exceed configured bounds', () => {
    const result = evaluateMarketDataStreamingSession({
      tenantContext,
      marketDataStreaming: upstream().marketDataStreaming,
      marketDataProviderFailover: upstream().marketDataProviderFailover,
      reconnectState: { reconnectAttempts: 9, maxReconnectAttempts: 3 },
    }, { emitEvent: false })
    expect(result.marketDataStreamingSessions[0].reconnectState.reconnectAttempts).toBe(3)
    expect(result.marketDataStreamingSessionStatus).toBe('stopped')
  })
})

describe('Phase 67D market data freshness and gap recovery', () => {
  it('detects stale, duplicate, out-of-order, missing candle, and sequence-gap scenarios', async () => {
    const events = [
      { id: 'e1', symbol: 'SPY', dataType: 'quote', sequence: 1, timestamp: '2026-07-13T10:00:00.000Z' },
      { id: 'e3', symbol: 'SPY', dataType: 'quote', sequence: 3, timestamp: '2026-07-13T10:00:01.000Z' },
      { id: 'e2', symbol: 'SPY', dataType: 'quote', sequence: 2, timestamp: '2026-07-13T09:00:00.000Z' },
      { id: 'e3dup', symbol: 'SPY', dataType: 'quote', sequence: 3, timestamp: '2026-07-13T10:00:02.000Z' },
      { id: 'c1', symbol: 'SPY', dataType: 'candle', sequence: 1, timestamp: '2026-07-13T10:00:00.000Z' },
      { id: 'c4', symbol: 'SPY', dataType: 'candle', sequence: 4, timestamp: '2026-07-13T10:05:00.000Z' },
    ]
    const result = evaluateMarketDataFreshnessGapRecovery({
      tenantContext,
      marketDataEvents: events,
      freshnessThresholds: { quoteFreshnessMs: 1000, candleFreshnessMs: 1000 },
    }, { emitEvent: false, timestamp: '2026-07-13T10:10:00.000Z' })
    expect(result.eventType).toBe(MARKET_DATA_GAP_RECOVERY_EVALUATED_EVENT)
    expect(result.marketDataGapRecoverySummary.sequenceGaps).toBeGreaterThan(0)
    expect(result.marketDataGapRecoverySummary.duplicateEvents).toBeGreaterThan(0)
    expect(result.marketDataGapRecoverySummary.outOfOrderEvents).toBeGreaterThan(0)
    expect(result.marketDataGapRecoveries[0].missingCandleDetection.missingCount).toBeGreaterThan(0)
    expect(result.marketDataGapRecoveries[0].cacheReconciliationPlan.safeOverwriteNewerData).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createMarketDataFreshnessGapRecoveryRepository({ database: { connected: true, query } })
    await repository.create({ id: 'recovery-1', tenantContext, recoveryStatus: 'recovering', recoveryScore: 70 })
    await repository.list({ tenantContext, recoveryStatus: 'recovering' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })
})

describe('Phase 67E streaming operations command center', () => {
  it('summarizes sessions, failover, freshness, reconnects, subscriptions, gaps, and cache fallback', () => {
    const source = upstream()
    const result = source.marketDataStreamingOperations
    expect(result.eventType).toBe(MARKET_DATA_STREAMING_OPERATIONS_EVALUATED_EVENT)
    expect(result.activeSessionSummary.activeSessions).toBeGreaterThan(0)
    expect(result.providerHealthSummary.healthyProviders).toBeGreaterThan(0)
    expect(result.subscriptionSummary.totalSubscriptions).toBeGreaterThan(0)
    expect(result.localCacheFallbackSummary.cachedEntries).toBeGreaterThan(0)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('serves reliability APIs to trading desk roles only and denies viewers', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const session = parseResponse(await createMarketDataStreamingSessionsHandler(options)(authEvent('GET')))
    const freshness = parseResponse(await createMarketDataFreshnessHandler(options)(authEvent('GET')))
    const operations = parseResponse(await createMarketDataStreamingOperationsHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createMarketDataStreamingOperationsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([session.statusCode, freshness.statusCode, operations.statusCode]).toEqual([200, 200, 200])
    expect(operations.json.data.marketDataStreamingOperations.paperTrading).toBe(true)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createMarketDataStreamingOperationsHandler(options)(authEvent('GET', {}, 'admin')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
