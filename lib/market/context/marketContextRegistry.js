export const MARKET_CONTEXT_REGISTRY_VERSION = 'market-context-universe-v1'

const ENTRIES = Object.freeze([
  ['SPY', 'CORE_BENCHMARK', 'broad-market', 'S&P 500', 'SPY'], ['QQQ', 'CORE_BENCHMARK', 'growth-benchmark', 'Nasdaq 100', 'SPY'], ['IWM', 'CORE_BENCHMARK', 'small-cap-benchmark', 'Russell 2000', 'SPY'],
  ['XLK', 'SECTOR_PROXY', 'technology', 'Technology', 'SPY'], ['XLF', 'SECTOR_PROXY', 'financials', 'Financials', 'SPY'], ['XLE', 'SECTOR_PROXY', 'energy', 'Energy', 'SPY'], ['XLV', 'SECTOR_PROXY', 'health-care', 'Health Care', 'SPY'], ['XLI', 'SECTOR_PROXY', 'industrials', 'Industrials', 'SPY'], ['XLY', 'SECTOR_PROXY', 'consumer-discretionary', 'Consumer Discretionary', 'SPY'], ['XLP', 'SECTOR_PROXY', 'consumer-staples', 'Consumer Staples', 'SPY'], ['XLU', 'SECTOR_PROXY', 'utilities', 'Utilities', 'SPY'], ['XLB', 'SECTOR_PROXY', 'materials', 'Materials', 'SPY'], ['XLRE', 'SECTOR_PROXY', 'real-estate', 'Real Estate', 'SPY'], ['XLC', 'SECTOR_PROXY', 'communication-services', 'Communication Services', 'SPY'],
].map(([symbol, role, marketGroup, displayName, benchmarkSymbol]) => Object.freeze({ symbol, role, marketGroup, displayName, benchmarkSymbol, enabled: true, evidenceRequirements: Object.freeze({ minimumDailyCandles: 200, completedDailyBars: true }) })))

export function buildMarketContextRegistry({ entries = ENTRIES } = {}) {
  const normalized = entries.filter((entry) => entry.enabled !== false).map((entry) => ({ ...entry, symbol: String(entry.symbol ?? '').toUpperCase() }))
  if (normalized.some((entry) => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(entry.symbol)) || new Set(normalized.map((entry) => entry.symbol)).size !== normalized.length) throw new Error('market context registry is invalid')
  return Object.freeze({ version: MARKET_CONTEXT_REGISTRY_VERSION, entries: Object.freeze(normalized.sort((left, right) => left.symbol.localeCompare(right.symbol)).map(Object.freeze)), refreshSymbols: Object.freeze(['SPY', 'QQQ', 'IWM', 'XLK', 'XLF']), boundaries: Object.freeze({ sectorEtfProxy: true, trueExchangeBreadthAvailable: false, registrationChangesStrategyEligibility: false }) })
}