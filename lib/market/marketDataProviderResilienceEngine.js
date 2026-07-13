import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_PROVIDER_DEGRADED_EVENT = 'marketData.provider.degraded'
export const MARKET_DATA_PROVIDER_FAILED_OVER_EVENT = 'marketData.provider.failedOver'
export const MARKET_DATA_PROVIDER_RECOVERED_EVENT = 'marketData.provider.recovered'
export const MARKET_DATA_RESILIENCE_UPDATED_EVENT = 'marketData.resilience.updated'
export const MARKET_DATA_CIRCUIT_STATES = Object.freeze(['closed', 'open', 'half-open'])
export const MARKET_DATA_RESILIENCE_STATES = Object.freeze(['healthy', 'degraded', 'critical'])

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

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function ageMs(value, now) {
  const then = new Date(value ?? now).getTime()
  const current = new Date(now).getTime()
  return Number.isFinite(then) && Number.isFinite(current) ? Math.max(0, current - then) : 0
}

function provider(input = {}, index = 0) {
  return {
    id: String(input.id ?? input.providerId ?? `provider-${index + 1}`).slice(0, 100),
    name: String(input.name ?? input.id ?? input.providerId ?? `Provider ${index + 1}`).slice(0, 140),
    priority: Math.max(1, Number(input.priority ?? index + 1)),
    status: String(input.status ?? input.healthStatus ?? 'healthy').toLowerCase(),
    available: input.available !== false,
    failures: Math.max(0, Number(input.failures ?? input.failureCount ?? 0)),
    timeouts: Math.max(0, Number(input.timeouts ?? input.timeoutCount ?? 0)),
    staleResponses: Math.max(0, Number(input.staleResponses ?? input.staleResponseCount ?? 0)),
    lastSuccessAt: input.lastSuccessAt ?? input.lastSuccessfulSync ?? null,
    lastFailureAt: input.lastFailureAt ?? null,
    previousCircuitState: input.previousCircuitState ?? input.circuitState ?? null,
    mockMode: input.mockMode !== false,
    capabilities: (input.capabilities ?? ['quotes', 'candles']).slice(0, 12).map(String),
  }
}

function circuitState(item, policy, timestamp) {
  const previous = item.previousCircuitState ?? item.circuitState
  const failures = numberValue(item.failures) + numberValue(item.timeouts)
  if (previous === 'open' && ageMs(item.lastFailureAt, timestamp) >= policy.recoveryWindowMs) return 'half-open'
  if (failures >= policy.failureThreshold || item.staleResponses >= policy.staleResponseThreshold || !item.available || item.status === 'blocked') return 'open'
  return 'closed'
}

export function evaluateMarketDataProviderResilience(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const policy = {
    failureThreshold: Math.max(1, Number(input.policy?.failureThreshold ?? 3)),
    staleResponseThreshold: Math.max(1, Number(input.policy?.staleResponseThreshold ?? 2)),
    timeoutMs: Math.max(100, Number(input.policy?.timeoutMs ?? 2500)),
    recoveryWindowMs: Math.max(1000, Number(input.policy?.recoveryWindowMs ?? 60000)),
    staleAfterMs: Math.max(1000, Number(input.policy?.staleAfterMs ?? 300000)),
  }
  const providerInputs = (input.providers ?? input.marketDataProviderFailover?.marketDataProviderFailovers?.[0]?.providerHealthRegistry ?? []).slice(0, 12)
  const providers = (providerInputs.length ? providerInputs : [
    { id: 'mock-market-data-adapter', priority: 1, status: input.marketDataAdapterHealth?.health?.status ?? 'healthy', available: input.marketDataAdapterHealth?.health?.available !== false, lastSuccessAt: input.marketDataAdapterHealth?.health?.lastSuccessfulSync },
    { id: 'local-cache-fallback', priority: 2, status: input.marketDataCache?.marketDataCacheStatus ?? 'ready', available: input.marketDataCache?.marketDataCacheStatus !== 'blocked', capabilities: ['quotes', 'candles', 'cache'] },
  ]).map(provider).sort((a, b) => a.priority - b.priority)
  const providerStates = providers.map((item) => {
    const stale = item.lastSuccessAt ? ageMs(item.lastSuccessAt, timestamp) > policy.staleAfterMs : false
    const circuit = circuitState({ ...item, staleResponses: item.staleResponses + (stale ? 1 : 0) }, policy, timestamp)
    return { ...item, stale, circuitState: circuit, usable: circuit !== 'open' && item.available && !stale }
  })
  const primaryProvider = providerStates[0] ?? null
  const activeProvider = providerStates.find((item) => item.usable) ?? null
  const failoverCount = primaryProvider && activeProvider && primaryProvider.id !== activeProvider.id ? 1 : 0
  const recoveryCount = providerStates.filter((item) => item.circuitState === 'half-open').length
  const allUnavailable = !activeProvider
  const healthStatus = allUnavailable ? 'critical' : failoverCount > 0 || providerStates.some((item) => item.circuitState !== 'closed' || item.stale) ? 'degraded' : 'healthy'
  const eventType = allUnavailable
    ? MARKET_DATA_PROVIDER_DEGRADED_EVENT
    : failoverCount > 0
      ? MARKET_DATA_PROVIDER_FAILED_OVER_EVENT
      : recoveryCount > 0
        ? MARKET_DATA_PROVIDER_RECOVERED_EVENT
        : MARKET_DATA_RESILIENCE_UPDATED_EVENT
  const snapshot = {
    id: String(input.id ?? `market-data-provider-resilience-${scope.organizationId ?? 'tenant'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    healthStatus,
    primaryProviderId: primaryProvider?.id ?? null,
    activeProviderId: activeProvider?.id ?? null,
    providerStates,
    circuitBreakerPolicy: policy,
    failoverSummary: {
      failoverCount,
      recoveryCount,
      allProvidersUnavailable: allUnavailable,
      degradedProviders: providerStates.filter((item) => item.circuitState !== 'closed' || item.stale).length,
    },
    timeoutSummary: {
      timeoutRate: providerStates.length ? Number((providerStates.reduce((sum, item) => sum + item.timeouts, 0) / providerStates.length).toFixed(4)) : 0,
      staleResponseRate: providerStates.length ? Number((providerStates.reduce((sum, item) => sum + item.staleResponses + (item.stale ? 1 : 0), 0) / providerStates.length).toFixed(4)) : 0,
    },
    correlationReference: input.correlationReference ?? `market-data-resilience:${scope.organizationId ?? 'tenant'}:${Date.parse(timestamp) || Date.now()}`,
    idempotencyReference: input.idempotencyReference ?? `${primaryProvider?.id ?? 'none'}:${activeProvider?.id ?? 'none'}:${healthStatus}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    providerSensitiveMaterialExposed: false,
  }
  const result = {
    eventType,
    timestamp,
    marketDataProviderResilienceSnapshot: snapshot,
    marketDataProviderResilienceSummary: {
      healthStatus,
      primaryProviderId: snapshot.primaryProviderId,
      activeProviderId: snapshot.activeProviderId,
      failoverCount,
      recoveryCount,
      providerCount: providerStates.length,
    },
    healthStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Market-data provider resilience ${healthStatus}: active provider ${snapshot.activeProviderId ?? 'none'}, failovers ${failoverCount}, recoveries ${recoveryCount}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(eventType, result)
  return result
}

export function createMarketDataProviderResilienceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.marketDataProviderResilienceSnapshot ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_market_data_provider_resilience_snapshots
          (id, organization_id, team_workspace_id, account_id, provider_id, circuit_state, health_status, snapshot_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET circuit_state = EXCLUDED.circuit_state, health_status = EXCLUDED.health_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.activeProviderId, snapshot.providerStates?.find((item) => item.id === snapshot.activeProviderId)?.circuitState ?? 'open', snapshot.healthStatus, snapshot.createdAt, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, healthStatus, providerId, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (healthStatus) { params.push(String(healthStatus)); clauses.push(`health_status = $${params.length}`) }
      if (providerId) { params.push(String(providerId)); clauses.push(`provider_id = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_provider_resilience_snapshots
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY snapshot_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
