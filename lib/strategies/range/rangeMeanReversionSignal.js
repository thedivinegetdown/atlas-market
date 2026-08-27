import { normalizeDailyCandles } from '../../market/indicators/normalizeDailyCandles.js'

export const RANGE_MEAN_REVERSION_STRATEGY_ID = 'range-mean-reversion-v1'
export const RANGE_MEAN_REVERSION_STRATEGY_VERSION = '1.0.0'
export const RANGE_MEAN_REVERSION_SIGNAL_VERSION = 'range-mean-reversion-signal-v1'

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const fingerprint = (value) => Array.from(JSON.stringify(value)).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(16)

export function buildRangeMeanReversionSignal({ symbol, currentPrice, candles = [], indicatorBundle = {}, regime = {}, marketContext = {}, evidenceFreshness = 'FRESH', generatedAt = new Date().toISOString() } = {}) {
  const normalized = normalizeDailyCandles(candles, { symbol, now: generatedAt, marketOpen: false })
  const previousSessions = normalized.candles.slice(-20)
  const indicators = indicatorBundle.indicators ?? {}
  const price = finite(currentPrice), sma20 = finite(indicators.shortMovingAverage), atr14 = finite(indicators.atr), adx14 = finite(indicators.adx), rsi14 = finite(indicators.rsi), relativeVolume = finite(indicators.relativeVolume), relativeStrength = finite(indicators.relativeStrengthPct)
  const prior20Low = previousSessions.length === 20 ? Math.min(...previousSessions.map((candle) => finite(candle.low))) : null
  const stretchAtr = sma20 !== null && price !== null && atr14 !== null && atr14 > 0 ? (sma20 - price) / atr14 : null
  const participation = marketContext.participation?.status ?? 'INSUFFICIENT_DATA', sectorAlignment = marketContext.selectedCandidateContext?.alignmentStatus ?? 'UNAVAILABLE'
  const blockers = [], cautionReasons = [], reasons = []
  if (String(evidenceFreshness).toUpperCase() !== 'FRESH') blockers.push('Required market evidence is stale')
  if (previousSessions.length !== 20 || prior20Low === null) blockers.push('Exactly 20 completed daily sessions are required for the range low')
  if (price === null || sma20 === null || atr14 === null || atr14 <= 0 || adx14 === null || rsi14 === null) blockers.push('Required range evidence is unavailable')
  if (price !== null && prior20Low !== null && price <= prior20Low) blockers.push('Current price is at or below the prior 20-session low')
  if (stretchAtr !== null && stretchAtr < 0.75) blockers.push('Price is not at least 0.75 ATR below SMA20')
  if (rsi14 !== null && (rsi14 < 30 || rsi14 > 40)) blockers.push('RSI14 must be between 30 and 40')
  if (adx14 !== null && adx14 > 25) blockers.push('ADX14 is above 25 and incompatible with range mean reversion')
  if (adx14 !== null && adx14 >= 20 && adx14 <= 25) cautionReasons.push('ADX14 is between 20 and 25')
  if (relativeVolume !== null && relativeVolume >= 2) blockers.push('Relative volume is at least 2.00')
  else if (relativeVolume !== null && relativeVolume > 1.5) cautionReasons.push('Relative volume is above 1.50')
  if (relativeStrength !== null && relativeStrength < 0) cautionReasons.push('Benchmark-relative strength is negative')
  if (['BEAR', 'STRONG_BEAR'].includes(regime.classification?.trendRegime ?? regime.trendRegime)) blockers.push('Trend regime is incompatible with long range mean reversion')
  if ((regime.classification?.riskRegime ?? regime.riskRegime) === 'RISK_OFF') blockers.push('Risk regime is RISK_OFF')
  if (participation === 'BROAD_WEAKNESS') blockers.push('Market participation is broad weakness')
  if (['BULL', 'STRONG_BULL', 'BROAD_STRENGTH', 'NARROW_STRENGTH'].includes(regime.classification?.trendRegime ?? regime.trendRegime) || ['BROAD_STRENGTH', 'NARROW_STRENGTH'].includes(participation)) cautionReasons.push('Trend or participation context is conditional for mean reversion')
  if (!blockers.length) reasons.push('Fresh range evidence is structurally intact and sufficiently stretched below SMA20')
  const status = String(evidenceFreshness).toUpperCase() !== 'FRESH' ? 'STALE' : blockers.some((reason) => reason.includes('unavailable') || reason.includes('Exactly 20')) ? 'INSUFFICIENT_DATA' : blockers.length ? 'REJECTED' : cautionReasons.length ? 'CONDITIONAL' : 'ENABLED'
  const core = { signalVersion: RANGE_MEAN_REVERSION_SIGNAL_VERSION, symbol: String(symbol ?? '').toUpperCase(), side: 'LONG', strategyId: RANGE_MEAN_REVERSION_STRATEGY_ID, strategyVersion: RANGE_MEAN_REVERSION_STRATEGY_VERSION, strategyFamily: 'range-mean-reversion', timeframe: '1D', currentPrice: price, prior20Low, SMA20: sma20, ATR14: atr14, stretchAtr, ADX14: adx14, RSI14: rsi14, relativeVolume, relativeStrength, regime: regime.classification ?? regime, marketParticipation: participation, sectorAlignment, evidenceFreshness: String(evidenceFreshness).toUpperCase(), evidenceCoverage: indicatorBundle.coverage ?? { available: [], missing: [] }, suitabilityStatus: status, reasons, cautionReasons, blockers, generatedAt }
  return Object.freeze({ ...core, strategyFingerprint: fingerprint(core) })
}