import packageJson from '../../package.json' with { type: 'json' }
import { validateProductionConfiguration } from './productionConfigurationValidationEngine.js'
import { evaluateApiReliability } from './apiReliabilityEngine.js'

export const RELEASE_OBSERVABILITY_VERSION = 'phase90-release-observability-v1'
export const RELEASE_METADATA_VERSION = 'phase90-release-metadata-v1'
export const HEALTH_STATUSES = Object.freeze(['healthy', 'degraded', 'unhealthy', 'unknown'])
const SAFE_LABEL_VALUE = /^[a-z0-9_.:-]+$/i

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function duration(startedAt) {
  return Math.max(0, Date.now() - startedAt)
}

function clampStatus(status) {
  return HEALTH_STATUSES.includes(status) ? status : 'unknown'
}

function redactString(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|10\.|172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.|192\.168\.|[^/\s"'<>]*internal[^/\s"'<>]*)[^\s"'<>]*/gi, '[REDACTED_URL]')
    .replace(/(api[_-]?key|secret|token|password|authorization)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/raw\s*(prompt|provider|response)[^,.;]*/gi, 'raw $1 [REDACTED]')
    .slice(0, 240)
}

export function redactObservabilityValue(value) {
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redactObservabilityValue(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, entry]) => {
      const normalized = String(key).toLowerCase()
      if (/authorization|cookie|password|secret|token|apikey|api_key|prompt|providerresponse|rawresponse|chainofthought|url|hostname|path/.test(normalized)) {
        return [key, '[REDACTED]']
      }
      return [key, redactObservabilityValue(entry)]
    }))
  }
  if (typeof value === 'string') return redactString(value)
  return value
}

export function normalizeErrorCategory(error) {
  const code = String(error?.code ?? error?.name ?? error ?? 'unknown').toLowerCase()
  if (code.includes('auth')) return 'authorization'
  if (code.includes('rate')) return 'rate_limit'
  if (code.includes('timeout') || code.includes('abort')) return 'timeout'
  if (code.includes('config') || code.includes('environment')) return 'configuration'
  if (code.includes('tenant')) return 'tenant_isolation'
  if (code.includes('provider') || code.includes('ai')) return 'ai_provider'
  if (code.includes('validation')) return 'validation'
  return 'internal'
}

function safeLabel(value, fallback = 'unknown') {
  const label = String(value ?? fallback).toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 48)
  return SAFE_LABEL_VALUE.test(label) ? label : fallback
}

export function createObservabilityRecord({
  eventType = 'release.observability.event',
  status = 'unknown',
  route = 'system',
  category = 'runtime',
  durationMs = 0,
  correlationId,
  requestId,
  tenantContext = {},
  accountId,
  metadata = {},
  timestamp,
} = {}) {
  return {
    eventType: safeLabel(eventType, 'release.observability.event'),
    version: RELEASE_OBSERVABILITY_VERSION,
    timestamp: timestamp ?? nowIso(),
    status: clampStatus(status),
    labels: {
      route: safeLabel(route, 'system'),
      category: safeLabel(category, 'runtime'),
      status: clampStatus(status),
    },
    durationMs: Math.max(0, Math.min(300000, Number(durationMs) || 0)),
    correlationId: correlationId ? String(correlationId).slice(0, 80) : null,
    requestId: requestId ? String(requestId).slice(0, 80) : null,
    tenant: {
      organizationId: tenantContext.organizationId ?? null,
      teamWorkspaceId: tenantContext.teamWorkspaceId ?? null,
      userId: tenantContext.userId ?? null,
      accountId: accountId ?? null,
    },
    metadata: redactObservabilityValue(metadata),
    secretsIncluded: false,
    rawPayloadsIncluded: false,
  }
}

function check(id, label, status, metadata = {}) {
  return {
    id,
    label,
    status: clampStatus(status),
    category: metadata.category ?? id,
    durationMs: Math.max(0, Math.min(30000, Number(metadata.durationMs) || 0)),
    failureCategory: status === 'healthy' ? null : metadata.failureCategory ?? normalizeErrorCategory(metadata.error ?? id),
    metadata: redactObservabilityValue(metadata.metadata ?? {}),
  }
}

function aggregate(checks, { optionalCanDegrade = true } = {}) {
  if (checks.some((item) => item.status === 'unhealthy')) return 'unhealthy'
  if (checks.some((item) => item.status === 'unknown')) return 'unknown'
  if (optionalCanDegrade && checks.some((item) => item.status === 'degraded')) return 'degraded'
  return 'healthy'
}

export function createReleaseMetadata(input = {}, options = {}) {
  const env = input.env ?? {}
  const timestamp = options.timestamp ?? nowIso()
  return {
    version: RELEASE_METADATA_VERSION,
    applicationVersion: packageJson.version,
    commit: String(input.commit ?? env.COMMIT_REF ?? env.VITE_COMMIT_REF ?? env.GIT_COMMIT ?? 'unknown').slice(0, 40),
    buildTimestamp: String(input.buildTimestamp ?? env.BUILD_TIMESTAMP ?? timestamp).slice(0, 40),
    releaseChannel: String(input.releaseChannel ?? env.RELEASE_CHANNEL ?? 'release-candidate').slice(0, 40),
    environmentName: String(input.environmentName ?? env.CONTEXT ?? env.NODE_ENV ?? 'unknown').slice(0, 40),
    migrationCompatibilityVersion: String(input.migrationCompatibilityVersion ?? '202607210090_phase90_release_observability_readiness').slice(0, 80),
    apiCompatibilityVersion: 'atlas-api-v1',
    frontendBundleVersion: String(input.frontendBundleVersion ?? env.DEPLOY_ID ?? 'local-build').slice(0, 80),
    releaseVerificationStatus: clampStatus(input.releaseVerificationStatus ?? 'unknown'),
    generatedAt: timestamp,
    secretsIncluded: false,
    internalPathsIncluded: false,
  }
}

export function evaluateLiveness(input = {}, options = {}) {
  const startedAt = Date.now()
  const timestamp = options.timestamp ?? nowIso()
  const runtimeStatus = input.runtimeAvailable === false ? 'unhealthy' : 'healthy'
  const checks = [
    check('runtime', 'Application runtime', runtimeStatus, { category: 'runtime' }),
    check('paper-trading-boundary', 'Paper-trading service boundary', input.paperTradingOnly === false ? 'unhealthy' : 'healthy', { category: 'paper-trading' }),
  ]
  const status = aggregate(checks, { optionalCanDegrade: false })
  return {
    eventType: 'release.liveness.evaluated',
    version: RELEASE_OBSERVABILITY_VERSION,
    timestamp,
    durationMs: duration(startedAt),
    status,
    checks,
    releaseMetadata: createReleaseMetadata(input.releaseMetadata ?? input, { timestamp }),
    liveness: true,
    readiness: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    secretsIncluded: false,
  }
}

export function evaluateReadiness(input = {}, options = {}) {
  const startedAt = Date.now()
  const timestamp = options.timestamp ?? nowIso()
  const configuration = input.configurationValidation ?? validateProductionConfiguration(input.configurationInput ?? {
    env: input.env ?? {},
    databaseConfigured: input.databaseAvailable === true,
    tradingMode: 'paper',
    paperTradingOnly: true,
    liveTradingEnabled: false,
  }, { emitEvent: false, timestamp })
  const apiReliability = input.apiReliability ?? evaluateApiReliability(input.apiReliabilityInput ?? {}, { emitEvent: false, timestamp })
  const aiStatus = input.aiProviderAvailable === false ? 'degraded' : input.aiProviderAvailable === undefined ? 'unknown' : 'healthy'
  const performanceStatus = input.performanceBudgetStatus ?? 'unknown'
  const migrationStatus = input.migrationCompatible === false ? 'unhealthy' : input.migrationCompatible === undefined ? 'unknown' : 'healthy'
  const configStatus = configuration.configurationValidationStatus === 'blocked' ? 'unhealthy' : configuration.configurationValidationStatus === 'warning' ? 'degraded' : 'healthy'
  const reliabilityStatus = apiReliability.apiReliabilityStatus === 'blocked' ? 'unhealthy' : apiReliability.apiReliabilityStatus === 'caution' ? 'degraded' : 'healthy'
  const checks = [
    check('configuration', 'Required production configuration', configStatus, { category: 'configuration', metadata: { findingCount: configuration.findings?.length ?? 0 } }),
    check('api-reliability', 'API reliability subsystem', reliabilityStatus, { category: 'api' }),
    check('migration-compatibility', 'Migration compatibility', migrationStatus, { category: 'database' }),
    check('ai-provider', 'Optional AI provider availability', aiStatus, { category: 'atlas-ai', failureCategory: aiStatus === 'degraded' ? 'ai_provider' : null }),
    check('paper-trading-service', 'Paper-trading service availability', input.paperTradingAvailable === false ? 'unhealthy' : 'healthy', { category: 'paper-trading' }),
    check('performance-budget', 'Performance budget status', performanceStatus, { category: 'performance' }),
  ]
  const status = aggregate(checks)
  return {
    eventType: 'release.readiness.evaluated',
    version: RELEASE_OBSERVABILITY_VERSION,
    timestamp,
    durationMs: duration(startedAt),
    status,
    checks,
    configurationValidationStatus: configuration.configurationValidationStatus,
    apiReliabilityStatus: apiReliability.apiReliabilityStatus,
    releaseMetadata: createReleaseMetadata(input.releaseMetadata ?? input, { timestamp }),
    deterministicAtlasAvailable: status !== 'unhealthy' || aiStatus === 'degraded',
    aiAssistanceAvailable: aiStatus === 'healthy',
    liveness: false,
    readiness: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    secretsIncluded: false,
  }
}

export function createRuntimeDiagnostics(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const liveness = input.liveness ?? evaluateLiveness(input, { timestamp })
  const readiness = input.readiness ?? evaluateReadiness(input, { timestamp })
  return {
    eventType: 'release.runtimeDiagnostics.evaluated',
    version: RELEASE_OBSERVABILITY_VERSION,
    timestamp,
    status: readiness.status === 'unhealthy' ? 'unhealthy' : liveness.status === 'healthy' ? readiness.status : liveness.status,
    liveness,
    readiness,
    degradedSubsystems: readiness.checks.filter((item) => item.status === 'degraded').map((item) => ({ id: item.id, category: item.category })),
    releaseMetadata: readiness.releaseMetadata,
    authorized: input.authorized !== false,
    secretsIncluded: false,
    rawPayloadsIncluded: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function canViewReleaseDiagnostics(actor = {}) {
  return ['owner', 'admin', 'analyst'].includes(String(actor.role ?? '').toLowerCase())
}
