import { getSymbolMetadata } from '../assets/index.js'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function executableValue(value, { allowZero = false } = {}) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0) ? number : null
}

const OFFSET_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

export function normalizeSourceObservationTimestamp(value) {
  if (value === null || value === undefined || value === '') return { value: null, status: 'MISSING' }
  let milliseconds
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    milliseconds = value < 1_000_000_000_000 ? value * 1000 : value
  } else if (typeof value === 'string' && /^\d{10}(?:\d{3})?$/.test(value)) {
    const numeric = Number(value)
    milliseconds = value.length === 10 ? numeric * 1000 : numeric
  } else if (typeof value === 'string' && OFFSET_ISO_TIMESTAMP.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    const calendarDate = new Date(0)
    calendarDate.setUTCFullYear(year, month - 1, day)
    const sourceDate = value.slice(0, 10)
    if (calendarDate.toISOString().slice(0, 10) === sourceDate) milliseconds = Date.parse(value)
  }
  if (!Number.isFinite(milliseconds)) return { value: null, status: 'MALFORMED' }
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime())
    ? { value: null, status: 'MALFORMED' }
    : { value: date.toISOString(), status: 'VALID' }
}

export function normalizeQuote(rawQuote, provider = 'unknown', options = {}) {
  const quote = rawQuote ?? {}
  const metadata = getSymbolMetadata(quote.symbol ?? options.symbol, options.assetType ?? quote.assetType)
  const price = numberValue(quote.price ?? quote.last ?? quote.close)
  const rawSourceTimestamp = Object.hasOwn(quote, 'sourceObservedAt')
    ? quote.sourceObservedAt
    : quote.updatedAt ?? quote.timestamp
  const sourceTimestamp = normalizeSourceObservationTimestamp(rawSourceTimestamp)
  const sourceTimestampStatus = ['VALID', 'MISSING', 'MALFORMED'].includes(quote.sourceTimestampStatus)
    ? quote.sourceTimestampStatus === sourceTimestamp.status ? sourceTimestamp.status : 'MALFORMED'
    : sourceTimestamp.status
  return {
    symbol: metadata.symbol,
    price,
    bid: executableValue(quote.bid),
    ask: executableValue(quote.ask),
    bidSize: executableValue(Object.hasOwn(quote, 'bidSize') ? quote.bidSize : quote.bid_size, { allowZero: true }),
    askSize: executableValue(Object.hasOwn(quote, 'askSize') ? quote.askSize : quote.ask_size, { allowZero: true }),
    open: numberValue(quote.open, price),
    high: numberValue(quote.high, price),
    low: numberValue(quote.low, price),
    previousClose: numberValue(quote.previousClose ?? quote.previous_close, price),
    change: numberValue(quote.change),
    changePercent: numberValue(quote.changePercent ?? quote.percent_change),
    volume: numberValue(quote.volume),
    provider,
    updatedAt: sourceTimestamp.value,
    sourceObservedAt: sourceTimestamp.value,
    sourceTimestampStatus,
  }
}

export function normalizeCandle(rawCandle, provider = 'unknown', options = {}) {
  const candle = rawCandle ?? {}
  const metadata = getSymbolMetadata(candle.symbol ?? options.symbol, options.assetType ?? candle.assetType)
  const close = numberValue(candle.close ?? candle.price)

  return {
    symbol: metadata.symbol,
    assetType: metadata.assetType,
    open: numberValue(candle.open, close),
    high: numberValue(candle.high, close),
    low: numberValue(candle.low, close),
    close,
    volume: numberValue(candle.volume),
    interval: String(candle.interval ?? options.interval ?? '1d'),
    provider,
    timestamp: normalizeTimestamp(candle.timestamp ?? candle.updatedAt),
  }
}

export function normalizeSymbolMetadata(symbol, options = {}) {
  const metadata = getSymbolMetadata(symbol, options.assetType)

  return {
    symbol: metadata.symbol,
    assetType: metadata.assetType,
    baseCurrency: metadata.baseCurrency,
    quoteCurrency: metadata.quoteCurrency,
    quantityTerm: metadata.profile.quantityTerm,
    pricePrecision: metadata.profile.pricePrecision,
    tickSize: metadata.profile.tickSize,
    tradingSession: metadata.profile.tradingSession,
    margin: metadata.profile.margin,
  }
}

export function isMarketDataStale(updatedAt, { now = new Date(), staleAfterMs = 90000 } = {}) {
  const updatedTime = new Date(updatedAt).getTime()
  const nowTime = new Date(now).getTime()

  if (!Number.isFinite(updatedTime) || !Number.isFinite(nowTime)) return true
  return nowTime - updatedTime > staleAfterMs
}
