import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createMockWebSocketProviderAdapter } from '../lib/market/marketDataStreamingProviderAdapters.js'
import { routeMarketDataStreamingEvents } from '../lib/market/marketDataStreamingEventRouter.js'
import { createRealtimeScannerRepository, evaluateRealtimeScanner, SCANNER_REALTIME_EVALUATED_EVENT } from '../lib/scanners/realTimeScannerOrchestrator.js'
import { createRealtimeSignalEvaluationRepository, evaluateRealtimeSignals, SIGNAL_REALTIME_EVALUATED_EVENT } from '../lib/signals/realTimeSignalEvaluationEngine.js'
import { createRealtimeAlertRepository, createRealtimeAlerts, updateRealtimeAlertLifecycle, ALERTS_REALTIME_CREATED_EVENT, ALERTS_REALTIME_UPDATED_EVENT } from '../lib/alerts/realTimeAlertPipeline.js'
import { createRealtimeScannerStatusHandler } from '../netlify/functions/realtime-scanner-status.js'
import { createRealtimeSignalEvaluationsHandler } from '../netlify/functions/realtime-signal-evaluations.js'
import { createRealtimeAlertsHandler } from '../netlify/functions/realtime-alerts.js'
import { createRealtimeAlertStatusUpdateHandler } from '../netlify/functions/realtime-alert-status-update.js'
import { createRealtimeScannerAlertOperationsHealthHandler } from '../netlify/functions/realtime-scanner-alert-operations-health.js'

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
      'x-request-id': 'req-phase68',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'analyst') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function routedEvents() {
  const mock = createMockWebSocketProviderAdapter({ timestamp: '2026-07-13T10:40:00.000Z' })
  return routeMarketDataStreamingEvents({
    tenantContext,
    providerEvents: mock.simulateEvents({ channel: 'quote', symbols: ['SPY'] }),
  }, { emitEvent: false, timestamp: '2026-07-13T10:40:30.000Z' })
}

function realtimeScannerFixture() {
  return evaluateRealtimeScanner({
    tenantContext,
    marketDataStreamingRouting: routedEvents(),
    scannerSubscriptions: [{
      id: 'scanner-rt-1',
      name: 'Real-time Momentum',
      assetType: 'etf',
      symbols: ['SPY'],
      criteria: [{ type: 'price_above', threshold: 1 }, { type: 'risk_acceptable' }],
    }],
  }, { emitEvent: false, timestamp: '2026-07-13T10:41:00.000Z' })
}

function realtimeSignalsFixture() {
  return evaluateRealtimeSignals({
    tenantContext,
    realtimeScanner: realtimeScannerFixture(),
    researchSignalScore: { eventType: 'research.signalScore.evaluated', decisionBias: 'bullish' },
    marketRegimeClassification: { eventType: 'market.regime.classified', riskRegime: { regime: 'risk-on' } },
    portfolioRisk: { eventType: 'portfolio.risk.evaluated', summary: { riskLevel: 'low' } },
    strategyRuleEvaluation: { eventType: 'strategy.rules.evaluated', strategyEvaluationStatus: 'eligible' },
    strategySignalComposition: { eventType: 'strategy.signal.composed', signalStatus: 'composed' },
    multiTimeframeResearchContext: { eventType: 'research.multiTimeframeContext.evaluated' },
  }, { emitEvent: false, timestamp: '2026-07-13T10:42:00.000Z' })
}

describe('Phase 68A real-time scanner orchestrator', () => {
  it('adds idempotent persistence and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_scanner_subscriptions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_signal_evaluations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_alerts')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const scannerRepository = createRealtimeScannerRepository({ database: { connected: true, query } })
    await scannerRepository.create({ id: 'scan-sub-1', tenantContext, symbols: ['SPY'] })
    await scannerRepository.list({ tenantContext })
    const signalRepository = createRealtimeSignalEvaluationRepository({ database: { connected: true, query } })
    await signalRepository.create({ id: 'signal-1', tenantContext, symbol: 'SPY', signalStatus: 'qualified', signalConfidence: 90 })
    await signalRepository.list({ tenantContext, signalStatus: 'qualified', symbol: 'SPY' })
    const alertRepository = createRealtimeAlertRepository({ database: { connected: true, query } })
    await alertRepository.create({ id: 'alert-1', tenantContext, symbol: 'SPY', severity: 'high', lifecycle: 'open' })
    await alertRepository.list({ tenantContext, lifecycle: 'open', symbol: 'SPY' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates accepted routed quote events and blocks stale/rejected/duplicate scanner work', () => {
    const scanner = realtimeScannerFixture()
    expect(scanner.eventType).toBe(SCANNER_REALTIME_EVALUATED_EVENT)
    expect(scanner.realtimeScannerSummary.candidates).toBeGreaterThan(0)
    expect(scanner.realtimeScannerSummary.staleBlocked).toBeGreaterThan(0)
    expect(scanner.realtimeScannerSummary.duplicateSuppressed).toBeGreaterThan(0)
    expect(scanner.scannerDebounceThrottlePolicy.maxEventsPerEvaluation).toBe(100)
    const blocked = evaluateRealtimeScanner({
      tenantContext,
      marketDataStreamingRouting: { marketDataStreamingRoutes: routedEvents().marketDataStreamingRoutes.filter((route) => route.routingStatus !== 'accepted') },
    }, { emitEvent: false })
    expect(blocked.realtimeScannerSummary.candidates).toBe(0)
  })
})

describe('Phase 68B real-time signal evaluation engine', () => {
  it('qualifies scanner candidates using strategy, research, regime, and risk references without execution', () => {
    const signals = realtimeSignalsFixture()
    expect(signals.eventType).toBe(SIGNAL_REALTIME_EVALUATED_EVENT)
    expect(signals.realtimeSignalSummary.qualified).toBeGreaterThan(0)
    expect(signals.realtimeSignalEvaluations[0].sourceEventReferences.length).toBeGreaterThan(0)
    expect(signals.liveOrders).toBe(false)
    expect(signals.brokerExecution).toBe(false)
  })

  it('rejects incomplete or high-risk market context', () => {
    const rejected = evaluateRealtimeSignals({
      tenantContext,
      realtimeScanner: realtimeScannerFixture(),
      researchSignalScore: { decisionBias: 'avoid' },
      marketRegimeClassification: { riskRegime: { regime: 'risk-off' } },
      portfolioRisk: { summary: { riskLevel: 'blocked' } },
      strategyRuleEvaluation: { strategyEvaluationStatus: 'blocked' },
    }, { emitEvent: false })
    expect(rejected.realtimeSignalSummary.rejected).toBeGreaterThan(0)
  })
})

describe('Phase 68C real-time alert pipeline', () => {
  it('creates alerts from qualified/watchlist signals with cooldown and deduplication controls', () => {
    const realtimeSignals = realtimeSignalsFixture()
    const first = createRealtimeAlerts({ tenantContext, realtimeSignals }, { emitEvent: false, timestamp: '2026-07-13T10:43:00.000Z' })
    const duplicate = createRealtimeAlerts({ tenantContext, realtimeSignals, existingAlerts: first.realtimeAlerts }, { emitEvent: false, timestamp: '2026-07-13T10:43:30.000Z' })
    expect(first.eventType).toBe(ALERTS_REALTIME_CREATED_EVENT)
    expect(first.realtimeAlertSummary.total).toBeGreaterThan(0)
    expect(first.realtimeAlerts[0].cooldownUntil).toBeTruthy()
    expect(duplicate.realtimeAlertSummary.total).toBe(0)
    const updated = updateRealtimeAlertLifecycle({ tenantContext, id: first.realtimeAlerts[0].id, lifecycle: 'acknowledged' }, { emitEvent: false })
    expect(updated.eventType).toBe(ALERTS_REALTIME_UPDATED_EVENT)
    expect(updated.realtimeAlert.lifecycle).toBe('acknowledged')
  })

  it('serves tenant-scoped APIs with viewer read-only and analyst update access', async () => {
    const realtimeScanner = realtimeScannerFixture()
    const realtimeSignals = realtimeSignalsFixture()
    const realtimeAlerts = createRealtimeAlerts({ tenantContext, realtimeSignals }, { emitEvent: false })
    const viewerOptions = { repositoryFactory, organizationMembershipRepository: membershipRepository('viewer'), realtimeScanner, realtimeSignals, realtimeAlerts, env: { TRADING_MODE: 'paper' } }
    const scanner = parseResponse(await createRealtimeScannerStatusHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const signals = parseResponse(await createRealtimeSignalEvaluationsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const alerts = parseResponse(await createRealtimeAlertsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const operations = parseResponse(await createRealtimeScannerAlertOperationsHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const deniedWrite = parseResponse(await createRealtimeAlertsHandler(viewerOptions)(authEvent('POST', { alert: {} }, 'viewer')))
    const analystUpdate = parseResponse(await createRealtimeAlertStatusUpdateHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { id: 'alert-1', lifecycle: 'acknowledged' }, 'analyst')))
    const crossTenant = parseResponse(await createRealtimeScannerStatusHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([scanner.statusCode, signals.statusCode, alerts.statusCode, operations.statusCode]).toEqual([200, 200, 200, 200])
    expect(deniedWrite.statusCode).toBe(403)
    expect(analystUpdate.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
    expect(JSON.stringify({ scanner: scanner.json, signals: signals.json, alerts: alerts.json })).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey/i)
  })
})
