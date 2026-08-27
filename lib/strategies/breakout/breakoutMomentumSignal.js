import { normalizeDailyCandles } from '../../market/indicators/normalizeDailyCandles.js'

export const BREAKOUT_MOMENTUM_STRATEGY_ID = 'breakout-momentum-v1'
export const BREAKOUT_MOMENTUM_STRATEGY_VERSION = '1.0.0'
export const BREAKOUT_MOMENTUM_SIGNAL_VERSION = 'breakout-momentum-signal-v1'

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const fingerprint = (value) => Array.from(JSON.stringify(value)).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(16)

function contextStatus(marketContext = {}) {
  const participation = marketContext.participation?.status ?? 'INSUFFICIENT_DATA'
  const sectorAlignment = marketContext.selectedCandidateContext?.alignmentStatus ?? 'UNAVAILABLE'
  return { participation, sectorAlignment }
}

export function buildBreakoutMomentumSignal({
  symbol,
  currentPrice,
  candles = [],
  indicatorBundle = {},
  regime = {},
  marketContext = {},
  evidenceFreshness = 'FRESH',
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalized = normalizeDailyCandles(candles, { symbol, now: generatedAt, marketOpen: false })
  const previousSessions = normalized.candles.slice(-20)
  const indicators = indicatorBundle.indicators ?? {}
  const price = finite(currentPrice)
  const prior20High = previousSessions.length === 20 ? Math.max(...previousSessions.map((candle) => finite(candle.high))) : null
  const sma20 = finite(indicators.shortMovingAverage)
  const sma50 = finite(indicators.mediumMovingAverage)
  const sma200 = finite(indicators.longMovingAverage)
  const adx14 = finite(indicators.adx)
  const rsi14 = finite(indicators.rsi)
  const relativeVolume = finite(indicators.relativeVolume)
  const relativeStrength = finite(indicators.relativeStrengthPct)
  const { participation, sectorAlignment } = contextStatus(marketContext)
  const reasons = []
  const cautionReasons = []
  const blockers = []

  if (String(evidenceFreshness).toUpperCase() !== 'FRESH') blockers.push('Required market evidence is stale')
  if (previousSessions.length !== 20 || prior20High === null) blockers.push('Exactly 20 completed daily sessions are required for the breakout level')
  if (price === null) blockers.push('Authoritative current price is unavailable')
  if (sma20 === null || sma50 === null || sma200 === null) blockers.push('Required moving-average evidence is unavailable')
  else if (!(sma20 > sma50 && sma50 > sma200)) blockers.push('SMA20 must be greater than SMA50 and SMA50 must be greater than SMA200')
  if (adx14 === null) blockers.push('ADX14 is unavailable')
  else if (adx14 < 20) blockers.push('ADX14 is below 20')
  if (rsi14 === null) blockers.push('RSI14 is unavailable')
  else if (rsi14 < 55 || rsi14 > 75) blockers.push('RSI14 must be between 55 and 75')
  if (relativeVolume === null) blockers.push('Relative volume is unavailable')
  else if (relativeVolume < 1.2) blockers.push('Relative volume is below 1.20')
  if (relativeStrength === null) blockers.push('Benchmark-relative strength is unavailable')
  else if (relativeStrength <= 0) blockers.push('Benchmark-relative strength must be positive')
  if (price !== null && prior20High !== null && price <= prior20High) blockers.push('Current price has not strictly exceeded the prior 20-session high')
  if (participation === 'BROAD_WEAKNESS') blockers.push('Market participation is broad weakness')
  if (['NARROW_STRENGTH', 'MIXED'].includes(participation)) cautionReasons.push(`Market participation is ${participation}`)
  if (['MISALIGNED', 'INSUFFICIENT_DATA'].includes(sectorAlignment)) cautionReasons.push(`Sector alignment is ${sectorAlignment}`)

  const breakoutPercent = price !== null && prior20High !== null ? ((price - prior20High) / prior20High) * 100 : null
  if (!blockers.length) reasons.push('Current price strictly exceeds the prior 20-session high with required trend, momentum, volume, and relative-strength evidence')
  const status = String(evidenceFreshness).toUpperCase() !== 'FRESH'
    ? 'STALE'
    : blockers.some((reason) => reason.includes('unavailable') || reason.includes('Exactly 20'))
      ? 'INSUFFICIENT_DATA'
      : blockers.length ? 'REJECTED' : cautionReasons.length ? 'CONDITIONAL' : 'ENABLED'
  const core = {
    signalVersion: BREAKOUT_MOMENTUM_SIGNAL_VERSION,
    symbol: String(symbol ?? '').toUpperCase(), side: 'LONG', strategyId: BREAKOUT_MOMENTUM_STRATEGY_ID,
    strategyVersion: BREAKOUT_MOMENTUM_STRATEGY_VERSION, timeframe: '1D', currentPrice: price, prior20High,
    breakoutPercent, SMA20: sma20, SMA50: sma50, SMA200: sma200, ADX14: adx14, RSI14: rsi14,
    relativeVolume, relativeStrength, regime: regime.classification ?? regime, marketParticipation: participation,
    sectorAlignment, evidenceFreshness: String(evidenceFreshness).toUpperCase(),
    evidenceCoverage: indicatorBundle.coverage ?? { available: [], missing: [] }, suitabilityStatus: status,
    reasons, cautionReasons, blockers, generatedAt,
  }
  return Object.freeze({ ...core, strategyFingerprint: fingerprint(core) })
}