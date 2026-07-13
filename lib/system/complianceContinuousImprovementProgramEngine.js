import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CONTINUOUS_IMPROVEMENT_PROGRAM_EVALUATED_EVENT = 'system.complianceContinuousImprovementProgram.evaluated'
export const CONTINUOUS_IMPROVEMENT_STATUSES = Object.freeze(['healthy', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return CONTINUOUS_IMPROVEMENT_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceContinuousImprovementProgram(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-continuous-improvement-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    programStatus: safeStatus(input.programStatus ?? input.status),
    programScore: Math.max(0, Math.min(100, Number(input.programScore ?? 0))),
    programSummaryText: String(input.programSummaryText ?? input.programSummary ?? 'Compliance continuous improvement program evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticProgramChange: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceContinuousImprovementProgramRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const program = normalizeComplianceContinuousImprovementProgram(input)
      if (!database?.connected) return { ok: true, disabled: true, program }
      const result = await database.query(
        `INSERT INTO atlas_compliance_continuous_improvement_programs
          (id, organization_id, team_workspace_id, program_status, program_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET program_status = EXCLUDED.program_status, program_score = EXCLUDED.program_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [program.id, program.tenantScope.organizationId, program.tenantScope.teamWorkspaceId, program.programStatus, program.programScore, program],
      )
      return { ok: true, program: normalizeComplianceContinuousImprovementProgram(result.rows?.[0]?.payload ?? program) }
    },
    async list({ tenantContext = {}, programStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (programStatus) {
        params.push(safeStatus(programStatus))
        clauses.push(`program_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_continuous_improvement_programs
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceContinuousImprovementProgram(row.payload))
    },
  }
}

export function evaluateComplianceContinuousImprovementProgram(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceContinuousImprovementPrograms ?? []
  const benefits = input.complianceBenefitRealization ?? {}
  const outcomes = input.complianceImprovementOutcomeReview ?? {}
  const programHealth = input.complianceProgramHealth ?? {}
  const benefitScore = benefits.benefitSummary?.averageBenefitScore ?? 0
  const outcomeScore = outcomes.outcomeSummary?.averageOutcomeScore ?? benefitScore
  const healthScore = programHealth.programHealthSummary?.averageScore ?? benefitScore
  const score = Math.max(0, Math.min(100, Math.round((benefitScore + outcomeScore + healthScore) / 3)))
  const programStatus = score >= 85 ? 'healthy' : score >= 60 ? 'caution' : 'blocked'
  const programs = (supplied.length ? supplied : [normalizeComplianceContinuousImprovementProgram({
    tenantContext,
    programStatus,
    programScore: score,
    programSummaryText: `Compliance continuous improvement program references benefit score ${benefitScore}, outcome score ${outcomeScore}, and program health score ${healthScore}.`,
    sourceReferences: [
      { id: 'compliance-benefit-realization', type: 'compliance-benefit-realization', eventType: benefits.eventType },
      { id: 'compliance-improvement-outcome-review', type: 'compliance-improvement-outcome-review', eventType: outcomes.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: programHealth.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceContinuousImprovementProgram)
  const continuousImprovementSummary = {
    total: programs.length,
    healthy: programs.filter((item) => item.programStatus === 'healthy').length,
    caution: programs.filter((item) => item.programStatus === 'caution').length,
    blocked: programs.filter((item) => item.programStatus === 'blocked').length,
    averageProgramScore: programs.length ? Math.round(programs.reduce((sum, item) => sum + item.programScore, 0) / programs.length) : 0,
  }
  const continuousImprovementStatus = continuousImprovementSummary.blocked > 0 ? 'blocked' : continuousImprovementSummary.caution > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CONTINUOUS_IMPROVEMENT_PROGRAM_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceContinuousImprovementPrograms: programs,
    continuousImprovementSummary,
    continuousImprovementStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticProgramChange: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance continuous improvement program ${continuousImprovementStatus}: average program score ${continuousImprovementSummary.averageProgramScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CONTINUOUS_IMPROVEMENT_PROGRAM_EVALUATED_EVENT, result)
  return result
}
