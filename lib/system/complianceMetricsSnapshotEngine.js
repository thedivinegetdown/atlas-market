import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_METRICS_SNAPSHOT_CAPTURED_EVENT = 'system.complianceMetricsSnapshot.captured'

export const METRICS_SNAPSHOT_STATUSES = Object.freeze(['current', 'caution', 'stale'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return METRICS_SNAPSHOT_STATUSES.includes(status) ? status : 'current'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceMetricsSnapshot(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-metrics-snapshot-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    snapshotStatus: safeStatus(input.snapshotStatus ?? input.status),
    healthScore: Math.max(0, Math.min(100, Number(input.healthScore ?? 0))),
    openActionItems: Number(input.openActionItems ?? 0),
    highPriorityActionItems: Number(input.highPriorityActionItems ?? 0),
    examReadinessScore: Math.max(0, Math.min(100, Number(input.examReadinessScore ?? 0))),
    minutesReady: Number(input.minutesReady ?? 0),
    snapshotSummary: String(input.snapshotSummary ?? 'Compliance metrics snapshot captured for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    capturedByUserId: input.capturedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticDistribution: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceMetricsSnapshotRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(snapshotInput) {
      const snapshot = normalizeComplianceMetricsSnapshot(snapshotInput)
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_compliance_metrics_snapshots
          (id, organization_id, team_workspace_id, snapshot_status, health_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET snapshot_status = EXCLUDED.snapshot_status, health_score = EXCLUDED.health_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.snapshotStatus, snapshot.healthScore, snapshot],
      )
      return { ok: true, snapshot: normalizeComplianceMetricsSnapshot(result.rows?.[0]?.payload ?? snapshot) }
    },
    async list({ tenantContext = {}, snapshotStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (snapshotStatus) {
        params.push(safeStatus(snapshotStatus))
        clauses.push(`snapshot_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_metrics_snapshots
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceMetricsSnapshot(row.payload))
    },
  }
}

export function captureComplianceMetricsSnapshot(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceMetricsSnapshots ?? []
  const programHealth = input.complianceProgramHealth ?? {}
  const actionItems = input.complianceGovernanceActionItems ?? {}
  const examReadiness = input.complianceExamReadiness ?? {}
  const minutes = input.complianceMeetingMinutes ?? {}
  const healthScore = programHealth.programHealthSummary?.averageScore ?? 0
  const snapshots = (supplied.length ? supplied : [normalizeComplianceMetricsSnapshot({
    tenantContext,
    snapshotStatus: programHealth.programHealthStatus === 'blocked' ? 'caution' : 'current',
    healthScore,
    openActionItems: actionItems.actionItemSummary?.open ?? 0,
    highPriorityActionItems: actionItems.actionItemSummary?.highPriority ?? 0,
    examReadinessScore: examReadiness.examReadinessSummary?.averageScore ?? 0,
    minutesReady: minutes.meetingMinutesSummary?.readyForReview ?? 0,
    snapshotSummary: `Compliance metrics snapshot captures program health score ${healthScore}, ${actionItems.actionItemSummary?.open ?? 0} open action items, and exam readiness score ${examReadiness.examReadinessSummary?.averageScore ?? 0}.`,
    sourceReferences: [
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: programHealth.eventType },
      { id: 'compliance-action-items', type: 'compliance-governance-action-items', eventType: actionItems.eventType },
      { id: 'compliance-exam-readiness', type: 'compliance-exam-readiness', eventType: examReadiness.eventType },
      { id: 'compliance-meeting-minutes', type: 'compliance-meeting-minutes', eventType: minutes.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceMetricsSnapshot)
  const metricsSnapshotSummary = {
    total: snapshots.length,
    current: snapshots.filter((item) => item.snapshotStatus === 'current').length,
    caution: snapshots.filter((item) => item.snapshotStatus === 'caution').length,
    averageHealthScore: snapshots.length ? Math.round(snapshots.reduce((sum, item) => sum + item.healthScore, 0) / snapshots.length) : 0,
    openActionItems: snapshots.reduce((sum, item) => sum + item.openActionItems, 0),
  }
  const metricsSnapshotStatus = metricsSnapshotSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_METRICS_SNAPSHOT_CAPTURED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceMetricsSnapshots: snapshots,
    metricsSnapshotSummary,
    metricsSnapshotStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticDistribution: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance metrics snapshot ${metricsSnapshotStatus}: average health score ${metricsSnapshotSummary.averageHealthScore} with ${metricsSnapshotSummary.openActionItems} open action items.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_METRICS_SNAPSHOT_CAPTURED_EVENT, result)
  return result
}
