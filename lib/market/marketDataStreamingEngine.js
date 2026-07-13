import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_DATA_STREAMING_PREPARED_EVENT = 'market.dataStreaming.prepared'
export const MARKET_DATA_STREAMING_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_STREAMING_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeChannel(channel = {}, index = 0) {
  return {
    id: String(channel.id ?? `stream-channel-${index + 1}`).slice(0, 100),
    dataType: String(channel.dataType ?? 'quote').toLowerCase().slice(0, 40),
    symbols: (channel.symbols ?? ['SPY']).slice(0, 64).map((symbol) => String(symbol).toUpperCase().slice(0, 24)),
    provider: String(channel.provider ?? 'mock-market-data-adapter').slice(0, 100),
    transport: String(channel.transport ?? 'polling-ready').slice(0, 80),
    subscriptionReady: channel.subscriptionReady !== false,
    reconnectReady: channel.reconnectReady !== false,
  }
}

export function normalizeMarketDataStreamingRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const channels = (input.streamChannels ?? input.channels ?? []).slice(0, 24).map(normalizeChannel)
  return {
    id: String(input.id ?? `market-data-streaming-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    streamingStatus: safeStatus(input.streamingStatus ?? input.status),
    streamingScore: clampScore(input.streamingScore),
    streamChannels: channels,
    connectionPolicy: {
      connectionMode: String(input.connectionPolicy?.connectionMode ?? 'mock-polling-ready').slice(0, 100),
      heartbeatMs: Math.max(1000, Number(input.connectionPolicy?.heartbeatMs ?? 15000)),
      reconnectBackoffMs: Math.max(1000, Number(input.connectionPolicy?.reconnectBackoffMs ?? 3000)),
      maxReconnectAttempts: Math.max(1, Math.min(20, Number(input.connectionPolicy?.maxReconnectAttempts ?? 5))),
      externalProviderRequired: input.connectionPolicy?.externalProviderRequired === true,
    },
    subscriptionSummary: {
      totalSubscriptions: Math.max(0, Number(input.subscriptionSummary?.totalSubscriptions ?? channels.reduce((sum, channel) => sum + channel.symbols.length, 0))),
      quoteSubscriptions: Math.max(0, Number(input.subscriptionSummary?.quoteSubscriptions ?? channels.filter((channel) => channel.dataType === 'quote').reduce((sum, channel) => sum + channel.symbols.length, 0))),
      candleSubscriptions: Math.max(0, Number(input.subscriptionSummary?.candleSubscriptions ?? channels.filter((channel) => channel.dataType === 'candle').reduce((sum, channel) => sum + channel.symbols.length, 0))),
      streamFanoutReady: input.subscriptionSummary?.streamFanoutReady !== false,
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

export function createMarketDataStreamingRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const streaming = normalizeMarketDataStreamingRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, streaming }
      const result = await database.query(
        `INSERT INTO atlas_market_data_streaming_configs
          (id, organization_id, team_workspace_id, streaming_status, streaming_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET streaming_status = EXCLUDED.streaming_status, streaming_score = EXCLUDED.streaming_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [streaming.id, streaming.tenantScope.organizationId, streaming.tenantScope.teamWorkspaceId, streaming.streamingStatus, streaming.streamingScore, streaming],
      )
      return { ok: true, streaming: normalizeMarketDataStreamingRecord(result.rows?.[0]?.payload ?? streaming) }
    },
    async list({ tenantContext = {}, streamingStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (streamingStatus) {
        params.push(safeStatus(streamingStatus))
        clauses.push(`streaming_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_streaming_configs
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataStreamingRecord(row.payload))
    },
  }
}

export function prepareMarketDataStreaming(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataStreamingConfigs ?? input.marketDataStreaming ?? []
  const contracts = input.marketDataContracts ?? {}
  const firstContract = contracts.marketDataContracts?.[0] ?? contracts
  const provider = firstContract.provider ?? input.marketDataAdapterHealth?.metadata?.id ?? 'mock-market-data-adapter'
  const symbols = [...new Set((firstContract.normalizedRequests ?? []).map((request) => request.symbol ?? 'SPY'))]
  const channelCount = symbols.length > 0 ? 2 : 0
  const score = channelCount >= 2 ? 90 : channelCount === 1 ? 75 : 50
  const streamingStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const configs = (sourceItems.length ? sourceItems : [normalizeMarketDataStreamingRecord({
    tenantContext,
    streamingStatus,
    streamingScore: score,
    streamChannels: [
      { id: 'quote-stream-primary', dataType: 'quote', symbols, provider, transport: 'mock-polling-ready' },
      { id: 'candle-stream-primary', dataType: 'candle', symbols, provider, transport: 'mock-polling-ready' },
    ],
    connectionPolicy: input.connectionPolicy,
    sourceReferences: [{ id: 'market-data-contracts', type: 'market-data-contracts', eventType: contracts.eventType }],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataStreamingRecord)
  const marketDataStreamingSummary = {
    total: configs.length,
    ready: configs.filter((item) => item.streamingStatus === 'ready').length,
    caution: configs.filter((item) => item.streamingStatus === 'caution').length,
    blocked: configs.filter((item) => item.streamingStatus === 'blocked').length,
    totalChannels: configs.reduce((sum, item) => sum + item.streamChannels.length, 0),
    totalSubscriptions: configs.reduce((sum, item) => sum + item.subscriptionSummary.totalSubscriptions, 0),
    averageStreamingScore: configs.length ? Math.round(configs.reduce((sum, item) => sum + item.streamingScore, 0) / configs.length) : 0,
  }
  const marketDataStreamingStatus = marketDataStreamingSummary.blocked > 0 ? 'blocked' : marketDataStreamingSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: MARKET_DATA_STREAMING_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataStreamingConfigs: configs,
    marketDataStreamingSummary,
    marketDataStreamingStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data streaming ${marketDataStreamingStatus}: ${marketDataStreamingSummary.totalChannels} channels and ${marketDataStreamingSummary.totalSubscriptions} subscriptions prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_STREAMING_PREPARED_EVENT, result)
  return result
}
