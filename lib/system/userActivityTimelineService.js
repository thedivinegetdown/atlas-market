import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_USER_ACTIVITY_TIMELINE_EVALUATED_EVENT = 'system.userActivityTimeline.evaluated'

export const USER_ACTIVITY_CATEGORIES = Object.freeze([
  'account',
  'authentication',
  'session',
  'organization',
  'team workspace',
  'invitation',
  'workspace',
  'notification',
  'paper-trading operation',
])

const SENSITIVE_KEY_PATTERN = /(token|hash|secret|password|ip_address|ipAddress|user_agent|userAgent|device|fingerprint)/i

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return []
    return [[key, redact(entry)]]
  }))
}

function safeCategory(category = '') {
  return USER_ACTIVITY_CATEGORIES.includes(category) ? category : 'workspace'
}

export function normalizeActivityRecord(input = {}) {
  const timestamp = input.timestamp ?? input.createdAt ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `activity-${safeCategory(input.category).replace(/\s+/g, '-')}-${Date.parse(timestamp) || Date.now()}`),
    category: safeCategory(input.category),
    actorUserId: input.actorUserId ?? input.userId ?? input.actor ?? tenantScope.userId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    summary: String(input.summary ?? input.message ?? 'User activity reviewed.').slice(0, 400),
    sourceEventReference: input.sourceEventReference ?? input.eventType ?? null,
    payload: redact(input.payload ?? input.details ?? {}),
    timestamp,
    sensitiveFieldsRedacted: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

function fromAdministrativeAudit(audit = {}) {
  const record = audit.normalizedAdministrativeAuditRecord ?? audit
  return normalizeActivityRecord({
    id: `activity-audit-${record.id ?? Date.now()}`,
    category: record.category ?? 'organization',
    actorUserId: record.actor,
    tenantScope: record.tenantScope,
    summary: `${record.category ?? 'administrative'} change recorded.`,
    sourceEventReference: record.eventType ?? audit.eventType,
    payload: { before: record.before, after: record.after },
    timestamp: record.timestamp,
  })
}

function fromSession(session = {}, tenantContext = {}) {
  return normalizeActivityRecord({
    id: `activity-session-${session.id ?? Date.now()}`,
    category: 'session',
    actorUserId: session.userId ?? tenantContext.userId,
    tenantScope: tenantContext,
    summary: `Session ${session.status ?? 'reviewed'}.`,
    sourceEventReference: 'system.sessionSecurity.evaluated',
    payload: session,
    timestamp: session.lastSeenAt ?? session.updatedAt ?? session.createdAt,
  })
}

function fromNotification(notification = {}) {
  return normalizeActivityRecord({
    id: `activity-notification-${notification.id ?? Date.now()}`,
    category: 'notification',
    actorUserId: notification.userId,
    tenantScope: notification.tenantScope,
    summary: `${notification.category ?? 'notification'} notification ${notification.status ?? 'reviewed'}.`,
    sourceEventReference: notification.sourceEventReference?.eventType ?? 'system.inAppNotification.created',
    payload: notification,
    timestamp: notification.updatedAt ?? notification.createdAt,
  })
}

function fromOperatorAction(action = {}, tenantContext = {}) {
  const payload = action.payload ?? action
  return normalizeActivityRecord({
    id: `activity-operator-${payload.id ?? action.id ?? Date.now()}`,
    category: payload.category === 'paper-trading risk' ? 'paper-trading operation' : 'workspace',
    actorUserId: payload.actor ?? tenantContext.userId,
    tenantScope: payload.tenantScope ?? tenantContext,
    summary: payload.rationale ?? payload.summary ?? 'Operator action reviewed.',
    sourceEventReference: payload.eventType ?? 'system.operatorActions.generated',
    payload,
    timestamp: payload.timestamp ?? payload.createdAt,
  })
}

function paginate(records, query = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50))
  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null
  const dateTo = query.dateTo ? new Date(query.dateTo) : null
  const filtered = records.filter((record) => {
    const date = new Date(record.timestamp)
    if (dateFrom && date < dateFrom) return false
    if (dateTo && date > dateTo) return false
    return true
  })
  return filtered
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, limit)
}

function canViewTimeline({ requester = {}, tenantContext = {}, targetUserId, administrative = false } = {}) {
  if (administrative) return ['owner', 'admin'].includes(tenantContext.role ?? requester.role)
  return requester.id === targetUserId || tenantContext.userId === targetUserId
}

export function evaluateUserActivityTimeline(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const requester = input.requester ?? input.user ?? { id: tenantContext.userId, role: tenantContext.role }
  const targetUserId = input.targetUserId ?? tenantContext.userId ?? requester.id
  const administrative = input.administrative === true
  const allowed = canViewTimeline({ requester, tenantContext, targetUserId, administrative })
  const auditRecords = (input.administrativeAuditRecords ?? input.auditRecords ?? []).map(fromAdministrativeAudit)
  const sessionRecords = (input.sessions ?? input.sessionSecurity?.activeSessionListing ?? []).map((session) => fromSession(session, tenantContext))
  const notificationRecords = (input.notifications ?? []).map(fromNotification)
  const operatorRecords = (input.operatorActions ?? []).map((action) => fromOperatorAction(action, tenantContext))
  const eventRecords = (input.systemEvents ?? []).map((event) => normalizeActivityRecord({
    id: `activity-event-${event.id ?? Date.now()}`,
    category: event.category ?? 'workspace',
    actorUserId: event.userId ?? tenantContext.userId,
    tenantScope: event.tenantScope ?? tenantContext,
    summary: event.summary ?? event.eventType ?? 'System event reviewed.',
    sourceEventReference: event.eventType,
    payload: event.payload ?? event,
    timestamp: event.timestamp ?? event.createdAt,
  }))
  const records = allowed ? paginate([...auditRecords, ...sessionRecords, ...notificationRecords, ...operatorRecords, ...eventRecords], input.query) : []
  const result = {
    eventType: SYSTEM_USER_ACTIVITY_TIMELINE_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    normalizedActivityRecords: records,
    activityCategories: USER_ACTIVITY_CATEGORIES,
    tenantScoped: true,
    userScoped: !administrative,
    pagination: { limit: Math.min(100, Math.max(1, Number(input.query?.limit ?? 50) || 50)), returned: records.length },
    dateFiltering: { dateFrom: input.query?.dateFrom ?? null, dateTo: input.query?.dateTo ?? null },
    access: {
      allowed,
      usersViewOwnActivity: true,
      ownerAdminTenantActivity: true,
      analystViewerTenantAdminDenied: administrative && !allowed,
    },
    sensitiveFieldRedaction: {
      tokens: true,
      hashes: true,
      secrets: true,
      ipAddresses: true,
      sensitiveDeviceDetails: true,
    },
    status: allowed ? 'healthy' : 'blocked',
    summary: allowed
      ? `User activity timeline healthy: ${records.length} safe records composed from audit, session, notification, action, and event sources.`
      : 'User activity timeline blocked: requester is not allowed to view this activity scope.',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_USER_ACTIVITY_TIMELINE_EVALUATED_EVENT, result)
  return result
}
