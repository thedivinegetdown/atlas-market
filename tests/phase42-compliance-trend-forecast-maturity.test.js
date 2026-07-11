import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceTrendAnalyticsRepository, evaluateComplianceTrendAnalytics, SYSTEM_COMPLIANCE_TREND_ANALYTICS_EVALUATED_EVENT } from '../lib/system/complianceTrendAnalyticsEngine.js'
import { createComplianceRiskForecastRepository, evaluateComplianceRiskForecast, SYSTEM_COMPLIANCE_RISK_FORECAST_EVALUATED_EVENT } from '../lib/system/complianceRiskForecastEngine.js'
import { assessComplianceMaturity, createComplianceMaturityAssessmentRepository, SYSTEM_COMPLIANCE_MATURITY_ASSESSED_EVENT } from '../lib/system/complianceMaturityAssessmentEngine.js'
import { createComplianceTrendAnalyticsHandler } from '../netlify/functions/compliance-trend-analytics.js'
import { createComplianceRiskForecastsHandler } from '../netlify/functions/compliance-risk-forecasts.js'
import { createComplianceMaturityAssessmentsHandler } from '../netlify/functions/compliance-maturity-assessments.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase42abc',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const complianceMetricsSnapshot = { eventType: 'system.complianceMetricsSnapshot.captured', metricsSnapshotStatus: 'ready', metricsSnapshotSummary: { averageHealthScore: 95, openActionItems: 0 } }
  const complianceExecutiveDashboard = { eventType: 'system.complianceExecutiveDashboard.evaluated', executiveDashboardStatus: 'healthy', executiveDashboardSummary: { averageScore: 95, healthy: 1, caution: 0, blocked: 0 } }
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthStatus: 'healthy', programHealthSummary: { averageScore: 95 } }
  const complianceGovernanceActionItems = { eventType: 'system.complianceActionItems.tracked', actionItemSummary: { highPriority: 0, blocked: 0 } }
  const complianceTrendAnalytics = evaluateComplianceTrendAnalytics({ tenantContext, complianceMetricsSnapshot, complianceExecutiveDashboard }, { emitEvent: false })
  const complianceRiskForecast = evaluateComplianceRiskForecast({ tenantContext, complianceTrendAnalytics, complianceProgramHealth, complianceGovernanceActionItems }, { emitEvent: false })
  const complianceMaturityAssessment = assessComplianceMaturity({ tenantContext, complianceExecutiveDashboard, complianceTrendAnalytics, complianceRiskForecast }, { emitEvent: false })
  return { complianceMetricsSnapshot, complianceExecutiveDashboard, complianceProgramHealth, complianceGovernanceActionItems, complianceTrendAnalytics, complianceRiskForecast, complianceMaturityAssessment }
}

describe('Phase 42A compliance trend analytics', () => {
  it('adds idempotent trend/forecast/maturity migrations and parameterized trend access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_trend_analytics')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_risk_forecasts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_maturity_assessments')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceTrendAnalyticsRepository({ database: { connected: true, query } })
    await repository.create({ id: 'trend-1', tenantContext, trendStatus: 'improving', trendScore: 95 })
    await repository.list({ tenantContext, trendStatus: 'improving' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates trends without compliance claims or destructive automation', () => {
    const source = upstream()
    expect(source.complianceTrendAnalytics.eventType).toBe(SYSTEM_COMPLIANCE_TREND_ANALYTICS_EVALUATED_EVENT)
    expect(source.complianceTrendAnalytics.automaticComplianceClaims).toBe(false)
    expect(source.complianceTrendAnalytics.destructiveAutomation).toBe(false)
  })
})

describe('Phase 42B compliance risk forecast', () => {
  it('evaluates forecasts without automatic remediation', async () => {
    const source = upstream()
    expect(source.complianceRiskForecast.eventType).toBe(SYSTEM_COMPLIANCE_RISK_FORECAST_EVALUATED_EVENT)
    expect(source.complianceRiskForecast.automaticRemediation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceRiskForecastRepository({ database: { connected: true, query } })
    await repository.create({ id: 'forecast-1', tenantContext, forecastStatus: 'low', forecastScore: 25 })
    await repository.list({ tenantContext, forecastStatus: 'low' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves trend and forecast APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const trends = parseResponse(await createComplianceTrendAnalyticsHandler(options)(authEvent('GET')))
    const createTrend = parseResponse(await createComplianceTrendAnalyticsHandler(options)(authEvent('POST', { analytics: { id: 'trend-1' } })))
    const forecasts = parseResponse(await createComplianceRiskForecastsHandler(options)(authEvent('GET')))
    const createForecast = parseResponse(await createComplianceRiskForecastsHandler(options)(authEvent('POST', { forecast: { id: 'forecast-1' } })))
    const denied = parseResponse(await createComplianceRiskForecastsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([trends.statusCode, createTrend.statusCode, forecasts.statusCode, createForecast.statusCode]).toEqual([200, 200, 200, 200])
    expect(trends.json.data.complianceTrendAnalytics.automaticComplianceClaims).toBe(false)
    expect(forecasts.json.data.complianceRiskForecast.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 42C compliance maturity assessment', () => {
  it('assesses maturity without approval automation', async () => {
    const source = upstream()
    expect(source.complianceMaturityAssessment.eventType).toBe(SYSTEM_COMPLIANCE_MATURITY_ASSESSED_EVENT)
    expect(source.complianceMaturityAssessment.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceMaturityAssessmentRepository({ database: { connected: true, query } })
    await repository.create({ id: 'maturity-1', tenantContext, maturityLevel: 'advanced', maturityScore: 95 })
    await repository.list({ tenantContext, maturityLevel: 'advanced' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves maturity APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const maturity = parseResponse(await createComplianceMaturityAssessmentsHandler(options)(authEvent('GET')))
    const createMaturity = parseResponse(await createComplianceMaturityAssessmentsHandler(options)(authEvent('POST', { assessment: { id: 'maturity-1' } })))
    const denied = parseResponse(await createComplianceMaturityAssessmentsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([maturity.statusCode, createMaturity.statusCode]).toEqual([200, 200])
    expect(maturity.json.data.complianceMaturityAssessment.automaticComplianceClaims).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(maturity.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
