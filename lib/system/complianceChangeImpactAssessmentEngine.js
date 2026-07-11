import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CHANGE_IMPACT_ASSESSED_EVENT = 'system.complianceChangeImpact.assessed'

export const IMPACT_STATUSES = Object.freeze(['low', 'moderate', 'high'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return IMPACT_STATUSES.includes(status) ? status : 'moderate'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceChangeImpactAssessment(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-change-impact-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    impactStatus: safeStatus(input.impactStatus ?? input.status),
    impactScore: Math.max(0, Math.min(100, Number(input.impactScore ?? 0))),
    affectedDomainSummary: String(input.affectedDomainSummary ?? 'Compliance change impact assessed for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceChangeImpactAssessmentRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const assessment = normalizeComplianceChangeImpactAssessment(input)
      if (!database?.connected) return { ok: true, disabled: true, assessment }
      const result = await database.query(
        `INSERT INTO atlas_compliance_change_impact_assessments
          (id, organization_id, team_workspace_id, impact_status, impact_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET impact_status = EXCLUDED.impact_status, impact_score = EXCLUDED.impact_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [assessment.id, assessment.tenantScope.organizationId, assessment.tenantScope.teamWorkspaceId, assessment.impactStatus, assessment.impactScore, assessment],
      )
      return { ok: true, assessment: normalizeComplianceChangeImpactAssessment(result.rows?.[0]?.payload ?? assessment) }
    },
    async list({ tenantContext = {}, impactStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (impactStatus) {
        params.push(safeStatus(impactStatus))
        clauses.push(`impact_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_change_impact_assessments
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceChangeImpactAssessment(row.payload))
    },
  }
}

export function assessComplianceChangeImpact(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceChangeImpactAssessments ?? []
  const intake = input.complianceRegulatoryChangeIntake ?? {}
  const obligations = input.complianceObligationMapping ?? {}
  const priority = intake.changeSummary?.averageChangePriorityScore ?? 0
  const mappedObligations = obligations.obligationSummary?.mapped ?? 0
  const score = Math.max(0, Math.min(100, priority + mappedObligations * 5))
  const impactStatus = score >= 65 ? 'high' : score >= 35 ? 'moderate' : 'low'
  const assessments = (supplied.length ? supplied : [normalizeComplianceChangeImpactAssessment({
    tenantContext,
    impactStatus,
    impactScore: score,
    affectedDomainSummary: `Compliance change impact assessment uses regulatory priority ${priority} and ${mappedObligations} mapped obligations as advisory inputs.`,
    sourceReferences: [
      { id: 'compliance-regulatory-change-intake', type: 'compliance-regulatory-change-intake', eventType: intake.eventType },
      { id: 'compliance-obligation-mapping', type: 'compliance-obligation-mapping', eventType: obligations.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceChangeImpactAssessment)
  const impactSummary = {
    total: assessments.length,
    low: assessments.filter((item) => item.impactStatus === 'low').length,
    moderate: assessments.filter((item) => item.impactStatus === 'moderate').length,
    high: assessments.filter((item) => item.impactStatus === 'high').length,
    averageImpactScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.impactScore, 0) / assessments.length) : 0,
  }
  const changeImpactAssessmentStatus = impactSummary.high > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CHANGE_IMPACT_ASSESSED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceChangeImpactAssessments: assessments,
    impactSummary,
    changeImpactAssessmentStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance change impact assessment ${changeImpactAssessmentStatus}: average impact score ${impactSummary.averageImpactScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CHANGE_IMPACT_ASSESSED_EVENT, result)
  return result
}
