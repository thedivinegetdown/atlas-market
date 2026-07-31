import { normalizeHistoricalInterval } from './historicalCandleNormalizer.js'

const DEFAULT_TIMEOUT_MS = 4000

export function createTwelveDataClient({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  return {
    async getQuote(symbol) {
      if (!apiKey) {
        return { ok: false, error: 'missing_api_key', provider: 'twelvedata' }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`, {
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          return { ok: false, error: 'request_failed', provider: 'twelvedata', status: response.status }
        }

        const payload = await response.json()
        const quote = payload?.quote ?? payload?.data?.[0] ?? {}
        return {
          ok: true,
          provider: 'twelvedata',
          data: {
            symbol,
            price: quote.close ?? quote.price,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            previousClose: quote.previous_close,
            change: quote.change,
            changePercent: quote.percent_change,
            volume: quote.volume,
          },
        }
      } catch (error) {
        clearTimeout(timeoutId)
        return {
          ok: false,
          error: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
          provider: 'twelvedata',
        }
      }
    },

    async getCandles(symbol, options = {}) {
      if (!apiKey) return { ok: false, error: { code: 'missing_api_key', message: 'Twelve Data API key is not configured' }, provider: 'twelvedata' }
      const interval = normalizeHistoricalInterval(options.interval)
      if (!interval) {
        return { ok: false, error: { code: 'unsupported_interval', message: 'Twelve Data historical candles support only daily intervals in Atlas' }, provider: 'twelvedata' }
      }
      const outputsize = Math.max(260, Math.min(5000, Number(options.limit ?? options.outputsize ?? 260)))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      const startedAt = Date.now()
      try {
        const params = new URLSearchParams({
          symbol: String(symbol ?? '').trim().toUpperCase(),
          interval,
          outputsize: String(outputsize),
          order: 'asc',
          adjust: 'splits',
          apikey: apiKey,
        })
        const response = await fetchImpl(`https://api.twelvedata.com/time_series?${params}`, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (response.status === 429) {
          return { ok: false, provider: 'twelvedata', status: 429, durationMs: Date.now() - startedAt, error: { code: 'provider_rate_limited', message: 'Twelve Data rate limit reached' } }
        }
        if (!response.ok) {
          return { ok: false, provider: 'twelvedata', status: response.status, durationMs: Date.now() - startedAt, error: { code: 'request_failed', message: 'Twelve Data historical request failed' } }
        }
        const payload = await response.json()
        if (payload?.status === 'error' || Number(payload?.code) >= 400) {
          const rateLimited = Number(payload?.code) === 429
          return {
            ok: false,
            provider: 'twelvedata',
            status: Number(payload?.code) || 400,
            durationMs: Date.now() - startedAt,
            error: {
              code: rateLimited ? 'provider_rate_limited' : 'provider_response_error',
              message: rateLimited ? 'Twelve Data rate limit reached' : 'Twelve Data rejected the historical request',
            },
          }
        }
        if (!Array.isArray(payload?.values)) {
          return { ok: false, provider: 'twelvedata', durationMs: Date.now() - startedAt, error: { code: 'malformed_provider_response', message: 'Twelve Data historical response is malformed' } }
        }
        return {
          ok: true,
          provider: 'twelvedata',
          data: payload.values,
          metadata: payload.meta ?? {},
          requestedCount: outputsize,
          durationMs: Date.now() - startedAt,
          receivedAt: new Date().toISOString(),
        }
      } catch (error) {
        clearTimeout(timeoutId)
        return {
          ok: false,
          provider: 'twelvedata',
          durationMs: Date.now() - startedAt,
          error: {
            code: error?.name === 'AbortError' ? 'provider_timeout' : 'request_failed',
            message: error?.name === 'AbortError' ? 'Twelve Data historical request timed out' : 'Twelve Data historical request failed',
          },
        }
      }
    },
  }
}
