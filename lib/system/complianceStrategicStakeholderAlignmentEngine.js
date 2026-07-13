import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_STAKEHOLDER_ALIGNMENT_EVALUATED_EVENT = 'system.complianceStrategicStakeholderAlignment.evaluated'
export const STAKEHOLDER_ALIGNMENT_STATUSES = Object.freeze(['aligned', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STAKEHOLDER_ALIGNMENT_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicStakeholderAlignment(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-stakeholder-alignment-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    alignmentStatus: safeStatus(input.alignmentStatus ?? input.status),
    alignmentScore: Math.max(0, Math.min(100, Number(input.alignmentScore ?? 0))),
    alignmentSummaryText: String(input.alignmentSummaryText ?? input.alignmentSummary ?? 'Compliance strategic stakeholder alignment evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticStakeholderApproval: false,
    automaticExecutiveDistribution: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicStakeholderAlignmentRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const alignment = normalizeComplianceStrategicStakeholderAlignment(input)
      if (!database?.connected) return { ok: true, disabled: true, alignment }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_stakeholder_alignments
          (id, organization_id, team_workspace_id, alignment_status, alignment_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET alignment_status = EXCLUDED.alignment_status, alignment_score = EXCLUDED.alignment_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [alignment.id, alignment.tenantScope.organizationId, alignment.tenantScope.teamWorkspaceId, alignment.alignmentStatus, alignment.alignmentScore, alignment],
      )
      return { ok: true, alignment: normalizeComplianceStrategicStakeholderAlignment(result.rows?.[0]?.payload ?? alignment) }
    },
    async list({ tenantContext = {}, alignmentStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (alignmentStatus) {
        params.push(safeStatus(alignmentStatus))
        clauses.push(`alignment_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_stakeholder_alignments
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicStakeholderAlignment(row.payload))
    },
  }
}

export function evaluateComplianceStrategicStakeholderAlignment(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicStakeholderAlignments ?? []
  const kpis = input.complianceStrategicKpis ?? {}
  const milestones = input.complianceStrategicMilestones ?? {}
  const governance = input.complianceGovernanceReadout ?? {}
  const kpiScore = kpis.strategicKpiSummary?.averageKpiScore ?? 0
  const milestoneScore = milestones.strategicMilestoneSummary?.averageMilestoneScore ?? kpiScore
  const readoutScore = governance.readoutSummary?.averageReadoutScore ?? kpiScore
  const score = Math.max(0, Math.min(100, Math.round((kpiScore + milestoneScore + readoutScore) / 3)))
  const alignmentStatus = score >= 85 ? 'aligned' : score >= 60 ? 'needs-review' : 'blocked'
  const alignments = (supplied.length ? supplied : [normalizeComplianceStrategicStakeholderAlignment({
    tenantContext,
    alignmentStatus,
    alignmentScore: score,
    alignmentSummaryText: `Compliance strategic stakeholder alignment references KPI score ${kpiScore}, milestone score ${milestoneScore}, and governance readout score ${readoutScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-kpis', type: 'compliance-strategic-kpis', eventType: kpis.eventType },
      { id: 'compliance-strategic-milestones', type: 'compliance-strategic-milestones', eventType: milestones.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: governance.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicStakeholderAlignment)
  const stakeholderAlignmentSummary = {
    total: alignments.length,
    aligned: alignments.filter((item) => item.alignmentStatus === 'aligned').length,
    needsReview: alignments.filter((item) => item.alignmentStatus === 'needs-review').length,
    blocked: alignments.filter((item) => item.alignmentStatus === 'blocked').length,
    averageAlignmentScore: alignments.length ? Math.round(alignments.reduce((sum, item) => sum + item.alignmentScore, 0) / alignments.length) : 0,
  }
  const stakeholderAlignmentStatus = stakeholderAlignmentSummary.blocked > 0 ? 'blocked' : stakeholderAlignmentSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_STAKEHOLDER_ALIGNMENT_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicStakeholderAlignments: alignments,
    stakeholderAlignmentSummary,
    stakeholderAlignmentStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticStakeholderApproval: false,
    automaticExecutiveDistribution: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic stakeholder alignment ${stakeholderAlignmentStatus}: average alignment score ${stakeholderAlignmentSummary.averageAlignmentScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_STAKEHOLDER_ALIGNMENT_EVALUATED_EVENT, result)
  return result
}
