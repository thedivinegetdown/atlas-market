import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_REMEDIATION_EFFECTIVENESS_REVIEWED_EVENT = 'system.remediationEffectiveness.reviewed'
export const SYSTEM_REMEDIATION_FOLLOW_UP_REVIEWED_EVENT = 'system.remediationFollowUp.reviewed'

export const EFFECTIVENESS_RATINGS = Object.freeze(['effective', 'partially_effective', 'ineffective', 'inconclusive', 'pending_evaluation'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function addDays(isoDate, days) {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.caseId ?? null,
    type: reference.type ?? reference.evidenceType ?? 'reference',
    eventType: reference.eventType ?? reference.sourceEventReference?.eventType ?? null,
  }
}

function riskRank(risk) {
  return { low: 0, caution: 1, medium: 1, high: 2, critical: 3 }[risk] ?? 1
}

function residualRisk({ plan = {}, relatedEvidence = [], repeatedFindingCount = 0, reopenedCaseCount = 0 }) {
  if (plan.executionStatus === 'blocked') return 'critical'
  if (plan.executionStatus === 'cancelled' && relatedEvidence.some((item) => item.severity === 'critical')) return 'critical'
  if (repeatedFindingCount > 1 || reopenedCaseCount > 0) return 'high'
  if (plan.executionStatus !== 'completed') return plan.priority === 'critical' ? 'high' : 'caution'
  if (!plan.completionSummary || relatedEvidence.length === 0) return 'caution'
  return 'low'
}

function ratingFrom({ plan, currentResidualRisk, expectedOutcomeStatus }) {
  if (['not_started', 'in_progress'].includes(plan.executionStatus)) return 'pending_evaluation'
  if (plan.executionStatus === 'blocked' || (plan.executionStatus === 'cancelled' && riskRank(currentResidualRisk) >= 2)) return 'ineffective'
  if (!plan.completionSummary || expectedOutcomeStatus !== 'met') return 'inconclusive'
  if (riskRank(currentResidualRisk) <= 0) return 'effective'
  return 'partially_effective'
}

export function normalizeRemediationEffectivenessEvaluation(input = {}) {
  const now = input.evaluatedAt ?? input.timestamp ?? getNowIso()
  const plan = input.plan ?? input
  const tenantScope = plan.tenantScope ?? input.tenantScope ?? {}
  const relatedEvidence = input.relatedEvidence ?? []
  const repeatedFindingCount = Number(input.repeatedFindingCount ?? 0)
  const reopenedCaseCount = Number(input.reopenedCaseCount ?? 0)
  const currentResidualRisk = input.currentResidualRisk ?? residualRisk({ plan, relatedEvidence, repeatedFindingCount, reopenedCaseCount })
  const expectedOutcomeStatus = input.expectedOutcomeStatus ?? (plan.executionStatus === 'completed' && plan.completionSummary ? 'met' : plan.executionStatus === 'completed' ? 'unverified' : 'pending')
  const effectivenessRating = input.effectivenessRating ?? ratingFrom({ plan, currentResidualRisk, expectedOutcomeStatus })
  const followUpRequired = input.followUpRequired ?? !['effective'].includes(effectivenessRating)
  const followUpDueDate = input.followUpDueDate ?? (followUpRequired ? addDays(now, currentResidualRisk === 'critical' ? 1 : 14) : null)
  const findings = [
    plan.executionStatus === 'completed' && relatedEvidence.length === 0 ? 'completed-without-evidence' : null,
    plan.executionStatus === 'completed' && !plan.completionSummary ? 'missing-completion-summary' : null,
    repeatedFindingCount > 0 ? 'repeated-findings-after-remediation' : null,
    reopenedCaseCount > 0 ? 'case-reopened-after-remediation' : null,
    plan.executionStatus === 'blocked' ? 'blocked-plan-requires-escalation' : null,
    plan.executionStatus === 'cancelled' && riskRank(currentResidualRisk) >= 2 ? 'cancelled-with-unresolved-risk' : null,
  ].filter(Boolean)

  return {
    id: String(input.id ?? `remediation-effectiveness-${plan.id ?? Date.now()}`),
    remediationPlanId: plan.id ?? input.remediationPlanId ?? null,
    relatedCaseId: plan.relatedCaseId ?? input.relatedCaseId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    originalRiskLevel: plan.priority ?? input.originalRiskLevel ?? 'medium',
    currentResidualRisk,
    expectedOutcomeStatus,
    effectivenessRating,
    followUpRequired,
    followUpDueDate,
    repeatedFindingCount,
    evidenceReferences: (plan.relatedEvidenceReferences ?? relatedEvidence).map(normalizeReference),
    caseReferences: [plan.relatedCaseId].filter(Boolean).map((id) => ({ id, type: 'administrative-case' })),
    workflowReferences: (input.workflowReferences ?? []).map(normalizeReference),
    operatorAttentionReferences: (input.operatorAttentionReferences ?? []).map(normalizeReference),
    humanReviewRecommendation: followUpRequired ? 'owner/admin follow-up review required' : 'monitor',
    evaluationRationale: String(input.evaluationRationale ?? `Remediation effectiveness ${effectivenessRating} with ${currentResidualRisk} residual risk.`).slice(0, 500),
    findings,
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.78))),
    evaluatedAt: now,
    recommendationsOnly: true,
    humanReviewOnly: true,
    automaticCaseReopen: false,
    automaticEnforcementActions: false,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createRemediationEffectivenessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evaluationInput) {
      const evaluation = normalizeRemediationEffectivenessEvaluation(evaluationInput)
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_remediation_effectiveness_evaluations
          (id, organization_id, team_workspace_id, remediation_plan_id, related_case_id, effectiveness_rating, residual_risk, follow_up_due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET effectiveness_rating = EXCLUDED.effectiveness_rating, residual_risk = EXCLUDED.residual_risk, follow_up_due_date = EXCLUDED.follow_up_due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          evaluation.id,
          evaluation.tenantScope.organizationId,
          evaluation.tenantScope.teamWorkspaceId,
          evaluation.remediationPlanId,
          evaluation.relatedCaseId,
          evaluation.effectivenessRating,
          evaluation.currentResidualRisk,
          evaluation.followUpDueDate,
          evaluation,
        ],
      )
      return { ok: true, evaluation: normalizeRemediationEffectivenessEvaluation(result.rows?.[0]?.payload ?? evaluation) }
    },
    async list({ tenantContext = {}, effectivenessRating, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (effectivenessRating) {
        params.push(EFFECTIVENESS_RATINGS.includes(effectivenessRating) ? effectivenessRating : 'inconclusive')
        clauses.push(`effectiveness_rating = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_remediation_effectiveness_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRemediationEffectivenessEvaluation(row.payload))
    },
  }
}

export function evaluateRemediationEffectiveness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const plans = input.remediationPlanning?.remediationPlans ?? input.remediationPlans ?? []
  const evidence = input.administrativeEvidence?.administrativeEvidence ?? []
  const cases = input.administrativeCases?.administrativeCases ?? []
  const reopenedCases = cases.filter((item) => ['reopened', 'investigating'].includes(item.status))
  const evaluations = plans.map((plan) => {
    const relatedEvidence = evidence.filter((item) => plan.relatedEvidenceReferences?.some((reference) => reference.id === item.id) || item.relatedCaseId === plan.relatedCaseId)
    const repeatedFindingCount = evidence.filter((item) => item.relatedCaseId === plan.relatedCaseId && ['high', 'critical'].includes(item.severity)).length > 1 ? 1 : 0
    const reopenedCaseCount = reopenedCases.filter((item) => item.id === plan.relatedCaseId).length
    return normalizeRemediationEffectivenessEvaluation({
      plan,
      relatedEvidence,
      repeatedFindingCount,
      reopenedCaseCount,
      workflowReferences: input.administrationWorkflowSla?.workflowSlaItems ?? [],
      operatorAttentionReferences: input.operatorAttention?.rankedOperatorAttentionQueue ?? [],
      timestamp: now,
    })
  })
  const effectivenessSummary = {
    total: evaluations.length,
    effective: evaluations.filter((item) => item.effectivenessRating === 'effective').length,
    partiallyEffective: evaluations.filter((item) => item.effectivenessRating === 'partially_effective').length,
    ineffective: evaluations.filter((item) => item.effectivenessRating === 'ineffective').length,
    inconclusive: evaluations.filter((item) => item.effectivenessRating === 'inconclusive').length,
    pendingEvaluation: evaluations.filter((item) => item.effectivenessRating === 'pending_evaluation').length,
    followUpRequired: evaluations.filter((item) => item.followUpRequired).length,
    repeatedFindings: evaluations.reduce((sum, item) => sum + item.repeatedFindingCount, 0),
    criticalResidualRisk: evaluations.filter((item) => item.currentResidualRisk === 'critical').length,
  }
  const status = effectivenessSummary.ineffective > 0 || effectivenessSummary.criticalResidualRisk > 0 ? 'blocked' : effectivenessSummary.followUpRequired > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_REMEDIATION_EFFECTIVENESS_REVIEWED_EVENT,
    timestamp: now,
    remediationEffectivenessEvaluations: evaluations,
    effectivenessSummary,
    status,
    recommendationsOnly: true,
    humanReviewOnly: true,
    automaticCaseReopen: false,
    automaticEnforcementActions: false,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Remediation effectiveness ${status}: ${effectivenessSummary.followUpRequired} plans require follow-up and ${effectivenessSummary.criticalResidualRisk} carry critical residual risk.`,
    sourceEvents: {
      remediationPlanning: input.remediationPlanning?.eventType ?? null,
      administrativeEvidence: input.administrativeEvidence?.eventType ?? null,
      administrativeCases: input.administrativeCases?.eventType ?? null,
      operatorAttention: input.operatorAttention?.eventType ?? null,
      administrationWorkflowSla: input.administrationWorkflowSla?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_REMEDIATION_EFFECTIVENESS_REVIEWED_EVENT, result)
  return result
}
