import {
  normalizeProviderError,
  normalizeProviderStreamingEvent,
  normalizeSubscriptionAcknowledgement,
} from './marketDataWebSocketAdapterEngine.js'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function sanitizeProviderConfig(config = {}) {
  return {
    providerId: String(config.providerId ?? 'reference-websocket-market-data').slice(0, 120),
    endpointConfigured: Boolean(config.endpoint),
    tokenConfigured: Boolean(config.tokenRef ?? config.apiKeyRef),
    enabled: config.enabled === true,
  }
}

export function createMockWebSocketProviderAdapter(options = {}) {
  const providerId = options.providerId ?? 'mock-websocket-market-data'
  const baseTimestamp = options.timestamp ?? '2026-07-13T10:20:00.000Z'
  let connected = false
  let reconnectAttempts = 0
  const maxReconnectAttempts = Math.max(1, Math.min(20, Number(options.maxReconnectAttempts ?? 5)))

  function eventFor(symbol, channel, sequence, overrides = {}) {
    const timestamp = overrides.timestamp ?? baseTimestamp
    const price = Number(overrides.price ?? 525 + sequence)
    const payload = channel === 'candle'
      ? { symbol, open: price - 1, high: price + 1, low: price - 2, close: price, volume: 1000000 + sequence, interval: '1m', timestamp }
      : { symbol, price, open: price - 1, high: price + 1, low: price - 2, previousClose: price - 0.5, volume: 1000000 + sequence, timestamp }
    return normalizeProviderStreamingEvent({
      id: `${providerId}-${channel}-${symbol}-${sequence}-${overrides.idSuffix ?? 'event'}`,
      providerId,
      eventType: channel,
      channel,
      symbol,
      sequence,
      timestamp,
      payload,
      stale: overrides.stale,
      duplicate: overrides.duplicate,
      outOfOrder: overrides.outOfOrder,
    })
  }

  return {
    metadata: {
      providerId,
      providerName: 'Atlas Deterministic Mock WebSocket Provider',
      assetTypes: ['equity', 'etf', 'crypto', 'forex'],
      channels: ['quote', 'candle'],
      lifecycle: ['initialize', 'connect', 'subscribe', 'unsubscribe', 'heartbeat', 'reconnect', 'disconnect'],
      mockMode: true,
      configured: true,
      disabledByDefault: false,
    },
    initialize() {
      return { ok: true, providerId, lifecycle: 'initialize' }
    },
    connect() {
      connected = true
      return { ok: true, providerId, lifecycle: 'connect', connected }
    },
    subscribe({ channel = 'quote', symbols = ['SPY'] } = {}) {
      const normalizedSymbols = symbols.slice(0, 64).map((symbol) => String(symbol).toUpperCase().slice(0, 24))
      const acknowledgements = [normalizeSubscriptionAcknowledgement({ providerId, channel, symbols: normalizedSymbols, acknowledged: connected, timestamp: baseTimestamp })]
      const providerEvents = normalizedSymbols.flatMap((symbol) => [
        eventFor(symbol, channel, 1),
        eventFor(symbol, channel, 2),
      ])
      return { ok: connected, providerId, lifecycle: 'subscribe', acknowledgements, providerEvents }
    },
    unsubscribe({ channel = 'quote', symbols = ['SPY'] } = {}) {
      return { ok: true, providerId, lifecycle: 'unsubscribe', acknowledgement: normalizeSubscriptionAcknowledgement({ providerId, channel, symbols, acknowledged: true }) }
    },
    heartbeat() {
      return { ok: connected, providerId, lifecycle: 'heartbeat', heartbeatAt: getNowIso(baseTimestamp), heartbeatHealthy: connected }
    },
    reconnect() {
      reconnectAttempts = Math.min(maxReconnectAttempts, reconnectAttempts + 1)
      connected = reconnectAttempts <= maxReconnectAttempts
      return { ok: connected, providerId, lifecycle: 'reconnect', reconnectAttempts, maxReconnectAttempts, boundedReconnect: reconnectAttempts <= maxReconnectAttempts }
    },
    disconnect({ simulateFailure = false } = {}) {
      connected = false
      return { ok: !simulateFailure, providerId, lifecycle: 'disconnect', connected, error: simulateFailure ? normalizeProviderError({ code: 'mock_disconnect_failure', message: 'Mock provider disconnect simulation' }, providerId) : null }
    },
    simulateEvents({ symbols = ['SPY'], channel = 'quote', includeStale = true, includeDuplicate = true, includeOutOfOrder = true } = {}) {
      const symbol = String(symbols[0] ?? 'SPY').toUpperCase().slice(0, 24)
      return [
        eventFor(symbol, channel, 1),
        eventFor(symbol, channel, 3),
        ...(includeOutOfOrder ? [eventFor(symbol, channel, 2, { outOfOrder: true, idSuffix: 'late' })] : []),
        ...(includeDuplicate ? [eventFor(symbol, channel, 3, { duplicate: true, idSuffix: 'duplicate' })] : []),
        ...(includeStale ? [eventFor(symbol, channel, 4, { stale: true, timestamp: '2026-07-13T09:00:00.000Z', idSuffix: 'stale' })] : []),
      ]
    },
  }
}

export function createReferenceWebSocketProviderAdapter(config = {}) {
  const safeConfig = sanitizeProviderConfig(config)
  return {
    metadata: {
      providerId: safeConfig.providerId,
      providerName: 'Reference WebSocket Market Data Provider',
      assetTypes: ['equity', 'etf', 'crypto', 'forex'],
      channels: ['quote', 'candle'],
      lifecycle: ['initialize', 'connect', 'subscribe', 'unsubscribe', 'heartbeat', 'reconnect', 'disconnect'],
      mockMode: false,
      configured: safeConfig.enabled && safeConfig.endpointConfigured && safeConfig.tokenConfigured,
      disabledByDefault: true,
    },
    initialize() {
      return { ok: true, providerId: safeConfig.providerId, lifecycle: 'initialize', configured: this.metadata.configured }
    },
    connect() {
      if (!this.metadata.configured) {
        return { ok: false, providerId: safeConfig.providerId, lifecycle: 'connect', disabled: true, error: normalizeProviderError({ code: 'reference_adapter_not_configured', message: 'Reference adapter is disabled until explicit environment configuration is present', retryable: false }, safeConfig.providerId) }
      }
      return { ok: true, providerId: safeConfig.providerId, lifecycle: 'connect', connected: true }
    },
    subscribe({ channel = 'quote', symbols = ['SPY'] } = {}) {
      if (!this.metadata.configured) {
        return { ok: false, providerId: safeConfig.providerId, lifecycle: 'subscribe', acknowledgements: [], providerEvents: [], error: normalizeProviderError({ code: 'reference_adapter_not_configured', message: 'Reference adapter subscription disabled without explicit configuration', retryable: false }, safeConfig.providerId) }
      }
      return { ok: true, providerId: safeConfig.providerId, lifecycle: 'subscribe', acknowledgements: [normalizeSubscriptionAcknowledgement({ providerId: safeConfig.providerId, channel, symbols, acknowledged: true })], providerEvents: [] }
    },
    unsubscribe({ channel = 'quote', symbols = ['SPY'] } = {}) {
      return { ok: true, providerId: safeConfig.providerId, lifecycle: 'unsubscribe', acknowledgement: normalizeSubscriptionAcknowledgement({ providerId: safeConfig.providerId, channel, symbols, acknowledged: true }) }
    },
    heartbeat() {
      return { ok: this.metadata.configured, providerId: safeConfig.providerId, lifecycle: 'heartbeat', heartbeatHealthy: this.metadata.configured }
    },
    reconnect() {
      return { ok: this.metadata.configured, providerId: safeConfig.providerId, lifecycle: 'reconnect', reconnectAttempts: 0, maxReconnectAttempts: 5, boundedReconnect: true }
    },
    disconnect() {
      return { ok: true, providerId: safeConfig.providerId, lifecycle: 'disconnect', connected: false }
    },
  }
}

export function buildDefaultStreamingProviderAdapters({ env = {}, timestamp } = {}) {
  return [
    createMockWebSocketProviderAdapter({ timestamp }),
    createReferenceWebSocketProviderAdapter({
      providerId: env.MARKET_DATA_WS_PROVIDER_ID,
      endpoint: env.MARKET_DATA_WS_ENDPOINT,
      tokenRef: env.MARKET_DATA_WS_TOKEN_REF,
      enabled: env.MARKET_DATA_WS_ENABLED === 'true',
    }),
  ]
}
