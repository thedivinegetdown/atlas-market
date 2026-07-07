import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  MARKET_REPLAY_STEP_PREPARED_EVENT,
  createHistoricalMarketReplayEngine,
  prepareHistoricalReplayStep,
} from './historicalMarketReplayEngine.js'

const backtestInput = Object.freeze({
  eventType: 'strategy.backtestInput.prepared',
  readinessStatus: 'ready',
  normalizedBacktestRequest: Object.freeze({
    requestId: 'index-pullback-v1-swing-2025-01-01-2025-01-05',
    selectedStrategySnapshot: Object.freeze({
      strategyId: 'index-pullback-v1',
      strategyName: 'Index Pullback',
    }),
    selectedAssetUniverse: Object.freeze([
      Object.freeze({ symbol: 'SPY', assetType: 'etf' }),
    ]),
    timeframeSelection: Object.freeze({
      timeframe: 'swing',
      supportedTimeframes: Object.freeze(['swing', 'position']),
      compatible: true,
    }),
    dateRange: Object.freeze({
      startDate: '2025-01-01',
      endDate: '2025-01-05',
    }),
  }),
})

const marketDataAdapterHealth = Object.freeze({
  eventType: 'marketData.adapter.checked',
  metadata: Object.freeze({
    id: 'mock-market-data-adapter',
    paperTrading: true,
  }),
  health: Object.freeze({
    provider: 'mock-market-data-adapter',
    status: 'healthy',
    available: true,
    stale: false,
    paperTrading: true,
  }),
})

const candles = Object.freeze([
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-01T00:00:00.000Z', open: 100, high: 102, low: 99, close: 101, volume: 1000000 }),
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-02T00:00:00.000Z', open: 101, high: 103, low: 100, close: 102, volume: 1100000 }),
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-03T00:00:00.000Z', open: 102, high: 104, low: 101, close: 103, volume: 1200000 }),
])

describe('historical market replay engine', () => {
  it('normalizes historical candles and prepares a replay step cursor', () => {
    const result = prepareHistoricalReplayStep({
      strategyBacktestInput: backtestInput,
      marketDataAdapterHealth,
      historicalCandles: candles,
      cursorIndex: 1,
      now: '2025-01-04T00:00:00.000Z',
    }, { emitEvent: false })

    expect(result.eventType).toBe(MARKET_REPLAY_STEP_PREPARED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.replaySessionConfiguration).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      timeframe: 'swing',
      interval: '1d',
    })
    expect(result.normalizedHistoricalCandles).toHaveLength(3)
    expect(result.replayCursorState).toMatchObject({
      cursorIndex: 1,
      totalCandles: 3,
      hasPrevious: true,
      hasNext: true,
    })
    expect(result.replayStepOutput.status).toBe('ready')
    expect(result.replayStepOutput.candle.close).toBe(102)
  })

  it('flags missing data gaps without building backtest execution', () => {
    const result = prepareHistoricalReplayStep({
      strategyBacktestInput: backtestInput,
      marketDataAdapterHealth,
      historicalCandles: [
        candles[0],
        { ...candles[2], timestamp: '2025-01-05T00:00:00.000Z' },
      ],
      now: '2025-01-06T00:00:00.000Z',
    }, { emitEvent: false })

    expect(result.replayStepOutput.status).toBe('caution')
    expect(result.missingDataDetection.hasMissingData).toBe(true)
    expect(result.missingDataDetection.missingCount).toBeGreaterThan(0)
  })

  it('flags stale and incomplete candles', () => {
    const result = prepareHistoricalReplayStep({
      strategyBacktestInput: backtestInput,
      marketDataAdapterHealth,
      historicalCandles: [
        { ...candles[0], volume: 0 },
      ],
      now: '2026-01-01T00:00:00.000Z',
    }, { emitEvent: false })

    expect(result.replayStepOutput.status).toBe('caution')
    expect(result.staleIncompleteCandleDetection.hasStaleCandles).toBe(true)
    expect(result.staleIncompleteCandleDetection.hasIncompleteCandles).toBe(true)
  })

  it('blocks replay steps when timeframe is incompatible or candles are missing', () => {
    const result = prepareHistoricalReplayStep({
      strategyBacktestInput: backtestInput,
      marketDataAdapterHealth,
      historicalCandles: [],
      timeframe: 'intraday',
    }, { emitEvent: false })

    expect(result.timeframeCompatibilityValidation.status).toBe('fail')
    expect(result.missingDataDetection.hasMissingData).toBe(true)
    expect(result.replayStepOutput.status).toBe('blocked')
  })

  it('emits market replay step prepared events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(MARKET_REPLAY_STEP_PREPARED_EVENT, (payload) => events.push(payload))

    const result = createHistoricalMarketReplayEngine({ eventBus }).prepareStep({
      strategyBacktestInput: backtestInput,
      marketDataAdapterHealth,
      historicalCandles: candles,
      now: '2025-01-04T00:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(MARKET_REPLAY_STEP_PREPARED_EVENT)
  })
})
