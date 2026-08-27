import { calculateAtrPercentileSeries } from '../../market/indicators/indicatorCalculations.js'
import { normalizeDailyCandles } from '../../market/indicators/normalizeDailyCandles.js'

export const VOLATILITY_EXPANSION_STRATEGY_ID = 'volatility-expansion-v1'
export const VOLATILITY_EXPANSION_STRATEGY_VERSION = '1.0.0'
export const VOLATILITY_EXPANSION_SIGNAL_VERSION = 'volatility-expansion-signal-v1'
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const fingerprint = (value) => Array.from(JSON.stringify(value)).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(16)

export function buildVolatilityExpansionSignal({ symbol, currentPrice, candles = [], indicatorBundle = {}, regime = {}, marketContext = {}, evidenceFreshness = 'FRESH', generatedAt = new Date().toISOString() } = {}) {
  const normalized = normalizeDailyCandles(candles, { symbol, now: generatedAt, marketOpen: false }); const completed = normalized.candles; const previousSessions = completed.slice(-20); const indicators = indicatorBundle.indicators ?? {}
  const price = finite(currentPrice), sma20 = finite(indicators.shortMovingAverage), sma50 = finite(indicators.mediumMovingAverage), sma200 = finite(indicators.longMovingAverage), atr14 = finite(indicators.atr), atrPct = finite(indicators.atrPct), atrPercentile = finite(indicators.atrPercentile), adx14 = finite(indicators.adx), rsi14 = finite(indicators.rsi), relativeVolume = finite(indicators.relativeVolume), relativeStrength = finite(indicators.relativeStrengthPct)
  const history = calculateAtrPercentileSeries(completed).slice(-5); const compressionCount = history.filter((value) => value !== null && value <= 30).length; const compressionConfirmed = history.length === 5 && compressionCount >= 3; const prior20High = previousSessions.length === 20 ? Math.max(...previousSessions.map((candle) => finite(candle.high))) : null
  const expansionPercent = price !== null && prior20High !== null ? ((price - prior20High) / prior20High) * 100 : null; const participation = marketContext.participation?.status ?? 'INSUFFICIENT_DATA', sectorAlignment = marketContext.selectedCandidateContext?.alignmentStatus ?? 'UNAVAILABLE'; const blockers = [], cautionReasons = [], reasons = []
  if (String(evidenceFreshness).toUpperCase() !== 'FRESH') blockers.push('Required market evidence is stale')
  if (previousSessions.length !== 20 || history.length !== 5 || history.some((value) => value === null)) blockers.push('Completed ATR-percentile history is insufficient')
  if ([price, atr14, atrPct, atrPercentile, sma20, sma50, adx14, rsi14, relativeVolume].some((value) => value === null)) blockers.push('Required volatility evidence is unavailable')
  if (!compressionConfirmed) blockers.push('Prior compression is not confirmed')
  if (price !== null && prior20High !== null && price <= prior20High) blockers.push('Current price has not strictly exceeded the prior 20-session high')
  if (relativeVolume !== null && relativeVolume < 1.2) blockers.push('Relative volume is below 1.20')
  if (adx14 !== null && adx14 < 20) blockers.push('ADX14 is below 20')
  if (rsi14 !== null && (rsi14 < 55 || rsi14 > 75)) blockers.push('RSI14 must be between 55 and 75')
  if (sma20 !== null && sma50 !== null && sma20 <= sma50) blockers.push('SMA20 must be greater than SMA50')
  if (sma50 !== null && sma200 !== null && sma50 <= sma200) cautionReasons.push('SMA50 is not greater than SMA200')
  if (['BEAR', 'STRONG_BEAR'].includes(regime.classification?.trendRegime ?? regime.trendRegime) || (regime.classification?.riskRegime ?? regime.riskRegime) === 'RISK_OFF' || participation === 'BROAD_WEAKNESS') blockers.push('Regime or market participation is incompatible')
  if (['RANGE'].includes(regime.classification?.trendRegime ?? regime.trendRegime) || ['NEUTRAL'].includes(regime.classification?.riskRegime ?? regime.riskRegime) || ['NARROW_STRENGTH', 'MIXED'].includes(participation)) cautionReasons.push('Regime or market participation is conditional')
  if (!blockers.length) reasons.push('Confirmed prior volatility compression resolved through fresh upward expansion')
  const status = String(evidenceFreshness).toUpperCase() !== 'FRESH' ? 'STALE' : blockers.some((reason) => reason.includes('insufficient') || reason.includes('unavailable')) ? 'INSUFFICIENT_DATA' : blockers.length ? 'REJECTED' : cautionReasons.length ? 'CONDITIONAL' : 'ENABLED'
  const core = { signalVersion: VOLATILITY_EXPANSION_SIGNAL_VERSION, symbol: String(symbol ?? '').toUpperCase(), side: 'LONG', strategyId: VOLATILITY_EXPANSION_STRATEGY_ID, strategyVersion: VOLATILITY_EXPANSION_STRATEGY_VERSION, strategyFamily: 'volatility-expansion', timeframe: '1D', currentPrice: price, prior20High, SMA20: sma20, SMA50: sma50, SMA200: sma200, ATR14: atr14, atrPct, atrPercentile, priorCompressionPercentiles: history, compressionCount, compressionWindow: 5, compressionConfirmed, expansionPercent, ADX14: adx14, RSI14: rsi14, relativeVolume, relativeStrength, regime: regime.classification ?? regime, marketParticipation: participation, sectorAlignment, evidenceFreshness: String(evidenceFreshness).toUpperCase(), evidenceCoverage: indicatorBundle.coverage ?? { available: [], missing: [] }, suitabilityStatus: status, reasons, cautionReasons, blockers, generatedAt }
  return Object.freeze({ ...core, strategyFingerprint: fingerprint(core) })
}