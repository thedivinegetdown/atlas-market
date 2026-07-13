import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_KPIS_EVALUATED_EVENT = 'system.complianceStrategicKpis.evaluated'
export const STRATEGIC_KPI_STATUSES = Object.freeze(['meeting-target', 'watch', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_KPI_STATUSES.includes(status) ? status : 'watch'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicKpiEvaluation(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-kpi-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    kpiStatus: safeStatus(input.kpiStatus ?? input.status),
    kpiScore: Math.max(0, Math.min(100, Number(input.kpiScore ?? 0))),
    kpiSummaryText: String(input.kpiSummaryText ?? input.kpiSummary ?? 'Compliance strategic KPIs evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticKpiApproval: false,
    automaticExecutiveDistribution: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicKpiEvaluationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const kpi = normalizeComplianceStrategicKpiEvaluation(input)
      if (!database?.connected) return { ok: true, disabled: true, kpi }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_kpi_evaluations
          (id, organization_id, team_workspace_id, kpi_status, kpi_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET kpi_status = EXCLUDED.kpi_status, kpi_score = EXCLUDED.kpi_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [kpi.id, kpi.tenantScope.organizationId, kpi.tenantScope.teamWorkspaceId, kpi.kpiStatus, kpi.kpiScore, kpi],
      )
      return { ok: true, kpi: normalizeComplianceStrategicKpiEvaluation(result.rows?.[0]?.payload ?? kpi) }
    },
    async list({ tenantContext = {}, kpiStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (kpiStatus) {
        params.push(safeStatus(kpiStatus))
        clauses.push(`kpi_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_kpi_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicKpiEvaluation(row.payload))
    },
  }
}

export function evaluateComplianceStrategicKpis(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicKpiEvaluations ?? []
  const milestones = input.complianceStrategicMilestones ?? {}
  const strategy = input.complianceExecutiveStrategyPlan ?? {}
  const initiatives = input.complianceStrategicInitiativePortfolio ?? {}
  const milestoneScore = milestones.strategicMilestoneSummary?.averageMilestoneScore ?? 0
  const strategyScore = strategy.executiveStrategySummary?.averageStrategyScore ?? milestoneScore
  const initiativeScore = initiatives.initiativePortfolioSummary?.averageInitiativeScore ?? milestoneScore
  const score = Math.max(0, Math.min(100, Math.round((milestoneScore + strategyScore + initiativeScore) / 3)))
  const kpiStatus = score >= 85 ? 'meeting-target' : score >= 60 ? 'watch' : 'blocked'
  const kpis = (supplied.length ? supplied : [normalizeComplianceStrategicKpiEvaluation({
    tenantContext,
    kpiStatus,
    kpiScore: score,
    kpiSummaryText: `Compliance strategic KPIs reference milestone score ${milestoneScore}, strategy score ${strategyScore}, and initiative score ${initiativeScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-milestones', type: 'compliance-strategic-milestones', eventType: milestones.eventType },
      { id: 'compliance-executive-strategy-plan', type: 'compliance-executive-strategy-plan', eventType: strategy.eventType },
      { id: 'compliance-strategic-initiative-portfolio', type: 'compliance-strategic-initiative-portfolio', eventType: initiatives.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicKpiEvaluation)
  const strategicKpiSummary = {
    total: kpis.length,
    meetingTarget: kpis.filter((item) => item.kpiStatus === 'meeting-target').length,
    watch: kpis.filter((item) => item.kpiStatus === 'watch').length,
    blocked: kpis.filter((item) => item.kpiStatus === 'blocked').length,
    averageKpiScore: kpis.length ? Math.round(kpis.reduce((sum, item) => sum + item.kpiScore, 0) / kpis.length) : 0,
  }
  const strategicKpiStatus = strategicKpiSummary.blocked > 0 ? 'blocked' : strategicKpiSummary.watch > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_KPIS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicKpiEvaluations: kpis,
    strategicKpiSummary,
    strategicKpiStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticKpiApproval: false,
    automaticExecutiveDistribution: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic KPIs ${strategicKpiStatus}: average KPI score ${strategicKpiSummary.averageKpiScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_KPIS_EVALUATED_EVENT, result)
  return result
}
