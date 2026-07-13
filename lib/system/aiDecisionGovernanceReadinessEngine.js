import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_DECISION_GOVERNANCE_READINESS_EVALUATED_EVENT = 'system.aiDecisionGovernanceReadiness.evaluated'
export const AI_DECISION_GOVERNANCE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return AI_DECISION_GOVERNANCE_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeAiDecisionGovernanceReadinessRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-decision-governance-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    governanceStatus: safeStatus(input.governanceStatus ?? input.status),
    governanceScore: Math.max(0, Math.min(100, Number(input.governanceScore ?? 0))),
    governanceSummaryText: String(input.governanceSummaryText ?? input.governanceSummary ?? 'AI decision governance readiness evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticModelApproval: false,
    automaticPolicyEnforcement: false,
    automaticDecisionOverride: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAiDecisionGovernanceReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const readiness = normalizeAiDecisionGovernanceReadinessRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, readiness }
      const result = await database.query(
        `INSERT INTO atlas_ai_decision_governance_readiness
          (id, organization_id, team_workspace_id, governance_status, governance_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET governance_status = EXCLUDED.governance_status, governance_score = EXCLUDED.governance_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [readiness.id, readiness.tenantScope.organizationId, readiness.tenantScope.teamWorkspaceId, readiness.governanceStatus, readiness.governanceScore, readiness],
      )
      return { ok: true, readiness: normalizeAiDecisionGovernanceReadinessRecord(result.rows?.[0]?.payload ?? readiness) }
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
        `SELECT payload FROM atlas_ai_decision_governance_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiDecisionGovernanceReadinessRecord(row.payload))
    },
  }
}

export function evaluateAiDecisionGovernanceReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiDecisionGovernanceReadiness ?? input.aiDecisionGovernanceReadinessRecords ?? []
  const aiDecision = input.aiDecision ?? {}
  const researchEnhancedDecision = input.researchEnhancedDecision ?? {}
  const releaseControl = input.enterpriseReleaseControl ?? {}
  const auditTrail = input.enterpriseAuditTrail ?? {}
  const aiConfidenceScore = Math.max(0, Math.min(100, Number(aiDecision.confidenceScore ?? 0)))
  const researchInfluenceScore = Math.max(0, Math.min(100, Number(researchEnhancedDecision.researchInfluenceScore ?? aiConfidenceScore)))
  const releaseScore = releaseControl.finalReleaseStatus === 'release-ready' ? 95 : releaseControl.finalReleaseStatus === 'blocked' ? 35 : 70
  const auditScore = auditTrail.auditIntegrityStatus?.status === 'valid' ? 95 : auditTrail.auditIntegrityStatus?.status === 'invalid' ? 35 : 70
  const blockerPenalty = Math.min(25, Number(aiDecision.blockers?.length ?? 0) * 8 + Number(researchEnhancedDecision.blockers?.length ?? 0) * 8)
  const score = Math.max(0, Math.min(100, Math.round(((aiConfidenceScore + researchInfluenceScore + releaseScore + auditScore) / 4) - blockerPenalty)))
  const governanceStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const readinessRecords = (sourceItems.length ? sourceItems : [normalizeAiDecisionGovernanceReadinessRecord({
    tenantContext,
    governanceStatus,
    governanceScore: score,
    governanceSummaryText: `AI decision governance readiness references AI confidence ${aiConfidenceScore}, research influence ${researchInfluenceScore}, release score ${releaseScore}, audit score ${auditScore}, and blocker penalty ${blockerPenalty}.`,
    sourceReferences: [
      { id: 'ai-decision', type: 'ai-decision', eventType: aiDecision.eventType },
      { id: 'research-enhanced-decision', type: 'research-enhanced-decision', eventType: researchEnhancedDecision.eventType },
      { id: 'enterprise-release-control', type: 'enterprise-release-control', eventType: releaseControl.eventType },
      { id: 'enterprise-audit-trail', type: 'enterprise-audit-trail', eventType: auditTrail.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiDecisionGovernanceReadinessRecord)
  const aiDecisionGovernanceSummary = {
    total: readinessRecords.length,
    ready: readinessRecords.filter((item) => item.governanceStatus === 'ready').length,
    caution: readinessRecords.filter((item) => item.governanceStatus === 'caution').length,
    blocked: readinessRecords.filter((item) => item.governanceStatus === 'blocked').length,
    averageGovernanceScore: readinessRecords.length ? Math.round(readinessRecords.reduce((sum, item) => sum + item.governanceScore, 0) / readinessRecords.length) : 0,
  }
  const aiDecisionGovernanceStatus = aiDecisionGovernanceSummary.blocked > 0 ? 'blocked' : aiDecisionGovernanceSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_DECISION_GOVERNANCE_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiDecisionGovernanceReadiness: readinessRecords,
    aiDecisionGovernanceSummary,
    aiDecisionGovernanceStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticModelApproval: false,
    automaticPolicyEnforcement: false,
    automaticDecisionOverride: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `AI decision governance readiness ${aiDecisionGovernanceStatus}: average governance score ${aiDecisionGovernanceSummary.averageGovernanceScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_DECISION_GOVERNANCE_READINESS_EVALUATED_EVENT, result)
  return result
}
