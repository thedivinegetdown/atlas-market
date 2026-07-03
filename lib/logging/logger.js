export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
})

const sensitiveKeys = ['authorization', 'cookie', 'password', 'secret', 'token', 'apiKey', 'api_key', 'database_url', 'databaseUrl']
const secretValuePatterns = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
]

function shouldRedact(key) {
  const normalized = String(key).toLowerCase()
  return sensitiveKeys.some((sensitiveKey) => normalized.includes(sensitiveKey.toLowerCase()))
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      shouldRedact(key) ? '[REDACTED]' : redactSecrets(entry),
    ]))
  }

  if (typeof value === 'string') {
    return secretValuePatterns.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value)
  }

  return value
}

export function createLogger({
  name = 'atlas-market',
  level = 'info',
  sink = console,
  now = () => new Date().toISOString(),
} = {}) {
  const minimumLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info

  function write(logLevel, message, metadata = {}) {
    if ((LOG_LEVELS[logLevel] ?? LOG_LEVELS.info) < minimumLevel) return null

    const entry = {
      timestamp: now(),
      level: logLevel,
      logger: name,
      message,
      metadata: redactSecrets(metadata),
    }

    const writer = sink?.[logLevel] ?? sink?.log
    if (typeof writer === 'function') {
      writer.call(sink, JSON.stringify(entry))
    }

    return entry
  }

  return {
    debug(message, metadata) {
      return write('debug', message, metadata)
    },
    info(message, metadata) {
      return write('info', message, metadata)
    },
    warn(message, metadata) {
      return write('warn', message, metadata)
    },
    error(message, metadata) {
      return write('error', message, metadata)
    },
  }
}

export const serverLogger = createLogger({
  name: 'atlas-market-api',
  level: globalThis.process?.env?.LOG_LEVEL ?? 'info',
})
