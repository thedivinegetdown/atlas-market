import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { canonicalHistory, monteCarloInput } from '../../../tests/fixtures/gap6CanonicalHistory.js'
import { STRATEGY_MONTE_CARLO_SIMULATED_EVENT, createStrategyMonteCarloSimulationEngine, simulateMonteCarloStrategy } from './strategyMonteCarloSimulationEngine.js'

const options = { emitEvent: false, timestamp: '2025-02-01T00:00:00.000Z' }
const run = (input = monteCarloInput()) => simulateMonteCarloStrategy(input, options)

function expectUnavailable(input) {
  const result = run(input)
  expect(result.evidenceStatus).toBe('UNAVAILABLE')
  expect(result.randomizedEquityCurves).toEqual([])
  expect(result.probabilityOfProfitability).toBeNull()
  expect(result.probabilityOfDrawdownBreach).toBeNull()
  expect(result.confidenceIntervalSummary).toBeNull()
  return result
}

describe('canonical outcome Monte Carlo', () => {
  it('samples only completed canonical net outcomes, including break-even outcomes', () => {
    const result = run()
    expect(result.tradeOutcomeSampling.sampledOutcomes).toEqual([120, -40, 60, 0, 80])
    expect(result.tradeOutcomeSampling.sourceOutcomeIds).toHaveLength(5)
    expect(result.tradeOutcomeSampling.outcomeSource).toBe('canonical-paper-outcome-v1')
    expect(result.evidenceStatus).toBe('AVAILABLE')
    expect(result.historicalValidationStatus).toBe('UNAVAILABLE')
    expect(result.randomizedEquityCurves).toHaveLength(25)
    for (const path of result.randomizedEquityCurves) {
      path.equityCurve.slice(1).forEach((equity, index) => {
        expect([120, -40, 60, 0, 80]).toContain(equity - path.equityCurve[index])
      })
    }
  })

  it('never reconstructs outcomes from aggregate metrics or equity differences', () => {
    for (const performance of [
      { metrics: { totalIncludedTrades: 1000, winRate: 99, averageWin: 100, averageLoss: -1 } },
      { returnCurveSummary: { startingEquity: 100000, points: [{ endingEquity: 100500 }] } },
    ]) expectUnavailable({ strategyBacktestPerformance: performance, startingEquity: 100000 })
    expectUnavailable({ ...monteCarloInput(), canonicalExecutionHistory: undefined, canonicalOutcomes: [100, 100, 100, 100, 100] })
  })

  it('fails closed on insufficient outcomes without manufacturing a zero path', () => {
    expectUnavailable(monteCarloInput([]))
    expectUnavailable(monteCarloInput([100, 100, 100, 100]))
  })

  it('requires complete history and explicit cutoff/capital', () => {
    const input = monteCarloInput()
    input.canonicalExecutionHistory.history.status = 'WINDOWED'
    expectUnavailable(input)
    expectUnavailable({ ...monteCarloInput(), outcomeCutoff: undefined })
    expectUnavailable({ ...monteCarloInput(), outcomeCutoff: '2025-01-02T00:00:00.000Z' })
    expectUnavailable({ ...monteCarloInput(), startingEquity: undefined })
    expectUnavailable({ ...monteCarloInput(), seed: 2147483647 })
  })

  it.each(['fees', 'slippageBps', 'quantity', 'fillPrice', 'cashImpact', 'realizedPnlDelta', 'createdAt', 'evidenceTimestamp', 'engineVersion'])('rejects missing %s without assigning a zero/default', (field) => {
    const input = monteCarloInput()
    delete input.canonicalExecutionHistory.executions[0][field]
    expectUnavailable(input)
  })

  it('uses recorded fees and slippage exactly once and freezes configuration', () => {
    const input = monteCarloInput()
    const result = run(input)
    expect(result.tradeOutcomeSampling.sampledOutcomes).toEqual([120, -40, 60, 0, 80])
    expect(result.costTreatment).toContain('entry/exit fees and fill-price slippage')
    expect(result.configuration).toMatchObject({ seed: 7, simulationCount: 25, tradesPerPath: 5, startingEquity: 100000 })
    expect(run(input)).toEqual(result)
    const reversed = structuredClone(input)
    reversed.canonicalExecutionHistory.executions.reverse()
    expect(run(reversed)).toEqual(result)
    const reordered = JSON.parse(JSON.stringify(input, function (key, value) {
      return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value
    }))
    expect(run(reordered)).toEqual(result)
    expect(run({ ...input, seed: 8 }).configurationFingerprint).not.toBe(result.configurationFingerprint)
    input.canonicalExecutionHistory.executions[0].slippageBps = 6
    expect(run(input).sourceFingerprint).not.toBe(result.sourceFingerprint)
    input.canonicalExecutionHistory.executions[0].fees = 0
    input.canonicalExecutionHistory.executions[0].cashImpact = -1000
    input.canonicalExecutionHistory.executions[1].realizedPnlDelta = 121
    expect(run(input).tradeOutcomeSampling.sampledOutcomes[0]).toBe(121)
  })

  it('excludes open and partial lifecycles from sample size', () => {
    const input = monteCarloInput()
    const extra = canonicalHistory([10]).executions[0]
    const entry = { ...extra, executionId: 'open-entry', positionId: 'open-position' }
    input.canonicalExecutionHistory.executions.push(entry, { ...entry, executionId: 'partial-exit', executionType: 'reduction', quantity: 2, createdAt: '2025-01-01T14:30:00.000Z', evidenceTimestamp: '2025-01-01T14:30:00.000Z' })
    input.canonicalExecutionHistory.history.returnedCount += 2
    expect(run(input).tradeOutcomeSampling).toMatchObject({ sourceTradeCount: 5, excludedOpenLifecycles: 1 })
  })

  it.each([
    (rows) => { rows[0].accountRecordId = 'another-account' },
    (rows) => { rows[0].executionId = rows[1].executionId },
    (rows) => { rows[1].cashImpact += 10 },
    (rows) => { rows[1].quantity -= 1 },
    (rows) => { rows[0].payload.attribution.policyFingerprint = null },
    (rows) => { rows[0].payload.attribution.strategyFingerprint = 'different-strategy' },
    (rows) => { rows[0].paperTradingOnly = false },
    (rows) => { rows[1].evidenceTimestamp = rows[0].evidenceTimestamp },
  ])('rejects mixed, duplicate, unreconciled, unscoped, or temporally invalid evidence', (mutate) => {
    const input = structuredClone(monteCarloInput())
    mutate(input.canonicalExecutionHistory.executions)
    expectUnavailable(input)
  })

  it('cannot promote resampling into historical robustness using a legacy walk-forward label', () => {
    expect(run({ ...monteCarloInput(), strategyWalkForward: { finalWalkForwardStatus: 'robust' } }).robustnessClassification).not.toBe('robust')
    expect(run(monteCarloInput([-100, -100, -100, -100, -100])).robustnessClassification).toBe('fragile')
  })

  it('retains the existing drawdown-protection threshold precedence', () => {
    const input = monteCarloInput()
    expect(run({ ...input, drawdownProtection: { maxDrawdownThreshold: 3 } }).configuration.drawdownThreshold).toBe(3)
    expect(run({ ...input, drawdownThreshold: 4, drawdownProtection: { maxDrawdownThreshold: 3 } }).configuration.drawdownThreshold).toBe(4)
  })

  it('emits available and unavailable results through the existing event API', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_MONTE_CARLO_SIMULATED_EVENT, (event) => events.push(event))
    const engine = createStrategyMonteCarloSimulationEngine({ eventBus })
    expect(engine.simulate(monteCarloInput()).evidenceStatus).toBe('AVAILABLE')
    expect(engine.simulate({}).evidenceStatus).toBe('UNAVAILABLE')
    expect(events).toHaveLength(2)
  })
})
