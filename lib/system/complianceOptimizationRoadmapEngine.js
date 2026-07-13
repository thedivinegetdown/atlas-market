import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_OPTIMIZATION_ROADMAP_PLANNED_EVENT = 'system.complianceOptimizationRoadmap.planned'
export const OPTIMIZATION_ROADMAP_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return OPTIMIZATION_ROADMAP_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceOptimizationRoadmap(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-optimization-roadmap-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    roadmapStatus: safeStatus(input.roadmapStatus ?? input.status),
    roadmapScore: Math.max(0, Math.min(100, Number(input.roadmapScore ?? 0))),
    roadmapSummaryText: String(input.roadmapSummaryText ?? input.roadmapSummary ?? 'Compliance optimization roadmap planned for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    recommendationOnly: true,
    automaticOptimization: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceOptimizationRoadmapRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const roadmap = normalizeComplianceOptimizationRoadmap(input)
      if (!database?.connected) return { ok: true, disabled: true, roadmap }
      const result = await database.query(
        `INSERT INTO atlas_compliance_optimization_roadmaps
          (id, organization_id, team_workspace_id, roadmap_status, roadmap_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET roadmap_status = EXCLUDED.roadmap_status, roadmap_score = EXCLUDED.roadmap_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [roadmap.id, roadmap.tenantScope.organizationId, roadmap.tenantScope.teamWorkspaceId, roadmap.roadmapStatus, roadmap.roadmapScore, roadmap],
      )
      return { ok: true, roadmap: normalizeComplianceOptimizationRoadmap(result.rows?.[0]?.payload ?? roadmap) }
    },
    async list({ tenantContext = {}, roadmapStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (roadmapStatus) {
        params.push(safeStatus(roadmapStatus))
        clauses.push(`roadmap_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_optimization_roadmaps
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceOptimizationRoadmap(row.payload))
    },
  }
}

export function planComplianceOptimizationRoadmap(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceOptimizationRoadmaps ?? []
  const improvementProgram = input.complianceContinuousImprovementProgram ?? {}
  const benchmark = input.complianceBenchmarkComparison ?? {}
  const resource = input.complianceResourcePlanning ?? {}
  const programScore = improvementProgram.continuousImprovementSummary?.averageProgramScore ?? 0
  const benchmarkScore = benchmark.benchmarkSummary?.averageBenchmarkScore ?? programScore
  const resourceScore = resource.resourceSummary?.averageResourceScore ?? programScore
  const score = Math.max(0, Math.min(100, Math.round((programScore + benchmarkScore + resourceScore) / 3)))
  const roadmapStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const roadmaps = (supplied.length ? supplied : [normalizeComplianceOptimizationRoadmap({
    tenantContext,
    roadmapStatus,
    roadmapScore: score,
    roadmapSummaryText: `Compliance optimization roadmap references improvement program score ${programScore}, benchmark score ${benchmarkScore}, and resource score ${resourceScore}.`,
    sourceReferences: [
      { id: 'compliance-continuous-improvement-program', type: 'compliance-continuous-improvement-program', eventType: improvementProgram.eventType },
      { id: 'compliance-benchmark-comparison', type: 'compliance-benchmark-comparison', eventType: benchmark.eventType },
      { id: 'compliance-resource-planning', type: 'compliance-resource-planning', eventType: resource.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceOptimizationRoadmap)
  const optimizationRoadmapSummary = {
    total: roadmaps.length,
    ready: roadmaps.filter((item) => item.roadmapStatus === 'ready').length,
    caution: roadmaps.filter((item) => item.roadmapStatus === 'caution').length,
    blocked: roadmaps.filter((item) => item.roadmapStatus === 'blocked').length,
    averageRoadmapScore: roadmaps.length ? Math.round(roadmaps.reduce((sum, item) => sum + item.roadmapScore, 0) / roadmaps.length) : 0,
  }
  const optimizationRoadmapStatus = optimizationRoadmapSummary.blocked > 0 ? 'blocked' : optimizationRoadmapSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_OPTIMIZATION_ROADMAP_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceOptimizationRoadmaps: roadmaps,
    optimizationRoadmapSummary,
    optimizationRoadmapStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    recommendationOnly: true,
    automaticOptimization: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance optimization roadmap ${optimizationRoadmapStatus}: average roadmap score ${optimizationRoadmapSummary.averageRoadmapScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_OPTIMIZATION_ROADMAP_PLANNED_EVENT, result)
  return result
}
