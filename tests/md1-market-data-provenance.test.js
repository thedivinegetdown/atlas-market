import { describe, expect, it } from 'vitest'
import { combineMarketDataProvenance, MARKET_DATA_STATES, normalizeMarketDataProvenance } from '../lib/market/marketDataProvenanceContract.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'

const NOW = '2026-08-11T16:00:00.000Z'

describe('MD.1 market-data provenance contract', () => {
  it('publishes the complete canonical state vocabulary', () => {
    expect(Object.values(MARKET_DATA_STATES)).toEqual(['LIVE', 'DELAYED', 'STALE', 'DEGRADED', 'MOCK', 'UNAVAILABLE', 'UNKNOWN'])
  })

  it.each([
    [{ provider: 'finnhub', observedAt: NOW }, 'LIVE'],
    [{ provider: 'finnhub', observedAt: NOW, delayed: true }, 'DELAYED'],
    [{ provider: 'finnhub', observedAt: '2026-08-11T15:00:00.000Z' }, 'STALE'],
    [{ provider: 'twelvedata', observedAt: NOW, fallbackUsed: true }, 'DEGRADED'],
    [{ provider: 'mock', observedAt: NOW }, 'MOCK'],
    [{ provider: 'registry', available: false }, 'UNAVAILABLE'],
    [{}, 'UNKNOWN'],
  ])('normalizes %o as %s', (input, expected) => {
    expect(normalizeMarketDataProvenance(input, { now: NOW }).dataStatus).toBe(expected)
  })

  it('does not let a fresh timestamp relabel mock data as live', () => {
    const result = normalizeMarketDataProvenance({ provider: 'mock', observedAt: NOW, status: 'LIVE' }, { now: NOW })
    expect(result).toMatchObject({ dataStatus: 'MOCK', mock: true })
    expect(result.warningCodes).toContain('MOCK_DATA')
  })

  it('aggregates the least-trustworthy state and safe source metadata', () => {
    const result = combineMarketDataProvenance([
      { provider: 'finnhub', dataStatus: 'LIVE', observedAt: NOW },
      { provider: 'mock', dataStatus: 'MOCK', observedAt: NOW, fallbackUsed: true },
    ])
    expect(result).toMatchObject({ dataStatus: 'MOCK', fallbackUsed: true, mock: true, sourceCount: 2 })
  })

  it('marks the deterministic no-key fallback as MOCK and degraded health', async () => {
    const service = createMarketDataService({ finnhubApiKey: '', twelveDataApiKey: '' })
    const quote = await service.getQuote('SPY')
    expect(quote.provenance).toMatchObject({ provider: 'mock', dataStatus: 'MOCK', fallbackUsed: true, mock: true })
    expect(quote.health.status).toBe('degraded')
  })
})
