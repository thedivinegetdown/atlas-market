import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_TRAINING_READINESS_EVALUATED_EVENT = 'system.complianceTrainingReadiness.evaluated'

export const TRAINING_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return TRAINING_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceTrainingReadiness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-training-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    trainingStatus: safeStatus(input.trainingStatus ?? input.status),
    trainingScore: Math.max(0, Math.min(100, Number(input.trainingScore ?? 0))),
    trainingCoverageSummary: String(input.trainingCoverageSummary ?? 'Compliance training readiness evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceTrainingReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const readiness = normalizeComplianceTrainingReadiness(input)
      if (!database?.connected) return { ok: true, disabled: true, readiness }
      const result = await database.query(
        `INSERT INTO atlas_compliance_training_readiness
          (id, organization_id, team_workspace_id, training_status, training_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET training_status = EXCLUDED.training_status, training_score = EXCLUDED.training_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [readiness.id, readiness.tenantScope.organizationId, readiness.tenantScope.teamWorkspaceId, readiness.trainingStatus, readiness.trainingScore, readiness],
      )
      return { ok: true, readiness: normalizeComplianceTrainingReadiness(result.rows?.[0]?.payload ?? readiness) }
    },
    async list({ tenantContext = {}, trainingStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (trainingStatus) {
        params.push(safeStatus(trainingStatus))
        clauses.push(`training_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_training_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceTrainingReadiness(row.payload))
    },
  }
}

export function evaluateComplianceTrainingReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceTrainingReadiness ?? []
  const resource = input.complianceResourcePlanning ?? {}
  const program = input.complianceProgramHealth ?? {}
  const resourceScore = resource.resourceSummary?.averageResourceScore ?? 0
  const programScore = program.programHealthSummary?.averageScore ?? resourceScore
  const score = Math.round((resourceScore + programScore) / 2)
  const trainingStatus = score >= 85 ? 'ready' : score >= 65 ? 'caution' : 'blocked'
  const readinessItems = (supplied.length ? supplied : [normalizeComplianceTrainingReadiness({
    tenantContext,
    trainingStatus,
    trainingScore: score,
    trainingCoverageSummary: `Compliance training readiness references resource planning score ${resourceScore} and program health score ${programScore}.`,
    sourceReferences: [
      { id: 'compliance-resource-planning', type: 'compliance-resource-planning', eventType: resource.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: program.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceTrainingReadiness)
  const trainingSummary = {
    total: readinessItems.length,
    ready: readinessItems.filter((item) => item.trainingStatus === 'ready').length,
    caution: readinessItems.filter((item) => item.trainingStatus === 'caution').length,
    blocked: readinessItems.filter((item) => item.trainingStatus === 'blocked').length,
    averageTrainingScore: readinessItems.length ? Math.round(readinessItems.reduce((sum, item) => sum + item.trainingScore, 0) / readinessItems.length) : 0,
  }
  const trainingReadinessStatus = trainingSummary.blocked > 0 ? 'blocked' : trainingSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_TRAINING_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceTrainingReadiness: readinessItems,
    trainingSummary,
    trainingReadinessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance training readiness ${trainingReadinessStatus}: average training score ${trainingSummary.averageTrainingScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_TRAINING_READINESS_EVALUATED_EVENT, result)
  return result
}
