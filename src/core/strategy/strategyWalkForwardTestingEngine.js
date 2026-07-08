import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_WALK_FORWARD_EVALUATED_EVENT = 'strategy.walkForward.evaluated'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getHistoricalReplay(input = {}) {
  return input.historicalReplay ?? input.marketReplay ?? {}
}

function getBacktestExecution(input = {}) {
  return input.strategyBacktestExecution ?? input.backtestExecution ?? {}
}

function getBacktestPerformance(input = {}) {
  return input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
}

function buildWindowConfiguration(input = {}, key, fallbackSize) {
  const config = input[key] ?? {}
  return {
    size: Math.max(1, Math.floor(numberValue(config.size ?? config.candles, fallbackSize))),
    label: config.label ?? key.replace('Configuration', ''),
  }
}

function generateRollingWindows(candles = [], inSampleConfiguration, outOfSampleConfiguration) {
  const windows = []
  const step = outOfSampleConfiguration.size
  const totalSize = inSampleConfiguration.size + outOfSampleConfiguration.size

  for (let start = 0; start + totalSize <= candles.length; start += step) {
    const inSampleCandles = candles.slice(start, start + inSampleConfiguration.size)
    const outOfSampleCandles = candles.slice(start + inSampleConfiguration.size, start + totalSize)
    windows.push({
      id: `wf-window-${windows.length + 1}`,
      index: windows.length,
      inSample: {
        startIndex: start,
        endIndex: start + inSampleCandles.length - 1,
        startTimestamp: inSampleCandles[0]?.timestamp ?? null,
        endTimestamp: inSampleCandles.at(-1)?.timestamp ?? null,
        candleCount: inSampleCandles.length,
      },
      outOfSample: {
        startIndex: start + inSampleConfiguration.size,
        endIndex: start + inSampleConfiguration.size + outOfSampleCandles.length - 1,
        startTimestamp: outOfSampleCandles[0]?.timestamp ?? null,
        endTimestamp: outOfSampleCandles.at(-1)?.timestamp ?? null,
        candleCount: outOfSampleCandles.length,
      },
      paperTrading: true,
    })
  }

  return windows
}

function getWindowPerformanceSummary(input = {}, window, fallbackPerformance = {}) {
  const supplied = input.windowPerformanceSummaries?.[window.index]
  const metrics = supplied?.metrics ?? fallbackPerformance.metrics ?? {}
  const returnCurveSummary = supplied?.returnCurveSummary ?? fallbackPerformance.returnCurveSummary ?? {}

  return {
    windowId: window.id,
    eventType: supplied?.eventType ?? fallbackPerformance.eventType ?? null,
    analyticsStatus: supplied?.analyticsStatus ?? fallbackPerformance.analyticsStatus ?? 'unknown',
    totalSimulatedTrades: numberValue(metrics.totalSimulatedTrades ?? supplied?.totalSimulatedTrades),
    includedTrades: numberValue(metrics.totalIncludedTrades ?? supplied?.includedTrades),
    netRealizedPnl: round(metrics.netRealizedPnl),
    winRate: round(metrics.winRate),
    profitFactor: round(metrics.profitFactor),
    expectancy: round(metrics.expectancy),
    maxDrawdown: round(metrics.maxDrawdown, 4),
    returnPct: round(returnCurveSummary.totalReturnPct, 4),
    paperTrading: true,
  }
}

function attachWindowReferences({ input, windows, backtestExecution, backtestPerformance }) {
  return windows.map((window) => ({
    ...window,
    backtestExecutionReference: {
      eventType: input.windowExecutionReferences?.[window.index]?.eventType ?? backtestExecution.eventType ?? null,
      status: input.windowExecutionReferences?.[window.index]?.backtestExecutionStatus ?? backtestExecution.backtestExecutionStatus ?? 'unknown',
      sessionId: input.windowExecutionReferences?.[window.index]?.sessionId ?? backtestExecution.session?.sessionId ?? null,
    },
    performanceSummary: getWindowPerformanceSummary(input, window, backtestPerformance),
  }))
}

function calculateRobustnessScore(windowResults = []) {
  if (windowResults.length === 0) return 0
  const scores = windowResults.map((window) => {
    const performance = window.performanceSummary
    const returnScore = Math.max(0, Math.min(100, 50 + performance.returnPct * 4))
    const profitFactorScore = Math.max(0, Math.min(100, performance.profitFactor * 25))
    const drawdownScore = Math.max(0, 100 - performance.maxDrawdown * 4)
    const tradeScore = performance.includedTrades > 0 ? 100 : 20
    return (returnScore * 0.3) + (profitFactorScore * 0.25) + (drawdownScore * 0.25) + (tradeScore * 0.2)
  })
  return round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
}

function detectDegradation(windowResults = []) {
  if (windowResults.length < 2) {
    return {
      degraded: false,
      degradationPct: 0,
      notes: [],
    }
  }

  const first = windowResults[0].performanceSummary
  const last = windowResults.at(-1).performanceSummary
  const returnDelta = last.returnPct - first.returnPct
  const expectancyDelta = last.expectancy - first.expectancy
  const drawdownDelta = last.maxDrawdown - first.maxDrawdown
  const notes = []
  if (returnDelta < -2) notes.push('Out-of-sample return declined across windows')
  if (expectancyDelta < 0) notes.push('Expectancy degraded across windows')
  if (drawdownDelta > 3) notes.push('Max drawdown expanded across windows')
  const degradationPct = round(Math.max(0, (-returnDelta * 8) + (-Math.min(0, expectancyDelta)) + (Math.max(0, drawdownDelta) * 5)))

  return {
    degraded: notes.length > 0,
    degradationPct,
    notes,
  }
}

function resolveStatus({ robustnessScore, degradationDetection, windowResults }) {
  if (windowResults.length === 0 || robustnessScore < 45) return 'failed'
  if (degradationDetection.degraded || robustnessScore < 70) return 'caution'
  return 'robust'
}

export function evaluateWalkForwardTesting(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const historicalReplay = getHistoricalReplay(input)
  const backtestExecution = getBacktestExecution(input)
  const backtestPerformance = getBacktestPerformance(input)
  const candles = historicalReplay.normalizedHistoricalCandles ?? []
  const inSampleWindowConfiguration = buildWindowConfiguration(input, 'inSampleWindowConfiguration', 2)
  const outOfSampleWindowConfiguration = buildWindowConfiguration(input, 'outOfSampleWindowConfiguration', 1)
  const rollingWindows = generateRollingWindows(candles, inSampleWindowConfiguration, outOfSampleWindowConfiguration)
  const windowResults = attachWindowReferences({
    input,
    windows: rollingWindows,
    backtestExecution,
    backtestPerformance,
  })
  const robustnessScore = calculateRobustnessScore(windowResults)
  const degradationDetection = detectDegradation(windowResults)
  const finalWalkForwardStatus = resolveStatus({ robustnessScore, degradationDetection, windowResults })
  const result = {
    eventType: STRATEGY_WALK_FORWARD_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    inSampleWindowConfiguration,
    outOfSampleWindowConfiguration,
    rollingWindows,
    windowResults,
    perWindowBacktestExecutionReferences: windowResults.map((window) => ({
      windowId: window.id,
      ...window.backtestExecutionReference,
    })),
    perWindowPerformanceSummary: windowResults.map((window) => window.performanceSummary),
    robustnessScore,
    degradationDetection,
    finalWalkForwardStatus,
    summary: `Walk-forward testing ${finalWalkForwardStatus} with ${robustnessScore} robustness across ${windowResults.length} windows.`,
    sourceEvents: {
      historicalReplay: historicalReplay.eventType ?? null,
      strategyBacktestExecution: backtestExecution.eventType ?? null,
      strategyBacktestPerformance: backtestPerformance.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_WALK_FORWARD_EVALUATED_EVENT, result)
  }

  return result
}

export function createStrategyWalkForwardTestingEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateWalkForwardTesting(input, { ...options, ...evaluationOptions })
    },
  }
}
