import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_IMPLEMENTATION_PROGRESS_TRACKED_EVENT = 'system.complianceImplementationProgress.tracked'

export const PROGRESS_STATUSES = Object.freeze(['on-track', 'watchlist', 'stalled'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return PROGRESS_STATUSES.includes(status) ? status : 'watchlist'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceImplementationProgress(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-implementation-progress-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    progressStatus: safeStatus(input.progressStatus ?? input.status),
    progressScore: Math.max(0, Math.min(100, Number(input.progressScore ?? 0))),
    progressSummaryText: String(input.progressSummaryText ?? input.progressSummary ?? 'Compliance implementation progress tracked for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticImplementation: false,
    automaticStatusChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceImplementationProgressRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const progress = normalizeComplianceImplementationProgress(input)
      if (!database?.connected) return { ok: true, disabled: true, progress }
      const result = await database.query(
        `INSERT INTO atlas_compliance_implementation_progress
          (id, organization_id, team_workspace_id, progress_status, progress_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET progress_status = EXCLUDED.progress_status, progress_score = EXCLUDED.progress_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [progress.id, progress.tenantScope.organizationId, progress.tenantScope.teamWorkspaceId, progress.progressStatus, progress.progressScore, progress],
      )
      return { ok: true, progress: normalizeComplianceImplementationProgress(result.rows?.[0]?.payload ?? progress) }
    },
    async list({ tenantContext = {}, progressStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (progressStatus) {
        params.push(safeStatus(progressStatus))
        clauses.push(`progress_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_implementation_progress
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceImplementationProgress(row.payload))
    },
  }
}

export function trackComplianceImplementationProgress(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceImplementationProgress ?? []
  const implementation = input.complianceImplementationPlanning ?? {}
  const actions = input.complianceGovernanceActionItems ?? {}
  const implementationScore = implementation.implementationSummary?.averageImplementationScore ?? 0
  const highPriorityActions = actions.actionItemSummary?.highPriority ?? 0
  const score = Math.max(0, Math.min(100, implementationScore - highPriorityActions * 10))
  const progressStatus = score >= 80 ? 'on-track' : score >= 55 ? 'watchlist' : 'stalled'
  const progressItems = (supplied.length ? supplied : [normalizeComplianceImplementationProgress({
    tenantContext,
    progressStatus,
    progressScore: score,
    progressSummaryText: `Compliance implementation progress references implementation score ${implementationScore} and ${highPriorityActions} high priority governance action items.`,
    sourceReferences: [
      { id: 'compliance-implementation-planning', type: 'compliance-implementation-planning', eventType: implementation.eventType },
      { id: 'compliance-governance-action-items', type: 'compliance-governance-action-items', eventType: actions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceImplementationProgress)
  const progressSummary = {
    total: progressItems.length,
    onTrack: progressItems.filter((item) => item.progressStatus === 'on-track').length,
    watchlist: progressItems.filter((item) => item.progressStatus === 'watchlist').length,
    stalled: progressItems.filter((item) => item.progressStatus === 'stalled').length,
    averageProgressScore: progressItems.length ? Math.round(progressItems.reduce((sum, item) => sum + item.progressScore, 0) / progressItems.length) : 0,
  }
  const implementationProgressStatus = progressSummary.stalled > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_IMPLEMENTATION_PROGRESS_TRACKED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceImplementationProgress: progressItems,
    progressSummary,
    implementationProgressStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticImplementation: false,
    automaticStatusChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance implementation progress ${implementationProgressStatus}: average progress score ${progressSummary.averageProgressScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_IMPLEMENTATION_PROGRESS_TRACKED_EVENT, result)
  return result
}
