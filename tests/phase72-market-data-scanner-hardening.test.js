import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateMarketDataProviderResilience, createMarketDataProviderResilienceRepository, MARKET_DATA_PROVIDER_FAILED_OVER_EVENT, MARKET_DATA_PROVIDER_DEGRADED_EVENT, MARKET_DATA_PROVIDER_RECOVERED_EVENT } from '../lib/market/marketDataProviderResilienceEngine.js'
import { evaluateScannerThroughputBackpressure, createScannerThroughputRepository, SCANNER_CYCLE_COMPLETED_EVENT, SCANNER_CYCLE_DEGRADED_EVENT, SCANNER_BACKPRESSURE_UPDATED_EVENT } from '../lib/scanners/scannerThroughputBackpressureEngine.js'
import { evaluateMarketDataScannerHealth, createMarketDataScannerHealthRepository, MARKET_DATA_SCANNER_HEALTH_UPDATED_EVENT } from '../lib/market/marketDataScannerHealthEngine.js'
import { createMarketDataResilienceHandler } from '../netlify/functions/market-data-resilience.js'
import { createScannerProductionHealthHandler } from '../netlify/functions/scanner-production-health.js'
import { createMarketDataScannerHealthHandler } from '../netlify/functions/market-data-scanner-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase72',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function membershipRepository(role = 'analyst') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function providers(primaryFailures = 0, fallbackAvailable = true) {
  return [
    { id: 'primary-mock', priority: 1, status: primaryFailures > 0 ? 'degraded' : 'healthy', failures: primaryFailures, timeouts: primaryFailures, lastSuccessAt: '2026-07-13T14:00:00.000Z', lastFailureAt: '2026-07-13T14:00:30.000Z' },
    { id: 'fallback-cache', priority: 2, status: fallbackAvailable ? 'healthy' : 'blocked', available: fallbackAvailable, lastSuccessAt: '2026-07-13T14:00:00.000Z' },
  ]
}

describe('Phase 72A market data provider resilience', () => {
  it('adds idempotent compact persistence with parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_provider_resilience_snapshots')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_scanner_cycle_summaries')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_market_data_scanner_health_snapshots')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createMarketDataProviderResilienceRepository, createScannerThroughputRepository, createMarketDataScannerHealthRepository]) {
      const query = vi.fn(async () => ({ rows: [] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ id: 'phase72-record', tenantScope: tenantContext, accountId: 'paper-portfolio', healthStatus: 'healthy', cycleStatus: 'completed', createdAt: '2026-07-13T14:00:00.000Z' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('opens circuits, fails over, half-opens recovery, and handles all-provider failure without duplicate provider processing', () => {
    const failedOver = evaluateMarketDataProviderResilience({ tenantContext, providers: providers(4) }, { emitEvent: false, timestamp: '2026-07-13T14:01:00.000Z' })
    const recovered = evaluateMarketDataProviderResilience({ tenantContext, providers: [{ ...providers(4)[0], previousCircuitState: 'open', lastFailureAt: '2026-07-13T13:00:00.000Z' }, providers(0)[1]] }, { emitEvent: false, timestamp: '2026-07-13T14:02:00.000Z' })
    const critical = evaluateMarketDataProviderResilience({ tenantContext, providers: providers(5, false) }, { emitEvent: false, timestamp: '2026-07-13T14:03:00.000Z' })
    expect(failedOver.eventType).toBe(MARKET_DATA_PROVIDER_FAILED_OVER_EVENT)
    expect(failedOver.marketDataProviderResilienceSnapshot.providerStates[0].circuitState).toBe('open')
    expect(failedOver.marketDataProviderResilienceSummary.activeProviderId).toBe('fallback-cache')
    expect(recovered.eventType).toBe(MARKET_DATA_PROVIDER_RECOVERED_EVENT)
    expect(recovered.marketDataProviderResilienceSnapshot.providerStates[0].circuitState).toBe('half-open')
    expect(critical.eventType).toBe(MARKET_DATA_PROVIDER_DEGRADED_EVENT)
    expect(critical.healthStatus).toBe('critical')
    expect(new Set(failedOver.marketDataProviderResilienceSnapshot.providerStates.map((item) => item.id)).size).toBe(2)
  })

  it('rejects stale provider responses and keeps provider secrets out of public payloads', () => {
    const stale = evaluateMarketDataProviderResilience({ tenantContext, providers: [{ id: 'primary-mock', priority: 1, lastSuccessAt: '2026-07-13T13:00:00.000Z' }, { ...providers(0)[1], lastSuccessAt: '2026-07-13T14:04:00.000Z' }], policy: { staleAfterMs: 1000 } }, { emitEvent: false, timestamp: '2026-07-13T14:04:00.000Z' })
    expect(stale.healthStatus).toBe('degraded')
    expect(stale.marketDataProviderResilienceSnapshot.providerStates[0].stale).toBe(true)
    expect(JSON.stringify(stale)).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential|secret/i)
  })
})

describe('Phase 72B scanner throughput and backpressure', () => {
  it('bounds queue work, deduplicates symbols, applies fairness, and completes healthy cycles', () => {
    const result = evaluateScannerThroughputBackpressure({
      tenantContext,
      scannerSubscriptions: [
        { id: 'watchlist-a', symbols: ['SPY', 'QQQ', 'SPY'] },
        { id: 'watchlist-b', symbols: ['IWM', 'DIA'] },
      ],
      policy: { maxQueueSize: 10, concurrency: 4, maxPerCycle: 10, cycleDeadlineMs: 2000 },
    }, { emitEvent: false })
    expect(result.eventType).toBe(SCANNER_CYCLE_COMPLETED_EVENT)
    expect(result.scannerThroughputSummary.queued).toBe(4)
    expect(result.scannerThroughputSummary.deduplicated).toBeGreaterThan(0)
    expect(result.scannerThroughputSnapshot.fairnessSummary.length).toBe(2)
    expect(result.liveOrders).toBe(false)
  })

  it('enforces backpressure, deadlines, stale suppression, and retry limits without retry storms', () => {
    const result = evaluateScannerThroughputBackpressure({
      tenantContext,
      scanQueue: Array.from({ length: 20 }, (_, index) => ({ symbol: `SYM${index}`, groupId: index % 2 ? 'b' : 'a', timestamp: index < 2 ? '2026-07-13T13:00:00.000Z' : '2026-07-13T14:00:00.000Z', transientFailure: index > 2 && index < 6 })),
      policy: { maxQueueSize: 8, concurrency: 2, maxPerCycle: 4, cycleDeadlineMs: 100, staleAfterMs: 1000, retryLimit: 1 },
    }, { emitEvent: false, timestamp: '2026-07-13T14:05:00.000Z' })
    expect([SCANNER_CYCLE_DEGRADED_EVENT, SCANNER_BACKPRESSURE_UPDATED_EVENT]).toContain(result.eventType)
    expect(result.scannerThroughputSummary.deferred).toBeGreaterThan(0)
    expect(result.scannerThroughputSummary.stale).toBeGreaterThan(0)
    expect(result.scannerThroughputSummary.retried).toBeLessThanOrEqual(1)
  })
})

describe('Phase 72C market data and scanner production health', () => {
  it('aggregates provider resilience, scanner throughput, freshness, and health states', () => {
    const resilience = evaluateMarketDataProviderResilience({ tenantContext, providers: providers(4) }, { emitEvent: false, timestamp: '2026-07-13T14:05:00.000Z' })
    const scannerThroughput = evaluateScannerThroughputBackpressure({ tenantContext, scanQueue: [{ symbol: 'SPY' }, { symbol: 'QQQ' }], policy: { maxQueueSize: 10 } }, { emitEvent: false })
    const result = evaluateMarketDataScannerHealth({
      tenantContext,
      marketDataProviderResilience: resilience,
      scannerThroughput,
      marketDataStreamingRouting: { marketDataStreamingRoutingSummary: { accepted: 2, stale: 1, rejected: 0, duplicate: 0 } },
    }, { emitEvent: false })
    expect(result.eventType).toBe(MARKET_DATA_SCANNER_HEALTH_UPDATED_EVENT)
    expect(result.healthStatus).toBe('degraded')
    expect(result.marketDataScannerHealthSummary.activeProviderId).toBe('fallback-cache')
    expect(result.marketDataScannerHealthSnapshot.scannerHealthSummary.queueDepth).toBe(0)
    expect(result.paperTrading).toBe(true)
    expect(result.brokerExecution).toBe(false)
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst evaluation, and cross-tenant denial', async () => {
    const resilience = evaluateMarketDataProviderResilience({ tenantContext, providers: providers(4) }, { emitEvent: false })
    const scannerThroughput = evaluateScannerThroughputBackpressure({ tenantContext, symbols: ['SPY', 'QQQ'] }, { emitEvent: false })
    const marketDataScannerHealth = evaluateMarketDataScannerHealth({ tenantContext, marketDataProviderResilience: resilience, scannerThroughput }, { emitEvent: false })
    const viewerOptions = { database: { connected: false }, accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), marketDataProviderResilience: resilience, scannerThroughput, marketDataScannerHealth, providers: providers(0) }
    const resilienceRead = parseResponse(await createMarketDataResilienceHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const scannerRead = parseResponse(await createScannerProductionHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const healthRead = parseResponse(await createMarketDataScannerHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const viewerDenied = parseResponse(await createMarketDataResilienceHandler(viewerOptions)(authEvent('POST', { providers: providers(0) }, 'viewer')))
    const analystWrite = parseResponse(await createMarketDataScannerHealthHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { accountId: 'paper-portfolio', marketDataProviderResilience: resilience, scannerThroughput }, 'analyst')))
    const crossTenant = parseResponse(await createScannerProductionHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([resilienceRead.statusCode, scannerRead.statusCode, healthRead.statusCode]).toEqual([200, 200, 200])
    expect(viewerDenied.statusCode).toBe(403)
    expect(analystWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
