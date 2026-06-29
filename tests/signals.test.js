import { describe, expect, it } from 'vitest'
import { createSignalEngine } from '../lib/signals/signalEngine.js'

describe('signal engine', () => {
  it('returns a normalized signal shape', () => {
    const engine = createSignalEngine()
    const signal = engine.evaluateQuote({
      symbol: 'AAPL',
      price: 220,
      open: 210,
      high: 225,
      low: 205,
      previousClose: 205,
      changePercent: 7.3,
      volume: 5000000,
    })

    expect(signal).toMatchObject({
      symbol: 'AAPL',
      action: expect.any(String),
      score: expect.any(Number),
      confidence: expect.any(Number),
      thesis: expect.any(String),
      factors: expect.any(Array),
      riskFlags: expect.any(Array),
      updatedAt: expect.any(String),
    })
  })

  it('creates a BUY signal for strong bullish quote data', () => {
    const engine = createSignalEngine()
    const signal = engine.evaluateQuote({
      symbol: 'NVDA',
      price: 140,
      open: 130,
      high: 142,
      low: 128,
      previousClose: 125,
      changePercent: 12,
      volume: 8000000,
    })

    expect(signal.action).toBe('BUY')
    expect(signal.score).toBeGreaterThan(70)
  })

  it('creates an AVOID signal for weak or high-risk quote data', () => {
    const engine = createSignalEngine()
    const signal = engine.evaluateQuote({
      symbol: 'TSLA',
      price: 100,
      open: 105,
      high: 106,
      low: 95,
      previousClose: 110,
      changePercent: -8,
      volume: 300000,
    })

    expect(signal.action).toBe('AVOID')
    expect(signal.riskFlags).toContain('weak-setup')
  })

  it('creates a HOLD signal for neutral data', () => {
    const engine = createSignalEngine()
    const signal = engine.evaluateQuote({
      symbol: 'SPY',
      price: 510,
      open: 508,
      high: 512,
      low: 507,
      previousClose: 509,
      changePercent: 0.2,
      volume: 2000000,
    })

    expect(signal.action).toBe('HOLD')
  })
})
