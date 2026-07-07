import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { isMarketDataStale, normalizeCandle } from './marketNormalizer.js'

export const MARKET_REPLAY_STEP_PREPARED_EVENT = 'market.replay.stepPrepared'

const timeframeIntervals = Object.freeze({
  intraday: '5m',
  swing: '1d',
  position: '1d',
})

const intervalMs = Object.freeze({
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '1d': 86400000,
})

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
}

function normalizeSymbol(value) {
  return normalizeText(value, 'MARKET').toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getBacktestInput(input = {}) {
  return input.strategyBacktestInput ?? input.backtestInput ?? {}
}

function getBacktestRequest(input = {}) {
  const backtestInput = getBacktestInput(input)
  return backtestInput.normalizedBacktestRequest ?? backtestInput
}

function buildReplaySessionConfiguration(input = {}) {
  const request = getBacktestRequest(input)
  const timeframe = normalizeText(
    input.timeframe ?? request.timeframeSelection?.timeframe,
    'swing',
  ).toLowerCase()
  const interval = normalizeText(input.interval, timeframeIntervals[timeframe] ?? '1d')
  const assetUniverse = request.selectedAssetUniverse ?? input.assetUniverse ?? []
  const firstAsset = assetUniverse[0] ?? {}

  return {
    sessionId: normalizeText(input.sessionId, `${request.requestId ?? 'historical-replay'}-${interval}`),
    strategyId: request.selectedStrategySnapshot?.strategyId ?? 'strategy-blueprint',
    symbol: normalizeSymbol(input.symbol ?? firstAsset.symbol),
    assetType: input.assetType ?? firstAsset.assetType ?? 'equity',
    timeframe,
    interval,
    dateRange: {
      startDate: input.startDate ?? request.dateRange?.startDate ?? null,
      endDate: input.endDate ?? request.dateRange?.endDate ?? null,
    },
    cursorIndex: Math.max(0, Math.floor(numberValue(input.cursorIndex, 0))),
    paperTrading: true,
  }
}

function validateTimeframeCompatibility(session, backtestRequest = {}) {
  const selection = backtestRequest.timeframeSelection ?? {}
  const supported = selection.supportedTimeframes ?? []
  const compatible = selection.compatible !== false && (supported.length === 0 || supported.includes(session.timeframe))
  const intervalCompatible = session.interval === (timeframeIntervals[session.timeframe] ?? session.interval)
    || session.timeframe === 'intraday'

  return {
    status: compatible && intervalCompatible ? 'pass' : 'fail',
    timeframe: session.timeframe,
    interval: session.interval,
    supportedTimeframes: supported,
    compatible: compatible && intervalCompatible,
    rationale: compatible && intervalCompatible
      ? 'Replay timeframe is compatible with prepared backtest input.'
      : 'Replay timeframe or interval is not compatible with prepared backtest input.',
  }
}

function normalizeHistoricalCandles(input = {}, session, options = {}) {
  const provider = input.marketDataAdapterHealth?.health?.provider
    ?? input.marketDataAdapterHealth?.metadata?.id
    ?? input.provider
    ?? 'historical-replay'
  const rawCandles = input.historicalCandles ?? input.candles ?? []

  return rawCandles
    .map((rawCandle, index) => {
      const candle = normalizeCandle({
        ...rawCandle,
        symbol: rawCandle.symbol ?? session.symbol,
        assetType: rawCandle.assetType ?? session.assetType,
        interval: rawCandle.interval ?? session.interval,
      }, provider, {
        symbol: session.symbol,
        assetType: session.assetType,
        interval: session.interval,
      })
      const stale = isMarketDataStale(candle.timestamp, {
        now: options.now ?? input.now ?? new Date(),
        staleAfterMs: numberValue(input.staleAfterMs, 86400000 * 30),
      })
      const incomplete = [candle.open, candle.high, candle.low, candle.close].some((value) => !Number.isFinite(Number(value)))
        || candle.volume <= 0

      return {
        ...candle,
        sequence: index,
        complete: !incomplete,
        stale,
        paperTrading: true,
      }
    })
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map((candle, index) => ({ ...candle, sequence: index }))
}

function detectMissingData(candles = [], session) {
  const expectedMs = intervalMs[session.interval] ?? intervalMs['1d']
  const gaps = []

  candles.forEach((candle, index) => {
    if (index === 0) return
    const previousTime = new Date(candles[index - 1].timestamp).getTime()
    const currentTime = new Date(candle.timestamp).getTime()
    const gapMs = currentTime - previousTime
    if (Number.isFinite(gapMs) && gapMs > expectedMs * 1.5) {
      gaps.push({
        after: candles[index - 1].timestamp,
        before: candle.timestamp,
        missingIntervals: Math.max(1, Math.round(gapMs / expectedMs) - 1),
      })
    }
  })

  return {
    hasMissingData: gaps.length > 0 || candles.length === 0,
    gaps,
    missingCount: candles.length === 0 ? 1 : gaps.reduce((total, gap) => total + gap.missingIntervals, 0),
  }
}

function detectCandleQuality(candles = []) {
  const staleCandles = candles.filter((candle) => candle.stale)
  const incompleteCandles = candles.filter((candle) => !candle.complete)

  return {
    hasStaleCandles: staleCandles.length > 0,
    hasIncompleteCandles: incompleteCandles.length > 0,
    staleCount: staleCandles.length,
    incompleteCount: incompleteCandles.length,
    staleCandles: staleCandles.map((candle) => candle.timestamp),
    incompleteCandles: incompleteCandles.map((candle) => candle.timestamp),
  }
}

function buildReplayCursorState(session, candles = []) {
  const cursorIndex = Math.min(session.cursorIndex, Math.max(0, candles.length - 1))
  return {
    sessionId: session.sessionId,
    cursorIndex,
    totalCandles: candles.length,
    hasPrevious: cursorIndex > 0,
    hasNext: cursorIndex < candles.length - 1,
    currentTimestamp: candles[cursorIndex]?.timestamp ?? null,
    paperTrading: true,
  }
}

function buildReplayStepOutput({ session, candles, cursorState, timeframeCompatibility, missingDataDetection, candleQuality }) {
  const currentCandle = candles[cursorState.cursorIndex] ?? null
  const status = !currentCandle || timeframeCompatibility.status === 'fail'
    ? 'blocked'
    : missingDataDetection.hasMissingData || candleQuality.hasIncompleteCandles
      ? 'caution'
      : 'ready'

  return {
    status,
    sessionId: session.sessionId,
    cursorIndex: cursorState.cursorIndex,
    candle: currentCandle,
    previousCandle: cursorState.hasPrevious ? candles[cursorState.cursorIndex - 1] : null,
    nextTimestamp: cursorState.hasNext ? candles[cursorState.cursorIndex + 1].timestamp : null,
    paperTrading: true,
  }
}

export function prepareHistoricalReplayStep(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const backtestRequest = getBacktestRequest(input)
  const replaySessionConfiguration = buildReplaySessionConfiguration(input)
  const timeframeCompatibilityValidation = validateTimeframeCompatibility(replaySessionConfiguration, backtestRequest)
  const normalizedHistoricalCandles = normalizeHistoricalCandles(input, replaySessionConfiguration, options)
  const missingDataDetection = detectMissingData(normalizedHistoricalCandles, replaySessionConfiguration)
  const candleQuality = detectCandleQuality(normalizedHistoricalCandles)
  const replayCursorState = buildReplayCursorState(replaySessionConfiguration, normalizedHistoricalCandles)
  const replayStepOutput = buildReplayStepOutput({
    session: replaySessionConfiguration,
    candles: normalizedHistoricalCandles,
    cursorState: replayCursorState,
    timeframeCompatibility: timeframeCompatibilityValidation,
    missingDataDetection,
    candleQuality,
  })
  const result = {
    eventType: MARKET_REPLAY_STEP_PREPARED_EVENT,
    paperTrading: true,
    timestamp,
    replaySessionConfiguration,
    normalizedHistoricalCandles,
    replayCursorState,
    replayStepOutput,
    timeframeCompatibilityValidation,
    missingDataDetection,
    staleIncompleteCandleDetection: candleQuality,
    summary: `${replaySessionConfiguration.symbol} ${replaySessionConfiguration.timeframe} replay step is ${replayStepOutput.status}.`,
    sourceEvents: {
      marketDataAdapter: input.marketDataAdapterHealth?.eventType ?? null,
      strategyBacktestInput: getBacktestInput(input).eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(MARKET_REPLAY_STEP_PREPARED_EVENT, result)
  }

  return result
}

export function createHistoricalMarketReplayEngine(options = {}) {
  return {
    prepareStep(input, prepareOptions = {}) {
      return prepareHistoricalReplayStep(input, { ...options, ...prepareOptions })
    },
  }
}
