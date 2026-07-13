import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_WEBSOCKET_ADAPTER_EVALUATED_EVENT = 'marketData.websocketAdapter.evaluated'
export const MARKET_DATA_WEBSOCKET_LIFECYCLE = Object.freeze(['initialize', 'connect', 'subscribe', 'unsubscribe', 'heartbeat', 'reconnect', 'disconnect'])
export const MARKET_DATA_WEBSOCKET_ADAPTER_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_WEBSOCKET_ADAPTER_STATUSES.includes(status) ? status : 'caution'
}

function normalizeCapabilityMetadata(input = {}) {
  return {
    providerId: String(input.providerId ?? input.id ?? 'mock-websocket-market-data').slice(0, 120),
    providerName: String(input.providerName ?? input.name ?? 'Mock WebSocket Market Data Provider').slice(0, 160),
    assetTypes: (input.assetTypes ?? ['equity', 'etf', 'crypto', 'forex']).slice(0, 20).map((item) => String(item).toLowerCase().slice(0, 40)),
    channels: (input.channels ?? ['quote', 'candle']).slice(0, 20).map((item) => String(item).toLowerCase().slice(0, 40)),
    lifecycle: (input.lifecycle ?? MARKET_DATA_WEBSOCKET_LIFECYCLE).filter((item) => MARKET_DATA_WEBSOCKET_LIFECYCLE.includes(item)),
    mockMode: input.mockMode !== false,
    configured: input.configured !== false,
    disabledByDefault: input.disabledByDefault === true,
  }
}

export function normalizeProviderStreamingEvent(event = {}, index = 0) {
  const timestamp = getNowIso(event.timestamp ?? event.updatedAt)
  return {
    id: String(event.id ?? `provider-event-${index + 1}`).slice(0, 160),
    providerId: String(event.providerId ?? event.provider ?? 'mock-websocket-market-data').slice(0, 120),
    eventType: String(event.eventType ?? event.type ?? 'quote').toLowerCase().slice(0, 80),
    channel: String(event.channel ?? event.dataType ?? event.eventType ?? 'quote').toLowerCase().slice(0, 80),
    symbol: String(event.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : index + 1,
    timestamp,
    payload: event.payload ?? event.data ?? event,
    stale: event.stale === true,
    duplicate: event.duplicate === true,
    outOfOrder: event.outOfOrder === true,
  }
}

export function normalizeProviderError(error = {}, providerId = 'mock-websocket-market-data') {
  if (!error) return null
  return {
    providerId: String(error.providerId ?? providerId).slice(0, 120),
    code: String(error.code ?? error.error ?? 'provider_stream_error').slice(0, 100),
    message: String(error.publicMessage ?? error.message ?? 'Provider streaming adapter reported an error').slice(0, 240),
    retryable: error.retryable !== false,
    safeForPublicResponse: true,
  }
}

export function normalizeSubscriptionAcknowledgement(ack = {}, index = 0) {
  return {
    id: String(ack.id ?? `subscription-ack-${index + 1}`).slice(0, 140),
    providerId: String(ack.providerId ?? ack.provider ?? 'mock-websocket-market-data').slice(0, 120),
    channel: String(ack.channel ?? ack.dataType ?? 'quote').toLowerCase().slice(0, 80),
    symbols: (ack.symbols ?? ['SPY']).slice(0, 64).map((symbol) => String(symbol).toUpperCase().slice(0, 24)),
    acknowledged: ack.acknowledged !== false,
    timestamp: getNowIso(ack.timestamp),
  }
}

export function normalizeMarketDataWebSocketAdapterRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const capabilityMetadata = normalizeCapabilityMetadata(input.capabilityMetadata ?? input.metadata)
  const maxReconnectAttempts = Math.max(1, Math.min(20, Number(input.reconnectPolicy?.maxReconnectAttempts ?? 5)))
  const reconnectAttempts = Math.max(0, Math.min(maxReconnectAttempts, Number(input.reconnectPolicy?.reconnectAttempts ?? 0)))
  const errors = (input.providerErrors ?? input.errors ?? []).slice(0, 20).map((error) => normalizeProviderError(error, capabilityMetadata.providerId)).filter(Boolean)
  const acknowledgements = (input.subscriptionAcknowledgements ?? input.acknowledgements ?? []).slice(0, 48).map(normalizeSubscriptionAcknowledgement)
  return {
    id: String(input.id ?? `market-data-websocket-adapter-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    adapterStatus: safeStatus(input.adapterStatus ?? input.status),
    adapterScore: clampScore(input.adapterScore),
    capabilityMetadata,
    lifecycleState: {
      initialized: input.lifecycleState?.initialized !== false,
      connected: input.lifecycleState?.connected === true,
      heartbeatHealthy: input.lifecycleState?.heartbeatHealthy !== false,
      disconnected: input.lifecycleState?.disconnected === true,
    },
    reconnectPolicy: {
      reconnectAttempts,
      maxReconnectAttempts,
      reconnectBackoffMs: Math.max(1000, Number(input.reconnectPolicy?.reconnectBackoffMs ?? 3000)),
      boundedReconnect: reconnectAttempts <= maxReconnectAttempts,
    },
    providerEvents: (input.providerEvents ?? []).slice(0, 500).map(normalizeProviderStreamingEvent),
    providerErrors: errors,
    subscriptionAcknowledgements: acknowledgements,
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

export function createMarketDataWebSocketAdapterRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const adapter = normalizeMarketDataWebSocketAdapterRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, adapter }
      const result = await database.query(
        `INSERT INTO atlas_market_data_websocket_adapters
          (id, organization_id, team_workspace_id, adapter_status, adapter_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET adapter_status = EXCLUDED.adapter_status, adapter_score = EXCLUDED.adapter_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [adapter.id, adapter.tenantScope.organizationId, adapter.tenantScope.teamWorkspaceId, adapter.adapterStatus, adapter.adapterScore, adapter],
      )
      return { ok: true, adapter: normalizeMarketDataWebSocketAdapterRecord(result.rows?.[0]?.payload ?? adapter) }
    },
    async list({ tenantContext = {}, adapterStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (adapterStatus) {
        params.push(safeStatus(adapterStatus))
        clauses.push(`adapter_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_websocket_adapters
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataWebSocketAdapterRecord(row.payload))
    },
  }
}

export function evaluateMarketDataWebSocketAdapter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataWebSocketAdapters ?? input.marketDataWebSocketAdapter ?? []
  const adapters = (Array.isArray(supplied) && supplied.length ? supplied : [normalizeMarketDataWebSocketAdapterRecord({
    tenantContext,
    adapterStatus: 'ready',
    adapterScore: 92,
    metadata: input.adapter?.metadata ?? input.capabilityMetadata,
    lifecycleState: input.adapter?.lifecycleState,
    reconnectPolicy: input.reconnectPolicy,
    providerEvents: input.providerEvents,
    subscriptionAcknowledgements: input.subscriptionAcknowledgements,
    errors: input.providerErrors,
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataWebSocketAdapterRecord)
  const summary = {
    total: adapters.length,
    ready: adapters.filter((item) => item.adapterStatus === 'ready').length,
    caution: adapters.filter((item) => item.adapterStatus === 'caution').length,
    blocked: adapters.filter((item) => item.adapterStatus === 'blocked').length,
    mockAdapters: adapters.filter((item) => item.capabilityMetadata.mockMode).length,
    configuredReferenceAdapters: adapters.filter((item) => !item.capabilityMetadata.mockMode && item.capabilityMetadata.configured).length,
    totalAcknowledgements: adapters.reduce((sum, item) => sum + item.subscriptionAcknowledgements.length, 0),
    providerErrors: adapters.reduce((sum, item) => sum + item.providerErrors.length, 0),
    averageAdapterScore: adapters.length ? Math.round(adapters.reduce((sum, item) => sum + item.adapterScore, 0) / adapters.length) : 0,
  }
  const marketDataWebSocketAdapterStatus = summary.blocked > 0 ? 'blocked' : summary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: MARKET_DATA_WEBSOCKET_ADAPTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataWebSocketAdapters: adapters,
    marketDataWebSocketAdapterSummary: summary,
    marketDataWebSocketAdapterStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data WebSocket adapters ${marketDataWebSocketAdapterStatus}: ${summary.total} adapters, ${summary.totalAcknowledgements} acknowledgements, and ${summary.providerErrors} safe provider errors reviewed.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_WEBSOCKET_ADAPTER_EVALUATED_EVENT, result)
  return result
}
