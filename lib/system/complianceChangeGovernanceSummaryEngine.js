import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CHANGE_GOVERNANCE_SUMMARIZED_EVENT = 'system.complianceChangeGovernance.summarized'
export const GOVERNANCE_SUMMARY_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return GOVERNANCE_SUMMARY_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceChangeGovernanceSummary(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-change-governance-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    governanceStatus: safeStatus(input.governanceStatus ?? input.status),
    governanceScore: Math.max(0, Math.min(100, Number(input.governanceScore ?? 0))),
    governanceSummaryText: String(input.governanceSummaryText ?? input.governanceSummary ?? 'Compliance change governance summarized for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticGovernanceDecision: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceChangeGovernanceSummaryRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const summary = normalizeComplianceChangeGovernanceSummary(input)
      if (!database?.connected) return { ok: true, disabled: true, summary }
      const result = await database.query(
        `INSERT INTO atlas_compliance_change_governance_summaries
          (id, organization_id, team_workspace_id, governance_status, governance_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET governance_status = EXCLUDED.governance_status, governance_score = EXCLUDED.governance_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [summary.id, summary.tenantScope.organizationId, summary.tenantScope.teamWorkspaceId, summary.governanceStatus, summary.governanceScore, summary],
      )
      return { ok: true, summary: normalizeComplianceChangeGovernanceSummary(result.rows?.[0]?.payload ?? summary) }
    },
    async list({ tenantContext = {}, governanceStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (governanceStatus) {
        params.push(safeStatus(governanceStatus))
        clauses.push(`governance_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_change_governance_summaries
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceChangeGovernanceSummary(row.payload))
    },
  }
}

export function summarizeComplianceChangeGovernance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceChangeGovernanceSummaries ?? []
  const lessons = input.complianceLessonsLearned ?? {}
  const decisions = input.complianceGovernanceDecisionLog ?? {}
  const closure = input.complianceChangeClosureReadiness ?? {}
  const lessonScore = lessons.lessonSummary?.averageLessonScore ?? 0
  const closureScore = closure.closureSummary?.averageClosureScore ?? lessonScore
  const decisionReady = decisions.decisionLogStatus === 'ready' ? 5 : 0
  const score = Math.max(0, Math.min(100, Math.round((lessonScore + closureScore) / 2) + decisionReady))
  const governanceStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const summaries = (supplied.length ? supplied : [normalizeComplianceChangeGovernanceSummary({
    tenantContext,
    governanceStatus,
    governanceScore: score,
    governanceSummaryText: `Compliance change governance summary references lesson score ${lessonScore}, closure score ${closureScore}, and governance decision log status ${decisions.decisionLogStatus ?? 'unknown'}.`,
    sourceReferences: [
      { id: 'compliance-lessons-learned', type: 'compliance-lessons-learned', eventType: lessons.eventType },
      { id: 'compliance-change-closure-readiness', type: 'compliance-change-closure-readiness', eventType: closure.eventType },
      { id: 'compliance-governance-decision-log', type: 'compliance-governance-decision-log', eventType: decisions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceChangeGovernanceSummary)
  const governanceSummary = {
    total: summaries.length,
    ready: summaries.filter((item) => item.governanceStatus === 'ready').length,
    caution: summaries.filter((item) => item.governanceStatus === 'caution').length,
    blocked: summaries.filter((item) => item.governanceStatus === 'blocked').length,
    averageGovernanceScore: summaries.length ? Math.round(summaries.reduce((sum, item) => sum + item.governanceScore, 0) / summaries.length) : 0,
  }
  const changeGovernanceSummaryStatus = governanceSummary.blocked > 0 ? 'blocked' : governanceSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CHANGE_GOVERNANCE_SUMMARIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceChangeGovernanceSummaries: summaries,
    governanceSummary,
    changeGovernanceSummaryStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticGovernanceDecision: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance change governance summary ${changeGovernanceSummaryStatus}: average governance score ${governanceSummary.averageGovernanceScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CHANGE_GOVERNANCE_SUMMARIZED_EVENT, result)
  return result
}
