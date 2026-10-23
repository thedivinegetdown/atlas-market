import { captureResearchSource, buildProvisionalResearch } from '../../lib/research/provisionalResearch.js'

export const RESEARCH_NOW = '2026-10-20T17:14:00.000Z'
// Consecutive dates are arithmetic fixtures, NOT a fabricated exchange calendar.
export function researchResponse(symbol = 'AAPL', count = 260) {
  const values = Array.from({ length: count }, (_, index) => {
    const close = 150 + index * 0.2 + Math.sin(index / 4) * 3
    return { datetime: new Date(Date.parse('2026-10-20T00:00:00Z') - (count - index - 1) * 86400000).toISOString().slice(0, 10),
      open: close - 0.5, high: close + 2, low: close - 2, close, volume: 1000000 + index * 1000, completed: true }
  })
  return { ok: true, provider: 'twelvedata', receivedAt: RESEARCH_NOW, fallbackUsed: false,
    researchSource: captureResearchSource({ metadata: { symbol, exchange: symbol === 'SPY' ? 'NYSE Arca' : 'NASDAQ', exchange_timezone: 'America/New_York', interval: '1day' }, data: values }) }
}
export function researchOverview(symbol = 'AAPL') {
  return { quote: { symbol, price: 201.8, change: 1.2, changePercent: 0.6, updatedAt: RESEARCH_NOW,
    provenance: { provider: 'twelvedata', dataStatus: 'LIVE', observedAt: RESEARCH_NOW, fallbackUsed: false, mock: false } },
  provisionalResearch: buildProvisionalResearch({ symbol, historyResponse: researchResponse(symbol), benchmarkResponse: researchResponse('SPY'), now: RESEARCH_NOW }) }
}
