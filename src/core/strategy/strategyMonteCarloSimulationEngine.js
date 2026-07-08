import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_MONTE_CARLO_SIMULATED_EVENT = 'strategy.monteCarlo.simulated'

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

function createSeededRandom(seed = 42) {
  let state = Math.max(1, Math.floor(numberValue(seed, 42))) % 2147483647
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

function getBacktestPerformance(input = {}) {
  return input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
}

function getWalkForward(input = {}) {
  return input.strategyWalkForward ?? input.walkForward ?? {}
}

function getTradeOutcomes(performance = {}) {
  const points = performance.returnCurveSummary?.points ?? []
  const startingEquity = numberValue(performance.returnCurveSummary?.startingEquity, 100000)

  if (points.length > 0) {
    let previousEquity = startingEquity
    return points.map((point) => {
      const endingEquity = numberValue(point.endingEquity, previousEquity)
      const pnl = round(endingEquity - previousEquity)
      previousEquity = endingEquity
      return pnl
    })
  }

  const metrics = performance.metrics ?? {}
  const totalTrades = Math.max(1, Math.floor(numberValue(metrics.totalIncludedTrades, 1)))
  const wins = Math.round((numberValue(metrics.winRate) / 100) * totalTrades)
  const losses = Math.max(0, totalTrades - wins)
  return [
    ...Array.from({ length: wins }, () => numberValue(metrics.averageWin)),
    ...Array.from({ length: losses }, () => numberValue(metrics.averageLoss)),
  ].filter((value) => value !== 0)
}

function calculateMaxDrawdown(equityCurve = []) {
  let peak = equityCurve[0] ?? 0
  let maxDrawdown = 0
  equityCurve.forEach((equity) => {
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  })
  return round(maxDrawdown, 4)
}

function generateSimulationPath({ outcomes, startingEquity, random, tradesPerPath, index }) {
  let equity = startingEquity
  const equityCurve = [round(equity)]

  for (let tradeIndex = 0; tradeIndex < tradesPerPath; tradeIndex += 1) {
    const sampleIndex = Math.floor(random() * outcomes.length)
    equity += outcomes[sampleIndex] ?? 0
    equityCurve.push(round(equity))
  }

  return {
    id: `mc-path-${index + 1}`,
    finalEquity: round(equity),
    totalPnl: round(equity - startingEquity),
    maxDrawdown: calculateMaxDrawdown(equityCurve),
    profitable: equity > startingEquity,
    equityCurve,
  }
}

function percentile(values = [], percentileValue) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarizeConfidenceIntervals(paths = []) {
  const finalEquities = paths.map((path) => path.finalEquity)
  const totalPnls = paths.map((path) => path.totalPnl)
  return {
    finalEquityP05: round(percentile(finalEquities, 5)),
    finalEquityP50: round(percentile(finalEquities, 50)),
    finalEquityP95: round(percentile(finalEquities, 95)),
    pnlP05: round(percentile(totalPnls, 5)),
    pnlP50: round(percentile(totalPnls, 50)),
    pnlP95: round(percentile(totalPnls, 95)),
  }
}

function buildPathSummaries(paths = []) {
  const sortedByPnl = [...paths].sort((left, right) => left.totalPnl - right.totalPnl)
  const worst = sortedByPnl[0] ?? null
  const median = sortedByPnl[Math.floor(sortedByPnl.length / 2)] ?? null
  return {
    worstCasePathSummary: worst ? {
      id: worst.id,
      finalEquity: worst.finalEquity,
      totalPnl: worst.totalPnl,
      maxDrawdown: worst.maxDrawdown,
    } : null,
    medianPathSummary: median ? {
      id: median.id,
      finalEquity: median.finalEquity,
      totalPnl: median.totalPnl,
      maxDrawdown: median.maxDrawdown,
    } : null,
  }
}

function classifyRobustness({ probabilityOfProfitability, probabilityOfDrawdownBreach, walkForwardStatus }) {
  if (probabilityOfProfitability >= 70 && probabilityOfDrawdownBreach <= 20 && walkForwardStatus === 'robust') return 'robust'
  if (probabilityOfProfitability < 45 || probabilityOfDrawdownBreach >= 45 || walkForwardStatus === 'failed') return 'fragile'
  return 'caution'
}

export function simulateMonteCarloStrategy(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const backtestPerformance = getBacktestPerformance(input)
  const walkForward = getWalkForward(input)
  const simulationCount = Math.max(1, Math.floor(numberValue(input.simulationCount ?? options.simulationCount, 100)))
  const startingEquity = numberValue(input.startingEquity ?? backtestPerformance.returnCurveSummary?.startingEquity, 100000)
  const drawdownThreshold = numberValue(
    input.drawdownThreshold
      ?? input.drawdownProtection?.maxDrawdownThreshold
      ?? input.drawdownProtection?.riskAdjustedMaxDrawdown
      ?? 10,
    10,
  )
  const outcomes = getTradeOutcomes(backtestPerformance)
  const tradesPerPath = Math.max(1, Math.floor(numberValue(input.tradesPerPath, outcomes.length || 1)))
  const random = createSeededRandom(input.seed ?? options.seed ?? 42)
  const randomizedEquityCurves = Array.from({ length: simulationCount }, (_, index) => generateSimulationPath({
    outcomes,
    startingEquity,
    random,
    tradesPerPath,
    index,
  }))
  const confidenceIntervalSummary = summarizeConfidenceIntervals(randomizedEquityCurves)
  const drawdownBreaches = randomizedEquityCurves.filter((path) => path.maxDrawdown >= drawdownThreshold).length
  const profitablePaths = randomizedEquityCurves.filter((path) => path.profitable).length
  const probabilityOfDrawdownBreach = round((drawdownBreaches / simulationCount) * 100)
  const probabilityOfProfitability = round((profitablePaths / simulationCount) * 100)
  const pathSummaries = buildPathSummaries(randomizedEquityCurves)
  const robustnessClassification = classifyRobustness({
    probabilityOfProfitability,
    probabilityOfDrawdownBreach,
    walkForwardStatus: walkForward.finalWalkForwardStatus,
  })
  const result = {
    eventType: STRATEGY_MONTE_CARLO_SIMULATED_EVENT,
    paperTrading: true,
    timestamp,
    simulationCount,
    tradesPerPath,
    tradeOutcomeSampling: {
      sourceTradeCount: outcomes.length,
      sampledOutcomes: outcomes,
      averageOutcome: round(outcomes.reduce((sum, value) => sum + value, 0) / Math.max(1, outcomes.length)),
    },
    randomizedEquityCurves,
    confidenceIntervalSummary,
    probabilityOfDrawdownBreach,
    probabilityOfProfitability,
    drawdownThreshold,
    worstCasePathSummary: pathSummaries.worstCasePathSummary,
    medianPathSummary: pathSummaries.medianPathSummary,
    robustnessClassification,
    summary: `Monte Carlo simulation ${robustnessClassification}: ${probabilityOfProfitability}% profitable paths, ${probabilityOfDrawdownBreach}% drawdown breach probability.`,
    sourceEvents: {
      strategyBacktestPerformance: backtestPerformance.eventType ?? null,
      strategyWalkForward: walkForward.eventType ?? null,
      drawdownProtection: input.drawdownProtection?.eventType ?? null,
      riskAdjustedPerformance: input.riskAdjustedPerformance?.eventType ?? backtestPerformance.riskAdjustedPerformanceSnapshot?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_MONTE_CARLO_SIMULATED_EVENT, result)
  }

  return result
}

export function createStrategyMonteCarloSimulationEngine(options = {}) {
  return {
    simulate(input, simulationOptions = {}) {
      return simulateMonteCarloStrategy(input, { ...options, ...simulationOptions })
    },
  }
}
