import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluatePaperOperationsAlerts, createPaperOperationsAlertRepository, PAPER_OPERATIONS_ALERT_UPDATED_EVENT } from '../lib/trading/paperOperationsAlertingEngine.js'
import { openPaperOperationsIncidents, transitionPaperOperationsIncident, createPaperOperationsIncidentRepository, PAPER_OPERATIONS_INCIDENT_OPENED_EVENT, PAPER_OPERATIONS_INCIDENT_RESOLVED_EVENT } from '../lib/trading/paperOperationsIncidentManagementEngine.js'
import { evaluatePaperOperationsObservability, createPaperOperationsObservabilityRepository, PAPER_OPERATIONS_OBSERVABILITY_UPDATED_EVENT } from '../lib/trading/paperOperationsObservabilityEngine.js'
import { createPaperOperationsAlertsHandler } from '../netlify/functions/paper-operations-alerts.js'
import { createPaperOperationsAlertActionHandler } from '../netlify/functions/paper-operations-alert-action.js'
import { createPaperOperationsIncidentsHandler } from '../netlify/functions/paper-operations-incidents.js'
import { createPaperOperationsIncidentActionHandler } from '../netlify/functions/paper-operations-incident-action.js'
import { createPaperOperationsObservabilityHandler } from '../netlify/functions/paper-operations-observability.js'

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
      'x-request-id': 'req-phase71',
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

function operationsFixture(status = 'degraded') {
  return {
    realtimePaperOperations: {
      eventType: 'paperOperations.realtime.evaluated',
      operationsStatus: status,
      realtimePaperOperationsSections: [
        { id: 'scanner-alerts', label: 'Scanner, signal, and alert pipeline', status: status === 'healthy' ? 'healthy' : 'caution' },
        { id: 'portfolio-reconciliation', label: 'Portfolio reconciliation', status: status === 'healthy' ? 'healthy' : 'degraded' },
        { id: 'risk-monitor', label: 'Real-time paper risk monitor', status: status === 'healthy' ? 'healthy' : 'degraded' },
      ],
    },
    realtimePaperRisk: {
      eventType: 'paperRisk.realtime.monitored',
      timestamp: '2026-07-13T13:00:00.000Z',
      riskStatus: status === 'healthy' ? 'healthy' : 'elevated',
      realtimePaperRiskSnapshot: { drawdownRiskSummary: { status: status === 'healthy' ? 'healthy' : 'locked' } },
    },
    realtimePaperPerformance: {
      eventType: 'paperPerformance.realtime.updated',
      timestamp: '2026-07-13T13:01:00.000Z',
      performanceStatus: status === 'healthy' ? 'healthy' : 'stale',
      realtimePaperPerformanceSummary: { totalTrades: 2 },
    },
    realtimePortfolioReconciliation: {
      eventType: 'paperPortfolio.realtime.reconciled',
      reconciliationStatus: status === 'healthy' ? 'reconciled' : 'mismatch',
      realtimePortfolioReconciliationSummary: { reconciled: status === 'healthy' ? 1 : 0, mismatch: status === 'healthy' ? 0 : 1 },
    },
    realtimeSimulatedExecutions: {
      eventType: 'paperExecution.realtime.simulated',
      realtimeSimulatedExecutionSummary: { simulated: 1, failed: status === 'healthy' ? 0 : 1 },
    },
    realtimePreparedTrades: { realtimePreparedTradeSummary: { ready: 1, blocked: status === 'healthy' ? 0 : 2 } },
    realtimePaperDecisions: { realtimePaperDecisionSummary: { approved: 1, rejected: 0 } },
    realtimeScanner: { scannerStatus: status === 'healthy' ? 'active' : 'degraded' },
    realtimeSignals: { realtimeSignalEvaluations: [{ id: 'signal-1' }] },
    realtimeAlerts: { realtimeAlertSummary: { total: 1 } },
  }
}

describe('Phase 71A paper operations alerting', () => {
  it('adds idempotent alert, incident, activity, link, and observability persistence with parameterized access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_operations_alerts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_operations_incidents')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_operations_incident_alert_links')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_operations_incident_activity')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_operations_observability_snapshots')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    for (const factory of [createPaperOperationsAlertRepository, createPaperOperationsIncidentRepository, createPaperOperationsObservabilityRepository]) {
      const query = vi.fn(async () => ({ rows: [] }))
      const repository = factory({ database: { connected: true, query } })
      if (repository.upsert) await repository.upsert({ id: 'record-1', tenantContext, accountId: 'paper-portfolio', fingerprint: 'fp', status: 'open' })
      if (repository.create) await repository.create({ id: 'record-2', tenantScope: tenantContext, accountId: 'paper-portfolio', healthStatus: 'healthy', createdAt: '2026-07-13T13:00:00.000Z' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('creates, deduplicates, updates, and resolves bounded operational alerts', () => {
    const first = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture() }, { emitEvent: false, timestamp: '2026-07-13T13:02:00.000Z' })
    const second = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture(), existingAlerts: first.paperOperationsAlerts }, { emitEvent: false, timestamp: '2026-07-13T13:03:00.000Z' })
    const cleared = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture('healthy'), existingAlerts: second.paperOperationsAlerts }, { emitEvent: false, timestamp: '2026-07-13T13:04:00.000Z' })
    expect(first.eventType).toBe(PAPER_OPERATIONS_ALERT_UPDATED_EVENT)
    expect(first.paperOperationsAlertSummary.critical).toBeGreaterThan(0)
    expect(second.paperOperationsAlerts[0].occurrenceCount).toBeGreaterThan(first.paperOperationsAlerts[0].occurrenceCount)
    expect(cleared.paperOperationsAlerts.every((alert) => alert.status === 'resolved')).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential/i)
  })
})

describe('Phase 71B paper operations incident management', () => {
  it('opens incidents for critical alerts, appends audit activity, and rejects invalid transitions safely', () => {
    const alerts = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture() }, { emitEvent: false }).paperOperationsAlerts
    const opened = openPaperOperationsIncidents({ tenantContext, accountId: 'paper-portfolio', paperOperationsAlerts: alerts }, { emitEvent: false, timestamp: '2026-07-13T13:05:00.000Z' })
    const acknowledged = transitionPaperOperationsIncident({ incident: opened.paperOperationsIncidents[0], nextState: 'acknowledged', actor: { userId, role: 'analyst' }, reason: 'reviewing' }, { timestamp: '2026-07-13T13:06:00.000Z' })
    const invalid = transitionPaperOperationsIncident({ incident: acknowledged.incident, nextState: 'open', actor: { userId, role: 'analyst' } })
    const resolved = transitionPaperOperationsIncident({ incident: acknowledged.incident, nextState: 'resolved', actor: { userId, role: 'admin' } }, { timestamp: '2026-07-13T13:07:00.000Z' })
    expect(opened.eventType).toBe(PAPER_OPERATIONS_INCIDENT_OPENED_EVENT)
    expect(opened.paperOperationsIncidents[0].linkedAlertIds.length).toBeGreaterThan(0)
    expect(acknowledged.incident.activityRecords.length).toBeGreaterThan(1)
    expect(invalid.rejected).toBe(true)
    expect(resolved.eventType).toBe(PAPER_OPERATIONS_INCIDENT_RESOLVED_EVENT)
  })

  it('enforces tenant APIs with viewer read-only, analyst actions, invalid transition safety, and cross-tenant denial', async () => {
    const alerts = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture() }, { emitEvent: false }).paperOperationsAlerts
    const incident = openPaperOperationsIncidents({ tenantContext, accountId: 'paper-portfolio', paperOperationsAlerts: alerts }, { emitEvent: false }).paperOperationsIncidents[0]
    const viewerOptions = { database: { connected: false }, accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), paperOperationsAlerts: alerts, alerts, paperOperationsIncidents: [incident], incidents: [incident], ...operationsFixture() }
    const alertRead = parseResponse(await createPaperOperationsAlertsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const incidentRead = parseResponse(await createPaperOperationsIncidentsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const observabilityRead = parseResponse(await createPaperOperationsObservabilityHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const viewerDenied = parseResponse(await createPaperOperationsAlertActionHandler(viewerOptions)(authEvent('POST', { alertId: alerts[0].id, fingerprint: alerts[0].fingerprint, action: 'acknowledge' }, 'viewer')))
    const analystAction = parseResponse(await createPaperOperationsIncidentActionHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { incident, nextState: 'acknowledged', accountId: 'paper-portfolio' }, 'analyst')))
    const invalidAction = parseResponse(await createPaperOperationsIncidentActionHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { incident: { ...incident, incidentState: 'resolved' }, nextState: 'open', accountId: 'paper-portfolio' }, 'analyst')))
    const crossTenant = parseResponse(await createPaperOperationsAlertsHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([alertRead.statusCode, incidentRead.statusCode, observabilityRead.statusCode]).toEqual([200, 200, 200])
    expect(viewerDenied.statusCode).toBe(403)
    expect(analystAction.statusCode).toBe(200)
    expect(invalidAction.statusCode).toBe(400)
    expect(crossTenant.statusCode).toBe(403)
  })
})

describe('Phase 71C paper operations observability', () => {
  it('calculates compact health metrics, freshness, throughput, alert, and incident counts', () => {
    const alerts = evaluatePaperOperationsAlerts({ tenantContext, accountId: 'paper-portfolio', ...operationsFixture() }, { emitEvent: false }).paperOperationsAlerts
    const incidents = openPaperOperationsIncidents({ tenantContext, accountId: 'paper-portfolio', paperOperationsAlerts: alerts }, { emitEvent: false }).paperOperationsIncidents
    const result = evaluatePaperOperationsObservability({
      tenantContext,
      accountId: 'paper-portfolio',
      ...operationsFixture(),
      paperOperationsAlerts: alerts,
      paperOperationsIncidents: incidents,
      apiReliability: { totalRequests: 100, failedRequests: 3 },
    }, { emitEvent: false, timestamp: '2026-07-13T13:08:00.000Z' })
    expect(result.eventType).toBe(PAPER_OPERATIONS_OBSERVABILITY_UPDATED_EVENT)
    expect(result.healthStatus).toBe('critical')
    expect(result.paperOperationsObservabilitySnapshot.apiReliabilityMetrics.failureRate).toBe(0.03)
    expect(result.paperOperationsObservabilitySummary.openAlerts).toBeGreaterThan(0)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('marks stale snapshots as degraded without retaining large histories', () => {
    const result = evaluatePaperOperationsObservability({
      tenantContext,
      accountId: 'paper-portfolio',
      ...operationsFixture('healthy'),
      observabilityPolicy: { staleAfterMs: 1000 },
    }, { emitEvent: false, timestamp: '2026-07-13T13:30:00.000Z' })
    expect(result.healthStatus).toBe('degraded')
    expect(result.paperOperationsObservabilitySnapshot.alertMetrics.open).toBe(0)
    expect(Object.keys(result.paperOperationsObservabilitySnapshot).length).toBeLessThan(25)
  })
})
