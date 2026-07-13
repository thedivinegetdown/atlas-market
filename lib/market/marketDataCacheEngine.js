import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { isMarketDataStale, normalizeCandle, normalizeQuote } from './marketNormalizer.js'

export const MARKET_DATA_CACHE_PREPARED_EVENT = 'market.dataCache.prepared'
export const MARKET_DATA_CACHE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_CACHE_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeCacheEntry(entry = {}, index = 0) {
  const dataType = String(entry.dataType ?? 'quote').toLowerCase().slice(0, 40)
  const provider = entry.provider ?? 'mock-market-data-adapter'
  const payload = dataType === 'candle' ? normalizeCandle(entry.payload ?? entry, provider, entry) : normalizeQuote(entry.payload ?? entry, provider, entry)
  const cachedAt = getNowIso(entry.cachedAt ?? entry.updatedAt ?? payload.updatedAt ?? payload.timestamp)
  const ttlMs = Math.max(1000, Number(entry.ttlMs ?? 90000))
  return {
    id: String(entry.id ?? `market-data-cache-entry-${index + 1}`).slice(0, 120),
    symbol: String(entry.symbol ?? payload.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(entry.assetType ?? payload.assetType ?? 'equity').toLowerCase().slice(0, 40),
    dataType,
    timeframe: String(entry.timeframe ?? payload.interval ?? 'realtime').toLowerCase().slice(0, 20),
    provider,
    payload,
    cachedAt,
    ttlMs,
    stale: isMarketDataStale(cachedAt, { staleAfterMs: ttlMs, now: entry.now }),
  }
}

export function normalizeMarketDataCacheRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const entries = (input.cacheEntries ?? input.entries ?? []).slice(0, 500).map(normalizeCacheEntry)
  return {
    id: String(input.id ?? `market-data-cache-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    cacheStatus: safeStatus(input.cacheStatus ?? input.status),
    cacheScore: clampScore(input.cacheScore),
    cacheEntries: entries,
    cachePolicy: {
      quoteTtlMs: Math.max(1000, Number(input.cachePolicy?.quoteTtlMs ?? 90000)),
      candleTtlMs: Math.max(1000, Number(input.cachePolicy?.candleTtlMs ?? 300000)),
      maxEntries: Math.max(1, Math.min(5000, Number(input.cachePolicy?.maxEntries ?? 1000))),
      localFallbackReady: input.cachePolicy?.localFallbackReady !== false,
      postgresPersistenceReady: input.cachePolicy?.postgresPersistenceReady !== false,
    },
    staleDataSummary: {
      staleCount: Math.max(0, Number(input.staleDataSummary?.staleCount ?? entries.filter((entry) => entry.stale).length)),
      freshCount: Math.max(0, Number(input.staleDataSummary?.freshCount ?? entries.filter((entry) => !entry.stale).length)),
      staleHandling: String(input.staleDataSummary?.staleHandling ?? 'serve-with-caution-and-refresh').slice(0, 120),
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

export function createMarketDataCacheRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const cache = normalizeMarketDataCacheRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, cache }
      const result = await database.query(
        `INSERT INTO atlas_market_data_cache_snapshots
          (id, organization_id, team_workspace_id, cache_status, cache_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET cache_status = EXCLUDED.cache_status, cache_score = EXCLUDED.cache_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [cache.id, cache.tenantScope.organizationId, cache.tenantScope.teamWorkspaceId, cache.cacheStatus, cache.cacheScore, cache],
      )
      return { ok: true, cache: normalizeMarketDataCacheRecord(result.rows?.[0]?.payload ?? cache) }
    },
    async list({ tenantContext = {}, cacheStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (cacheStatus) {
        params.push(safeStatus(cacheStatus))
        clauses.push(`cache_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_cache_snapshots
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataCacheRecord(row.payload))
    },
  }
}

export function prepareMarketDataCache(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataCaches ?? input.marketDataCache ?? []
  const marketDataContracts = input.marketDataContracts ?? {}
  const firstContract = marketDataContracts.marketDataContracts?.[0] ?? marketDataContracts
  const quoteTtlMs = Number(input.cachePolicy?.quoteTtlMs ?? 90000)
  const candleTtlMs = Number(input.cachePolicy?.candleTtlMs ?? 300000)
  const quoteEntries = (firstContract.normalizedQuotes ?? []).map((quote, index) => ({
    id: `quote-cache-${quote.symbol}-${index}`,
    dataType: 'quote',
    symbol: quote.symbol,
    assetType: quote.assetType,
    provider: quote.provider,
    payload: quote,
    cachedAt: quote.updatedAt,
    ttlMs: quoteTtlMs,
  }))
  const candleEntries = (firstContract.normalizedCandles ?? []).map((candle, index) => ({
    id: `candle-cache-${candle.symbol}-${candle.interval}-${index}`,
    dataType: 'candle',
    symbol: candle.symbol,
    assetType: candle.assetType,
    timeframe: candle.interval,
    provider: candle.provider,
    payload: candle,
    cachedAt: candle.timestamp,
    ttlMs: candleTtlMs,
  }))
  const entries = [...quoteEntries, ...candleEntries]
  const staleCount = entries.map((entry) => normalizeCacheEntry(entry)).filter((entry) => entry.stale).length
  const cacheScore = entries.length === 0 ? 55 : staleCount > 0 ? 75 : 92
  const cacheStatus = cacheScore >= 85 ? 'ready' : cacheScore >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const caches = (sourceItems.length ? sourceItems : [normalizeMarketDataCacheRecord({
    tenantContext,
    cacheStatus,
    cacheScore,
    cacheEntries: entries,
    cachePolicy: input.cachePolicy,
    sourceReferences: [{ id: 'market-data-contracts', type: 'market-data-contracts', eventType: marketDataContracts.eventType }],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataCacheRecord)
  const marketDataCacheSummary = {
    total: caches.length,
    ready: caches.filter((item) => item.cacheStatus === 'ready').length,
    caution: caches.filter((item) => item.cacheStatus === 'caution').length,
    blocked: caches.filter((item) => item.cacheStatus === 'blocked').length,
    totalCacheEntries: caches.reduce((sum, item) => sum + item.cacheEntries.length, 0),
    staleEntries: caches.reduce((sum, item) => sum + item.staleDataSummary.staleCount, 0),
    freshEntries: caches.reduce((sum, item) => sum + item.staleDataSummary.freshCount, 0),
    averageCacheScore: caches.length ? Math.round(caches.reduce((sum, item) => sum + item.cacheScore, 0) / caches.length) : 0,
  }
  const marketDataCacheStatus = marketDataCacheSummary.blocked > 0 ? 'blocked' : marketDataCacheSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: MARKET_DATA_CACHE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataCaches: caches,
    marketDataCacheSummary,
    marketDataCacheStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data cache ${marketDataCacheStatus}: ${marketDataCacheSummary.totalCacheEntries} quote/candle entries prepared with ${marketDataCacheSummary.staleEntries} stale entries.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_CACHE_PREPARED_EVENT, result)
  return result
}
