import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { normalizeCandle, normalizeQuote, isMarketDataStale } from './marketNormalizer.js'
import { normalizeProviderStreamingEvent } from './marketDataWebSocketAdapterEngine.js'

export const MARKET_DATA_STREAMING_EVENT_ROUTED_EVENT = 'marketData.streamingEvent.routed'
export const MARKET_DATA_STREAMING_ROUTING_STATUSES = Object.freeze(['accepted', 'duplicate', 'stale', 'rejected'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return MARKET_DATA_STREAMING_ROUTING_STATUSES.includes(status) ? status : 'rejected'
}

function fingerprint(event) {
  return [
    event.providerId,
    event.channel,
    event.symbol,
    event.sequence,
    event.timestamp,
  ].join(':')
}

function normalizeDomainPayload(event) {
  if (event.channel === 'candle') {
    return {
      dataType: 'candle',
      normalizedCandle: normalizeCandle(event.payload, event.providerId, {
        symbol: event.symbol,
        interval: event.payload?.interval,
      }),
    }
  }
  return {
    dataType: 'quote',
    normalizedQuote: normalizeQuote(event.payload, event.providerId, { symbol: event.symbol }),
  }
}

export function normalizeStreamingRouteRecord(input = {}, index = 0) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const providerEvent = normalizeProviderStreamingEvent(input.providerEvent ?? input.event ?? input, index)
  const payload = normalizeDomainPayload(providerEvent)
  const eventFingerprint = String(input.eventFingerprint ?? fingerprint(providerEvent)).slice(0, 260)
  const stale = input.routingStatus === 'stale'
    || providerEvent.stale === true
    || isMarketDataStale(providerEvent.timestamp, { now, staleAfterMs: Number(input.staleAfterMs ?? 90000) })
  const duplicate = input.routingStatus === 'duplicate' || providerEvent.duplicate === true
  const rejected = input.routingStatus === 'rejected' || !providerEvent.symbol || !['quote', 'candle'].includes(providerEvent.channel)
  const routingStatus = safeStatus(input.routingStatus ?? (rejected ? 'rejected' : duplicate ? 'duplicate' : stale ? 'stale' : 'accepted'))
  return {
    id: String(input.id ?? `market-data-streaming-route-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}-${index + 1}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    providerEvent,
    eventFingerprint,
    routingStatus,
    sequenceMetadata: {
      providerId: providerEvent.providerId,
      channel: providerEvent.channel,
      symbol: providerEvent.symbol,
      sequence: providerEvent.sequence,
      timestamp: providerEvent.timestamp,
      outOfOrder: providerEvent.outOfOrder === true,
    },
    ...payload,
    routingTargets: {
      cache: routingStatus === 'accepted',
      freshnessGapRecovery: true,
      streamingSessionCoordinator: true,
      failoverHealth: routingStatus !== 'accepted',
      scannerReadiness: routingStatus === 'accepted' && payload.dataType === 'quote',
    },
    routingReason: String(input.routingReason ?? (routingStatus === 'accepted' ? 'accepted-for-domain-routing' : `${routingStatus}-event-routed-to-operations-review`)).slice(0, 180),
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

export function createMarketDataStreamingEventRoutingRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const route = normalizeStreamingRouteRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, route }
      const result = await database.query(
        `INSERT INTO atlas_market_data_streaming_event_routes
          (id, organization_id, team_workspace_id, routing_status, event_fingerprint, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET routing_status = EXCLUDED.routing_status, event_fingerprint = EXCLUDED.event_fingerprint, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [route.id, route.tenantScope.organizationId, route.tenantScope.teamWorkspaceId, route.routingStatus, route.eventFingerprint, route],
      )
      return { ok: true, route: normalizeStreamingRouteRecord(result.rows?.[0]?.payload ?? route) }
    },
    async list({ tenantContext = {}, routingStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (routingStatus) {
        params.push(safeStatus(routingStatus))
        clauses.push(`routing_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_streaming_event_routes
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeStreamingRouteRecord(row.payload))
    },
  }
}

export function routeMarketDataStreamingEvents(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataStreamingRoutes ?? input.routes ?? []
  const providerEvents = input.providerEvents ?? input.marketDataWebSocketAdapter?.marketDataWebSocketAdapters?.flatMap((adapter) => adapter.providerEvents ?? []) ?? []
  const seen = new Set(input.existingFingerprints ?? [])
  const generated = providerEvents.slice(0, 1000).map((event, index) => {
    const normalized = normalizeProviderStreamingEvent(event, index)
    const key = fingerprint(normalized)
    const routingStatus = seen.has(key) ? 'duplicate' : undefined
    seen.add(key)
    return normalizeStreamingRouteRecord({ tenantContext, providerEvent: normalized, routingStatus, timestamp: options.timestamp }, index)
  })
  const routes = (Array.isArray(supplied) && supplied.length ? supplied : generated).map(normalizeStreamingRouteRecord)
  const marketDataStreamingRoutingSummary = {
    total: routes.length,
    accepted: routes.filter((item) => item.routingStatus === 'accepted').length,
    duplicate: routes.filter((item) => item.routingStatus === 'duplicate').length,
    stale: routes.filter((item) => item.routingStatus === 'stale').length,
    rejected: routes.filter((item) => item.routingStatus === 'rejected').length,
    quoteEvents: routes.filter((item) => item.dataType === 'quote').length,
    candleEvents: routes.filter((item) => item.dataType === 'candle').length,
    outOfOrderEvents: routes.filter((item) => item.sequenceMetadata.outOfOrder).length,
    cacheRoutable: routes.filter((item) => item.routingTargets.cache).length,
    scannerReady: routes.filter((item) => item.routingTargets.scannerReadiness).length,
  }
  const routingStatus = marketDataStreamingRoutingSummary.rejected > 0
    ? 'rejected'
    : marketDataStreamingRoutingSummary.duplicate > 0
      ? 'duplicate'
      : marketDataStreamingRoutingSummary.stale > 0
        ? 'stale'
        : 'accepted'
  const result = {
    eventType: MARKET_DATA_STREAMING_EVENT_ROUTED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataStreamingRoutes: routes,
    marketDataStreamingRoutingSummary,
    marketDataStreamingRoutingStatus: routingStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data streaming event routing ${routingStatus}: ${marketDataStreamingRoutingSummary.accepted} accepted, ${marketDataStreamingRoutingSummary.duplicate} duplicate, ${marketDataStreamingRoutingSummary.stale} stale, and ${marketDataStreamingRoutingSummary.rejected} rejected events.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_STREAMING_EVENT_ROUTED_EVENT, result)
  return result
}
