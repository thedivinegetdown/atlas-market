import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_AUDIT_GENERATED_EVENT = 'paperAudit.generated'

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function scope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function bounded(items = []) {
  return items.slice(0, 250)
}

export function generatePaperAuditReport(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const executions = bounded(input.executions ?? input.realtimeSimulatedExecutions?.realtimeSimulatedExecutions ?? [])
  const reconciliations = bounded(input.reconciliations ?? input.realtimePortfolioReconciliation?.realtimePortfolioReconciliations ?? [])
  const alerts = bounded(input.alerts ?? input.paperOperationsAlerts?.paperOperationsAlerts ?? input.realtimeAlerts?.realtimeAlerts ?? [])
  const incidents = bounded(input.incidents ?? input.paperOperationsIncidents?.paperOperationsIncidents ?? [])
  const journalRecords = bounded(input.journalRecords ?? input.realtimeSimulatedExecutions?.realtimeJournalRecords ?? [])
  const result = {
    eventType: PAPER_AUDIT_GENERATED_EVENT,
    timestamp,
    paperAuditReport: {
      id: String(input.id ?? `paper-audit-${input.accountId ?? 'paper'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
      tenantScope,
      accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
      executionAudit: {
        total: executions.length,
        simulated: executions.filter((item) => item.executionLifecycleStatus === 'simulated').length,
        failed: executions.filter((item) => item.executionLifecycleStatus === 'failed').length,
      },
      reconciliationAudit: {
        total: reconciliations.length,
        mismatches: reconciliations.filter((item) => item.reconciliationStatus === 'mismatch').length,
      },
      operationsAudit: {
        operationsStatus: input.realtimePaperOperations?.operationsStatus ?? 'referenced',
        healthStatus: input.paperOperationsObservability?.healthStatus ?? 'referenced',
      },
      alertHistory: {
        total: alerts.length,
        open: alerts.filter((item) => ['open', undefined].includes(item.status ?? item.lifecycle)).length,
        resolved: alerts.filter((item) => item.status === 'resolved' || item.lifecycle === 'resolved').length,
      },
      incidentHistory: {
        total: incidents.length,
        open: incidents.filter((item) => item.incidentState !== 'resolved').length,
        resolved: incidents.filter((item) => item.incidentState === 'resolved').length,
      },
      userActivitySummary: {
        actorReferences: [...new Set(incidents.flatMap((item) => item.activityRecords ?? []).map((item) => item.actor?.userId).filter(Boolean))].slice(0, 25),
        journalRecords: journalRecords.length,
      },
      apiActivitySummary: {
        successRate: input.apiReliability?.apiReliabilityMetrics?.successRate ?? input.apiReliability?.successRate ?? null,
        failureRate: input.apiReliability?.apiReliabilityMetrics?.failureRate ?? input.apiReliability?.failureRate ?? null,
      },
      generatedAt: timestamp,
      appendOnly: true,
      readOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    },
    auditStatus: tenantScope.organizationId && tenantScope.userId ? 'generated' : 'blocked',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: 'Paper audit report generated from existing append-only operational, execution, reconciliation, alert, incident, and journal records.',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_AUDIT_GENERATED_EVENT, result)
  return result
}

export function createPaperAuditRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const audit = input.paperAuditReport ?? input
      if (!database?.connected) return { ok: true, disabled: true, audit }
      const result = await database.query(
        `INSERT INTO atlas_paper_audit_reports
          (id, organization_id, team_workspace_id, account_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [audit.id, audit.tenantScope.organizationId, audit.tenantScope.teamWorkspaceId, audit.accountId, audit],
      )
      return { ok: true, audit: result.rows?.[0]?.payload ?? audit }
    },
    async list({ tenantContext = {}, accountId, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_audit_reports
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
