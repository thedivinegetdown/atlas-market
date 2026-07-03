import { validateEnvironment } from '../config/environment.js'
import { createPgClient } from '../db/pgClient.js'
import { createPersistenceService } from '../db/persistenceService.js'
import { createMarketDataService, getMarketDataDiagnostics } from '../market/marketDataService.js'

function componentStatus(ok, status = 'healthy') {
  return ok ? status : 'degraded'
}

function safeError(error) {
  return error?.publicMessage ?? 'service check failed'
}

export function createReadinessService({
  env = process.env,
  pgClientFactory = createPgClient,
  persistenceFactory = createPersistenceService,
  marketDataService = createMarketDataService(),
  now = () => new Date().toISOString(),
} = {}) {
  return {
    async check({ requestId } = {}) {
      const timestamp = now()
      const checks = {}
      let environment

      try {
        environment = validateEnvironment(env)
        checks.environment = {
          status: 'healthy',
          nodeEnv: environment.nodeEnv,
        }
      } catch (error) {
        checks.environment = {
          status: 'degraded',
          message: safeError(error),
        }
        environment = {
          tradingMode: env.TRADING_MODE ?? 'paper',
          databaseUrl: env.DATABASE_URL ?? null,
        }
      }

      try {
        const pgClient = pgClientFactory({ connectionString: environment.databaseUrl })
        const persistence = persistenceFactory(pgClient)
        const result = await persistence.initialize()
        checks.database = {
          status: result?.disabled ? 'disabled' : componentStatus(result?.ok),
          connected: Boolean(result?.connected),
        }
        await pgClient.end?.()
      } catch {
        checks.database = {
          status: 'degraded',
          connected: false,
        }
      }

      try {
        const quote = await marketDataService.getQuote('SPY')
        checks.marketData = {
          status: quote?.health?.available ? 'healthy' : 'degraded',
          provider: quote?.health?.provider ?? quote?.provider ?? 'unknown',
          lastSuccessfulSync: getMarketDataDiagnostics().lastSuccessfulSync,
        }
      } catch {
        checks.marketData = {
          status: 'degraded',
          provider: 'unavailable',
        }
      }

      checks.paperTrading = {
        status: environment.tradingMode === 'paper' ? 'healthy' : 'degraded',
        enabled: environment.tradingMode === 'paper',
      }

      const requiredStatuses = [checks.environment.status, checks.paperTrading.status]
      const optionalStatuses = [checks.database.status, checks.marketData.status]
      const status = requiredStatuses.includes('degraded')
        ? 'degraded'
        : optionalStatuses.includes('degraded')
          ? 'degraded'
          : 'healthy'

      return {
        status,
        requestId,
        timestamp,
        checks,
      }
    },
  }
}
