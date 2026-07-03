import { AppError, ERROR_CODES } from '../errors/appError.js'

const localDefaults = Object.freeze({
  NODE_ENV: 'development',
  TRADING_MODE: 'paper',
  LOG_LEVEL: 'info',
})

export function validateEnvironment(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? localDefaults.NODE_ENV
  const tradingMode = env.TRADING_MODE ?? localDefaults.TRADING_MODE
  const logLevel = env.LOG_LEVEL ?? localDefaults.LOG_LEVEL
  const isProduction = nodeEnv === 'production'
  const missing = []

  if (isProduction && !env.DATABASE_URL) {
    missing.push('DATABASE_URL')
  }

  if (tradingMode !== 'paper') {
    throw new AppError('invalid_trading_mode', 'unsupported trading mode configured', {
      statusCode: 500,
      publicMessage: 'server configuration is invalid',
      metadata: { tradingMode },
    })
  }

  if (missing.length > 0) {
    throw new AppError(ERROR_CODES.MISSING_CONFIG, `Missing required environment variables: ${missing.join(', ')}`, {
      statusCode: 500,
      publicMessage: 'server configuration is incomplete',
      metadata: { missing },
    })
  }

  return {
    nodeEnv,
    tradingMode,
    logLevel,
    databaseUrl: env.DATABASE_URL ?? null,
    isProduction,
  }
}
