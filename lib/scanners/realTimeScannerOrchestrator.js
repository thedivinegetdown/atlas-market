import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { getSymbolMetadata } from '../assets/index.js'
import { createSignalEngine } from '../signals/signalEngine.js'
import { SCANNER_CRITERIA } from './scannerCriteria.js'

export const SCANNER_REALTIME_EVALUATED_EVENT = 'scanner.realtime.evaluated'
export const REALTIME_SCANNER_STATUSES = Object.freeze(['idle', 'active', 'degraded', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return REALTIME_SCANNER_STATUSES.includes(status) ? status : 'degraded'
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeCriteria(criteria = []) {
  return criteria.slice(0, 12).map((criterion) => ({
    type: String(criterion.type ?? SCANNER_CRITERIA.SIGNAL_BULLISH).toLowerCase(),
    threshold: criterion.threshold,
  }))
}

function normalizeSubscription(input = {}, index = 0) {
  const symbols = (input.symbols ?? input.symbolUniverse ?? ['SPY']).slice(0, 128).map((symbol) => String(symbol).toUpperCase().slice(0, 24))
  return {
    id: String(input.id ?? `realtime-scanner-subscription-${index + 1}`).slice(0, 140),
    name: String(input.name ?? 'Real-time scanner').slice(0, 160),
    assetType: String(input.assetType ?? 'etf').toLowerCase().slice(0, 40),
    symbols: [...new Set(symbols)],
    criteria: normalizeCriteria(input.criteria ?? [{ type: SCANNER_CRITERIA.SIGNAL_BULLISH }]),
    enabled: input.enabled !== false,
  }
}

function criterionValue(criterion, quote, signal) {
  switch (criterion.type) {
    case SCANNER_CRITERIA.PRICE_ABOVE:
    case SCANNER_CRITERIA.PRICE_BELOW:
      return numberValue(quote.price)
    case SCANNER_CRITERIA.PERCENT_CHANGE_ABOVE:
    case SCANNER_CRITERIA.PERCENT_CHANGE_BELOW:
      return numberValue(quote.changePercent)
    case SCANNER_CRITERIA.VOLUME_ABOVE:
      return numberValue(quote.volume)
    case SCANNER_CRITERIA.SIGNAL_BULLISH:
    case SCANNER_CRITERIA.SIGNAL_BEARISH:
      return String(signal.action ?? '').toUpperCase()
    case SCANNER_CRITERIA.VOLATILITY_ABOVE:
      return numberValue(quote.volatility ?? Math.abs(numberValue(quote.changePercent)))
    case SCANNER_CRITERIA.RISK_ACCEPTABLE:
      return true
    default:
      return null
  }
}

function criterionMatches(criterion, value) {
  switch (criterion.type) {
    case SCANNER_CRITERIA.PRICE_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PRICE_BELOW:
      return numberValue(value) < numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PERCENT_CHANGE_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PERCENT_CHANGE_BELOW:
      return numberValue(value) < numberValue(criterion.threshold)
    case SCANNER_CRITERIA.VOLUME_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.SIGNAL_BULLISH:
      return ['BUY', 'STRONG_BUY'].includes(String(value).toUpperCase())
    case SCANNER_CRITERIA.SIGNAL_BEARISH:
      return ['SELL', 'AVOID'].includes(String(value).toUpperCase())
    case SCANNER_CRITERIA.VOLATILITY_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.RISK_ACCEPTABLE:
      return value === true
    default:
      return false
  }
}

function routeToInput(route = {}) {
  const quote = route.normalizedQuote
  const candle = route.normalizedCandle
  const symbol = quote?.symbol ?? candle?.symbol ?? route.providerEvent?.symbol
  return {
    symbol,
    dataType: route.dataType ?? (quote ? 'quote' : candle ? 'candle' : 'unknown'),
    quote,
    candle,
    routeId: route.id,
    eventFingerprint: route.eventFingerprint,
    routingStatus: route.routingStatus,
    sourceEventReference: { id: route.id, eventType: 'marketData.streamingEvent.routed' },
    timestamp: route.providerEvent?.timestamp ?? route.createdAt,
  }
}

export function normalizeRealtimeScannerSubscription(input = {}, index = 0) {
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  return {
    ...normalizeSubscription(input, index),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createRealtimeScannerRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const subscription = normalizeRealtimeScannerSubscription(input)
      if (!database?.connected) return { ok: true, disabled: true, subscription }
      const result = await database.query(
        `INSERT INTO atlas_realtime_scanner_subscriptions
          (id, organization_id, team_workspace_id, scanner_status, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET scanner_status = EXCLUDED.scanner_status, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [subscription.id, subscription.tenantScope.organizationId, subscription.tenantScope.teamWorkspaceId, subscription.enabled ? 'active' : 'idle', subscription.symbols[0] ?? null, subscription],
      )
      return { ok: true, subscription: normalizeRealtimeScannerSubscription(result.rows?.[0]?.payload ?? subscription) }
    },
    async list({ tenantContext = {}, limit = 50 } = {}) {
      if (!database?.connected) return []
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_scanner_subscriptions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
         ORDER BY updated_at DESC
         LIMIT $3`,
        [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))],
      )
      return (result.rows ?? []).map((row) => normalizeRealtimeScannerSubscription(row.payload))
    },
  }
}

export function evaluateRealtimeScanner(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const signalEngine = options.signalEngine ?? createSignalEngine()
  const subscriptions = (input.scannerSubscriptions?.length ? input.scannerSubscriptions : [{
    id: 'realtime-momentum-scanner',
    name: 'Real-time Momentum Scanner',
    assetType: 'etf',
    symbols: ['SPY'],
    criteria: [{ type: SCANNER_CRITERIA.SIGNAL_BULLISH }, { type: SCANNER_CRITERIA.RISK_ACCEPTABLE }],
  }]).slice(0, 24).map((item, index) => normalizeRealtimeScannerSubscription({ ...item, tenantContext }, index)).filter((item) => item.enabled)
  const routes = (input.marketDataStreamingRouting?.marketDataStreamingRoutes ?? input.routedEvents ?? []).slice(0, Number(input.debouncePolicy?.maxEventsPerEvaluation ?? 100))
  const seen = new Set(input.previouslyEvaluatedFingerprints ?? [])
  const blockedEvents = routes.filter((route) => ['stale', 'rejected'].includes(route.routingStatus)).length
  const duplicateEvents = routes.filter((route) => route.routingStatus === 'duplicate').length
  const candidates = []
  for (const route of routes) {
    const scannerInput = routeToInput(route)
    if (!['accepted'].includes(scannerInput.routingStatus)) continue
    if (seen.has(scannerInput.eventFingerprint)) continue
    seen.add(scannerInput.eventFingerprint)
    if (scannerInput.dataType === 'quote' && !scannerInput.quote) continue
    if (scannerInput.dataType === 'candle' && !scannerInput.candle) continue
    for (const subscription of subscriptions) {
      if (!subscription.symbols.includes(String(scannerInput.symbol ?? '').toUpperCase())) continue
      const quote = scannerInput.quote ?? {
        symbol: scannerInput.candle.symbol,
        price: scannerInput.candle.close,
        open: scannerInput.candle.open,
        high: scannerInput.candle.high,
        low: scannerInput.candle.low,
        previousClose: scannerInput.candle.open,
        volume: scannerInput.candle.volume,
        updatedAt: scannerInput.candle.timestamp,
      }
      const signal = signalEngine.evaluateQuote(quote)
      const matchedCriteria = []
      const currentValues = {}
      for (const criterion of subscription.criteria) {
        const value = criterionValue(criterion, quote, signal)
        currentValues[criterion.type] = value
        if (criterionMatches(criterion, value)) matchedCriteria.push(criterion.type)
      }
      if (matchedCriteria.length === subscription.criteria.length) {
        const metadata = getSymbolMetadata(quote.symbol, subscription.assetType)
        candidates.push({
          id: `realtime-scanner-candidate-${subscription.id}-${scannerInput.eventFingerprint}`.slice(0, 220),
          scannerId: subscription.id,
          scannerName: subscription.name,
          symbol: metadata.symbol,
          assetType: metadata.assetType,
          dataType: scannerInput.dataType,
          quote,
          candle: scannerInput.candle ?? null,
          signal,
          matchedCriteria,
          currentValues,
          sourceEventReference: scannerInput.sourceEventReference,
          eventFingerprint: scannerInput.eventFingerprint,
          evaluatedAt: timestamp,
        })
      }
    }
  }
  const summary = {
    subscriptions: subscriptions.length,
    evaluatedEvents: routes.length,
    candidates: candidates.length,
    duplicateSuppressed: duplicateEvents,
    staleBlocked: blockedEvents,
    maxEventsPerEvaluation: Number(input.debouncePolicy?.maxEventsPerEvaluation ?? 100),
    debounceMs: Number(input.debouncePolicy?.debounceMs ?? 250),
    throttleMs: Number(input.debouncePolicy?.throttleMs ?? 1000),
  }
  const scannerStatus = subscriptions.length === 0 || routes.length === 0
    ? 'idle'
    : blockedEvents === routes.length
      ? 'blocked'
      : blockedEvents > 0 || duplicateEvents > 0
        ? 'degraded'
        : 'active'
  const result = {
    eventType: SCANNER_REALTIME_EVALUATED_EVENT,
    timestamp,
    scannerSubscriptionRegistry: subscriptions,
    normalizedScannerInputs: routes.map(routeToInput),
    scannerCandidates: candidates,
    scannerDebounceThrottlePolicy: {
      maxEventsPerEvaluation: summary.maxEventsPerEvaluation,
      debounceMs: summary.debounceMs,
      throttleMs: summary.throttleMs,
      duplicateEvaluationSuppression: true,
      staleDataBlocking: true,
    },
    realtimeScannerSummary: summary,
    scannerStatus: safeStatus(scannerStatus),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time scanner ${scannerStatus}: ${summary.candidates} candidates from ${summary.evaluatedEvents} bounded routed events.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SCANNER_REALTIME_EVALUATED_EVENT, result)
  return result
}
