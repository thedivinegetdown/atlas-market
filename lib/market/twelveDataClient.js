const DEFAULT_TIMEOUT_MS = 4000

export function createTwelveDataClient({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    async getQuote(symbol) {
      if (!apiKey) {
        return { ok: false, error: 'missing_api_key', provider: 'twelvedata' }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`, {
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
  }
}
