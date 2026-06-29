const DEFAULT_TIMEOUT_MS = 4000

export function createFinnhubClient({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    async getQuote(symbol) {
      if (!apiKey) {
        return { ok: false, error: 'missing_api_key', provider: 'finnhub' }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, {
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          return { ok: false, error: 'request_failed', provider: 'finnhub', status: response.status }
        }

        const payload = await response.json()
        return {
          ok: true,
          provider: 'finnhub',
          data: {
            symbol,
            price: payload.c,
            open: payload.o,
            high: payload.h,
            low: payload.l,
            previousClose: payload.pc,
            change: payload.d,
            changePercent: payload.dp,
            volume: payload.v,
          },
        }
      } catch (error) {
        clearTimeout(timeoutId)
        return {
          ok: false,
          error: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
          provider: 'finnhub',
        }
      }
    },
  }
}
