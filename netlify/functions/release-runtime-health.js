import { createApiHandler } from './_shared/api.js'
import { createRuntimeDiagnostics } from '../../lib/system/releaseObservabilityReadinessEngine.js'

export function createReleaseRuntimeHealthHandler(options = {}) {
  return createApiHandler(async ({ requestId, query }) => {
    const mode = String(query.mode ?? 'summary').toLowerCase()
    const diagnostics = createRuntimeDiagnostics({
      env: options.env ?? process.env,
      databaseAvailable: options.databaseAvailable ?? Boolean((options.env ?? process.env).DATABASE_URL),
      aiProviderAvailable: options.aiProviderAvailable,
      migrationCompatible: options.migrationCompatible ?? true,
      performanceBudgetStatus: options.performanceBudgetStatus ?? 'healthy',
      paperTradingAvailable: options.paperTradingAvailable ?? true,
      releaseMetadata: {
        env: options.env ?? process.env,
        commit: options.commit,
        buildTimestamp: options.buildTimestamp,
        releaseVerificationStatus: options.releaseVerificationStatus ?? 'unknown',
      },
    })
    return {
      requestId,
      releaseRuntimeHealth: mode === 'liveness'
        ? { liveness: diagnostics.liveness, releaseMetadata: diagnostics.releaseMetadata }
        : diagnostics,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      secretsIncluded: false,
    }
  }, {
    allowedMethods: ['GET'],
    routeId: 'release-runtime-health',
    maxRequestBytes: 8 * 1024,
    ...options,
  })
}

export const handler = createReleaseRuntimeHealthHandler()
