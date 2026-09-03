import { describe, expect, it, vi } from 'vitest'
import { createDefaultMarketDataProvider } from '../lib/market/defaultMarketDataProvider.js'
import { createTwelveDataClient } from '../lib/market/twelveDataClient.js'

function response(payload, { status = 200, ok = status >= 200 && status < 300, headers = {} } = {}) {
  return { ok, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, async json() { return payload } }
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
    expect(result).toMatchObject({ ok: true, provider: 'twelvedata', fallbackUsed: false, data: { price: 633.25 } })
    expect(result.mock).not.toBe(true)
  })

  it('treats configured Twelve Data as the primary source when Finnhub is not configured', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const fetchImpl = vi.fn().mockResolvedValue(response({ symbol: 'SPY', last_quote_at: timestamp, close: '633.25' }))
    const provider = createDefaultMarketDataProvider({
      finnhubApiKey: '', twelveDataApiKey: 'key', fetchImpl, logger: { info: vi.fn(), warn: vi.fn() },
    })

    const result = await provider.getQuotes(['SPY'])

    expect(result.data[0]).toMatchObject({
      provider: 'twelvedata',
      health: { status: 'healthy' },
      provenance: { provider: 'twelvedata', dataStatus: 'LIVE', freshness: 'FRESH', fallbackUsed: false, mock: false },
    })
    expect(result.data[0].provenance.warningCodes).not.toContain('FALLBACK_PROVIDER_USED')
  })

  it('logs one sanitized quote failure for HTTP 429 and preserves fallback behavior', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const fetchImpl = vi.fn().mockResolvedValue(response({ message: 'daily credits exhausted: private-test-key' }, { status: 429, ok: false, headers: { 'retry-after': '30', 'x-ratelimit-reset': '60' } }))
    const result = await createDefaultMarketDataProvider({ finnhubApiKey: '', twelveDataApiKey: 'private-test-key', fetchImpl, logger }).getQuote('SPY')
    const failure = logger.warn.mock.calls.find(([event]) => event === 'twelve data provider request failed')?.[1]
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: true, provider: 'mock', fallbackUsed: true, mock: true })
    expect(failure).toMatchObject({ event: 'twelve_data_provider_request_failed', operation: 'quote', provider: 'twelvedata', httpStatus: 429, normalizedErrorCode: 'provider_rate_limited', normalizedErrorClass: 'RATE_LIMITED', sanitizedMessageCategory: 'DAILY_QUOTA', quotaScope: 'daily', retryAfterSeconds: 30, resetSeconds: 60 })
    expect(JSON.stringify(failure)).not.toMatch(/private-test-key|daily credits exhausted|apikey|authorization/i)
  })

  it('distinguishes HTTP-200 payload rate limits and maps explicit quota scope metadata', async () => {
    const minute = await createTwelveDataClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ status: 'error', code: 429, message: 'rate limited', meta: { quota_scope: 'minute' } })) }).getQuote('SPY')
    const daily = await createTwelveDataClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ status: 'error', code: 429, message: 'rate limited', meta: { quota_scope: 'daily' } })) }).getQuote('SPY')
    const ambiguous = await createTwelveDataClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ status: 'error', code: 429, message: 'credits exceeded' })) }).getQuote('SPY')
    expect(minute.failure).toMatchObject({ httpStatus: 200, providerErrorCode: 429, quotaScope: 'minute', sanitizedMessageCategory: 'RATE_LIMIT' })
    expect(daily.failure).toMatchObject({ httpStatus: 200, providerErrorCode: 429, quotaScope: 'daily', sanitizedMessageCategory: 'DAILY_QUOTA' })
    expect(ambiguous.failure).toMatchObject({ httpStatus: 200, providerErrorCode: 429, quotaScope: 'unknown', sanitizedMessageCategory: 'RATE_LIMIT' })
  })
})
