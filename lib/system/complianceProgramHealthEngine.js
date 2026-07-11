import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_PROGRAM_HEALTH_EVALUATED_EVENT = 'system.complianceProgramHealth.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceProgramHealthEvaluation(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-program-health-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    healthStatus: ['healthy', 'caution', 'blocked'].includes(input.healthStatus ?? input.status) ? (input.healthStatus ?? input.status) : 'caution',
    healthScore: Math.max(0, Math.min(100, Number(input.healthScore ?? 0))),
    healthSummary: String(input.healthSummary ?? 'Compliance program health evaluated for owner/admin review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    keyRisks: (input.keyRisks ?? []).map((item) => String(item).slice(0, 220)),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceProgramHealthRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evaluationInput) {
      const evaluation = normalizeComplianceProgramHealthEvaluation(evaluationInput)
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_compliance_program_health_evaluations
          (id, organization_id, team_workspace_id, health_status, health_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET health_status = EXCLUDED.health_status, health_score = EXCLUDED.health_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [evaluation.id, evaluation.tenantScope.organizationId, evaluation.tenantScope.teamWorkspaceId, evaluation.healthStatus, evaluation.healthScore, evaluation],
      )
      return { ok: true, evaluation: normalizeComplianceProgramHealthEvaluation(result.rows?.[0]?.payload ?? evaluation) }
    },
    async list({ tenantContext = {}, healthStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (healthStatus) {
        params.push(['healthy', 'caution', 'blocked'].includes(healthStatus) ? healthStatus : 'caution')
        clauses.push(`health_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_program_health_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceProgramHealthEvaluation(row.payload))
    },
  }
}

export function evaluateComplianceProgramHealth(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceProgramHealthEvaluations ?? []
  const risk = input.complianceRiskCommandCenter ?? {}
  const examReadiness = input.complianceExamReadiness ?? {}
  const boardPacket = input.complianceBoardPacket ?? {}
  const minutes = input.complianceMeetingMinutes ?? {}
  const actionItems = input.complianceGovernanceActionItems ?? {}
  const score = Math.max(0, Math.min(100, 100
    - (risk.commandCenterStatus === 'blocked' ? 30 : risk.commandCenterStatus === 'caution' ? 10 : 0)
    - (examReadiness.examReadinessStatus === 'blocked' ? 25 : examReadiness.examReadinessStatus === 'caution' ? 10 : 0)
    - (boardPacket.boardPacketStatus === 'caution' ? 10 : 0)
    - ((minutes.meetingMinutesSummary?.needsUpdates ?? 0) * 10)
    - ((actionItems.actionItemSummary?.blocked ?? 0) * 20)
    - ((actionItems.actionItemSummary?.highPriority ?? 0) * 5)))
  const healthStatus = score < 60 ? 'blocked' : score < 85 ? 'caution' : 'healthy'
  const evaluations = (supplied.length ? supplied : [normalizeComplianceProgramHealthEvaluation({
    tenantContext,
    healthStatus,
    healthScore: score,
    healthSummary: `Compliance program health summarizes risk command, exam readiness, board packet, meeting minutes, and governance action items with a ${score} health score.`,
    sourceReferences: [
      { id: 'compliance-risk-command', type: 'compliance-risk-command-center', eventType: risk.eventType },
      { id: 'compliance-exam-readiness', type: 'compliance-exam-readiness', eventType: examReadiness.eventType },
      { id: 'compliance-board-packet', type: 'compliance-board-packet', eventType: boardPacket.eventType },
      { id: 'compliance-meeting-minutes', type: 'compliance-meeting-minutes', eventType: minutes.eventType },
      { id: 'compliance-action-items', type: 'compliance-governance-action-items', eventType: actionItems.eventType },
    ],
    keyRisks: [
      ...(risk.commandCenterStatus === 'blocked' ? ['Compliance risk command center blocked'] : []),
      ...(examReadiness.examReadinessStatus === 'blocked' ? ['Exam readiness blocked'] : []),
      ...((actionItems.actionItemSummary?.blocked ?? 0) > 0 ? ['Blocked governance action items'] : []),
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceProgramHealthEvaluation)
  const programHealthSummary = {
    total: evaluations.length,
    healthy: evaluations.filter((item) => item.healthStatus === 'healthy').length,
    caution: evaluations.filter((item) => item.healthStatus === 'caution').length,
    blocked: evaluations.filter((item) => item.healthStatus === 'blocked').length,
    averageScore: evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + item.healthScore, 0) / evaluations.length) : 0,
  }
  const programHealthStatus = programHealthSummary.blocked > 0 ? 'blocked' : programHealthSummary.caution > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_PROGRAM_HEALTH_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceProgramHealthEvaluations: evaluations,
    programHealthSummary,
    programHealthStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance program health ${programHealthStatus}: average score ${programHealthSummary.averageScore} across ${programHealthSummary.total} evaluations.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_PROGRAM_HEALTH_EVALUATED_EVENT, result)
  return result
}
