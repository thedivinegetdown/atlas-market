import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CONTINUITY_READINESS_EVALUATED_EVENT = 'system.complianceContinuityReadiness.evaluated'

export const CONTINUITY_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return CONTINUITY_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceContinuityReadiness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-continuity-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    continuityStatus: safeStatus(input.continuityStatus ?? input.status),
    continuityScore: Math.max(0, Math.min(100, Number(input.continuityScore ?? 0))),
    continuitySummaryText: String(input.continuitySummaryText ?? input.continuitySummary ?? 'Compliance continuity readiness evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticFailover: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceContinuityReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const readiness = normalizeComplianceContinuityReadiness(input)
      if (!database?.connected) return { ok: true, disabled: true, readiness }
      const result = await database.query(
        `INSERT INTO atlas_compliance_continuity_readiness
          (id, organization_id, team_workspace_id, continuity_status, continuity_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET continuity_status = EXCLUDED.continuity_status, continuity_score = EXCLUDED.continuity_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [readiness.id, readiness.tenantScope.organizationId, readiness.tenantScope.teamWorkspaceId, readiness.continuityStatus, readiness.continuityScore, readiness],
      )
      return { ok: true, readiness: normalizeComplianceContinuityReadiness(result.rows?.[0]?.payload ?? readiness) }
    },
    async list({ tenantContext = {}, continuityStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (continuityStatus) {
        params.push(safeStatus(continuityStatus))
        clauses.push(`continuity_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_continuity_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceContinuityReadiness(row.payload))
    },
  }
}

export function evaluateComplianceContinuityReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceContinuityReadiness ?? []
  const training = input.complianceTrainingReadiness ?? {}
  const thirdParty = input.complianceThirdPartyOversight ?? {}
  const runbook = input.productionOperationsRunbook ?? {}
  const trainingScore = training.trainingSummary?.averageTrainingScore ?? 0
  const oversightScore = thirdParty.oversightSummary?.averageOversightScore ?? 0
  const runbookReady = runbook.operatorHandoffSummary?.handoffStatus === 'ready' ? 10 : 0
  const score = Math.max(0, Math.min(100, Math.round((trainingScore + oversightScore) / 2) + runbookReady))
  const continuityStatus = score >= 85 ? 'ready' : score >= 65 ? 'caution' : 'blocked'
  const readinessItems = (supplied.length ? supplied : [normalizeComplianceContinuityReadiness({
    tenantContext,
    continuityStatus,
    continuityScore: score,
    continuitySummaryText: `Compliance continuity readiness combines training score ${trainingScore}, third-party oversight score ${oversightScore}, and operations runbook handoff ${runbook.operatorHandoffSummary?.handoffStatus ?? 'unknown'}.`,
    sourceReferences: [
      { id: 'compliance-training-readiness', type: 'compliance-training-readiness', eventType: training.eventType },
      { id: 'compliance-third-party-oversight', type: 'compliance-third-party-oversight', eventType: thirdParty.eventType },
      { id: 'operations-runbook', type: 'operations-runbook', eventType: runbook.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceContinuityReadiness)
  const continuitySummary = {
    total: readinessItems.length,
    ready: readinessItems.filter((item) => item.continuityStatus === 'ready').length,
    caution: readinessItems.filter((item) => item.continuityStatus === 'caution').length,
    blocked: readinessItems.filter((item) => item.continuityStatus === 'blocked').length,
    averageContinuityScore: readinessItems.length ? Math.round(readinessItems.reduce((sum, item) => sum + item.continuityScore, 0) / readinessItems.length) : 0,
  }
  const continuityReadinessStatus = continuitySummary.blocked > 0 ? 'blocked' : continuitySummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CONTINUITY_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceContinuityReadiness: readinessItems,
    continuitySummary,
    continuityReadinessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticFailover: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance continuity readiness ${continuityReadinessStatus}: average continuity score ${continuitySummary.averageContinuityScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CONTINUITY_READINESS_EVALUATED_EVENT, result)
  return result
}
