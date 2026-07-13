import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_OPERATIONS_INCIDENT_OPENED_EVENT = 'paperOperations.incident.opened'
export const PAPER_OPERATIONS_INCIDENT_UPDATED_EVENT = 'paperOperations.incident.updated'
export const PAPER_OPERATIONS_INCIDENT_RESOLVED_EVENT = 'paperOperations.incident.resolved'
export const PAPER_OPERATIONS_INCIDENT_STATES = Object.freeze(['open', 'acknowledged', 'investigating', 'mitigated', 'resolved'])
export const PAPER_OPERATIONS_INCIDENT_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical'])

const ALLOWED_TRANSITIONS = Object.freeze({
  open: Object.freeze(['acknowledged', 'investigating', 'mitigated', 'resolved']),
  acknowledged: Object.freeze(['investigating', 'mitigated', 'resolved']),
  investigating: Object.freeze(['mitigated', 'resolved']),
  mitigated: Object.freeze(['resolved', 'investigating']),
  resolved: Object.freeze([]),
})

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function tenantScope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function state(value) {
  return PAPER_OPERATIONS_INCIDENT_STATES.includes(value) ? value : 'open'
}

function priority(value) {
  return PAPER_OPERATIONS_INCIDENT_PRIORITIES.includes(value) ? value : 'medium'
}

function severityToPriority(severity) {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'high'
  return 'medium'
}

function activity(input = {}) {
  const timestamp = input.timestamp ?? nowIso()
  return {
    id: String(input.id ?? `paper-operations-incident-activity-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    incidentId: input.incidentId ?? null,
    activityType: input.activityType ?? 'updated',
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    actor: {
      userId: input.actor?.userId ?? input.actor?.id ?? input.userId ?? null,
      role: input.actor?.role ?? input.role ?? null,
    },
    reason: String(input.reason ?? '').slice(0, 500),
    createdAt: timestamp,
  }
}

export function normalizePaperOperationsIncident(input = {}, index = 0) {
  const timestamp = input.updatedAt ?? input.openedAt ?? input.timestamp ?? nowIso()
  const incidentState = state(input.state ?? input.incidentState)
  return {
    id: String(input.id ?? `paper-operations-incident-${input.accountId ?? 'paper'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: tenantScope(input),
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    incidentState,
    severity: input.severity ?? 'critical',
    priority: priority(input.priority),
    title: String(input.title ?? 'Paper operations incident').slice(0, 220),
    summary: String(input.summary ?? 'Paper operations incident requires review.').slice(0, 800),
    linkedAlertIds: (input.linkedAlertIds ?? input.alertIds ?? []).slice(0, 50).map(String),
    linkedAlertFingerprints: (input.linkedAlertFingerprints ?? []).slice(0, 50).map(String),
    openedAt: input.openedAt ?? timestamp,
    acknowledgedAt: input.acknowledgedAt ?? (incidentState === 'acknowledged' ? timestamp : null),
    mitigatedAt: input.mitigatedAt ?? (incidentState === 'mitigated' ? timestamp : null),
    resolvedAt: input.resolvedAt ?? (incidentState === 'resolved' ? timestamp : null),
    actorAuditReference: input.actorAuditReference ?? null,
    activityRecords: (input.activityRecords ?? []).slice(0, 100).map(activity),
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function openPaperOperationsIncidents(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const existing = input.existingIncidents ?? []
  const activeAlerts = (input.paperOperationsAlerts ?? input.alerts ?? [])
    .filter((alert) => alert.status !== 'resolved' && (alert.severity === 'critical' || alert.occurrenceCount >= 3))
    .slice(0, 25)
  const openIncidents = []
  for (const alert of activeAlerts) {
    const prior = existing.find((incident) => incident.linkedAlertFingerprints?.includes(alert.fingerprint) && incident.incidentState !== 'resolved')
    const incident = normalizePaperOperationsIncident({
      ...prior,
      tenantContext: scope,
      accountId,
      severity: alert.severity,
      priority: severityToPriority(alert.severity),
      title: `Paper operations: ${alert.category}`,
      summary: alert.message,
      linkedAlertIds: [...new Set([...(prior?.linkedAlertIds ?? []), alert.id])],
      linkedAlertFingerprints: [...new Set([...(prior?.linkedAlertFingerprints ?? []), alert.fingerprint])],
      activityRecords: prior?.activityRecords?.length ? prior.activityRecords : [activity({ incidentId: prior?.id, activityType: 'opened', toState: 'open', timestamp })],
      timestamp,
    })
    openIncidents.push(incident)
  }
  const result = {
    eventType: PAPER_OPERATIONS_INCIDENT_OPENED_EVENT,
    timestamp,
    tenantScope: scope,
    accountId,
    paperOperationsIncidents: openIncidents,
    paperOperationsIncidentSummary: summarizeIncidents(openIncidents),
    incidentWorkflowStatus: openIncidents.some((incident) => incident.priority === 'critical') ? 'critical' : openIncidents.length ? 'degraded' : 'healthy',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Paper operations incident workflow opened or reused ${openIncidents.length} bounded incidents.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_OPERATIONS_INCIDENT_OPENED_EVENT, result)
  return result
}

export function transitionPaperOperationsIncident(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const current = normalizePaperOperationsIncident(input.incident ?? input)
  const nextState = state(input.nextState ?? input.toState)
  if (!ALLOWED_TRANSITIONS[current.incidentState].includes(nextState)) {
    return {
      eventType: PAPER_OPERATIONS_INCIDENT_UPDATED_EVENT,
      timestamp,
      ok: false,
      rejected: true,
      reason: `invalid transition ${current.incidentState} to ${nextState}`,
      incident: current,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }
  const next = normalizePaperOperationsIncident({
    ...current,
    incidentState: nextState,
    acknowledgedAt: current.acknowledgedAt ?? (nextState === 'acknowledged' ? timestamp : null),
    mitigatedAt: current.mitigatedAt ?? (nextState === 'mitigated' ? timestamp : null),
    resolvedAt: current.resolvedAt ?? (nextState === 'resolved' ? timestamp : null),
    actorAuditReference: {
      actorUserId: input.actor?.userId ?? input.actor?.id ?? null,
      actorRole: input.actor?.role ?? null,
      eventType: nextState === 'resolved' ? PAPER_OPERATIONS_INCIDENT_RESOLVED_EVENT : PAPER_OPERATIONS_INCIDENT_UPDATED_EVENT,
    },
    activityRecords: [
      ...(current.activityRecords ?? []),
      activity({ incidentId: current.id, activityType: nextState, fromState: current.incidentState, toState: nextState, actor: input.actor, reason: input.reason, timestamp }),
    ],
    timestamp,
  })
  return {
    eventType: nextState === 'resolved' ? PAPER_OPERATIONS_INCIDENT_RESOLVED_EVENT : PAPER_OPERATIONS_INCIDENT_UPDATED_EVENT,
    timestamp,
    ok: true,
    rejected: false,
    incident: next,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function summarizeIncidents(incidents = []) {
  return {
    total: incidents.length,
    open: incidents.filter((incident) => incident.incidentState === 'open').length,
    acknowledged: incidents.filter((incident) => incident.incidentState === 'acknowledged').length,
    investigating: incidents.filter((incident) => incident.incidentState === 'investigating').length,
    mitigated: incidents.filter((incident) => incident.incidentState === 'mitigated').length,
    resolved: incidents.filter((incident) => incident.incidentState === 'resolved').length,
    critical: incidents.filter((incident) => incident.priority === 'critical' && incident.incidentState !== 'resolved').length,
  }
}

export function createPaperOperationsIncidentRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async upsert(incident) {
      const normalized = normalizePaperOperationsIncident(incident)
      if (!database?.connected) return { ok: true, disabled: true, incident: normalized }
      const result = await database.query(
        `INSERT INTO atlas_paper_operations_incidents
          (id, organization_id, team_workspace_id, account_id, incident_state, severity, priority, payload, opened_at, resolved_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET incident_state = EXCLUDED.incident_state, severity = EXCLUDED.severity, priority = EXCLUDED.priority, payload = EXCLUDED.payload, resolved_at = EXCLUDED.resolved_at, updated_at = NOW()
         RETURNING payload`,
        [normalized.id, normalized.tenantScope.organizationId, normalized.tenantScope.teamWorkspaceId, normalized.accountId, normalized.incidentState, normalized.severity, normalized.priority, normalized, normalized.openedAt, normalized.resolvedAt],
      )
      return { ok: true, incident: normalizePaperOperationsIncident(result.rows?.[0]?.payload ?? normalized) }
    },
    async appendActivity(incident, record) {
      const normalized = normalizePaperOperationsIncident(incident)
      const normalizedActivity = activity({ ...record, incidentId: normalized.id })
      if (!database?.connected) return { ok: true, disabled: true, activity: normalizedActivity }
      await database.query(
        `INSERT INTO atlas_paper_operations_incident_activity
          (id, organization_id, team_workspace_id, incident_id, activity_type, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [normalizedActivity.id, normalized.tenantScope.organizationId, normalized.tenantScope.teamWorkspaceId, normalized.id, normalizedActivity.activityType, normalizedActivity],
      )
      return { ok: true, activity: normalizedActivity }
    },
    async linkAlert(incident, alert) {
      if (!database?.connected) return { ok: true, disabled: true }
      await database.query(
        `INSERT INTO atlas_paper_operations_incident_alert_links
          (incident_id, alert_id, organization_id, team_workspace_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (incident_id, alert_id) DO NOTHING`,
        [incident.id, alert.id, incident.tenantScope.organizationId, incident.tenantScope.teamWorkspaceId, { incidentId: incident.id, alertId: alert.id }],
      )
      return { ok: true }
    },
    async list({ tenantContext = {}, accountId, incidentState, priority: priorityFilter, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (incidentState) {
        params.push(state(incidentState))
        clauses.push(`incident_state = $${params.length}`)
      }
      if (priorityFilter) {
        params.push(priority(priorityFilter))
        clauses.push(`priority = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_operations_incidents
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizePaperOperationsIncident(row.payload))
    },
  }
}
