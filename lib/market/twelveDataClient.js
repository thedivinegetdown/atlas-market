import { normalizeHistoricalInterval } from './historicalCandleNormalizer.js'

const DEFAULT_TIMEOUT_MS = 4000
const APPROVED_HISTORY_SIZE = 260

function retryAfterSeconds(response) {
  const value = response?.headers?.get?.('retry-after')
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
}

function headerValue(response, names) {
  for (const name of names) {
    const value = response?.headers?.get?.(name)
    if (value) return value
  }
  return null
}

function resetMetadata(response) {
  const value = headerValue(response, ['ratelimit-reset', 'x-ratelimit-reset', 'x-rate-limit-reset'])
  if (!value) return { resetAt: null, resetSeconds: null }
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    const resetAt = numeric > 1_000_000_000 ? new Date(numeric * 1000) : null
    return {
      resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt.toISOString() : null,
      resetSeconds: resetAt ? Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) : Math.max(0, Math.ceil(numeric)),
    }
  }
  const resetAt = new Date(value)
  return {
    resetAt: Number.isNaN(resetAt.getTime()) ? null : resetAt.toISOString(),
    resetSeconds: Number.isNaN(resetAt.getTime()) ? null : Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
  }
}

function quotaScope(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (/daily|per[ -]?day|day quota/.test(normalized)) return 'daily'
  if (/minute|per[ -]?minute|per[ -]?min|minute quota/.test(normalized)) return 'minute'
  return 'unknown'
}

function sanitizedMessageCategory({ errorCode, httpStatus, message, quotaScope: quotaScopeValue }) {
  const normalizedMessage = String(message ?? '').toLowerCase()
  if (quotaScopeValue === 'daily' || quotaScope(normalizedMessage) === 'daily') return 'DAILY_QUOTA'
  if (errorCode === 'provider_rate_limited' || httpStatus === 429) return 'RATE_LIMIT'
  if (errorCode === 'missing_api_key' || httpStatus === 401 || httpStatus === 403 || /api key|auth|credential/.test(normalizedMessage)) return 'AUTH'
  if (errorCode === 'unsupported_interval' || errorCode === 'unsupported_history_size' || errorCode === 'unsupported_history_range' || /invalid request|bad request|invalid symbol/.test(normalizedMessage)) return 'INVALID_REQUEST'
  if (errorCode === 'provider_timeout' || errorCode === 'timeout') return 'TIMEOUT'
  if (errorCode === 'request_failed' && httpStatus == null) return 'NETWORK'
  if (errorCode === 'provider_response_error' || errorCode === 'malformed_provider_response' || httpStatus != null) return 'PROVIDER_ERROR'
  return 'UNKNOWN'
}

function normalizedErrorClass(errorCode, category) {
  if (category === 'RATE_LIMIT' || category === 'DAILY_QUOTA') return 'RATE_LIMITED'
  if (category === 'AUTH') return 'AUTHENTICATION'
  if (category === 'INVALID_REQUEST') return 'INVALID_REQUEST'
  if (category === 'NETWORK') return 'NETWORK'
  if (category === 'TIMEOUT') return 'TIMEOUT'
  if (category === 'PROVIDER_ERROR') return 'PROVIDER_ERROR'
  return errorCode ? 'UNKNOWN' : 'UNKNOWN'
}

function createFailure({ operation, response, payload, errorCode, message, retryAfter = null }) {
  const httpStatus = Number.isInteger(response?.status) ? response.status : null
  const providerErrorCode = Number.isFinite(Number(payload?.code)) ? Number(payload.code) : null
  const scope = quotaScope(payload?.quota_scope ?? payload?.meta?.quota_scope ?? headerValue(response, ['ratelimit-scope', 'x-ratelimit-scope', 'x-rate-limit-scope']) ?? message)
  const sanitizedMessageCategoryValue = sanitizedMessageCategory({ errorCode, httpStatus, message, quotaScope: scope })
  return {
    operation,
    provider: 'twelvedata',
    httpStatus,
    providerErrorCode,
    normalizedErrorCode: errorCode,
    normalizedErrorClass: normalizedErrorClass(errorCode, sanitizedMessageCategoryValue),
    quotaScope: scope,
    retryAfterSeconds: retryAfter,
    ...resetMetadata(response),
    sanitizedMessageCategory: sanitizedMessageCategoryValue,
  }
}

async function responsePayload(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function quoteTimestamp(value, receivedAt) {
  if (value === null || value === undefined || value === '') return receivedAt
  const numeric = Number(value)
  const candidate = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(candidate.getTime()) ? receivedAt : candidate.toISOString()
}

export function createTwelveDataClient({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  return {
    async getQuote(symbol) {
      if (!apiKey) {
        return { ok: false, error: 'missing_api_key', provider: 'twelvedata', failure: createFailure({ operation: 'quote', errorCode: 'missing_api_key' }) }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`, {
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const payload = await responsePayload(response)
          const errorCode = Number(payload?.code) === 429 || response.status === 429 ? 'provider_rate_limited' : 'request_failed'
          return { ok: false, error: errorCode, provider: 'twelvedata', status: response.status, failure: createFailure({ operation: 'quote', response, payload, errorCode, message: payload?.message, retryAfter: retryAfterSeconds(response) }) }
        }

        const payload = await responsePayload(response)
        if (payload?.status === 'error' || Number(payload?.code) >= 400) {
          const rateLimited = Number(payload?.code) === 429
          const errorCode = rateLimited ? 'provider_rate_limited' : 'provider_response_error'
          return {
            ok: false,
            provider: 'twelvedata',
            status: Number(payload?.code) || 400,
            error: errorCode,
            failure: createFailure({ operation: 'quote', response, payload, errorCode, message: payload?.message, retryAfter: retryAfterSeconds(response) }),
          }
        }
        const quote = payload?.quote ?? payload?.data?.[0] ?? payload ?? {}
        const price = Number(quote.close ?? quote.price)
        if (!Number.isFinite(price) || price <= 0) {
          return { ok: false, error: 'malformed_provider_response', provider: 'twelvedata', failure: createFailure({ operation: 'quote', response, errorCode: 'malformed_provider_response' }) }
        }
        const receivedAt = new Date().toISOString()
        return {
          ok: true,
          provider: 'twelvedata',
          receivedAt,
          data: {
            symbol,
            price,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            previousClose: quote.previous_close,
            change: quote.change,
            changePercent: quote.percent_change,
            volume: quote.volume,
            updatedAt: quoteTimestamp(quote.last_quote_at ?? quote.timestamp ?? quote.datetime, receivedAt),
          },
        }
      } catch (error) {
        clearTimeout(timeoutId)
        return {
          ok: false,
          error: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
          provider: 'twelvedata',
          failure: createFailure({ operation: 'quote', errorCode: error?.name === 'AbortError' ? 'timeout' : 'request_failed' }),
        }
      }
    },

    async getCandles(symbol, options = {}) {
      if (!apiKey) return { ok: false, error: { code: 'missing_api_key', message: 'Twelve Data API key is not configured' }, provider: 'twelvedata', failure: createFailure({ operation: 'historical', errorCode: 'missing_api_key' }) }
      const interval = normalizeHistoricalInterval(options.interval)
      if (!interval) {
        return { ok: false, error: { code: 'unsupported_interval', message: 'Twelve Data historical candles support only daily intervals in Atlas' }, provider: 'twelvedata' }
      }
      const requestedSize = Number(options.limit ?? options.outputsize ?? APPROVED_HISTORY_SIZE)
      if (requestedSize !== APPROVED_HISTORY_SIZE) {
        return { ok: false, error: { code: 'unsupported_history_size', message: `Atlas historical requests require exactly ${APPROVED_HISTORY_SIZE} daily candles` }, provider: 'twelvedata' }
      }
      if (options.startDate || options.endDate || options.start || options.end || options.range) {
        return { ok: false, error: { code: 'unsupported_history_range', message: 'Custom historical ranges are not supported' }, provider: 'twelvedata' }
      }
      const outputsize = APPROVED_HISTORY_SIZE
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      const startedAt = Date.now()
      try {
        const params = new URLSearchParams({
          symbol: String(symbol ?? '').trim().toUpperCase(),
          interval,
          outputsize: String(outputsize),
          order: 'asc',
          adjust: 'splits',
          apikey: apiKey,
        })
        const response = await fetchImpl(`https://api.twelvedata.com/time_series?${params}`, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (response.status === 429) {
          const payload = await responsePayload(response)
          const retryAfter = retryAfterSeconds(response)
          return { ok: false, provider: 'twelvedata', status: 429, retryAfterSeconds: retryAfter, durationMs: Date.now() - startedAt, error: { code: 'provider_rate_limited', message: 'Twelve Data rate limit reached' }, failure: createFailure({ operation: 'historical', response, payload, errorCode: 'provider_rate_limited', message: payload?.message, retryAfter }) }
        }
        if (!response.ok) {
          const payload = await responsePayload(response)
          const errorCode = Number(payload?.code) === 429 ? 'provider_rate_limited' : 'request_failed'
          const retryAfter = retryAfterSeconds(response)
          return { ok: false, provider: 'twelvedata', status: response.status, durationMs: Date.now() - startedAt, error: { code: errorCode, message: 'Twelve Data historical request failed' }, failure: createFailure({ operation: 'historical', response, payload, errorCode, message: payload?.message, retryAfter }) }
        }
        const payload = await responsePayload(response)
        if (payload?.status === 'error' || Number(payload?.code) >= 400) {
          const rateLimited = Number(payload?.code) === 429
          const errorCode = rateLimited ? 'provider_rate_limited' : 'provider_response_error'
          const retryAfter = retryAfterSeconds(response)
          return {
            ok: false,
            provider: 'twelvedata',
            status: Number(payload?.code) || 400,
            durationMs: Date.now() - startedAt,
            error: {
              code: errorCode,
              message: rateLimited ? 'Twelve Data rate limit reached' : 'Twelve Data rejected the historical request',
            },
            failure: createFailure({ operation: 'historical', response, payload, errorCode, message: payload?.message, retryAfter }),
          }
        }
        if (!Array.isArray(payload?.values)) {
          return { ok: false, provider: 'twelvedata', durationMs: Date.now() - startedAt, error: { code: 'malformed_provider_response', message: 'Twelve Data historical response is malformed' }, failure: createFailure({ operation: 'historical', response, errorCode: 'malformed_provider_response' }) }
        }
        return {
          ok: true,
          provider: 'twelvedata',
          data: payload.values,
          metadata: payload.meta ?? {},
          requestedCount: outputsize,
          durationMs: Date.now() - startedAt,
          receivedAt: new Date().toISOString(),
        }
      } catch (error) {
        clearTimeout(timeoutId)
        return {
          ok: false,
          provider: 'twelvedata',
          durationMs: Date.now() - startedAt,
          error: {
            code: error?.name === 'AbortError' ? 'provider_timeout' : 'request_failed',
            message: error?.name === 'AbortError' ? 'Twelve Data historical request timed out' : 'Twelve Data historical request failed',
          },
          failure: createFailure({ operation: 'historical', errorCode: error?.name === 'AbortError' ? 'provider_timeout' : 'request_failed' }),
        }
      }
    },
  }
}
