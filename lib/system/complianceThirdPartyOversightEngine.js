import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_THIRD_PARTY_OVERSIGHT_EVALUATED_EVENT = 'system.complianceThirdPartyOversight.evaluated'

export const THIRD_PARTY_STATUSES = Object.freeze(['healthy', 'monitor', 'elevated'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return THIRD_PARTY_STATUSES.includes(status) ? status : 'monitor'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceThirdPartyOversight(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-third-party-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    oversightStatus: safeStatus(input.oversightStatus ?? input.status),
    oversightScore: Math.max(0, Math.min(100, Number(input.oversightScore ?? 0))),
    vendorRiskSummary: String(input.vendorRiskSummary ?? 'Compliance third-party oversight evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticVendorAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceThirdPartyOversightRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const oversight = normalizeComplianceThirdPartyOversight(input)
      if (!database?.connected) return { ok: true, disabled: true, oversight }
      const result = await database.query(
        `INSERT INTO atlas_compliance_third_party_oversight
          (id, organization_id, team_workspace_id, oversight_status, oversight_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET oversight_status = EXCLUDED.oversight_status, oversight_score = EXCLUDED.oversight_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [oversight.id, oversight.tenantScope.organizationId, oversight.tenantScope.teamWorkspaceId, oversight.oversightStatus, oversight.oversightScore, oversight],
      )
      return { ok: true, oversight: normalizeComplianceThirdPartyOversight(result.rows?.[0]?.payload ?? oversight) }
    },
    async list({ tenantContext = {}, oversightStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (oversightStatus) {
        params.push(safeStatus(oversightStatus))
        clauses.push(`oversight_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_third_party_oversight
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceThirdPartyOversight(row.payload))
    },
  }
}

export function evaluateComplianceThirdPartyOversight(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceThirdPartyOversight ?? []
  const security = input.productionSecurityReadiness ?? {}
  const dataLineage = input.dataLineage ?? {}
  const securityReady = security.securityReadinessStatus === 'ready'
  const lineageValid = dataLineage.lineageStatus === 'valid'
  const score = (securityReady ? 45 : 30) + (lineageValid ? 45 : 30)
  const oversightStatus = score >= 85 ? 'healthy' : score >= 65 ? 'monitor' : 'elevated'
  const oversightItems = (supplied.length ? supplied : [normalizeComplianceThirdPartyOversight({
    tenantContext,
    oversightStatus,
    oversightScore: score,
    vendorRiskSummary: `Compliance third-party oversight references security readiness ${security.securityReadinessStatus ?? 'unknown'} and data lineage ${dataLineage.lineageStatus ?? 'unknown'}.`,
    sourceReferences: [
      { id: 'production-security-readiness', type: 'production-security-readiness', eventType: security.eventType },
      { id: 'data-lineage', type: 'data-lineage', eventType: dataLineage.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceThirdPartyOversight)
  const oversightSummary = {
    total: oversightItems.length,
    healthy: oversightItems.filter((item) => item.oversightStatus === 'healthy').length,
    monitor: oversightItems.filter((item) => item.oversightStatus === 'monitor').length,
    elevated: oversightItems.filter((item) => item.oversightStatus === 'elevated').length,
    averageOversightScore: oversightItems.length ? Math.round(oversightItems.reduce((sum, item) => sum + item.oversightScore, 0) / oversightItems.length) : 0,
  }
  const thirdPartyOversightStatus = oversightSummary.elevated > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_THIRD_PARTY_OVERSIGHT_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceThirdPartyOversight: oversightItems,
    oversightSummary,
    thirdPartyOversightStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticVendorAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance third-party oversight ${thirdPartyOversightStatus}: average oversight score ${oversightSummary.averageOversightScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_THIRD_PARTY_OVERSIGHT_EVALUATED_EVENT, result)
  return result
}
