import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { captureComplianceMetricsSnapshot, createComplianceMetricsSnapshotRepository, SYSTEM_COMPLIANCE_METRICS_SNAPSHOT_CAPTURED_EVENT } from '../lib/system/complianceMetricsSnapshotEngine.js'
import { createComplianceExecutiveSummaryRepository, prepareComplianceExecutiveSummary, SYSTEM_COMPLIANCE_EXECUTIVE_SUMMARY_PREPARED_EVENT } from '../lib/system/complianceExecutiveSummaryEngine.js'
import { createComplianceExecutiveDashboardRepository, evaluateComplianceExecutiveDashboard, SYSTEM_COMPLIANCE_EXECUTIVE_DASHBOARD_EVALUATED_EVENT } from '../lib/system/complianceExecutiveDashboardEngine.js'
import { createComplianceMetricsSnapshotsHandler } from '../netlify/functions/compliance-metrics-snapshots.js'
import { createComplianceExecutiveSummariesHandler } from '../netlify/functions/compliance-executive-summaries.js'
import { createComplianceExecutiveDashboardHandler } from '../netlify/functions/compliance-executive-dashboard.js'

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
      'x-request-id': 'req-phase41abc',
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
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthStatus: 'healthy', programHealthSummary: { averageScore: 95, healthy: 1, caution: 0, blocked: 0 } }
  const complianceGovernanceActionItems = { eventType: 'system.complianceActionItems.tracked', actionItemStatus: 'ready', actionItemSummary: { open: 0, highPriority: 0, blocked: 0 } }
  const complianceExamReadiness = { eventType: 'system.complianceExamReadiness.evaluated', examReadinessStatus: 'ready', examReadinessSummary: { averageScore: 95, ready: 1, caution: 0, blocked: 0 } }
  const complianceMeetingMinutes = { eventType: 'system.complianceMeetingMinutes.recorded', meetingMinutesStatus: 'ready', meetingMinutesSummary: { readyForReview: 1, recorded: 0, needsUpdates: 0 } }
  const complianceBoardPacket = { eventType: 'system.complianceBoardPacket.prepared', boardPacketStatus: 'ready', boardPacketSummary: { readyForReview: 1, needsUpdates: 0 } }
  const complianceRiskCommandCenter = { eventType: 'system.complianceRiskCommandCenter.evaluated', commandCenterStatus: 'healthy' }
  const complianceMetricsSnapshot = captureComplianceMetricsSnapshot({ tenantContext, complianceProgramHealth, complianceGovernanceActionItems, complianceExamReadiness, complianceMeetingMinutes }, { emitEvent: false })
  const complianceExecutiveSummary = prepareComplianceExecutiveSummary({ tenantContext, complianceMetricsSnapshot, complianceProgramHealth, complianceBoardPacket }, { emitEvent: false })
  const complianceExecutiveDashboard = evaluateComplianceExecutiveDashboard({ tenantContext, complianceMetricsSnapshot, complianceExecutiveSummary, complianceProgramHealth, complianceRiskCommandCenter }, { emitEvent: false })
  return { complianceProgramHealth, complianceGovernanceActionItems, complianceExamReadiness, complianceMeetingMinutes, complianceBoardPacket, complianceRiskCommandCenter, complianceMetricsSnapshot, complianceExecutiveSummary, complianceExecutiveDashboard }
}

describe('Phase 41A compliance metrics snapshots', () => {
  it('adds idempotent executive reporting migrations and parameterized snapshot access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_metrics_snapshots')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_executive_summaries')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_executive_dashboards')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceMetricsSnapshotRepository({ database: { connected: true, query } })
    await repository.create({ id: 'snapshot-1', tenantContext, snapshotStatus: 'current', healthScore: 95 })
    await repository.list({ tenantContext, snapshotStatus: 'current' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('captures metrics without distribution or compliance claims', () => {
    const source = upstream()
    expect(source.complianceMetricsSnapshot.eventType).toBe(SYSTEM_COMPLIANCE_METRICS_SNAPSHOT_CAPTURED_EVENT)
    expect(source.complianceMetricsSnapshot.automaticDistribution).toBe(false)
    expect(source.complianceMetricsSnapshot.automaticComplianceClaims).toBe(false)
  })
})

describe('Phase 41B compliance executive summaries', () => {
  it('prepares summaries without approval automation', async () => {
    const source = upstream()
    expect(source.complianceExecutiveSummary.eventType).toBe(SYSTEM_COMPLIANCE_EXECUTIVE_SUMMARY_PREPARED_EVENT)
    expect(source.complianceExecutiveSummary.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceExecutiveSummaryRepository({ database: { connected: true, query } })
    await repository.create({ id: 'summary-1', tenantContext, summaryStatus: 'ready_for_review' })
    await repository.list({ tenantContext, summaryStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves metrics and executive summary APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const snapshots = parseResponse(await createComplianceMetricsSnapshotsHandler(options)(authEvent('GET')))
    const createSnapshot = parseResponse(await createComplianceMetricsSnapshotsHandler(options)(authEvent('POST', { snapshot: { id: 'snapshot-1' } })))
    const summaries = parseResponse(await createComplianceExecutiveSummariesHandler(options)(authEvent('GET')))
    const createSummary = parseResponse(await createComplianceExecutiveSummariesHandler(options)(authEvent('POST', { summary: { id: 'summary-1' } })))
    const denied = parseResponse(await createComplianceExecutiveSummariesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([snapshots.statusCode, createSnapshot.statusCode, summaries.statusCode, createSummary.statusCode]).toEqual([200, 200, 200, 200])
    expect(snapshots.json.data.complianceMetricsSnapshot.automaticDistribution).toBe(false)
    expect(summaries.json.data.complianceExecutiveSummary.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 41C compliance executive dashboard', () => {
  it('evaluates executive dashboards without claims or destructive automation', async () => {
    const source = upstream()
    expect(source.complianceExecutiveDashboard.eventType).toBe(SYSTEM_COMPLIANCE_EXECUTIVE_DASHBOARD_EVALUATED_EVENT)
    expect(source.complianceExecutiveDashboard.automaticComplianceClaims).toBe(false)
    expect(source.complianceExecutiveDashboard.destructiveAutomation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceExecutiveDashboardRepository({ database: { connected: true, query } })
    await repository.create({ id: 'dashboard-1', tenantContext, dashboardStatus: 'healthy', dashboardScore: 95 })
    await repository.list({ tenantContext, dashboardStatus: 'healthy' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves executive dashboard APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const dashboards = parseResponse(await createComplianceExecutiveDashboardHandler(options)(authEvent('GET')))
    const createDashboard = parseResponse(await createComplianceExecutiveDashboardHandler(options)(authEvent('POST', { dashboard: { id: 'dashboard-1' } })))
    const denied = parseResponse(await createComplianceExecutiveDashboardHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([dashboards.statusCode, createDashboard.statusCode]).toEqual([200, 200])
    expect(dashboards.json.data.complianceExecutiveDashboard.automaticComplianceClaims).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(dashboards.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
