import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_REGULATORY_CHANGE_INTAKE_EVALUATED_EVENT = 'system.complianceRegulatoryChange.intakeEvaluated'

export const REGULATORY_CHANGE_STATUSES = Object.freeze(['tracked', 'watchlist', 'urgent'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return REGULATORY_CHANGE_STATUSES.includes(status) ? status : 'watchlist'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceRegulatoryChange(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-regulatory-change-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    changeStatus: safeStatus(input.changeStatus ?? input.status),
    changePriorityScore: Math.max(0, Math.min(100, Number(input.changePriorityScore ?? 0))),
    changeDomain: String(input.changeDomain ?? 'general-compliance').slice(0, 120),
    changeSummary: String(input.changeSummary ?? 'Regulatory change intake evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRegulatoryClaims: false,
    automaticComplianceClaims: false,
    automaticPolicyUpdate: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceRegulatoryChangeIntakeRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const change = normalizeComplianceRegulatoryChange(input)
      if (!database?.connected) return { ok: true, disabled: true, change }
      const result = await database.query(
        `INSERT INTO atlas_compliance_regulatory_change_intake
          (id, organization_id, team_workspace_id, change_status, change_priority_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET change_status = EXCLUDED.change_status, change_priority_score = EXCLUDED.change_priority_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [change.id, change.tenantScope.organizationId, change.tenantScope.teamWorkspaceId, change.changeStatus, change.changePriorityScore, change],
      )
      return { ok: true, change: normalizeComplianceRegulatoryChange(result.rows?.[0]?.payload ?? change) }
    },
    async list({ tenantContext = {}, changeStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (changeStatus) {
        params.push(safeStatus(changeStatus))
        clauses.push(`change_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_regulatory_change_intake
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceRegulatoryChange(row.payload))
    },
  }
}

export function evaluateComplianceRegulatoryChangeIntake(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceRegulatoryChanges ?? []
  const continuity = input.complianceContinuityReadiness ?? {}
  const policy = input.policyControlPlanning ?? {}
  const continuityScore = continuity.continuitySummary?.averageContinuityScore ?? 0
  const policyReady = policy.policyReadinessStatus === 'ready'
  const score = Math.max(0, Math.min(100, 100 - continuityScore + (policyReady ? 5 : 18)))
  const changeStatus = score >= 45 ? 'urgent' : score >= 25 ? 'watchlist' : 'tracked'
  const changes = (supplied.length ? supplied : [normalizeComplianceRegulatoryChange({
    tenantContext,
    changeStatus,
    changePriorityScore: score,
    changeDomain: 'enterprise-compliance-readiness',
    changeSummary: `Regulatory change intake uses continuity readiness score ${continuityScore} and policy readiness ${policy.policyReadinessStatus ?? 'unknown'} as advisory inputs.`,
    sourceReferences: [
      { id: 'compliance-continuity-readiness', type: 'compliance-continuity-readiness', eventType: continuity.eventType },
      { id: 'policy-control-planning', type: 'policy-control-planning', eventType: policy.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceRegulatoryChange)
  const changeSummary = {
    total: changes.length,
    tracked: changes.filter((item) => item.changeStatus === 'tracked').length,
    watchlist: changes.filter((item) => item.changeStatus === 'watchlist').length,
    urgent: changes.filter((item) => item.changeStatus === 'urgent').length,
    averageChangePriorityScore: changes.length ? Math.round(changes.reduce((sum, item) => sum + item.changePriorityScore, 0) / changes.length) : 0,
  }
  const regulatoryChangeIntakeStatus = changeSummary.urgent > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_REGULATORY_CHANGE_INTAKE_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceRegulatoryChanges: changes,
    changeSummary,
    regulatoryChangeIntakeStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRegulatoryClaims: false,
    automaticComplianceClaims: false,
    automaticPolicyUpdate: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance regulatory change intake ${regulatoryChangeIntakeStatus}: ${changeSummary.urgent} urgent and ${changeSummary.watchlist} watchlist changes.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_REGULATORY_CHANGE_INTAKE_EVALUATED_EVENT, result)
  return result
}
