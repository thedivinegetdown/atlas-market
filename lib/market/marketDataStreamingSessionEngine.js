import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_STREAMING_SESSION_EVALUATED_EVENT = 'marketData.streamingSession.evaluated'
export const MARKET_DATA_STREAMING_SESSION_STATUSES = Object.freeze(['connecting', 'active', 'degraded', 'reconnecting', 'stopped'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_STREAMING_SESSION_STATUSES.includes(status) ? status : 'degraded'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeSubscription(subscription = {}, index = 0) {
  return {
    id: String(subscription.id ?? `stream-subscription-${index + 1}`).slice(0, 120),
    channelId: String(subscription.channelId ?? subscription.id ?? 'quote-stream-primary').slice(0, 120),
    dataType: String(subscription.dataType ?? 'quote').toLowerCase().slice(0, 40),
    symbols: (subscription.symbols ?? ['SPY']).slice(0, 64).map((symbol) => String(symbol).toUpperCase().slice(0, 24)),
    provider: String(subscription.provider ?? 'mock-market-data-adapter').slice(0, 120),
    active: subscription.active !== false,
  }
}

export function normalizeMarketDataStreamingSessionRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const subscriptions = (input.channelSubscriptions ?? input.subscriptions ?? []).slice(0, 48).map(normalizeSubscription)
  const maxReconnectAttempts = Math.max(1, Math.min(20, Number(input.reconnectState?.maxReconnectAttempts ?? input.connectionPolicy?.maxReconnectAttempts ?? 5)))
  const reconnectAttempts = Math.max(0, Math.min(maxReconnectAttempts, Number(input.reconnectState?.reconnectAttempts ?? 0)))
  return {
    id: String(input.id ?? `market-data-streaming-session-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    sessionStatus: safeStatus(input.sessionStatus ?? input.status),
    sessionScore: clampScore(input.sessionScore),
    activeProviderId: String(input.activeProviderId ?? 'mock-market-data-adapter').slice(0, 120),
    channelSubscriptions: subscriptions,
    reconnectState: {
      reconnectAttempts,
      maxReconnectAttempts,
      reconnectBackoffMs: Math.max(1000, Number(input.reconnectState?.reconnectBackoffMs ?? input.connectionPolicy?.reconnectBackoffMs ?? 3000)),
      boundedReconnect: reconnectAttempts <= maxReconnectAttempts,
      nextReconnectAt: input.reconnectState?.nextReconnectAt ?? null,
    },
    heartbeatMonitoring: {
      heartbeatMs: Math.max(1000, Number(input.heartbeatMonitoring?.heartbeatMs ?? input.connectionPolicy?.heartbeatMs ?? 15000)),
      lastHeartbeatAt: input.heartbeatMonitoring?.lastHeartbeatAt ?? now,
      missedHeartbeats: Math.max(0, Number(input.heartbeatMonitoring?.missedHeartbeats ?? 0)),
      heartbeatHealthy: input.heartbeatMonitoring?.heartbeatHealthy ?? Number(input.heartbeatMonitoring?.missedHeartbeats ?? 0) === 0,
    },
    backpressureStatus: {
      status: String(input.backpressureStatus?.status ?? 'healthy').toLowerCase().slice(0, 40),
      queuedMessages: Math.max(0, Number(input.backpressureStatus?.queuedMessages ?? 0)),
      maxQueueDepth: Math.max(1, Number(input.backpressureStatus?.maxQueueDepth ?? 1000)),
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

export function createMarketDataStreamingSessionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const session = normalizeMarketDataStreamingSessionRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, session }
      const result = await database.query(
        `INSERT INTO atlas_market_data_streaming_sessions
          (id, organization_id, team_workspace_id, session_status, session_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET session_status = EXCLUDED.session_status, session_score = EXCLUDED.session_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [session.id, session.tenantScope.organizationId, session.tenantScope.teamWorkspaceId, session.sessionStatus, session.sessionScore, session],
      )
      return { ok: true, session: normalizeMarketDataStreamingSessionRecord(result.rows?.[0]?.payload ?? session) }
    },
    async list({ tenantContext = {}, sessionStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (sessionStatus) {
        params.push(safeStatus(sessionStatus))
        clauses.push(`session_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_streaming_sessions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataStreamingSessionRecord(row.payload))
    },
  }
}

export function evaluateMarketDataStreamingSession(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataStreamingSessions ?? input.marketDataStreamingSession ?? []
  const streaming = input.marketDataStreaming ?? {}
  const failover = input.marketDataProviderFailover ?? {}
  const firstStreaming = streaming.marketDataStreamingConfigs?.[0] ?? streaming
  const firstFailover = failover.marketDataProviderFailovers?.[0] ?? failover
  const subscriptions = (firstStreaming.streamChannels ?? []).map((channel) => ({
    id: `subscription-${channel.id}`,
    channelId: channel.id,
    dataType: channel.dataType,
    symbols: channel.symbols,
    provider: channel.provider,
  }))
  const missedHeartbeats = Number(input.heartbeatMonitoring?.missedHeartbeats ?? 0)
  const reconnectAttempts = Number(input.reconnectState?.reconnectAttempts ?? 0)
  const maxReconnectAttempts = Number(input.reconnectState?.maxReconnectAttempts ?? firstStreaming.connectionPolicy?.maxReconnectAttempts ?? 5)
  const providerReady = failover.marketDataProviderFailoverStatus !== 'blocked'
  const subscriptionReady = subscriptions.length > 0
  const heartbeatHealthy = missedHeartbeats === 0
  const boundedReconnect = reconnectAttempts <= maxReconnectAttempts
  const backpressureHealthy = Number(input.backpressureStatus?.queuedMessages ?? 0) < Number(input.backpressureStatus?.maxQueueDepth ?? 1000)
  const score = Math.round([
    providerReady ? 90 : 45,
    subscriptionReady ? 90 : 50,
    heartbeatHealthy ? 90 : 65,
    boundedReconnect ? 90 : 40,
    backpressureHealthy ? 90 : 65,
  ].reduce((sum, item) => sum + item, 0) / 5)
  const sessionStatus = !subscriptionReady
    ? 'connecting'
    : !boundedReconnect
      ? 'stopped'
      : !heartbeatHealthy
        ? 'reconnecting'
        : score >= 85
          ? 'active'
          : 'degraded'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const sessions = (sourceItems.length ? sourceItems : [normalizeMarketDataStreamingSessionRecord({
    tenantContext,
    sessionStatus,
    sessionScore: score,
    activeProviderId: firstFailover.activeProviderId,
    channelSubscriptions: subscriptions,
    reconnectState: {
      reconnectAttempts,
      maxReconnectAttempts,
      reconnectBackoffMs: firstStreaming.connectionPolicy?.reconnectBackoffMs,
    },
    heartbeatMonitoring: {
      heartbeatMs: firstStreaming.connectionPolicy?.heartbeatMs,
      missedHeartbeats,
      heartbeatHealthy,
    },
    backpressureStatus: input.backpressureStatus,
    sourceReferences: [
      { id: 'market-data-streaming', type: 'market-data-streaming', eventType: streaming.eventType },
      { id: 'market-data-provider-failover', type: 'market-data-provider-failover', eventType: failover.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataStreamingSessionRecord)
  const marketDataStreamingSessionSummary = {
    total: sessions.length,
    active: sessions.filter((item) => item.sessionStatus === 'active').length,
    degraded: sessions.filter((item) => item.sessionStatus === 'degraded').length,
    reconnecting: sessions.filter((item) => item.sessionStatus === 'reconnecting').length,
    stopped: sessions.filter((item) => item.sessionStatus === 'stopped').length,
    totalSubscriptions: sessions.reduce((sum, item) => sum + item.channelSubscriptions.length, 0),
    totalReconnectAttempts: sessions.reduce((sum, item) => sum + item.reconnectState.reconnectAttempts, 0),
    averageSessionScore: sessions.length ? Math.round(sessions.reduce((sum, item) => sum + item.sessionScore, 0) / sessions.length) : 0,
  }
  const marketDataStreamingSessionStatus = marketDataStreamingSessionSummary.stopped > 0
    ? 'stopped'
    : marketDataStreamingSessionSummary.reconnecting > 0
      ? 'reconnecting'
      : marketDataStreamingSessionSummary.degraded > 0
        ? 'degraded'
        : 'active'
  const result = {
    eventType: MARKET_DATA_STREAMING_SESSION_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataStreamingSessions: sessions,
    marketDataStreamingSessionSummary,
    marketDataStreamingSessionStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data streaming session ${marketDataStreamingSessionStatus}: ${marketDataStreamingSessionSummary.totalSubscriptions} subscriptions and ${marketDataStreamingSessionSummary.totalReconnectAttempts} bounded reconnect attempts tracked.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_STREAMING_SESSION_EVALUATED_EVENT, result)
  return result
}
