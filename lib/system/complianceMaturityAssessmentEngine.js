import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_MATURITY_ASSESSED_EVENT = 'system.complianceMaturity.assessed'

export const MATURITY_LEVELS = Object.freeze(['foundational', 'managed', 'advanced', 'optimized'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeLevel(level) {
  return MATURITY_LEVELS.includes(level) ? level : 'managed'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceMaturityAssessment(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-maturity-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    maturityLevel: safeLevel(input.maturityLevel ?? input.level),
    maturityScore: Math.max(0, Math.min(100, Number(input.maturityScore ?? 0))),
    assessmentSummary: String(input.assessmentSummary ?? 'Compliance maturity assessed for human review.').slice(0, 700),
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

export function createComplianceMaturityAssessmentRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const assessment = normalizeComplianceMaturityAssessment(input)
      if (!database?.connected) return { ok: true, disabled: true, assessment }
      const result = await database.query(
        `INSERT INTO atlas_compliance_maturity_assessments
          (id, organization_id, team_workspace_id, maturity_level, maturity_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET maturity_level = EXCLUDED.maturity_level, maturity_score = EXCLUDED.maturity_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [assessment.id, assessment.tenantScope.organizationId, assessment.tenantScope.teamWorkspaceId, assessment.maturityLevel, assessment.maturityScore, assessment],
      )
      return { ok: true, assessment: normalizeComplianceMaturityAssessment(result.rows?.[0]?.payload ?? assessment) }
    },
    async list({ tenantContext = {}, maturityLevel, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (maturityLevel) {
        params.push(safeLevel(maturityLevel))
        clauses.push(`maturity_level = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_maturity_assessments
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceMaturityAssessment(row.payload))
    },
  }
}

export function assessComplianceMaturity(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceMaturityAssessments ?? []
  const executiveDashboard = input.complianceExecutiveDashboard ?? {}
  const trend = input.complianceTrendAnalytics ?? {}
  const forecast = input.complianceRiskForecast ?? {}
  const score = Math.max(0, Math.min(100, (executiveDashboard.executiveDashboardSummary?.averageScore ?? 0)
    + (trend.trendSummary?.improving > 0 ? 5 : 0)
    - (forecast.riskForecastStatus === 'blocked' ? 20 : forecast.riskForecastStatus === 'caution' ? 8 : 0)))
  const level = score >= 95 ? 'optimized' : score >= 85 ? 'advanced' : score >= 70 ? 'managed' : 'foundational'
  const assessments = (supplied.length ? supplied : [normalizeComplianceMaturityAssessment({
    tenantContext,
    maturityLevel: level,
    maturityScore: score,
    assessmentSummary: `Compliance maturity assessed as ${level} from executive dashboard score ${executiveDashboard.executiveDashboardSummary?.averageScore ?? 0}, trend analytics, and risk forecast.`,
    sourceReferences: [
      { id: 'compliance-executive-dashboard', type: 'compliance-executive-dashboard', eventType: executiveDashboard.eventType },
      { id: 'compliance-trend-analytics', type: 'compliance-trend-analytics', eventType: trend.eventType },
      { id: 'compliance-risk-forecast', type: 'compliance-risk-forecast', eventType: forecast.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceMaturityAssessment)
  const maturitySummary = {
    total: assessments.length,
    foundational: assessments.filter((item) => item.maturityLevel === 'foundational').length,
    managed: assessments.filter((item) => item.maturityLevel === 'managed').length,
    advanced: assessments.filter((item) => item.maturityLevel === 'advanced').length,
    optimized: assessments.filter((item) => item.maturityLevel === 'optimized').length,
    averageMaturityScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.maturityScore, 0) / assessments.length) : 0,
  }
  const maturityAssessmentStatus = maturitySummary.foundational > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_MATURITY_ASSESSED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceMaturityAssessments: assessments,
    maturitySummary,
    maturityAssessmentStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance maturity ${maturityAssessmentStatus}: average maturity score ${maturitySummary.averageMaturityScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_MATURITY_ASSESSED_EVENT, result)
  return result
}
