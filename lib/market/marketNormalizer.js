import { getSymbolMetadata } from '../assets/index.js'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normalizeQuote(rawQuote, provider = 'unknown', options = {}) {
  const quote = rawQuote ?? {}
  const metadata = getSymbolMetadata(quote.symbol ?? options.symbol, options.assetType ?? quote.assetType)
  const price = numberValue(quote.price ?? quote.last ?? quote.close)
  return {
    symbol: metadata.symbol,
    price,
    open: numberValue(quote.open, price),
    high: numberValue(quote.high, price),
    low: numberValue(quote.low, price),
    previousClose: numberValue(quote.previousClose ?? quote.previous_close, price),
    change: numberValue(quote.change),
    changePercent: numberValue(quote.changePercent ?? quote.percent_change),
    volume: numberValue(quote.volume),
    provider,
    updatedAt: normalizeTimestamp(quote.updatedAt ?? quote.timestamp),
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
