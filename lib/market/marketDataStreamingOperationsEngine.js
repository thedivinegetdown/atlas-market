import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_STREAMING_OPERATIONS_EVALUATED_EVENT = 'marketData.streamingOperations.evaluated'
export const MARKET_DATA_STREAMING_OPERATIONS_STATUSES = Object.freeze(['healthy', 'caution', 'degraded', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusRank(status) {
  if (['blocked', 'stopped'].includes(status)) return 3
  if (['degraded', 'reconnecting', 'recovering'].includes(status)) return 2
  if (['caution', 'connecting'].includes(status)) return 1
  return 0
}

function resolveOperationalStatus(statuses) {
  const rank = Math.max(...statuses.map(statusRank), 0)
  return rank >= 3 ? 'blocked' : rank === 2 ? 'degraded' : rank === 1 ? 'caution' : 'healthy'
}

function section(id, label, status, details = {}) {
  return { id, label, status: status ?? 'healthy', ...details }
}

export function evaluateMarketDataStreamingOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const streamingSession = input.marketDataStreamingSession ?? {}
  const failover = input.marketDataProviderFailover ?? {}
  const streaming = input.marketDataStreaming ?? {}
  const gapRecovery = input.marketDataGapRecovery ?? {}
  const cache = input.marketDataCache ?? {}
  const activeSessionSummary = section('active-session-summary', 'Active session summary', streamingSession.marketDataStreamingSessionStatus, {
    activeSessions: streamingSession.marketDataStreamingSessionSummary?.active ?? 0,
    reconnectingSessions: streamingSession.marketDataStreamingSessionSummary?.reconnecting ?? 0,
  })
  const providerHealthSummary = section('provider-health-summary', 'Provider health summary', failover.marketDataProviderFailoverStatus, {
    healthyProviders: failover.marketDataProviderFailoverSummary?.healthyProviders ?? 0,
    degradedProviders: failover.marketDataProviderFailoverSummary?.degradedProviders ?? 0,
  })
  const failoverSummary = section('failover-summary', 'Failover summary', failover.marketDataProviderFailoverStatus, {
    totalProviders: failover.marketDataProviderFailoverSummary?.totalProviders ?? 0,
  })
  const freshnessSummary = section('freshness-summary', 'Freshness summary', gapRecovery.marketDataGapRecoveryStatus, {
    staleQuotes: gapRecovery.marketDataGapRecoverySummary?.staleQuotes ?? 0,
    staleCandles: gapRecovery.marketDataGapRecoverySummary?.staleCandles ?? 0,
  })
  const reconnectSummary = section('reconnect-summary', 'Reconnect summary', streamingSession.marketDataStreamingSessionStatus, {
    totalReconnectAttempts: streamingSession.marketDataStreamingSessionSummary?.totalReconnectAttempts ?? 0,
  })
  const subscriptionSummary = section('subscription-summary', 'Subscription summary', streaming.marketDataStreamingStatus, {
    totalSubscriptions: streaming.marketDataStreamingSummary?.totalSubscriptions ?? 0,
    totalChannels: streaming.marketDataStreamingSummary?.totalChannels ?? 0,
  })
  const gapRecoverySummary = section('gap-recovery-summary', 'Gap recovery summary', gapRecovery.marketDataGapRecoveryStatus, {
    sequenceGaps: gapRecovery.marketDataGapRecoverySummary?.sequenceGaps ?? 0,
    duplicateEvents: gapRecovery.marketDataGapRecoverySummary?.duplicateEvents ?? 0,
    outOfOrderEvents: gapRecovery.marketDataGapRecoverySummary?.outOfOrderEvents ?? 0,
  })
  const localCacheFallbackSummary = section('local-cache-fallback-summary', 'Local cache fallback summary', cache.marketDataCacheStatus, {
    cachedEntries: cache.marketDataCacheSummary?.totalCacheEntries ?? 0,
    staleEntries: cache.marketDataCacheSummary?.staleEntries ?? 0,
  })
  const summaries = [
    activeSessionSummary,
    providerHealthSummary,
    failoverSummary,
    freshnessSummary,
    reconnectSummary,
    subscriptionSummary,
    gapRecoverySummary,
    localCacheFallbackSummary,
  ]
  const operationalStatus = resolveOperationalStatus(summaries.map((item) => item.status))
  const result = {
    eventType: MARKET_DATA_STREAMING_OPERATIONS_EVALUATED_EVENT,
    timestamp,
    activeSessionSummary,
    providerHealthSummary,
    failoverSummary,
    freshnessSummary,
    reconnectSummary,
    subscriptionSummary,
    gapRecoverySummary,
    localCacheFallbackSummary,
    operationalStatus,
    sourceReferences: {
      marketDataStreamingSession: streamingSession.eventType ?? null,
      marketDataProviderFailover: failover.eventType ?? null,
      marketDataGapRecovery: gapRecovery.eventType ?? null,
      marketDataCache: cache.eventType ?? null,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data streaming operations ${operationalStatus}: sessions, providers, subscriptions, freshness, gap recovery, and local cache fallback reviewed.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_STREAMING_OPERATIONS_EVALUATED_EVENT, result)
  return result
}
