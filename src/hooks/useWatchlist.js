import { useEffect, useMemo, useState } from 'react'
import { createMarketDataService } from '../../lib/market/marketDataService.js'

const marketDataService = createMarketDataService()
const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']

export function useWatchlist() {
  const [quotes, setQuotes] = useState([])
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbols[0])
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchQuotes = async () => {
    setIsRefreshing(true)
    const nextQuotes = await marketDataService.getWatchlistQuotes()
    setQuotes(nextQuotes)
    setIsRefreshing(false)
  }

  useEffect(() => {
    void fetchQuotes()
  }, [])

  const selectedQuote = useMemo(() => {
    return quotes.find((quote) => quote.symbol === selectedSymbol) ?? quotes[0] ?? null
  }, [quotes, selectedSymbol])

  return {
    quotes,
    selectedSymbol,
    setSelectedSymbol,
    selectedQuote,
    isRefreshing,
    refresh: fetchQuotes,
  }
}
