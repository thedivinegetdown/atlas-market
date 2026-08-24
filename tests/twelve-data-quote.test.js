import { describe, expect, it, vi } from 'vitest'
import { createDefaultMarketDataProvider } from '../lib/market/defaultMarketDataProvider.js'
import { createTwelveDataClient } from '../lib/market/twelveDataClient.js'

function response(payload, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return { ok, status, headers: { get: () => null }, async json() { return payload } }
}

describe('Twelve Data production quote compatibility', () => {
  it('normalizes the documented root-level quote response and provider timestamp', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      symbol: 'SPY', timestamp: 1_786_379_400, open: '630.10', high: '634.50', low: '629.90',
      close: '633.25', volume: '48200123', previous_close: '631.00', change: '2.25', percent_change: '0.35658',
    }))
    const result = await createTwelveDataClient({ apiKey: 'private-test-key', fetchImpl }).getQuote('SPY')
    expect(result).toMatchObject({
      ok: true,
      provider: 'twelvedata',
      data: { symbol: 'SPY', price: 633.25, previousClose: '631.00', updatedAt: '2026-08-10T16:30:00.000Z' },
    })
    expect(JSON.stringify(result)).not.toContain('private-test-key')
  })

  it.each([
    [{ status: 'error', code: 429, message: 'credits exceeded' }, 'provider_rate_limited'],
    [{ status: 'error', code: 401, message: 'invalid key' }, 'provider_response_error'],
    [{ symbol: 'SPY', close: null }, 'malformed_provider_response'],
  ])('fails closed for provider errors instead of emitting zero-valued real quotes', async (payload, error) => {
    const result = await createTwelveDataClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response(payload)) }).getQuote('SPY')
    expect(result).toMatchObject({ ok: false, provider: 'twelvedata', error })
    expect(result.data).toBeUndefined()
  })

  it('preserves real Twelve Data provenance without relabeling the evidence as mock', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ symbol: 'SPY', timestamp: 1_786_379_400, close: '633.25' }))
    const result = await createDefaultMarketDataProvider({
      finnhubApiKey: '', twelveDataApiKey: 'key', fetchImpl, logger: { info: vi.fn(), warn: vi.fn() },
    }).getQuote('SPY')
    expect(result).toMatchObject({ ok: true, provider: 'twelvedata', fallbackUsed: true, data: { price: 633.25 } })
    expect(result.mock).not.toBe(true)
  })
})
