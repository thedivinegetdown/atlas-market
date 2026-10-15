import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMarketOverviewHandler } from '../netlify/functions/market-overview.js'

function parse(response) {
  return { ...response, json: JSON.parse(response.body) }
}

function testHandler(service) {
  return createMarketOverviewHandler({
    serviceFactory: () => service,
    repositoryFactory: () => ({ end: vi.fn() }),
    logger: { info: vi.fn(), error: vi.fn() },
    env: {},
  })
}

describe('historical data operational guardrails', () => {
  it('keeps provider credential contracts server-only', () => {
    const envContract = readFileSync(join(process.cwd(), '.env.example'), 'utf8')
    const marketService = readFileSync(join(process.cwd(), 'lib/market/marketDataService.js'), 'utf8')
    const clientApi = readFileSync(join(process.cwd(), 'src/api/workspaceApiClient.js'), 'utf8')
    expect(envContract).not.toMatch(/VITE_(FINNHUB|TWELVEDATA)_API_KEY/)
    expect(marketService).not.toMatch(/process\.env\.VITE_/)
    expect(clientApi).not.toMatch(/TWELVEDATA_API_KEY|apikey|time_series/i)
  })

  it('rejects unauthenticated public access before any provider-backed service call', async () => {
    const service = { getMarketOverview: vi.fn() }
    const response = parse(await testHandler(service)({
      httpMethod: 'GET',
      queryStringParameters: { symbol: 'SPY', timeframe: '1D' },
      headers: {},
    }))
    expect(response.statusCode).toBe(401)
    expect(response.json.error.message).toBe('authentication required')
    expect(service.getMarketOverview).not.toHaveBeenCalled()
  })

  it('returns the bounded symbol research read model without credentials or provider request details', async () => {
    const service = {
      getMarketOverview: vi.fn().mockResolvedValue({
        paperTrading: true,
        symbol: 'SPY',
        quote: { symbol: 'SPY', price: 630, provider: 'twelvedata' },
        regime: {
          symbol: 'SPY',
          timeframe: '1D',
          classification: { status: 'COMPLETE', trendRegime: 'BULL' },
          paperTrading: true,
          advisoryOnly: true,
        },
        research: {
          version: 'symbol-technical-research-v1',
          history: { candles: [{ timestamp: '2026-10-14T00:00:00.000Z', open: 625, high: 632, low: 624, close: 630, volume: 1000 }], candleCount: 1 },
          indicators: { values: {}, coverage: { available: [], missing: ['shortMovingAverage'] } },
          boundaries: { advisoryOnly: true, paperTradingOnly: true, automaticExecution: false },
        },
      }),
    }
    const response = parse(await testHandler(service)({
      httpMethod: 'GET',
      queryStringParameters: { symbol: 'SPY', timeframe: '1D' },
      headers: { authorization: 'Bearer private-session' },
    }))
    expect(response.statusCode).toBe(200)
    expect(service.getMarketOverview).toHaveBeenCalledWith('SPY', {
      timeframe: '1D',
      includeHistoricalIntelligence: true,
      includeResearchHistory: true,
    })
    expect(response.json.data.regime.classification.status).toBe('COMPLETE')
    expect(response.json.data).not.toHaveProperty('indicatorBundle')
    expect(response.json.data).not.toHaveProperty('candles')
    expect(response.json.data.research.history.candles).toHaveLength(1)
    expect(response.json.data.research.boundaries.automaticExecution).toBe(false)
    expect(JSON.stringify(response.json)).not.toMatch(/private-session|configured-existing-key|apikey|api_key|rawHistory/i)
  })
})
