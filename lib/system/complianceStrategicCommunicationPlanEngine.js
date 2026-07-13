import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_PLAN_PREPARED_EVENT = 'system.complianceStrategicCommunicationPlan.prepared'
export const STRATEGIC_COMMUNICATION_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_COMMUNICATION_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicCommunicationPlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-communication-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    communicationStatus: safeStatus(input.communicationStatus ?? input.status),
    communicationScore: Math.max(0, Math.min(100, Number(input.communicationScore ?? 0))),
    communicationSummaryText: String(input.communicationSummaryText ?? input.communicationSummary ?? 'Compliance strategic communication plan prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticMessageApproval: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicCommunicationPlanRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const communication = normalizeComplianceStrategicCommunicationPlan(input)
      if (!database?.connected) return { ok: true, disabled: true, communication }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_communication_plans
          (id, organization_id, team_workspace_id, communication_status, communication_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET communication_status = EXCLUDED.communication_status, communication_score = EXCLUDED.communication_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [communication.id, communication.tenantScope.organizationId, communication.tenantScope.teamWorkspaceId, communication.communicationStatus, communication.communicationScore, communication],
      )
      return { ok: true, communication: normalizeComplianceStrategicCommunicationPlan(result.rows?.[0]?.payload ?? communication) }
    },
    async list({ tenantContext = {}, communicationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (communicationStatus) {
        params.push(safeStatus(communicationStatus))
        clauses.push(`communication_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_communication_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicCommunicationPlan(row.payload))
    },
  }
}

export function prepareComplianceStrategicCommunicationPlan(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicCommunicationPlans ?? []
  const alignment = input.complianceStrategicStakeholderAlignment ?? {}
  const strategy = input.complianceExecutiveStrategyPlan ?? {}
  const readout = input.complianceGovernanceReadout ?? {}
  const alignmentScore = alignment.stakeholderAlignmentSummary?.averageAlignmentScore ?? 0
  const strategyScore = strategy.executiveStrategySummary?.averageStrategyScore ?? alignmentScore
  const readoutScore = readout.readoutSummary?.averageReadoutScore ?? alignmentScore
  const score = Math.max(0, Math.min(100, Math.round((alignmentScore + strategyScore + readoutScore) / 3)))
  const communicationStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const communications = (supplied.length ? supplied : [normalizeComplianceStrategicCommunicationPlan({
    tenantContext,
    communicationStatus,
    communicationScore: score,
    communicationSummaryText: `Compliance strategic communication plan references alignment score ${alignmentScore}, strategy score ${strategyScore}, and governance readout score ${readoutScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-stakeholder-alignment', type: 'compliance-strategic-stakeholder-alignment', eventType: alignment.eventType },
      { id: 'compliance-executive-strategy-plan', type: 'compliance-executive-strategy-plan', eventType: strategy.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: readout.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicCommunicationPlan)
  const strategicCommunicationSummary = {
    total: communications.length,
    ready: communications.filter((item) => item.communicationStatus === 'ready').length,
    caution: communications.filter((item) => item.communicationStatus === 'caution').length,
    blocked: communications.filter((item) => item.communicationStatus === 'blocked').length,
    averageCommunicationScore: communications.length ? Math.round(communications.reduce((sum, item) => sum + item.communicationScore, 0) / communications.length) : 0,
  }
  const strategicCommunicationStatus = strategicCommunicationSummary.blocked > 0 ? 'blocked' : strategicCommunicationSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_PLAN_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicCommunicationPlans: communications,
    strategicCommunicationSummary,
    strategicCommunicationStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticMessageApproval: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic communication plan ${strategicCommunicationStatus}: average communication score ${strategicCommunicationSummary.averageCommunicationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_PLAN_PREPARED_EVENT, result)
  return result
}
