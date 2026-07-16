import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createProductionConfigurationValidationRepository, validateProductionConfiguration } from '../lib/system/productionConfigurationValidationEngine.js'
import { createReleaseReadinessDiagnosticsRepository, evaluateReleaseReadinessDiagnostics, RELEASE_READINESS_EVALUATED_EVENT } from '../lib/system/releaseReadinessDiagnosticsEngine.js'
import { createProductionConfigurationValidationHandler } from '../netlify/functions/production-configuration-validation.js'
import { createReleaseReadinessHandler } from '../netlify/functions/release-readiness.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase76',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function membershipRepository(role = 'analyst') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function healthyInput() {
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    authenticationReadiness: { authReadinessStatus: 'healthy', eventType: 'system.authentication.initialized' },
    identityAuthorization: { authorizationStatus: 'healthy', eventType: 'system.authorization.evaluated' },
    apiReliability: { apiReliabilityStatus: 'healthy', eventType: 'system.apiReliability.evaluated' },
    marketDataScannerHealth: { healthStatus: 'healthy', eventType: 'marketDataScanner.health.updated' },
    realtimeScanner: { scannerStatus: 'active', eventType: 'scanner.realtime.evaluated' },
    realtimeSignals: { signalStatus: 'qualified', eventType: 'signal.realtime.evaluated' },
    realtimeSimulatedExecutions: { executionLifecycleStatus: 'simulated', eventType: 'paperExecution.realtime.simulated' },
    primaryAccounting: { accountingStatus: 'healthy', eventType: 'paperAccounting.realtime.updated' },
    realtimePortfolioReconciliation: { reconciliationStatus: 'reconciled', eventType: 'paperPortfolio.realtime.reconciled' },
    realtimePaperPortfolio: { streamingPortfolioStatus: 'healthy', eventType: 'paperPortfolio.realtime.updated' },
    realtimePaperRisk: { riskStatus: 'healthy', eventType: 'paperRisk.realtime.updated' },
    realtimePaperPerformance: { performanceStatus: 'healthy', eventType: 'paperPerformance.realtime.updated' },
    paperTradingReport: { reportStatus: 'generated', eventType: 'paperReports.generated' },
    paperReportJob: { paperReportJob: { status: 'completed' }, eventType: 'paperReportJob.completed' },
    paperReportWorker: { paperReportWorkerRun: { status: 'completed' }, eventType: 'paperReportWorker.batchCompleted' },
    paperReportArtifact: { paperReportArtifact: { status: 'available' }, eventType: 'paperReportArtifact.available' },
    realtimePaperOperations: { operationsStatus: 'healthy', eventType: 'paperOperations.realtime.evaluated' },
    paperOperationsAlerts: { alertingStatus: 'healthy', eventType: 'paperOperations.alert.updated' },
    paperOperationsIncidents: { incidentStatus: 'healthy', eventType: 'paperOperations.incident.updated' },
    paperOperationsObservability: { healthStatus: 'healthy', eventType: 'paperOperations.observability.updated' },
  }
}

describe('Phase 76A release readiness diagnostics', () => {
  it('adds idempotent diagnostic and configuration snapshot persistence with parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_readiness_diagnostics')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_production_configuration_validations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseReadinessDiagnosticsRepository, createProductionConfigurationValidationRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', timestamp: '2026-07-16T10:00:00.000Z', releaseReadinessStatus: 'healthy', readinessScore: 100, configurationValidationStatus: 'healthy' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('aggregates subsystem readiness into healthy, warning, blocked, score, warnings, and blockers', () => {
    const healthy = evaluateReleaseReadinessDiagnostics(healthyInput(), { emitEvent: false })
    const warning = evaluateReleaseReadinessDiagnostics({ ...healthyInput(), apiReliability: { apiReliabilityStatus: 'degraded' } }, { emitEvent: false })
    const blocked = evaluateReleaseReadinessDiagnostics({ ...healthyInput(), realtimePaperRisk: { riskStatus: 'critical' } }, { emitEvent: false })
    expect(healthy.eventType).toBe(RELEASE_READINESS_EVALUATED_EVENT)
    expect(healthy.releaseReadinessStatus).toBe('healthy')
    expect(healthy.readinessScore).toBe(100)
    expect(warning.releaseReadinessStatus).toBe('warning')
    expect(warning.warnings.some((item) => item.subsystemId === 'api-reliability')).toBe(true)
    expect(blocked.releaseReadinessStatus).toBe('blocked')
    expect(blocked.deploymentBlockers.some((item) => item.subsystemId === 'risk')).toBe(true)
  })
})

describe('Phase 76B production configuration validation', () => {
  it('validates configuration without returning secret values and surfaces missing configuration safely', () => {
    const missing = validateProductionConfiguration({ tenantContext, accountId: 'paper-portfolio', env: {} }, { emitEvent: false })
    const valid = validateProductionConfiguration({
      tenantContext,
      accountId: 'paper-portfolio',
      env: {
        NODE_ENV: 'production',
        TRADING_MODE: 'paper',
        PAPER_TRADING_ONLY: 'true',
        DATABASE_URL: 'configured',
        REPORT_WORKER_ENABLED: 'true',
        REPORT_ARTIFACT_RETENTION_DAYS: '7',
        API_BASE_URL: 'configured',
        ALLOWED_ORIGINS: 'configured',
        MARKET_DATA_PROVIDER: 'mock',
      },
      tenantConfiguration: { configured: true },
      securityConfiguration: { originValidation: true },
    }, { emitEvent: false })
    expect(missing.configurationValidationStatus).toBe('blocked')
    expect(missing.criticalSummary.length).toBeGreaterThan(0)
    expect(missing.secretsIncluded).toBe(false)
    expect(missing.findings.every((item) => item.valueIncluded === false)).toBe(true)
    expect(valid.configurationValidationStatus).toBe('healthy')
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst evaluation, and cross-tenant denial', async () => {
    const snapshots = [evaluateReleaseReadinessDiagnostics(healthyInput(), { emitEvent: false })]
    const releaseRepository = { list: vi.fn(async () => snapshots), create: vi.fn(async () => ({ ok: true })) }
    const configRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), releaseReadinessDiagnosticsRepository: releaseRepository, productionConfigurationValidationRepository: configRepository }
    const analystOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') }
    const releaseRead = parseResponse(await createReleaseReadinessHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const releaseWriteDenied = parseResponse(await createReleaseReadinessHandler(viewerOptions)(authEvent('POST', healthyInput(), 'viewer')))
    const releaseWrite = parseResponse(await createReleaseReadinessHandler(analystOptions)(authEvent('POST', healthyInput(), 'analyst')))
    const configWrite = parseResponse(await createProductionConfigurationValidationHandler(analystOptions)(authEvent('POST', { env: { TRADING_MODE: 'paper', PAPER_TRADING_ONLY: 'true', DATABASE_URL: 'configured' } }, 'analyst')))
    const crossTenant = parseResponse(await createProductionConfigurationValidationHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(releaseRead.statusCode).toBe(200)
    expect(releaseWriteDenied.statusCode).toBe(403)
    expect(releaseWrite.statusCode).toBe(200)
    expect(configWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
