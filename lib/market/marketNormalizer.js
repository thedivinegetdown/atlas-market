export function normalizeQuote(rawQuote, provider = 'unknown') {
  const quote = rawQuote ?? {}
  return {
    symbol: quote.symbol ?? '',
    price: Number(quote.price ?? 0),
    open: Number(quote.open ?? quote.price ?? 0),
    high: Number(quote.high ?? quote.price ?? 0),
    low: Number(quote.low ?? quote.price ?? 0),
    previousClose: Number(quote.previousClose ?? quote.previous_close ?? quote.price ?? 0),
    change: Number(quote.change ?? 0),
    changePercent: Number(quote.changePercent ?? quote.percent_change ?? 0),
    volume: Number(quote.volume ?? 0),
    provider,
    updatedAt: quote.updatedAt ?? new Date().toISOString(),
  }
}
