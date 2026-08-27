import { buildDailyIndicatorBundle } from '../indicators/buildDailyIndicatorBundle.js'
import { buildMarketContextRegistry } from './marketContextRegistry.js'

export const SECTOR_LEADERSHIP_VERSION = 'sector-leadership-v1'
export const SECTOR_PARTICIPATION_VERSION = 'sector-participation-v1'
export const ATLAS_MARKET_CONTEXT_VERSION = 'atlas-market-context-v1'

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const returnPct = (candles = [], sessions) => candles.length > sessions && number(candles.at(-1)?.close) && number(candles.at(-(sessions + 1))?.close) ? Number((((candles.at(-1).close / candles.at(-(sessions + 1)).close) - 1) * 100).toFixed(2)) : null
const freshness = (bundle = {}) => bundle.asOf && bundle.coverage?.missing?.length === 0 ? 'FRESH' : 'UNAVAILABLE'
const leadershipStatus = (entry) => entry.return20 == null || entry.relativeToSpy20 == null ? 'INSUFFICIENT_DATA' : entry.relativeToSpy20 >= 2 && entry.return20 > 0 ? 'LEADING' : entry.relativeToSpy20 <= -2 && entry.return20 < 0 ? 'LAGGING' : entry.return5 > entry.return20 && entry.relativeToSpy20 > 0 ? 'IMPROVING' : entry.return5 < entry.return20 && entry.relativeToSpy20 < 0 ? 'WEAKENING' : 'NEUTRAL'
const bounded = (values, limit = 5) => values.slice(0, limit)

export function buildSectorLeadership({ candleSets = {}, registry = buildMarketContextRegistry(), generatedAt = new Date().toISOString() } = {}) {
  const spy = candleSets.SPY ?? []
  const sectors = registry.entries.filter((entry) => entry.role === 'SECTOR_PROXY').map((metadata) => {
    const candles = candleSets[metadata.symbol] ?? []
    const bundle = buildDailyIndicatorBundle({ symbol: metadata.symbol, source: candles.at(-1)?.source ?? 'unknown', candles, benchmarkSymbol: 'SPY', benchmarkSource: spy.at(-1)?.source ?? 'unknown', benchmarkCandles: spy, marketOpen: false }, { calculatedAt: generatedAt })
    const return20 = returnPct(candles, 20); const spyReturn20 = returnPct(spy, 20); const relativeToSpy20 = return20 != null && spyReturn20 != null ? Number((return20 - spyReturn20).toFixed(2)) : null
    const item = { symbol: metadata.symbol, marketGroup: metadata.marketGroup, shortTermReturn: returnPct(candles, 5), intermediateReturn: return20, longerReturn: returnPct(candles, 60), relativeToSpy20, trendState: bundle.indicators.price != null && bundle.indicators.mediumMovingAverage != null ? (bundle.indicators.price >= bundle.indicators.mediumMovingAverage ? 'ABOVE_SMA50' : 'BELOW_SMA50') : 'UNAVAILABLE', momentumState: number(bundle.indicators.movingAverageSlopePct) == null ? 'UNAVAILABLE' : bundle.indicators.movingAverageSlopePct > 0 ? 'IMPROVING' : 'WEAKENING', freshness: freshness(bundle), provenance: bundle.provenance.price ?? null, evidenceAvailability: candles.length >= 61 && spy.length >= 21 ? 'AVAILABLE' : 'INSUFFICIENT_DATA' }
    return Object.freeze({ ...item, leadershipStatus: leadershipStatus({ return5: item.shortTermReturn, return20: item.intermediateReturn, relativeToSpy20 }) })
  }).sort((left, right) => (right.relativeToSpy20 ?? -Infinity) - (left.relativeToSpy20 ?? -Infinity) || left.symbol.localeCompare(right.symbol))
  return Object.freeze({ version: SECTOR_LEADERSHIP_VERSION, generatedAt, sectors: Object.freeze(sectors), leaders: Object.freeze(bounded(sectors.filter((entry) => ['LEADING', 'IMPROVING'].includes(entry.leadershipStatus)))), laggards: Object.freeze(bounded(sectors.filter((entry) => ['LAGGING', 'WEAKENING'].includes(entry.leadershipStatus)).sort((left, right) => (left.relativeToSpy20 ?? Infinity) - (right.relativeToSpy20 ?? Infinity) || left.symbol.localeCompare(right.symbol)))), boundaries: Object.freeze({ sectorEtfProxy: true, causalPrediction: false }) })
}

export function buildSectorParticipation({ leadership = {}, registry = buildMarketContextRegistry() } = {}) {
  const sectors = (leadership.sectors ?? []).filter((entry) => entry.evidenceAvailability === 'AVAILABLE')
  const total = registry.entries.filter((entry) => entry.role === 'SECTOR_PROXY').length
  const percentage = (predicate) => sectors.length ? Number((sectors.filter(predicate).length / sectors.length * 100).toFixed(2)) : null
  const coverage = Number((sectors.length / total * 100).toFixed(2))
  const above20 = percentage((entry) => entry.momentumState === 'IMPROVING')
  const above50 = percentage((entry) => entry.trendState === 'ABOVE_SMA50')
  const positive20 = percentage((entry) => entry.intermediateReturn > 0)
  const state = coverage < 70 ? 'INSUFFICIENT_DATA' : above50 >= 70 && positive20 >= 70 ? 'BROAD_STRENGTH' : above50 >= 70 && positive20 < 40 ? 'NARROW_STRENGTH' : above50 <= 30 && positive20 <= 30 ? 'BROAD_WEAKNESS' : 'MIXED'
  return Object.freeze({ version: SECTOR_PARTICIPATION_VERSION, status: state, coverage: { evaluated: sectors.length, configured: total, percentage: coverage, minimumRequiredPercentage: 70 }, percentageAbove20: above20, percentageAbove50: above50, percentageAbove200: null, positive20SessionReturn: positive20, reasons: Object.freeze([state === 'INSUFFICIENT_DATA' ? 'Sector ETF proxy coverage is below the required 70%.' : 'Participation is derived from configured sector ETF proxies, not exchange advance/decline data.']), labels: Object.freeze({ display: 'SECTOR ETF PARTICIPATION PROXY', trueExchangeBreadthAvailable: false }), boundaries: Object.freeze({ sectorEtfProxy: true, trueExchangeBreadthAvailable: false }) })
}

export function buildAtlasMarketContext({ candleSets = {}, marketRegime = null, selectedSymbol = null, selectedCandles = null, sectorProxySymbol = null, registry = buildMarketContextRegistry(), generatedAt = new Date().toISOString() } = {}) {
  const leadership = buildSectorLeadership({ candleSets, registry, generatedAt }); const participation = buildSectorParticipation({ leadership, registry }); const spy = candleSets.SPY ?? []
  const selectedReturn = returnPct(selectedCandles ?? [], 20); const spyReturn = returnPct(spy, 20); const sectorReturn = returnPct(candleSets[sectorProxySymbol] ?? [], 20)
  const candidate = selectedSymbol ? { symbol: selectedSymbol, benchmarkSymbol: 'SPY', sectorProxySymbol: sectorProxySymbol ?? null, benchmarkRelativeStrength: selectedReturn != null && spyReturn != null ? Number((selectedReturn - spyReturn).toFixed(2)) : 'UNAVAILABLE', sectorRelativeStrength: sectorProxySymbol && selectedReturn != null && sectorReturn != null ? Number((selectedReturn - sectorReturn).toFixed(2)) : 'UNAVAILABLE', alignmentStatus: sectorProxySymbol ? 'UNAVAILABLE' : 'UNAVAILABLE', freshness: selectedCandles?.length ? 'FRESH' : 'UNAVAILABLE' } : null
  return Object.freeze({ version: ATLAS_MARKET_CONTEXT_VERSION, generatedAt, benchmarks: Object.freeze(['SPY', 'QQQ', 'IWM'].map((symbol) => ({ symbol, return20: returnPct(candleSets[symbol] ?? [], 20), freshness: (candleSets[symbol] ?? []).length ? 'FRESH' : 'UNAVAILABLE' }))), marketRegime, participation, sectorLeadership: { leaders: leadership.leaders, laggards: leadership.laggards, sectors: leadership.sectors }, selectedCandidateContext: candidate, provenance: { provider: leadership.sectors.find((entry) => entry.provenance)?.provenance?.source ?? 'UNAVAILABLE', completedDailyBars: true }, evidenceAvailability: { sectorLeadership: leadership.sectors.some((entry) => entry.evidenceAvailability === 'AVAILABLE') ? 'AVAILABLE' : 'UNAVAILABLE', participation: participation.status === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA' : 'AVAILABLE' }, boundaries: Object.freeze({ sectorEtfProxy: true, trueExchangeBreadthAvailable: false, strategyOrRankingAuthority: false, empiricalConfidence: 'UNAVAILABLE' }) })
}