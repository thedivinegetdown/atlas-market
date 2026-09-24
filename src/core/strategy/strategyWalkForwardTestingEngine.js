import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { historicalEvidenceUnavailable } from './historicalEvidenceContract.js'

export const STRATEGY_WALK_FORWARD_EVALUATED_EVENT = 'strategy.walkForward.evaluated'

function windowSize(input, key, fallback) {
  const value = input[key]?.size ?? input[key]?.candles ?? fallback
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function planWindows(candles, trainingSize, testSize) {
  if (!trainingSize || !testSize || candles.some((candle, index) => !Number.isFinite(Date.parse(candle.timestamp)) || (index > 0 && Date.parse(candle.timestamp) <= Date.parse(candles[index - 1].timestamp)))) return []
  const windows = []
  const bounds = (startIndex, endIndex) => ({ startIndex, endIndex, startTimestamp: candles[startIndex].timestamp, endTimestamp: candles[endIndex].timestamp, candleCount: endIndex - startIndex + 1 })
  for (let start = 0; start + trainingSize + testSize <= candles.length; start += testSize) {
    windows.push({
      id: `wf-window-${windows.length + 1}`,
      inSample: bounds(start, start + trainingSize - 1),
      outOfSample: bounds(start + trainingSize, start + trainingSize + testSize - 1),
      executionStatus: 'NOT_EXECUTED',
      planningOnly: true,
      paperTrading: true,
    })
  }
  return windows
}

export function evaluateWalkForwardTesting(input = {}, options = {}) {
  const historicalReplay = input.historicalReplay ?? input.marketReplay ?? {}
  const candles = historicalReplay.normalizedHistoricalCandles ?? []
  const trainingSize = windowSize(input, 'inSampleWindowConfiguration', 2)
  const testSize = windowSize(input, 'outOfSampleWindowConfiguration', 1)
  const rollingWindows = planWindows(candles, trainingSize, testSize)
  const evidence = historicalEvidenceUnavailable()
  const result = {
    eventType: STRATEGY_WALK_FORWARD_EVALUATED_EVENT,
    paperTrading: true,
    timestamp: options.timestamp ?? new Date().toISOString(),
    evidenceStatus: 'UNAVAILABLE',
    historicalEvidence: evidence,
    reason: rollingWindows.length ? 'INDEPENDENT_OOS_EXECUTOR_UNAVAILABLE' : 'INSUFFICIENT_OR_INVALID_WINDOW_DATA',
    inSampleWindowConfiguration: { size: trainingSize },
    outOfSampleWindowConfiguration: { size: testSize },
    rollingWindows,
    // Window plans are not runs. Neither supplied summaries nor whole-run
    // execution/performance can populate these evidence arrays.
    windowResults: [],
    perWindowBacktestExecutionReferences: [],
    perWindowPerformanceSummary: [],
    robustnessScore: null,
    degradationDetection: { status: 'UNAVAILABLE', degraded: null, degradationPct: null, notes: [] },
    finalWalkForwardStatus: 'UNAVAILABLE',
    summary: 'Walk-forward evidence UNAVAILABLE: independent OOS execution under a frozen historical contract is required; window boundaries are plans only.',
    sourceEvents: { historicalReplay: historicalReplay.eventType ?? null },
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(STRATEGY_WALK_FORWARD_EVALUATED_EVENT, result)
  return result
}

export function createStrategyWalkForwardTestingEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateWalkForwardTesting(input, { ...options, ...evaluationOptions })
    },
  }
}
