import { describe, expect, it } from 'vitest'
import { calculateTechnicalLevels } from '../lib/market/technicalLevels.js'

function candles(count = 24) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.2
    const swingLow = index === 10 ? 94 : close - 2
    const swingHigh = index === 16 ? 112 : close + 2
    return {
      timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      high: swingHigh,
      low: swingLow,
      close,
    }
  })
}

describe('deterministic technical levels', () => {
  it('returns explainable support and resistance from actual swing pivots and window extremes', () => {
    const result = calculateTechnicalLevels(candles())

    expect(result.status).toBe('AVAILABLE')
    expect(result.support).toContainEqual(expect.objectContaining({ value: 94, kind: 'confirmed swing low' }))
    expect(result.resistance).toContainEqual(expect.objectContaining({ value: 112, kind: 'confirmed swing high' }))
    expect(result.method).toContain('confirmed 2-bar swing pivots')
  })

  it('fails closed when the selected window has insufficient valid history', () => {
    expect(calculateTechnicalLevels(candles(12))).toMatchObject({
      status: 'INSUFFICIENT',
      support: [],
      resistance: [],
    })
  })
})
