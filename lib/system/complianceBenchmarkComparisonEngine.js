import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_BENCHMARK_COMPARISON_EVALUATED_EVENT = 'system.complianceBenchmarkComparison.evaluated'

export const BENCHMARK_STATUSES = Object.freeze(['above-benchmark', 'aligned', 'below-benchmark'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return BENCHMARK_STATUSES.includes(status) ? status : 'aligned'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceBenchmarkComparison(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-benchmark-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    benchmarkStatus: safeStatus(input.benchmarkStatus ?? input.status),
    benchmarkScore: Math.max(0, Math.min(100, Number(input.benchmarkScore ?? 0))),
    benchmarkGap: Number(input.benchmarkGap ?? 0),
    benchmarkSummary: String(input.benchmarkSummary ?? 'Compliance benchmark comparison evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceBenchmarkComparisonRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const comparison = normalizeComplianceBenchmarkComparison(input)
      if (!database?.connected) return { ok: true, disabled: true, comparison }
      const result = await database.query(
        `INSERT INTO atlas_compliance_benchmark_comparisons
          (id, organization_id, team_workspace_id, benchmark_status, benchmark_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET benchmark_status = EXCLUDED.benchmark_status, benchmark_score = EXCLUDED.benchmark_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [comparison.id, comparison.tenantScope.organizationId, comparison.tenantScope.teamWorkspaceId, comparison.benchmarkStatus, comparison.benchmarkScore, comparison],
      )
      return { ok: true, comparison: normalizeComplianceBenchmarkComparison(result.rows?.[0]?.payload ?? comparison) }
    },
    async list({ tenantContext = {}, benchmarkStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (benchmarkStatus) {
        params.push(safeStatus(benchmarkStatus))
        clauses.push(`benchmark_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_benchmark_comparisons
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceBenchmarkComparison(row.payload))
    },
  }
}

export function evaluateComplianceBenchmarkComparison(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceBenchmarkComparisons ?? []
  const maturity = input.complianceMaturityAssessment ?? {}
  const trend = input.complianceTrendAnalytics ?? {}
  const maturityScore = maturity.maturitySummary?.averageMaturityScore ?? 0
  const trendScore = trend.trendSummary?.averageTrendScore ?? maturityScore
  const score = Math.round((maturityScore + trendScore) / 2)
  const status = score >= 90 ? 'above-benchmark' : score >= 75 ? 'aligned' : 'below-benchmark'
  const comparisons = (supplied.length ? supplied : [normalizeComplianceBenchmarkComparison({
    tenantContext,
    benchmarkStatus: status,
    benchmarkScore: score,
    benchmarkGap: score - 85,
    benchmarkSummary: `Compliance benchmark comparison uses maturity score ${maturityScore} and trend score ${trendScore} as advisory internal benchmark inputs.`,
    sourceReferences: [
      { id: 'compliance-maturity-assessment', type: 'compliance-maturity-assessment', eventType: maturity.eventType },
      { id: 'compliance-trend-analytics', type: 'compliance-trend-analytics', eventType: trend.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceBenchmarkComparison)
  const benchmarkSummary = {
    total: comparisons.length,
    aboveBenchmark: comparisons.filter((item) => item.benchmarkStatus === 'above-benchmark').length,
    aligned: comparisons.filter((item) => item.benchmarkStatus === 'aligned').length,
    belowBenchmark: comparisons.filter((item) => item.benchmarkStatus === 'below-benchmark').length,
    averageBenchmarkScore: comparisons.length ? Math.round(comparisons.reduce((sum, item) => sum + item.benchmarkScore, 0) / comparisons.length) : 0,
  }
  const benchmarkComparisonStatus = benchmarkSummary.belowBenchmark > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_BENCHMARK_COMPARISON_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceBenchmarkComparisons: comparisons,
    benchmarkSummary,
    benchmarkComparisonStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance benchmark comparison ${benchmarkComparisonStatus}: average benchmark score ${benchmarkSummary.averageBenchmarkScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_BENCHMARK_COMPARISON_EVALUATED_EVENT, result)
  return result
}
