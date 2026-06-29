import { createId } from '../core/id.js'

export function createMockMarketDataProvider() {
  const watchlist = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']

  return {
    async getQuote(symbol) {
      const normalized = symbol?.toUpperCase()
      const isWatchlist = watchlist.includes(normalized)

      if (!isWatchlist) {
        return {
          ok: false,
          error: 'unsupported_symbol',
          provider: 'mock',
        }
      }

      const basePrice = 100 + watchlist.indexOf(normalized) * 7
      const price = Number((basePrice + (normalized.length % 3) * 0.5).toFixed(2))
      const open = Number((price - 0.4).toFixed(2))
      const high = Number((price + 0.8).toFixed(2))
      const low = Number((price - 0.9).toFixed(2))
      const previousClose = Number((price - 0.3).toFixed(2))
      const change = Number((price - previousClose).toFixed(2))
      const changePercent = Number(((change / previousClose) * 100).toFixed(2))
      const volume = 1000000 + watchlist.indexOf(normalized) * 25000

      return {
        ok: true,
        provider: 'mock',
        health: {
          status: 'healthy',
          available: true,
          requestId: createId('mock'),
        },
        data: {
          symbol: normalized,
          price,
          open,
          high,
          low,
          previousClose,
          change,
          changePercent,
          volume,
        },
      }
    },
  }
}
