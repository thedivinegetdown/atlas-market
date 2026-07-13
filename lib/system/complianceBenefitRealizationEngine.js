import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_BENEFIT_REALIZATION_SUMMARIZED_EVENT = 'system.complianceBenefitRealization.summarized'
export const BENEFIT_REALIZATION_STATUSES = Object.freeze(['realized', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return BENEFIT_REALIZATION_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceBenefitRealization(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-benefit-realization-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    benefitStatus: safeStatus(input.benefitStatus ?? input.status),
    benefitScore: Math.max(0, Math.min(100, Number(input.benefitScore ?? 0))),
    benefitSummaryText: String(input.benefitSummaryText ?? input.benefitSummary ?? 'Compliance benefit realization summarized for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticBenefitClaim: false,
    automaticExecutiveDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceBenefitRealizationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const benefit = normalizeComplianceBenefitRealization(input)
      if (!database?.connected) return { ok: true, disabled: true, benefit }
      const result = await database.query(
        `INSERT INTO atlas_compliance_benefit_realizations
          (id, organization_id, team_workspace_id, benefit_status, benefit_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET benefit_status = EXCLUDED.benefit_status, benefit_score = EXCLUDED.benefit_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [benefit.id, benefit.tenantScope.organizationId, benefit.tenantScope.teamWorkspaceId, benefit.benefitStatus, benefit.benefitScore, benefit],
      )
      return { ok: true, benefit: normalizeComplianceBenefitRealization(result.rows?.[0]?.payload ?? benefit) }
    },
    async list({ tenantContext = {}, benefitStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (benefitStatus) {
        params.push(safeStatus(benefitStatus))
        clauses.push(`benefit_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_benefit_realizations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceBenefitRealization(row.payload))
    },
  }
}

export function summarizeComplianceBenefitRealization(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceBenefitRealizations ?? []
  const outcomes = input.complianceImprovementOutcomeReview ?? {}
  const maturity = input.complianceMaturityAssessment ?? {}
  const outcomeScore = outcomes.outcomeSummary?.averageOutcomeScore ?? 0
  const maturityScore = maturity.maturitySummary?.averageMaturityScore ?? outcomeScore
  const score = Math.max(0, Math.min(100, Math.round((outcomeScore + maturityScore) / 2)))
  const benefitStatus = score >= 85 ? 'realized' : score >= 60 ? 'needs-review' : 'blocked'
  const benefits = (supplied.length ? supplied : [normalizeComplianceBenefitRealization({
    tenantContext,
    benefitStatus,
    benefitScore: score,
    benefitSummaryText: `Compliance benefit realization references outcome score ${outcomeScore} and maturity score ${maturityScore}.`,
    sourceReferences: [
      { id: 'compliance-improvement-outcome-review', type: 'compliance-improvement-outcome-review', eventType: outcomes.eventType },
      { id: 'compliance-maturity-assessment', type: 'compliance-maturity-assessment', eventType: maturity.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceBenefitRealization)
  const benefitSummary = {
    total: benefits.length,
    realized: benefits.filter((item) => item.benefitStatus === 'realized').length,
    needsReview: benefits.filter((item) => item.benefitStatus === 'needs-review').length,
    blocked: benefits.filter((item) => item.benefitStatus === 'blocked').length,
    averageBenefitScore: benefits.length ? Math.round(benefits.reduce((sum, item) => sum + item.benefitScore, 0) / benefits.length) : 0,
  }
  const benefitRealizationStatus = benefitSummary.blocked > 0 ? 'blocked' : benefitSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_BENEFIT_REALIZATION_SUMMARIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceBenefitRealizations: benefits,
    benefitSummary,
    benefitRealizationStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticBenefitClaim: false,
    automaticExecutiveDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance benefit realization ${benefitRealizationStatus}: average benefit score ${benefitSummary.averageBenefitScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_BENEFIT_REALIZATION_SUMMARIZED_EVENT, result)
  return result
}
