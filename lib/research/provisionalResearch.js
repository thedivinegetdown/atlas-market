import { calculateAtr, calculateRelativeStrength, calculateSma, alignCandlesByTradingDate } from '../market/indicators/indicatorCalculations.js'

export const PROVISIONAL_RESEARCH = 'PROVISIONAL_RESEARCH_ESTIMATE'
const VERSION = 'provisional-research-v1'
const UNCERTAINTY = 'Provider observations are revisable. Finality, corrections, calendar completeness and missing sessions are not independently qualified.'
const EXCHANGE_IDENTITIES = Object.freeze({
  NASDAQ: Object.freeze(['XNAS', 'XNGS']),
  NYSE: Object.freeze(['XNYS']),
  'NYSE ARCA': Object.freeze(['ARCX']),
  'NYSE AMERICAN': Object.freeze(['XASE']),
})
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Capture only existing provider response fields. This is NOT calendar/finality authority.
export function captureResearchSource(response = {}) {
  const meta = response.metadata ?? {}
  return {
    instrument: { symbol: meta.symbol ?? null, exchange: meta.exchange ?? null, mic: meta.mic_code ?? null, timezone: meta.exchange_timezone ?? null, interval: meta.interval ?? null },
    adjustmentBasis: 'splits requested; provider revision state unknown',
    observations: (Array.isArray(response.data) ? response.data : []).slice(0, 260).map((bar) => ({
      providerDateLabel: bar.datetime ?? bar.timestamp ?? bar.time ?? null,
      symbol: bar.symbol ?? meta.symbol ?? null,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      completed: bar.completed ?? null, complete: bar.complete ?? null,
    })),
  }
}

function dateLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null
}

function observationHistory(response, symbol, now) {
  const source = response?.researchSource
  const instrument = source?.instrument
  // Twelve Data owns instrument identity fields. Atlas validates the supplied
  // segment/operating MIC against an explicit exchange compatibility set; it
  // does not manufacture a MIC from the human-readable exchange label.
  const exchangeMics = typeof instrument?.exchange === 'string' ? EXCHANGE_IDENTITIES[instrument.exchange.toUpperCase()] : null
  const validExchange = Boolean(exchangeMics)
  const validMic = typeof instrument?.mic === 'string' && exchangeMics?.includes(instrument.mic.toUpperCase())
  const identityValid = response?.ok === true && response.provider === 'twelvedata' && !response.mock && !response.fallbackUsed
    && instrument?.symbol === symbol && instrument?.timezone === 'America/New_York'
    && instrument?.interval === '1day' && validExchange && validMic
    && Number.isFinite(Date.parse(response.receivedAt)) && Date.parse(response.receivedAt) <= Date.parse(now)
  const rejected = []
  const history = { provider: response?.provider ?? 'unavailable', retrievedAt: response?.receivedAt ?? null,
    instrument: instrument ? { ...instrument } : null, adjustmentBasis: source?.adjustmentBasis ?? 'UNKNOWN',
    sessionInterpretation: 'Provider date-only labels in the reported exchange timezone; not certified exchange sessions',
    inputCutoff: null, completion: { status: 'UNKNOWN' }, candles: [], rejected,
    reason: identityValid ? null : !validExchange ? 'Provider exchange identity is unavailable or unsupported'
      : !validMic ? 'Provider MIC identity is unavailable or incompatible with the reported exchange'
        : 'Provider/source identity, timezone, interval or retrieval evidence is unavailable or inconsistent',
    providerError: response?.ok === false ? response.error?.code ?? 'history_unavailable' : null }
  if (!identityValid) return history
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: instrument.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  const byDate = new Map()
  const duplicates = new Set()
  for (const bar of source.observations ?? []) {
    const date = dateLabel(bar.providerDateLabel)
    const numbers = ['open', 'high', 'low', 'close', 'volume'].map((key) => bar[key] === null || bar[key] === '' || bar[key] === undefined ? NaN : Number(bar[key]))
    const [open, high, low, close, volume] = numbers
    let reason = !date ? 'ambiguous_date_label' : bar.symbol !== symbol ? 'symbol_mismatch'
      : date >= today ? 'current_or_future_exchange_date' : bar.completed === false || bar.complete === false ? 'explicitly_incomplete'
        : [bar.completed, bar.complete].some(flag => flag !== null && flag !== undefined && typeof flag !== 'boolean') ? 'ambiguous_completion_flag'
        : !numbers.every(Number.isFinite) || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, low, close) || low > Math.min(open, close) ? 'invalid_ohlcv' : null
    if (date && byDate.has(date)) { duplicates.add(date); reason = 'duplicate_revision_ambiguous' }
    if (reason) { rejected.push({ providerDateLabel: bar.providerDateLabel, reason }); if (date) duplicates.add(date); continue }
    byDate.set(date, { timestamp: `${date}T00:00:00.000Z`, sessionDate: date, providerDateLabel: bar.providerDateLabel,
      open, high, low, close, volume, symbol, source: response.provider, completion: 'UNKNOWN' })
  }
  history.candles = [...byDate.entries()].filter(([date]) => !duplicates.has(date)).sort(([a], [b]) => a.localeCompare(b)).map(([, bar]) => bar)
  history.inputCutoff = history.candles.at(-1)?.sessionDate ?? null
  if (!history.candles.length) history.reason = 'No usable prior-date provisional observations'
  return history
}

export function buildProvisionalResearch({ symbol, historyResponse, benchmarkResponse, now = new Date().toISOString() }) {
  const history = observationHistory(structuredClone(historyResponse), symbol, now)
  const benchmark = symbol === 'SPY' ? history : observationHistory(structuredClone(benchmarkResponse), 'SPY', now)
  const candles = history.candles
  const closes = candles.map((bar) => bar.close)
  const aligned = alignCandlesByTradingDate(candles, benchmark.candles)
  const alignedThroughCutoff = Boolean(history.inputCutoff && aligned.at(-1)?.symbol.sessionDate === history.inputCutoff)
  const atr = calculateAtr(candles, 14).value
  const estimates = {
    shortMovingAverage: calculateSma(closes, 20), mediumMovingAverage: calculateSma(closes, 50), longMovingAverage: calculateSma(closes, 200),
    atr, atrPct: atr !== null && closes.length ? atr / closes.at(-1) * 100 : null,
    relativeStrengthPct: alignedThroughCutoff ? calculateRelativeStrength(candles, benchmark.candles, 20) : null,
  }
  return freeze({ version: VERSION, evidenceClass: PROVISIONAL_RESEARCH, completion: { status: 'UNKNOWN' }, symbol,
    calculatedAt: now, authoritativeCompletedSessionCutoff: null, revisionUncertainty: UNCERTAINTY,
    history, benchmark: { provider: benchmark.provider, retrievedAt: benchmark.retrievedAt, inputCutoff: benchmark.inputCutoff, reason: benchmark.reason, providerError: benchmark.providerError },
    estimates: { inputCutoff: history.inputCutoff, values: estimates },
    sufficiency: { observations: candles.length, alignedObservations: aligned.length, available: Object.keys(estimates).filter((key) => estimates[key] !== null),
      missing: Object.keys(estimates).filter((key) => estimates[key] === null), requirements: { sma20: 20, sma50: 50, sma200: 200, atr14: 15, relativeStrength: 21, technicalLevels: 20 } },
  })
}
