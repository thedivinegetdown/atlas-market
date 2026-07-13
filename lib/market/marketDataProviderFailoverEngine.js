import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_PROVIDER_FAILOVER_EVALUATED_EVENT = 'market.providerFailover.evaluated'
export const MARKET_DATA_PROVIDER_FAILOVER_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_PROVIDER_FAILOVER_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeProvider(provider = {}, index = 0) {
  return {
    id: String(provider.id ?? provider.provider ?? `provider-${index + 1}`).slice(0, 100),
    name: String(provider.name ?? provider.id ?? provider.provider ?? 'Market Data Provider').slice(0, 140),
    priority: Math.max(1, Number(provider.priority ?? index + 1)),
    status: String(provider.status ?? 'healthy').toLowerCase().slice(0, 40),
    available: provider.available !== false,
    mockMode: provider.mockMode !== false,
    capabilities: (provider.capabilities ?? ['quotes', 'candles']).slice(0, 12).map((capability) => String(capability).slice(0, 80)),
    lastSuccessfulSync: provider.lastSuccessfulSync ?? null,
    lastError: provider.lastError ?? null,
  }
}

export function normalizeMarketDataProviderFailoverRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const providers = (input.providerHealthRegistry ?? input.providers ?? []).slice(0, 12).map(normalizeProvider)
  return {
    id: String(input.id ?? `market-data-provider-failover-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    failoverStatus: safeStatus(input.failoverStatus ?? input.status),
    failoverScore: clampScore(input.failoverScore),
    activeProviderId: String(input.activeProviderId ?? providers[0]?.id ?? 'mock-market-data-adapter').slice(0, 100),
    fallbackProviderId: input.fallbackProviderId ? String(input.fallbackProviderId).slice(0, 100) : null,
    providerHealthRegistry: providers,
    failoverPolicy: {
      healthCheckIntervalMs: Math.max(1000, Number(input.failoverPolicy?.healthCheckIntervalMs ?? 30000)),
      staleDataFailoverEnabled: input.failoverPolicy?.staleDataFailoverEnabled !== false,
      providerErrorFailoverEnabled: input.failoverPolicy?.providerErrorFailoverEnabled !== false,
      mockFallbackAllowed: input.failoverPolicy?.mockFallbackAllowed !== false,
    },
    healthMonitoringSummary: {
      healthyProviders: Math.max(0, Number(input.healthMonitoringSummary?.healthyProviders ?? providers.filter((provider) => provider.status === 'healthy' && provider.available).length)),
      degradedProviders: Math.max(0, Number(input.healthMonitoringSummary?.degradedProviders ?? providers.filter((provider) => provider.status !== 'healthy' || !provider.available).length)),
      failoverReady: input.healthMonitoringSummary?.failoverReady ?? providers.some((provider) => provider.available),
      staleDataDetected: input.healthMonitoringSummary?.staleDataDetected === true,
    },
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
  }
}

export function createMarketDataProviderFailoverRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const failover = normalizeMarketDataProviderFailoverRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, failover }
      const result = await database.query(
        `INSERT INTO atlas_market_data_provider_failover
          (id, organization_id, team_workspace_id, failover_status, failover_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET failover_status = EXCLUDED.failover_status, failover_score = EXCLUDED.failover_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [failover.id, failover.tenantScope.organizationId, failover.tenantScope.teamWorkspaceId, failover.failoverStatus, failover.failoverScore, failover],
      )
      return { ok: true, failover: normalizeMarketDataProviderFailoverRecord(result.rows?.[0]?.payload ?? failover) }
    },
    async list({ tenantContext = {}, failoverStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (failoverStatus) {
        params.push(safeStatus(failoverStatus))
        clauses.push(`failover_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_provider_failover
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataProviderFailoverRecord(row.payload))
    },
  }
}

export function evaluateMarketDataProviderFailover(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataProviderFailovers ?? input.marketDataProviderFailover ?? []
  const adapter = input.marketDataAdapterHealth ?? {}
  const cache = input.marketDataCache ?? {}
  const streaming = input.marketDataStreaming ?? {}
  const primaryProvider = {
    id: adapter.metadata?.id ?? adapter.health?.provider ?? 'mock-market-data-adapter',
    name: adapter.metadata?.name ?? 'Atlas Mock Market Data Adapter',
    priority: 1,
    status: adapter.health?.status ?? 'healthy',
    available: adapter.health?.available !== false,
    mockMode: adapter.metadata?.default !== false,
    capabilities: adapter.metadata?.capabilities ?? ['quotes', 'candles'],
    lastSuccessfulSync: adapter.health?.lastSuccessfulSync,
    lastError: adapter.health?.lastError,
  }
  const fallbackProvider = {
    id: 'local-cache-fallback',
    name: 'Local Quote/Candle Cache Fallback',
    priority: 2,
    status: cache.marketDataCacheStatus ?? 'ready',
    available: cache.marketDataCacheStatus !== 'blocked',
    mockMode: true,
    capabilities: ['quotes', 'candles', 'cache'],
  }
  const staleDataDetected = (cache.marketDataCacheSummary?.staleEntries ?? 0) > 0 || adapter.health?.stale === true
  const providerScore = primaryProvider.status === 'healthy' && primaryProvider.available ? 90 : 65
  const fallbackScore = fallbackProvider.available ? 90 : 50
  const streamScore = streaming.marketDataStreamingStatus === 'ready' ? 90 : 70
  const score = Math.round((providerScore + fallbackScore + streamScore) / 3)
  const failoverStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const failovers = (sourceItems.length ? sourceItems : [normalizeMarketDataProviderFailoverRecord({
    tenantContext,
    failoverStatus,
    failoverScore: score,
    activeProviderId: primaryProvider.id,
    fallbackProviderId: fallbackProvider.id,
    providers: [primaryProvider, fallbackProvider],
    healthMonitoringSummary: {
      staleDataDetected,
      failoverReady: true,
    },
    sourceReferences: [
      { id: 'market-data-adapter', type: 'market-data-adapter', eventType: adapter.eventType },
      { id: 'market-data-cache', type: 'market-data-cache', eventType: cache.eventType },
      { id: 'market-data-streaming', type: 'market-data-streaming', eventType: streaming.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataProviderFailoverRecord)
  const marketDataProviderFailoverSummary = {
    total: failovers.length,
    ready: failovers.filter((item) => item.failoverStatus === 'ready').length,
    caution: failovers.filter((item) => item.failoverStatus === 'caution').length,
    blocked: failovers.filter((item) => item.failoverStatus === 'blocked').length,
    totalProviders: failovers.reduce((sum, item) => sum + item.providerHealthRegistry.length, 0),
    healthyProviders: failovers.reduce((sum, item) => sum + item.healthMonitoringSummary.healthyProviders, 0),
    degradedProviders: failovers.reduce((sum, item) => sum + item.healthMonitoringSummary.degradedProviders, 0),
    averageFailoverScore: failovers.length ? Math.round(failovers.reduce((sum, item) => sum + item.failoverScore, 0) / failovers.length) : 0,
  }
  const marketDataProviderFailoverStatus = marketDataProviderFailoverSummary.blocked > 0 ? 'blocked' : marketDataProviderFailoverSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: MARKET_DATA_PROVIDER_FAILOVER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataProviderFailovers: failovers,
    marketDataProviderFailoverSummary,
    marketDataProviderFailoverStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data provider failover ${marketDataProviderFailoverStatus}: ${marketDataProviderFailoverSummary.totalProviders} providers monitored with ${marketDataProviderFailoverSummary.healthyProviders} healthy providers.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_PROVIDER_FAILOVER_EVALUATED_EVENT, result)
  return result
}
