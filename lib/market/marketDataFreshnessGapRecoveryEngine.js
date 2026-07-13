import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { isMarketDataStale } from './marketNormalizer.js'

export const MARKET_DATA_GAP_RECOVERY_EVALUATED_EVENT = 'marketData.gapRecovery.evaluated'
export const MARKET_DATA_GAP_RECOVERY_STATUSES = Object.freeze(['healthy', 'caution', 'recovering', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_GAP_RECOVERY_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeMarketEvent(event = {}, index = 0) {
  return {
    id: String(event.id ?? `market-data-event-${index + 1}`).slice(0, 140),
    symbol: String(event.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    dataType: String(event.dataType ?? 'quote').toLowerCase().slice(0, 40),
    sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : index + 1,
    timestamp: getNowIso(event.timestamp ?? event.updatedAt),
    provider: String(event.provider ?? 'mock-market-data-adapter').slice(0, 120),
  }
}

function sequenceFindings(events = []) {
  const duplicateEvents = []
  const gaps = []
  let outOfOrderCount = 0
  const grouped = new Map()
  events.forEach((event) => {
    const streamKey = `${event.symbol}:${event.dataType}`
    grouped.set(streamKey, [...(grouped.get(streamKey) ?? []), event])
  })
  grouped.forEach((streamEvents) => {
    const seen = new Set()
    streamEvents.forEach((event, index) => {
      if (index > 0 && event.sequence < streamEvents[index - 1].sequence) outOfOrderCount += 1
      const key = `${event.symbol}:${event.dataType}:${event.sequence}`
      if (seen.has(key)) duplicateEvents.push(event)
      seen.add(key)
    })
    const sorted = [...streamEvents].sort((a, b) => a.sequence - b.sequence)
    sorted.forEach((event, index) => {
      const next = sorted[index + 1]
      if (next && next.sequence - event.sequence > 1) {
        gaps.push({ symbol: event.symbol, dataType: event.dataType, afterSequence: event.sequence, beforeSequence: next.sequence, missingCount: next.sequence - event.sequence - 1 })
      }
    })
  })
  return { duplicateEvents, gaps, outOfOrderCount }
}

export function normalizeMarketDataFreshnessGapRecoveryRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const events = (input.marketDataEvents ?? input.events ?? []).slice(0, 1000).map(normalizeMarketEvent)
  const thresholds = {
    quoteFreshnessMs: Math.max(1000, Number(input.freshnessThresholds?.quoteFreshnessMs ?? 90000)),
    candleFreshnessMs: Math.max(1000, Number(input.freshnessThresholds?.candleFreshnessMs ?? 300000)),
  }
  const findings = sequenceFindings(events)
  const staleQuotes = events.filter((event) => event.dataType === 'quote' && isMarketDataStale(event.timestamp, { staleAfterMs: thresholds.quoteFreshnessMs, now }))
  const staleCandles = events.filter((event) => event.dataType === 'candle' && isMarketDataStale(event.timestamp, { staleAfterMs: thresholds.candleFreshnessMs, now }))
  return {
    id: String(input.id ?? `market-data-gap-recovery-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    recoveryStatus: safeStatus(input.recoveryStatus ?? input.status),
    recoveryScore: clampScore(input.recoveryScore),
    freshnessThresholds: thresholds,
    marketDataEvents: events,
    quoteFreshnessSummary: {
      checked: events.filter((event) => event.dataType === 'quote').length,
      stale: staleQuotes.length,
      thresholdMs: thresholds.quoteFreshnessMs,
    },
    candleFreshnessSummary: {
      checked: events.filter((event) => event.dataType === 'candle').length,
      stale: staleCandles.length,
      thresholdMs: thresholds.candleFreshnessMs,
    },
    sequenceGapDetection: {
      gapCount: findings.gaps.length,
      gaps: findings.gaps,
    },
    missingCandleDetection: {
      missingCount: Math.max(0, Number(input.missingCandleDetection?.missingCount ?? findings.gaps.filter((gap) => gap.dataType === 'candle').reduce((sum, gap) => sum + gap.missingCount, 0))),
      backfillRequired: input.missingCandleDetection?.backfillRequired ?? findings.gaps.some((gap) => gap.dataType === 'candle'),
    },
    outOfOrderEventDetection: {
      outOfOrderCount: Math.max(0, Number(input.outOfOrderEventDetection?.outOfOrderCount ?? findings.outOfOrderCount)),
    },
    duplicateEventDetection: {
      duplicateCount: Math.max(0, Number(input.duplicateEventDetection?.duplicateCount ?? findings.duplicateEvents.length)),
    },
    cacheReconciliationPlan: {
      planned: input.cacheReconciliationPlan?.planned !== false,
      safeOverwriteNewerData: false,
      action: String(input.cacheReconciliationPlan?.action ?? 'reconcile-stale-or-missing-only').slice(0, 140),
    },
    historicalBackfillReadiness: {
      ready: input.historicalBackfillReadiness?.ready !== false,
      mode: String(input.historicalBackfillReadiness?.mode ?? 'mock-replay-compatible').slice(0, 120),
      automaticBackfill: false,
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

export function createMarketDataFreshnessGapRecoveryRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const recovery = normalizeMarketDataFreshnessGapRecoveryRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, recovery }
      const result = await database.query(
        `INSERT INTO atlas_market_data_gap_recovery
          (id, organization_id, team_workspace_id, recovery_status, recovery_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET recovery_status = EXCLUDED.recovery_status, recovery_score = EXCLUDED.recovery_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [recovery.id, recovery.tenantScope.organizationId, recovery.tenantScope.teamWorkspaceId, recovery.recoveryStatus, recovery.recoveryScore, recovery],
      )
      return { ok: true, recovery: normalizeMarketDataFreshnessGapRecoveryRecord(result.rows?.[0]?.payload ?? recovery) }
    },
    async list({ tenantContext = {}, recoveryStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (recoveryStatus) {
        params.push(safeStatus(recoveryStatus))
        clauses.push(`recovery_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_gap_recovery
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataFreshnessGapRecoveryRecord(row.payload))
    },
  }
}

export function evaluateMarketDataFreshnessGapRecovery(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataGapRecoveries ?? input.marketDataGapRecovery ?? []
  const cache = input.marketDataCache ?? {}
  const firstCache = cache.marketDataCaches?.[0] ?? cache
  const cacheEntries = firstCache.cacheEntries ?? []
  const events = input.marketDataEvents ?? cacheEntries.map((entry, index) => ({
    id: `cache-event-${entry.id ?? index + 1}`,
    symbol: entry.symbol,
    dataType: entry.dataType,
    sequence: index + 1,
    timestamp: entry.cachedAt,
    provider: entry.provider,
  }))
  const normalizedProbe = normalizeMarketDataFreshnessGapRecoveryRecord({ tenantContext, marketDataEvents: events, timestamp: options.timestamp })
  const issueCount = normalizedProbe.quoteFreshnessSummary.stale
    + normalizedProbe.candleFreshnessSummary.stale
    + normalizedProbe.sequenceGapDetection.gapCount
    + normalizedProbe.outOfOrderEventDetection.outOfOrderCount
    + normalizedProbe.duplicateEventDetection.duplicateCount
  const score = Math.max(40, 92 - issueCount * 10)
  const recoveryStatus = issueCount === 0 ? 'healthy' : issueCount <= 2 ? 'caution' : normalizedProbe.historicalBackfillReadiness.ready ? 'recovering' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const recoveries = (sourceItems.length ? sourceItems : [normalizeMarketDataFreshnessGapRecoveryRecord({
    tenantContext,
    recoveryStatus,
    recoveryScore: score,
    marketDataEvents: events,
    freshnessThresholds: input.freshnessThresholds,
    sourceReferences: [
      { id: 'market-data-cache', type: 'market-data-cache', eventType: cache.eventType },
      { id: 'historical-replay', type: 'historical-replay', eventType: input.historicalReplay?.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataFreshnessGapRecoveryRecord)
  const marketDataGapRecoverySummary = {
    total: recoveries.length,
    healthy: recoveries.filter((item) => item.recoveryStatus === 'healthy').length,
    caution: recoveries.filter((item) => item.recoveryStatus === 'caution').length,
    recovering: recoveries.filter((item) => item.recoveryStatus === 'recovering').length,
    blocked: recoveries.filter((item) => item.recoveryStatus === 'blocked').length,
    staleQuotes: recoveries.reduce((sum, item) => sum + item.quoteFreshnessSummary.stale, 0),
    staleCandles: recoveries.reduce((sum, item) => sum + item.candleFreshnessSummary.stale, 0),
    sequenceGaps: recoveries.reduce((sum, item) => sum + item.sequenceGapDetection.gapCount, 0),
    duplicateEvents: recoveries.reduce((sum, item) => sum + item.duplicateEventDetection.duplicateCount, 0),
    outOfOrderEvents: recoveries.reduce((sum, item) => sum + item.outOfOrderEventDetection.outOfOrderCount, 0),
    averageRecoveryScore: recoveries.length ? Math.round(recoveries.reduce((sum, item) => sum + item.recoveryScore, 0) / recoveries.length) : 0,
  }
  const marketDataGapRecoveryStatus = marketDataGapRecoverySummary.blocked > 0
    ? 'blocked'
    : marketDataGapRecoverySummary.recovering > 0
      ? 'recovering'
      : marketDataGapRecoverySummary.caution > 0
        ? 'caution'
        : 'healthy'
  const result = {
    eventType: MARKET_DATA_GAP_RECOVERY_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataGapRecoveries: recoveries,
    marketDataGapRecoverySummary,
    marketDataGapRecoveryStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data gap recovery ${marketDataGapRecoveryStatus}: ${marketDataGapRecoverySummary.sequenceGaps} gaps, ${marketDataGapRecoverySummary.duplicateEvents} duplicates, and ${marketDataGapRecoverySummary.outOfOrderEvents} out-of-order events detected.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_GAP_RECOVERY_EVALUATED_EVENT, result)
  return result
}
