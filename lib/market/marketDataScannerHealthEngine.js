import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_SCANNER_HEALTH_UPDATED_EVENT = 'marketDataScanner.health.updated'
export const MARKET_DATA_SCANNER_HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'critical'])

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function tenantScope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function ratio(n, d) {
  const denominator = Number(d) || 0
  return denominator <= 0 ? 0 : Number(((Number(n) || 0) / denominator).toFixed(4))
}

export function evaluateMarketDataScannerHealth(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const resilience = input.marketDataProviderResilience?.marketDataProviderResilienceSnapshot ?? input.marketDataProviderResilience ?? {}
  const scanner = input.scannerThroughput?.scannerThroughputSnapshot ?? input.scannerThroughput ?? {}
  const scannerSummary = scanner.scannerCycleSummary ?? {}
  const routingSummary = input.marketDataStreamingRouting?.marketDataStreamingRoutingSummary ?? {}
  const critical = !scope.organizationId || !scope.userId || resilience.healthStatus === 'critical' || scanner.cycleStatus === 'failed'
  const degraded = resilience.healthStatus === 'degraded' || ['partial', 'degraded'].includes(scanner.cycleStatus) || (routingSummary.stale ?? 0) > 0
  const healthStatus = critical ? 'critical' : degraded ? 'degraded' : 'healthy'
  const snapshot = {
    id: String(input.id ?? `market-data-scanner-health-${scope.organizationId ?? 'tenant'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    healthStatus,
    providerHealthSummary: {
      primaryProviderId: resilience.primaryProviderId ?? null,
      activeProviderId: resilience.activeProviderId ?? null,
      providerHealth: resilience.healthStatus ?? 'missing',
      circuitStates: (resilience.providerStates ?? []).slice(0, 12).map((provider) => ({ providerId: provider.id, circuitState: provider.circuitState })),
      failoverCount: resilience.failoverSummary?.failoverCount ?? 0,
      recoveryCount: resilience.failoverSummary?.recoveryCount ?? 0,
      timeoutRate: resilience.timeoutSummary?.timeoutRate ?? 0,
      staleResponseRate: resilience.timeoutSummary?.staleResponseRate ?? 0,
    },
    streamFreshnessSummary: {
      accepted: routingSummary.accepted ?? 0,
      stale: routingSummary.stale ?? 0,
      rejected: routingSummary.rejected ?? 0,
      duplicate: routingSummary.duplicate ?? 0,
    },
    scannerHealthSummary: {
      cycleStatus: scanner.cycleStatus ?? 'missing',
      queueDepth: scannerSummary.queueDepth ?? 0,
      cycleDurationMs: scannerSummary.cycleDurationMs ?? 0,
      throughputPerSecond: scannerSummary.throughputPerSecond ?? 0,
      deferredSymbols: scannerSummary.deferred ?? 0,
      staleSymbols: scannerSummary.stale ?? 0,
      failureRate: ratio(scannerSummary.failed, (scannerSummary.processed ?? 0) + (scannerSummary.failed ?? 0)),
      partialOrDegradedCycles: ['partial', 'degraded'].includes(scanner.cycleStatus) ? 1 : 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
  const result = {
    eventType: MARKET_DATA_SCANNER_HEALTH_UPDATED_EVENT,
    timestamp,
    marketDataScannerHealthSnapshot: snapshot,
    marketDataScannerHealthSummary: {
      healthStatus,
      activeProviderId: snapshot.providerHealthSummary.activeProviderId,
      scannerCycleStatus: snapshot.scannerHealthSummary.cycleStatus,
      queueDepth: snapshot.scannerHealthSummary.queueDepth,
      staleSymbols: snapshot.scannerHealthSummary.staleSymbols,
      deferredSymbols: snapshot.scannerHealthSummary.deferredSymbols,
    },
    healthStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Market-data and scanner health ${healthStatus}: provider ${snapshot.providerHealthSummary.activeProviderId ?? 'none'}, scanner cycle ${snapshot.scannerHealthSummary.cycleStatus}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_SCANNER_HEALTH_UPDATED_EVENT, result)
  return result
}

export function createMarketDataScannerHealthRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.marketDataScannerHealthSnapshot ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_market_data_scanner_health_snapshots
          (id, organization_id, team_workspace_id, account_id, health_status, snapshot_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET health_status = EXCLUDED.health_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.healthStatus, snapshot.createdAt, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, healthStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (healthStatus) { params.push(String(healthStatus)); clauses.push(`health_status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_scanner_health_snapshots
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY snapshot_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
