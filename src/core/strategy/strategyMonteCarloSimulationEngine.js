import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { canonicalMonteCarloEvidence } from './canonicalMonteCarloEvidence.js'
import { historicalContentFingerprint } from './historicalEvidenceContract.js'

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
  const evidence = canonicalMonteCarloEvidence(input, input.outcomeCutoff)
  const simulationCount = input.simulationCount ?? options.simulationCount ?? 100
  const startingEquity = input.startingEquity
  const drawdownThreshold = input.drawdownThreshold
    ?? input.drawdownProtection?.maxDrawdownThreshold
    ?? input.drawdownProtection?.riskAdjustedMaxDrawdown
    ?? 10
  const seed = input.seed ?? options.seed ?? 42
  const outcomes = evidence.outcomes.map((outcome) => outcome.netPnl)
  const tradesPerPath = input.tradesPerPath ?? outcomes.length
  const validConfiguration = Number.isSafeInteger(simulationCount) && simulationCount > 0
    && Number.isSafeInteger(tradesPerPath) && tradesPerPath > 0
    && Number.isInteger(seed) && seed > 0 && seed < 2147483647
    && typeof startingEquity === 'number' && Number.isFinite(startingEquity) && startingEquity > 0
    && typeof drawdownThreshold === 'number' && Number.isFinite(drawdownThreshold) && drawdownThreshold > 0
  if (evidence.status !== 'AVAILABLE' || !validConfiguration) {
    const result = {
      eventType: STRATEGY_MONTE_CARLO_SIMULATED_EVENT, paperTrading: true, timestamp,
      evidenceStatus: 'UNAVAILABLE', simulationStatus: 'UNAVAILABLE',
      reason: evidence.status !== 'AVAILABLE' ? evidence.reason : 'INVALID_MONTE_CARLO_CONFIGURATION',
      simulationCount: 0, tradesPerPath: 0,
      tradeOutcomeSampling: { sourceTradeCount: 0, sampledOutcomes: [], averageOutcome: null },
      randomizedEquityCurves: [], confidenceIntervalSummary: null,
      probabilityOfDrawdownBreach: null, probabilityOfProfitability: null,
      worstCasePathSummary: null, medianPathSummary: null,
      robustnessClassification: 'UNAVAILABLE', sourceFingerprint: null, configurationFingerprint: null,
      summary: 'Monte Carlo UNAVAILABLE: complete canonical outcomes and explicit simulation configuration are required.',
    }
    if (emitEvent && eventBus?.emit) eventBus.emit(STRATEGY_MONTE_CARLO_SIMULATED_EVENT, result)
    return result
  }
  const configuration = { version: 'canonical-monte-carlo-v1', startingEquity, drawdownThreshold, seed, simulationCount, tradesPerPath, outcomeCutoff: input.outcomeCutoff, sourceFingerprint: evidence.sourceFingerprint }
  const random = createSeededRandom(seed)
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
    // Legacy walk-forward labels cannot establish independently executed OOS evidence.
    walkForwardStatus: 'UNAVAILABLE',
  })
  const result = {
    eventType: STRATEGY_MONTE_CARLO_SIMULATED_EVENT,
    paperTrading: true,
    timestamp,
    evidenceStatus: 'AVAILABLE',
    simulationStatus: 'AVAILABLE',
    historicalValidationStatus: 'UNAVAILABLE',
    evidenceScope: 'CANONICAL_PAPER_OUTCOME_RESAMPLING_ONLY',
    configuration,
    configurationFingerprint: historicalContentFingerprint(configuration),
    sourceFingerprint: evidence.sourceFingerprint,
    costTreatment: evidence.costTreatment,
    simulationCount,
    tradesPerPath,
    tradeOutcomeSampling: {
      outcomeSource: evidence.outcomeSource,
      sourceOutcomeIds: evidence.outcomes.map((outcome) => outcome.id),
      cohortKey: evidence.cohortKey,
      minimumSample: evidence.minimumSample,
      excludedOpenLifecycles: evidence.excludedOpenLifecycles,
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
    summary: `Canonical paper outcome resampling ${robustnessClassification}: ${probabilityOfProfitability}% profitable bootstrap paths, ${probabilityOfDrawdownBreach}% drawdown breach frequency. Historical strategy validation remains UNAVAILABLE.`,
    sourceEvents: {
      canonicalPaperOutcomes: evidence.outcomeSource,
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
