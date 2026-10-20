import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DAILY_COMPLETION_STATUS, normalizeDailyCandles } from '../lib/market/indicators/normalizeDailyCandles.js'
import { buildDailyIndicatorBundle } from '../lib/market/indicators/buildDailyIndicatorBundle.js'
import { createDailyIndicatorPipeline } from '../lib/market/indicators/dailyIndicatorPipeline.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'
import { calculateTechnicalLevels } from '../lib/market/technicalLevels.js'
import { buildBreakoutMomentumSignal } from '../lib/strategies/breakout/breakoutMomentumSignal.js'
import { buildRangeMeanReversionSignal } from '../lib/strategies/range/rangeMeanReversionSignal.js'
import { buildVolatilityExpansionSignal } from '../lib/strategies/volatility/volatilityExpansionSignal.js'
import { createExitEvidenceService, isExitEvidenceFor } from '../lib/opportunities/paperExit/exitEvidence.js'
import { exitEvidenceFixture } from './helpers/exitEvidenceFixtures.js'

const MIDSESSION = '2026-10-20T17:14:00.000Z'
// Arithmetic observations only. These consecutive dates are not a market calendar.
function history(symbol = 'AAPL', count = 260) {
  return Array.from({ length: count }, (_, index) => ({
    symbol,
    timestamp: new Date(Date.parse('2026-10-20T00:00:00Z') - (count - index - 1) * 86400000).toISOString(),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index,
    source: 'fixture', provider: 'fixture',
  }))
}

function bundle(now = MIDSESSION, overrides = {}) {
  return buildDailyIndicatorBundle({
    symbol: 'AAPL', source: 'fixture', candles: history(),
    benchmarkSymbol: 'SPY', benchmarkSource: 'fixture', benchmarkCandles: history('SPY'),
    ...overrides,
  }, { now, calculatedAt: now, includeHistory: true })
}

describe('daily completion containment without independent qualification', () => {
  it('exposes a three-state contract without treating provider assertions as qualification', () => {
    expect(Object.values(DAILY_COMPLETION_STATUS)).toEqual(['CONFIRMED_COMPLETED', 'CONFIRMED_INCOMPLETE', 'UNKNOWN'])
    for (const completed of [true, false, undefined, 'true', 1]) {
      const result = normalizeDailyCandles(history().map(candle => ({
        ...candle, completed, completionStatus: 'CONFIRMED_COMPLETED',
        qualification: { qualified: true }, finality: 'FINAL',
      })), { symbol: 'AAPL', now: MIDSESSION, marketOpen: true })
      expect(result.candles).toEqual([])
      expect(result.completion).toMatchObject({ status: 'UNKNOWN', unknownCount: 260, confirmedCompletedCount: 0 })
      expect(result.invalid.every(item => item.completionStatus === 'UNKNOWN')).toBe(true)
    }
  })

  it.each([
    ['October 20 at 9:41 EDT', '2026-10-20T13:41:00Z'],
    ['October 20 at 13:14 EDT', MIDSESSION],
    ['October 20 after 16:00 EDT', '2026-10-20T20:05:00Z'],
    ['weekend', '2026-10-24T17:14:00Z'],
    ['holiday ambiguity', '2026-11-26T17:14:00Z'],
    ['early-close ambiguity', '2026-11-27T18:14:00Z'],
    ['UTC date rollover while Eastern date is October 20', '2026-10-21T00:30:00Z'],
  ])('never derives completion from the clock: %s', (_label, now) => {
    const result = bundle(now, { marketOpen: false, candles: history().map(candle => ({ ...candle, completed: true })) })
    expect(result.indicators).toEqual({})
    expect(result.provenance).toEqual({})
    expect(result.asOf).toBeNull()
    expect(result.history).toMatchObject({ candles: [], asOf: null, candleCount: 0, historyCompleteness: 'UNAVAILABLE' })
    expect(result.history.completion).toEqual(result.coverage.completion)
    expect(result.history.completion).toMatchObject({
      status: 'UNKNOWN', sourceSessionDate: '2026-10-20', evaluatedAt: new Date(now).toISOString(),
    })
    expect(result.coverage.invalid.at(-1)).toMatchObject({
      timestamp: '2026-10-20T00:00:00.000Z', sessionDate: '2026-10-20',
      declaredCompleted: true, completionStatus: 'UNKNOWN',
    })
    expect(calculateTechnicalLevels(result.history.candles).status).toBe('INSUFFICIENT')
  })

  it('produces identical evidence on UTC and Eastern hosts', () => {
    const moduleUrl = pathToFileURL(resolve('lib/market/indicators/buildDailyIndicatorBundle.js')).href
    const script = `
      import { buildDailyIndicatorBundle } from ${JSON.stringify(moduleUrl)};
      const input = ${JSON.stringify({ symbol: 'AAPL', candles: history().map(c => ({ ...c, completed: true })) })};
      console.log(JSON.stringify(buildDailyIndicatorBundle(input, {
        now: '${MIDSESSION}', calculatedAt: '${MIDSESSION}', includeHistory: true
      })));
    `
    const outputs = ['UTC', 'America/New_York'].map(TZ => JSON.parse(execFileSync(
      process.execPath, ['--input-type=module'],
      { input: script, encoding: 'utf8', env: { ...process.env, TZ }, windowsHide: true },
    )))
    expect(outputs[0]).toEqual(outputs[1])
    expect(outputs[0].indicators).toEqual({})
  })

  it.each([undefined, null, true, false])('does not consult heuristic or missing market status (%s)', async (isOpen) => {
    const data = {
      getCandles: vi.fn(async symbol => ({ ok: true, provider: 'fixture', data: history(symbol) })),
      ...(isOpen !== undefined ? { getMarketStatus: vi.fn(() => {
        throw new Error('Unqualified market status must not be used as finality')
      }) } : {}),
    }
    const result = await createDailyIndicatorPipeline({ marketDataService: data }).build(
      { symbol: 'AAPL' }, { now: MIDSESSION, calculatedAt: MIDSESSION, marketOpen: isOpen, includeHistory: true },
    )
    expect(result.indicators).toEqual({})
    expect(result.history.completion.status).toBe('UNKNOWN')
    expect(data.getCandles).toHaveBeenCalledTimes(2)
    if (data.getMarketStatus) expect(data.getMarketStatus).not.toHaveBeenCalled()
  })

  it('does not silently fall back to older unqualified candles', () => {
    const result = bundle(MIDSESSION, { candles: history().slice(0, -1) })
    expect(result.coverage.completion.sourceSessionDate).toBe('2026-10-19')
    expect(result.asOf).toBeNull()
    expect(result.indicators).toEqual({})
  })

  it.each([0, 14, 19, 20, 50, 199, 200, 260])('requires finality even with %i available observations', count => {
    const result = bundle(MIDSESSION, { candles: history('AAPL', count) })
    expect(result.indicators).toEqual({})
    expect(result.coverage.missing).toEqual(expect.arrayContaining([
      'price', 'shortMovingAverage', 'mediumMovingAverage', 'longMovingAverage', 'atr', 'atrPct', 'relativeStrengthPct',
    ]))
  })

  it('retains the LIVE quote and timestamp through the actual Research response composition', async () => {
    const quote = {
      symbol: 'AAPL', price: 340.41, change: -2.53, updatedAt: MIDSESSION, provider: 'fixture',
      provenance: { dataStatus: 'LIVE', provider: 'fixture', sourceObservedAt: MIDSESSION, observedAt: MIDSESSION, mock: false },
    }
    const data = {
      getQuote: vi.fn(async () => quote),
      getCandles: vi.fn(async symbol => ({ ok: true, provider: 'fixture', data: history(symbol) })),
    }
    const service = createWorkspaceDataService({ marketDataService: data })
    const response = await service.getMarketOverview('AAPL', {
      now: MIDSESSION, includeHistoricalIntelligence: true, includeResearchHistory: true,
    })
    expect(response.quote).toBe(quote)
    expect(response.quote.provenance.dataStatus).toBe('LIVE')
    expect(response.research.indicators.values).toEqual({})
    expect(response.research.history.asOf).toBe(response.research.indicators.asOf)
    expect(response.research.history.asOf).toBeNull()
    expect(response.research.history.completion).toEqual(response.research.indicators.coverage.completion)
    expect(response.regime.classification.status).toBe('INSUFFICIENT_DATA')
    expect(response.research.boundaries.automaticExecution).toBe(false)
  })

  it.each([
    ['BREAKOUT.1', buildBreakoutMomentumSignal],
    ['RANGE.1', buildRangeMeanReversionSignal],
    ['VOL.1', buildVolatilityExpansionSignal],
  ])('keeps %s blocked even if supplied indicators look favorable', (_name, buildSignal) => {
    const result = buildSignal({
      symbol: 'AAPL', currentPrice: 400, candles: history().map(c => ({ ...c, completed: true })),
      indicatorBundle: { indicators: {
        shortMovingAverage: 390, mediumMovingAverage: 380, longMovingAverage: 300,
        atr: 4, atrPct: 1, atrPercentile: 25, adx: 22, rsi: 60, relativeVolume: 1.5, relativeStrengthPct: 2,
      } }, generatedAt: MIDSESSION,
    })
    expect(result.suitabilityStatus).toBe('INSUFFICIENT_DATA')
  })

  it('leaves the qualified PA.4 receipt contract scoped to exits, never daily indicators', async () => {
    expect(await createExitEvidenceService().getExitEvidence({})).toMatchObject({
      status: 'AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE', reason: 'provider_not_qualified',
    })
    const fixture = exitEvidenceFixture()
    const receipt = await createExitEvidenceService(fixture).getExitEvidence(fixture.context)
    expect(receipt.status).toBe('AVAILABLE')
    expect(isExitEvidenceFor(receipt, fixture.context)).toBe(true)
    expect(isExitEvidenceFor(structuredClone(receipt), fixture.context)).toBe(false)
    const result = bundle(MIDSESSION, {
      completionEvidence: receipt,
      candles: history().map(c => ({ ...c, completed: true, completionEvidence: receipt })),
    })
    expect(result.indicators).toEqual({})
    // No positive daily qualification path is invented to restore availability.
    expect(result.coverage.completion.status).toBe('UNKNOWN')
  })
})
