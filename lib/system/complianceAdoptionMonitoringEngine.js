import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_ADOPTION_MONITORING_EVALUATED_EVENT = 'system.complianceAdoptionMonitoring.evaluated'
export const ADOPTION_MONITORING_STATUSES = Object.freeze(['healthy', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return ADOPTION_MONITORING_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceAdoptionMonitoring(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-adoption-monitoring-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    monitoringStatus: safeStatus(input.monitoringStatus ?? input.status),
    monitoringScore: Math.max(0, Math.min(100, Number(input.monitoringScore ?? 0))),
    monitoringSummaryText: String(input.monitoringSummaryText ?? input.monitoringSummary ?? 'Compliance adoption monitoring evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticMonitoringAction: false,
    automaticAdoption: false,
    automaticRemediation: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceAdoptionMonitoringRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const monitoring = normalizeComplianceAdoptionMonitoring(input)
      if (!database?.connected) return { ok: true, disabled: true, monitoring }
      const result = await database.query(
        `INSERT INTO atlas_compliance_adoption_monitoring
          (id, organization_id, team_workspace_id, monitoring_status, monitoring_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET monitoring_status = EXCLUDED.monitoring_status, monitoring_score = EXCLUDED.monitoring_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [monitoring.id, monitoring.tenantScope.organizationId, monitoring.tenantScope.teamWorkspaceId, monitoring.monitoringStatus, monitoring.monitoringScore, monitoring],
      )
      return { ok: true, monitoring: normalizeComplianceAdoptionMonitoring(result.rows?.[0]?.payload ?? monitoring) }
    },
    async list({ tenantContext = {}, monitoringStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (monitoringStatus) {
        params.push(safeStatus(monitoringStatus))
        clauses.push(`monitoring_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_adoption_monitoring
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceAdoptionMonitoring(row.payload))
    },
  }
}

export function evaluateComplianceAdoptionMonitoring(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceAdoptionMonitoring ?? []
  const backlog = input.complianceImprovementBacklog ?? {}
  const program = input.complianceProgramHealth ?? {}
  const executive = input.complianceExecutiveDashboard ?? {}
  const backlogScore = backlog.backlogSummary?.averageBacklogScore ?? 0
  const programScore = program.programHealthSummary?.averageScore ?? backlogScore
  const executiveScore = executive.executiveDashboardSummary?.averageDashboardScore ?? backlogScore
  const score = Math.max(0, Math.min(100, Math.round((backlogScore + programScore + executiveScore) / 3)))
  const monitoringStatus = score >= 85 ? 'healthy' : score >= 60 ? 'caution' : 'blocked'
  const monitoringItems = (supplied.length ? supplied : [normalizeComplianceAdoptionMonitoring({
    tenantContext,
    monitoringStatus,
    monitoringScore: score,
    monitoringSummaryText: `Compliance adoption monitoring references backlog score ${backlogScore}, program health score ${programScore}, and executive dashboard score ${executiveScore}.`,
    sourceReferences: [
      { id: 'compliance-improvement-backlog', type: 'compliance-improvement-backlog', eventType: backlog.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: program.eventType },
      { id: 'compliance-executive-dashboard', type: 'compliance-executive-dashboard', eventType: executive.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceAdoptionMonitoring)
  const monitoringSummary = {
    total: monitoringItems.length,
    healthy: monitoringItems.filter((item) => item.monitoringStatus === 'healthy').length,
    caution: monitoringItems.filter((item) => item.monitoringStatus === 'caution').length,
    blocked: monitoringItems.filter((item) => item.monitoringStatus === 'blocked').length,
    averageMonitoringScore: monitoringItems.length ? Math.round(monitoringItems.reduce((sum, item) => sum + item.monitoringScore, 0) / monitoringItems.length) : 0,
  }
  const adoptionMonitoringStatus = monitoringSummary.blocked > 0 ? 'blocked' : monitoringSummary.caution > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_ADOPTION_MONITORING_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceAdoptionMonitoring: monitoringItems,
    monitoringSummary,
    adoptionMonitoringStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticMonitoringAction: false,
    automaticAdoption: false,
    automaticRemediation: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance adoption monitoring ${adoptionMonitoringStatus}: average monitoring score ${monitoringSummary.averageMonitoringScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_ADOPTION_MONITORING_EVALUATED_EVENT, result)
  return result
}
