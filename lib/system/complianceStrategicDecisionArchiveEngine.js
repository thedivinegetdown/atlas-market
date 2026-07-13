import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_DECISION_ARCHIVE_ARCHIVED_EVENT = 'system.complianceStrategicDecisionArchive.archived'
export const STRATEGIC_DECISION_ARCHIVE_STATUSES = Object.freeze(['archived', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_DECISION_ARCHIVE_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicDecisionArchiveRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-decision-archive-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    archiveStatus: safeStatus(input.archiveStatus ?? input.status),
    archiveScore: Math.max(0, Math.min(100, Number(input.archiveScore ?? 0))),
    archiveSummaryText: String(input.archiveSummaryText ?? input.archiveSummary ?? 'Compliance strategic decision archived for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticDecisionClaim: false,
    automaticDecisionApproval: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicDecisionArchiveRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const decision = normalizeComplianceStrategicDecisionArchiveRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, decision }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_decision_archives
          (id, organization_id, team_workspace_id, archive_status, archive_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET archive_status = EXCLUDED.archive_status, archive_score = EXCLUDED.archive_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [decision.id, decision.tenantScope.organizationId, decision.tenantScope.teamWorkspaceId, decision.archiveStatus, decision.archiveScore, decision],
      )
      return { ok: true, decision: normalizeComplianceStrategicDecisionArchiveRecord(result.rows?.[0]?.payload ?? decision) }
    },
    async list({ tenantContext = {}, archiveStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (archiveStatus) {
        params.push(safeStatus(archiveStatus))
        clauses.push(`archive_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_decision_archives
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicDecisionArchiveRecord(row.payload))
    },
  }
}

export function archiveComplianceStrategicDecisions(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicDecisionArchives ?? input.complianceStrategicDecisionArchive ?? []
  const knowledge = input.complianceStrategicKnowledgeBase ?? {}
  const decisions = input.complianceGovernanceDecisionLog ?? {}
  const strategy = input.complianceExecutiveStrategyPlan ?? {}
  const knowledgeScore = knowledge.strategicKnowledgeSummary?.averageKnowledgeScore ?? 0
  const decisionScore = decisions.governanceDecisionSummary?.averageDecisionScore ?? decisions.decisionLogSummary?.averageDecisionScore ?? knowledgeScore
  const strategyScore = strategy.executiveStrategySummary?.averageStrategyScore ?? knowledgeScore
  const score = Math.max(0, Math.min(100, Math.round((knowledgeScore + decisionScore + strategyScore) / 3)))
  const archiveStatus = score >= 85 ? 'archived' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const decisionArchives = (sourceItems.length ? sourceItems : [normalizeComplianceStrategicDecisionArchiveRecord({
    tenantContext,
    archiveStatus,
    archiveScore: score,
    archiveSummaryText: `Compliance strategic decision archive references knowledge score ${knowledgeScore}, decision score ${decisionScore}, and strategy score ${strategyScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-knowledge-base', type: 'compliance-strategic-knowledge-base', eventType: knowledge.eventType },
      { id: 'compliance-governance-decision-log', type: 'compliance-governance-decision-log', eventType: decisions.eventType },
      { id: 'compliance-executive-strategy-plan', type: 'compliance-executive-strategy-plan', eventType: strategy.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicDecisionArchiveRecord)
  const strategicDecisionArchiveSummary = {
    total: decisionArchives.length,
    archived: decisionArchives.filter((item) => item.archiveStatus === 'archived').length,
    needsReview: decisionArchives.filter((item) => item.archiveStatus === 'needs-review').length,
    blocked: decisionArchives.filter((item) => item.archiveStatus === 'blocked').length,
    averageArchiveScore: decisionArchives.length ? Math.round(decisionArchives.reduce((sum, item) => sum + item.archiveScore, 0) / decisionArchives.length) : 0,
  }
  const strategicDecisionArchiveStatus = strategicDecisionArchiveSummary.blocked > 0 ? 'blocked' : strategicDecisionArchiveSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_DECISION_ARCHIVE_ARCHIVED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicDecisionArchives: decisionArchives,
    strategicDecisionArchiveSummary,
    strategicDecisionArchiveStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticDecisionClaim: false,
    automaticDecisionApproval: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic decision archive ${strategicDecisionArchiveStatus}: average archive score ${strategicDecisionArchiveSummary.averageArchiveScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_DECISION_ARCHIVE_ARCHIVED_EVENT, result)
  return result
}
