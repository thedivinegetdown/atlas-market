import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMarketRegimeOrchestrator } from '../lib/market/regime/marketRegimeOrchestrator.js'
import { selectStrategiesForRegime } from '../lib/strategies/adaptive/adaptiveStrategyEngine.js'
import { scoreTradeQuality } from '../lib/opportunities/quality/tradeQualityEngine.js'
import { buildDailyBriefing } from '../lib/intelligence/briefing/index.js'
import { createScannerEvaluator } from '../lib/scanners/scannerEvaluator.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'

const provenance = { provider: 'mock', dataStatus: 'MOCK', observedAt: '2026-08-11T16:00:00.000Z', freshness: 'FRESH', fallbackUsed: true, mock: true, delayed: false, warningCodes: ['MOCK_DATA'], sourceCount: 1 }
const regime = createMarketRegimeOrchestrator().classify({
  symbol: 'SPY', timeframe: '1D', marketData: provenance,
  observations: { price: { value: 500, source: 'mock', observedAt: provenance.observedAt, receivedAt: provenance.observedAt, timeframe: 'REALTIME' } },
}, { now: provenance.observedAt })

describe('MD.1 downstream trust boundaries', () => {
  it('propagates MOCK through regime, strategy suitability, and Trade Quality', () => {
    expect(regime.marketData.dataStatus).toBe('MOCK')
    const suitability = selectStrategiesForRegime({ regime, strategies: [], context: { symbol: 'SPY', timeframe: '1D' } })
    expect(suitability.marketData.dataStatus).toBe('MOCK')
    const quality = scoreTradeQuality({ candidate: { symbol: 'SPY', strategyId: 'unknown' }, regime, strategySuitability: suitability })
    expect(quality.marketData.dataStatus).toBe('MOCK')
    expect(quality.boundaries).toMatchObject({ paperTradingOnly: true, scannerRankingUnchanged: true })
  })

  it('qualifies a Daily Briefing derived from MOCK evidence', () => {
    const briefing = buildDailyBriefing({ regime, strategySuitability: { status: 'COMPLETE', summary: {}, strategies: [] }, portfolioRisk: { summary: { accountValue: 1, maxDrawdown: 0 } }, operations: { status: 'MOCK', providerStatus: 'MOCK', marketData: provenance } })
    expect(briefing.status).not.toBe('READY')
    expect(briefing.market.marketData.dataStatus).toBe('MOCK')
    expect(briefing.warnings.join(' ')).toContain('qualified')
  })

  it('carries quote provenance into scanner matches without reordering', async () => {
    const quotes = [{ symbol: 'SPY', price: 500, changePercent: 1, volume: 100, provenance }]
    const evaluator = createScannerEvaluator({
      marketDataService: { getQuotes: vi.fn().mockResolvedValue(quotes) },
      signalEngine: { evaluateQuote: vi.fn().mockReturnValue({ action: 'BUY' }) },
      riskEngine: { evaluateOrder: vi.fn().mockReturnValue({ approved: true }) },
      now: () => provenance.observedAt,
    })
    const result = await evaluator.evaluate([{ id: 's', name: 'Scan', enabled: true, assetType: 'equity', symbols: ['SPY'], criteria: [{ type: 'price_above', threshold: 1 }] }])
    expect(result).toHaveLength(1)
    expect(result[0].marketData.dataStatus).toBe('MOCK')
  })

  it('makes one provider request per quote and does not expose credentials', async () => {
    const getQuote = vi.fn().mockResolvedValue({ ok: true, provider: 'finnhub', data: { symbol: 'SPY', price: 500, updatedAt: provenance.observedAt }, receivedAt: provenance.observedAt })
    const provider = { metadata: { id: 'test' }, getQuote }
    const service = createMarketDataService({ registry: { register: vi.fn(), selectProvider: () => provider }, logger: { info: vi.fn(), warn: vi.fn() } })
    const quote = await service.getQuote('SPY')
    expect(getQuote).toHaveBeenCalledOnce()
    expect(JSON.stringify(quote.provenance)).not.toMatch(/api.?key|credential|token|secret|https?:\/\//i)
  })

  it('wires the reusable accessible status into every required principal surface', () => {
    const files = [
      'src/components/panels.jsx',
      'src/workspaces/Dashboard/dashboardSections.jsx',
      'src/workspaces/Scanner/scannerSections.jsx',
      'src/workspaces/Portfolio/portfolioSections.jsx',
      'src/workspaces/Markets/marketSections.jsx',
      'src/workspaces/Research/researchSections.jsx',
      'src/workspaces/Watchlist/WatchlistWorkspace.jsx',
    ]
    const sharedPanels = readFileSync(files[0], 'utf8')
    expect(sharedPanels).toContain('MarketDataStatus')
    for (const path of files.slice(1)) {
      const source = readFileSync(path, 'utf8')
      expect(source.includes('MarketDataStatus') || source.includes('MarketOverviewPanel') || source.includes('WatchlistPanel')).toBe(true)
    }
    expect(readFileSync('src/components/MarketDataStatus.jsx', 'utf8')).toContain('role="status"')
  })
})
