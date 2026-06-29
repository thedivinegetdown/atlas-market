import { useMemo } from 'react'
import { createSignalEngine } from '../../lib/signals/signalEngine.js'

const signalEngine = createSignalEngine()

const fallbackQuote = {
  symbol: 'SPY',
  price: 100,
  open: 99.5,
  high: 101,
  low: 99,
  previousClose: 99.7,
  change: 0.3,
  changePercent: 0.3,
  volume: 1000000,
}

export function useSignals(quote) {
  return useMemo(() => {
    const signal = signalEngine.evaluateQuote(quote ?? fallbackQuote)
    return { signal }
  }, [quote])
}
