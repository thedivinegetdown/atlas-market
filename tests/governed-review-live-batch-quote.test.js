import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCreditBudget } from '../lib/market/creditBudget.js'
import { createDefaultMarketDataProvider } from '../lib/market/defaultMarketDataProvider.js'
import { createMarketDataProviderRegistry } from '../lib/market/providerRegistry.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'
import { createMarketEvidencePacketBuilder, GOVERNED_UNIVERSE } from '../lib/market/marketEvidencePacket.js'
import { runGovernedPreparation } from '../netlify/functions/governed-review-prepare-background.js'

const NOW = '2026-10-14T16:24:30.000Z'
const OBSERVED = '2026-10-14T16:24:00.000Z'
const observedSeconds = Date.parse(OBSERVED) / 1000

afterEach(() => vi.useRealTimers())

function quote(symbol, close, timestamp = observedSeconds) {
  return { symbol, close: String(close), last_quote_at: timestamp }
}

function buildWithBatchPayload(payload) {
  vi.useFakeTimers().setSystemTime(new Date(NOW))
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    headers: { get: () => null },
    json: async () => payload,
  }))
  const registry = createMarketDataProviderRegistry()
  const service = createMarketDataService({ registry, twelveDataApiKey: '' })
  registry.register(createDefaultMarketDataProvider({
    twelveDataApiKey: 'fixture-key',
    fetchImpl,
    logger: { info: vi.fn(), warn: vi.fn() },
    creditBudget: createCreditBudget({ dailyLimit: 1000, minuteLimit: 1000 }),
  }))
  const marketDataService = {
    getQuotes: (...args) => service.getQuotes(...args),
    getCandles: async () => ({ ok: false, provider: 'twelvedata', error: { code: 'history_unavailable' } }),
  }
  const builder = createMarketEvidencePacketBuilder({
    marketDataService,
    creditBudget: createCreditBudget({ dailyLimit: 1000, minuteLimit: 1000 }),
    now: () => NOW,
  })
  return { builder, fetchImpl }
}

async function coverageFor(packet) {
  const saved = []
  const repository = { getStore: () => ({ upsertScoped: async (_id, preparation) => { saved.push(preparation) } }) }
  await runGovernedPreparation({
    id: 'prep-focused-batch-quote',
    createdAt: NOW,
    tenantContext: { organizationId: 'org-test', teamWorkspaceId: 'workspace-test', userId: 'owner-test' },
    repository,
  }, { workspaceDataService: { buildMarketEvidencePacket: async () => packet }, now: () => new Date(NOW) })
  const completed = saved.at(-1)
  expect(completed.status).toBe('completed')
  return completed.observationCoverage.checks
}

describe('governed five-symbol Twelve Data batch quote contract', () => {
  it('maps genuine symbol-keyed quotes into the governed packet with provider and source time intact', async () => {
    const payload = Object.fromEntries([...GOVERNED_UNIVERSE].reverse().map((symbol, index) => [symbol, quote(symbol, 100 + index)]))
    const { builder, fetchImpl } = buildWithBatchPayload(payload)
    const packet = await builder.build(GOVERNED_UNIVERSE)

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0]).toContain('symbol=SPY,QQQ,IWM,AAPL,MSFT')
    for (const symbol of GOVERNED_UNIVERSE) {
      expect(packet.symbols[symbol].quote).toMatchObject({
        symbol,
        price: Number(payload[symbol].close),
        sourceObservedAt: OBSERVED,
        provenance: {
          provider: 'twelvedata', dataStatus: 'LIVE', sourceObservedAt: OBSERVED,
          receivedAt: NOW, fallbackUsed: false, mock: false,
        },
      })
    }
    const checks = await coverageFor(packet)
    expect(checks).toHaveLength(15)
    expect(checks.every((check) => check.reason === 'candle_evidence_missing')).toBe(true)
  })

  it('keeps per-symbol errors, identity conflicts, missing timestamps, and stale quotes unavailable', async () => {
    const { builder } = buildWithBatchPayload({
      SPY: quote('SPY', 100),
      QQQ: { status: 'error', code: 429, message: 'rate limited' },
      IWM: quote('AAPL', 200),
      AAPL: { symbol: 'AAPL', close: '300' },
      MSFT: quote('MSFT', 400, observedSeconds - 3600),
    })
    const packet = await builder.build(GOVERNED_UNIVERSE)

    expect(packet.symbols.SPY.quote?.provenance.dataStatus).toBe('LIVE')
    for (const symbol of ['QQQ', 'IWM', 'AAPL', 'MSFT']) {
      expect(packet.symbols[symbol].quote).toBeNull()
      expect(packet.symbols[symbol].warnings).toContain('Quote unavailable')
    }
    const checks = await coverageFor(packet)
    expect(checks).toHaveLength(15)
    expect(checks.filter((check) => check.reason === 'quote_evidence_missing')).toHaveLength(12)
    expect(checks.filter((check) => check.reason === 'candle_evidence_missing')).toHaveLength(3)
  })

  it('does not turn a batch provider error or mock fallback into governed quote evidence', async () => {
    const { builder } = buildWithBatchPayload({ status: 'error', code: 429, message: 'rate limited' })
    const packet = await builder.build(GOVERNED_UNIVERSE)

    for (const symbol of GOVERNED_UNIVERSE) {
      expect(packet.symbols[symbol].quote).toBeNull()
      expect(packet.symbols[symbol].warnings).toContain('Quote unavailable')
    }
    const checks = await coverageFor(packet)
    expect(checks).toHaveLength(15)
    expect(checks.every((check) => check.reason === 'quote_evidence_missing')).toBe(true)
  })
})
