import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CHANGE_CLOSURE_PREPARED_EVENT = 'system.complianceChangeClosure.prepared'

export const CLOSURE_STATUSES = Object.freeze(['ready', 'review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return CLOSURE_STATUSES.includes(status) ? status : 'review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceChangeClosureReadiness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-change-closure-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    closureStatus: safeStatus(input.closureStatus ?? input.status),
    closureScore: Math.max(0, Math.min(100, Number(input.closureScore ?? 0))),
    closureSummaryText: String(input.closureSummaryText ?? input.closureSummary ?? 'Compliance change closure readiness prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticClosure: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceChangeClosureReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const closure = normalizeComplianceChangeClosureReadiness(input)
      if (!database?.connected) return { ok: true, disabled: true, closure }
      const result = await database.query(
        `INSERT INTO atlas_compliance_change_closure_readiness
          (id, organization_id, team_workspace_id, closure_status, closure_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET closure_status = EXCLUDED.closure_status, closure_score = EXCLUDED.closure_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [closure.id, closure.tenantScope.organizationId, closure.tenantScope.teamWorkspaceId, closure.closureStatus, closure.closureScore, closure],
      )
      return { ok: true, closure: normalizeComplianceChangeClosureReadiness(result.rows?.[0]?.payload ?? closure) }
    },
    async list({ tenantContext = {}, closureStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (closureStatus) {
        params.push(safeStatus(closureStatus))
        clauses.push(`closure_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_change_closure_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceChangeClosureReadiness(row.payload))
    },
  }
}

export function prepareComplianceChangeClosureReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceChangeClosureReadiness ?? []
  const verification = input.complianceChangeVerification ?? {}
  const impact = input.complianceChangeImpactAssessment ?? {}
  const verificationScore = verification.verificationSummary?.averageVerificationScore ?? 0
  const impactScore = impact.impactSummary?.averageImpactScore ?? 0
  const score = Math.max(0, Math.min(100, verificationScore - Math.max(0, impactScore - 70)))
  const closureStatus = score >= 85 ? 'ready' : score >= 60 ? 'review' : 'blocked'
  const closures = (supplied.length ? supplied : [normalizeComplianceChangeClosureReadiness({
    tenantContext,
    closureStatus,
    closureScore: score,
    closureSummaryText: `Compliance change closure readiness references verification score ${verificationScore} and impact score ${impactScore}.`,
    sourceReferences: [
      { id: 'compliance-change-verification', type: 'compliance-change-verification', eventType: verification.eventType },
      { id: 'compliance-change-impact-assessment', type: 'compliance-change-impact-assessment', eventType: impact.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceChangeClosureReadiness)
  const closureSummary = {
    total: closures.length,
    ready: closures.filter((item) => item.closureStatus === 'ready').length,
    review: closures.filter((item) => item.closureStatus === 'review').length,
    blocked: closures.filter((item) => item.closureStatus === 'blocked').length,
    averageClosureScore: closures.length ? Math.round(closures.reduce((sum, item) => sum + item.closureScore, 0) / closures.length) : 0,
  }
  const changeClosureReadinessStatus = closureSummary.blocked > 0 ? 'blocked' : closureSummary.review > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CHANGE_CLOSURE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceChangeClosureReadiness: closures,
    closureSummary,
    changeClosureReadinessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticClosure: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance change closure readiness ${changeClosureReadinessStatus}: average closure score ${closureSummary.averageClosureScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CHANGE_CLOSURE_PREPARED_EVENT, result)
  return result
}
