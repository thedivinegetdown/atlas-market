import { createMarketDataService } from '../market/marketDataService.js'
import { buildProvisionalResearch } from './provisionalResearch.js'

const request = Object.freeze({ interval: '1day', limit: 260 })
const limited = (result) => result?.statusCode === 429 || result?.status === 429 || /rate_limit|backoff|budget|quota/.test(result?.error?.code ?? '')
export function createProvisionalResearchService({ marketDataService = createMarketDataService(), clock = () => new Date().toISOString() } = {}) {
  return {
    async read(symbol, { skipQuote = false } = {}) {
      // Sequential, existing pacing/cache only. No retry or benchmark acquisition after limiting.
      const quote = skipQuote ? null : await marketDataService.getQuote(symbol)
      if (quote?.marketDataIssue?.classification === 'RATE_LIMITED') {
        return { quote, provisionalResearch: buildProvisionalResearch({ symbol, historyResponse: { ok: false, provider: quote.marketDataIssue.provider, error: { code: quote.marketDataIssue.code } }, now: clock() }) }
      }
      const historyResponse = await marketDataService.getCandles(symbol, request)
      const preliminary = buildProvisionalResearch({ symbol, historyResponse, now: clock() })
      const benchmarkResponse = symbol === 'SPY' ? historyResponse : historyResponse?.ok && !limited(historyResponse) && preliminary.sufficiency.observations >= 21
        ? await marketDataService.getCandles('SPY', request) : null
      return { quote, provisionalResearch: buildProvisionalResearch({ symbol, historyResponse, benchmarkResponse, now: clock() }) }
    },
  }
}
