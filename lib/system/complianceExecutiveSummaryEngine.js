import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EXECUTIVE_SUMMARY_PREPARED_EVENT = 'system.complianceExecutiveSummary.prepared'

export const EXECUTIVE_SUMMARY_STATUSES = Object.freeze(['draft', 'ready_for_review', 'needs_updates', 'reviewed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return EXECUTIVE_SUMMARY_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceExecutiveSummary(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-executive-summary-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    summaryStatus: safeStatus(input.summaryStatus ?? input.status),
    audience: input.audience ?? 'owner-admin-executive-review',
    executiveSummary: String(input.executiveSummary ?? 'Compliance executive summary prepared for human review.').slice(0, 900),
    keyHighlights: (input.keyHighlights ?? []).map((item) => String(item).slice(0, 220)),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    preparedByUserId: input.preparedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceExecutiveSummaryRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(summaryInput) {
      const summary = normalizeComplianceExecutiveSummary(summaryInput)
      if (!database?.connected) return { ok: true, disabled: true, summary }
      const result = await database.query(
        `INSERT INTO atlas_compliance_executive_summaries
          (id, organization_id, team_workspace_id, summary_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET summary_status = EXCLUDED.summary_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [summary.id, summary.tenantScope.organizationId, summary.tenantScope.teamWorkspaceId, summary.summaryStatus, summary],
      )
      return { ok: true, summary: normalizeComplianceExecutiveSummary(result.rows?.[0]?.payload ?? summary) }
    },
    async list({ tenantContext = {}, summaryStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (summaryStatus) {
        params.push(safeStatus(summaryStatus))
        clauses.push(`summary_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_executive_summaries
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceExecutiveSummary(row.payload))
    },
  }
}

export function prepareComplianceExecutiveSummary(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceExecutiveSummaries ?? []
  const metrics = input.complianceMetricsSnapshot ?? {}
  const programHealth = input.complianceProgramHealth ?? {}
  const boardPacket = input.complianceBoardPacket ?? {}
  const needsUpdates = metrics.metricsSnapshotStatus === 'caution' || programHealth.programHealthStatus === 'blocked'
  const summaries = (supplied.length ? supplied : [normalizeComplianceExecutiveSummary({
    tenantContext,
    summaryStatus: needsUpdates ? 'needs_updates' : 'ready_for_review',
    executiveSummary: `Compliance executive summary references program health ${programHealth.programHealthStatus ?? 'unknown'}, metrics snapshot health score ${metrics.metricsSnapshotSummary?.averageHealthScore ?? 0}, and board packet status ${boardPacket.boardPacketStatus ?? 'unknown'}.`,
    keyHighlights: [
      `Program health: ${programHealth.programHealthStatus ?? 'unknown'}`,
      `Average health score: ${metrics.metricsSnapshotSummary?.averageHealthScore ?? 0}`,
      `Board packet status: ${boardPacket.boardPacketStatus ?? 'unknown'}`,
    ],
    sourceReferences: [
      { id: 'compliance-metrics-snapshot', type: 'compliance-metrics-snapshot', eventType: metrics.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: programHealth.eventType },
      { id: 'compliance-board-packet', type: 'compliance-board-packet', eventType: boardPacket.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceExecutiveSummary)
  const executiveSummarySummary = {
    total: summaries.length,
    readyForReview: summaries.filter((item) => item.summaryStatus === 'ready_for_review').length,
    needsUpdates: summaries.filter((item) => item.summaryStatus === 'needs_updates').length,
    reviewed: summaries.filter((item) => item.summaryStatus === 'reviewed').length,
  }
  const executiveSummaryStatus = executiveSummarySummary.needsUpdates > 0 ? 'caution' : executiveSummarySummary.readyForReview > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EXECUTIVE_SUMMARY_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceExecutiveSummaries: summaries,
    executiveSummarySummary,
    executiveSummaryStatus,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance executive summary ${executiveSummaryStatus}: ${executiveSummarySummary.readyForReview} ready for review and ${executiveSummarySummary.needsUpdates} needing updates.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EXECUTIVE_SUMMARY_PREPARED_EVENT, result)
  return result
}
