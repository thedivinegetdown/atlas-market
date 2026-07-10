import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_SESSION_SECURITY_EVALUATED_EVENT = 'system.sessionSecurity.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function publicSession(session = {}) {
  const { token, tokenHash, ...safeSession } = session
  void token
  void tokenHash
  return safeSession
}

function createAuditRecord(id, actor, action, timestamp) {
  return {
    id,
    category: 'session_security',
    severity: action.includes('revoked') ? 'medium' : 'low',
    actor,
    source: 'session-security-service',
    eventType: SYSTEM_SESSION_SECURITY_EVALUATED_EVENT,
    timestamp,
    summary: `Session security action: ${action}.`,
    eventChainReferences: [SYSTEM_SESSION_SECURITY_EVALUATED_EVENT],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export function evaluateSessionSecurity(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const userId = input.user?.id ?? input.userId ?? null
  const sessions = (input.sessions ?? []).map(publicSession)
  const nowMs = new Date(options.now?.() ?? timestamp).getTime()
  const idleTimeoutMs = input.idleTimeoutMs ?? 30 * 60 * 1000
  const suspiciousSessions = sessions.filter((session) => {
    const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : nowMs
    return session.status === 'active' && nowMs - lastSeenMs > idleTimeoutMs
  })
  const expiredSessions = sessions.filter((session) => session.expiresAt && new Date(session.expiresAt).getTime() <= nowMs)
  const result = {
    eventType: SYSTEM_SESSION_SECURITY_EVALUATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    userId,
    deviceSessionMetadataModel: {
      fields: ['deviceFingerprint', 'lastSeenAt', 'ipAddress', 'userAgent'],
      rawTokensExposed: false,
      tokenHashesExposed: false,
    },
    activeSessionListing: sessions.filter((session) => session.status === 'active'),
    sessionRotationReadiness: { status: 'ready', rotationBoundary: 'future token/session issue path' },
    idleTimeoutHandling: { idleTimeoutMs, suspiciousSessionCount: suspiciousSessions.length },
    absoluteExpirationHandling: { expiredSessionCount: expiredSessions.length },
    suspiciousSessionSummary: {
      count: suspiciousSessions.length,
      sessionIds: suspiciousSessions.map((session) => session.id),
    },
    sessionSecurityAuditRecords: [
      createAuditRecord(`audit-session-security-${userId ?? 'missing'}`, userId ?? 'anonymous', 'session security evaluated', timestamp),
    ],
    securityStatus: !userId ? 'blocked' : suspiciousSessions.length > 0 || expiredSessions.length > 0 ? 'caution' : 'healthy',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_SESSION_SECURITY_EVALUATED_EVENT, result)
  return result
}

export async function revokeSessionSecurity(input = {}, options = {}) {
  const actorUserId = input.actorUserId
  const targetUserId = input.targetUserId ?? actorUserId
  const actorRole = input.actorRole ?? 'viewer'
  if (!actorUserId) return { ok: false, statusCode: 401, error: { code: 'identity_required', message: 'authentication required' } }
  if (actorUserId !== targetUserId && !['owner', 'admin'].includes(actorRole)) {
    return { ok: false, statusCode: 403, error: { code: 'session_revocation_forbidden', message: 'forbidden' } }
  }
  const repository = options.repository
  const revoked = input.revokeOthers
    ? await repository?.revokeOtherSessions?.(actorUserId, input.sessionId)
    : await repository?.revokeSession?.(input.sessionId)
  return {
    ok: true,
    action: input.revokeOthers ? 'revoke-other-sessions' : 'revoke-session',
    revoked: publicSession(revoked?.session ?? { id: input.sessionId, status: 'revoked' }),
    auditRecord: createAuditRecord(`audit-session-revoke-${input.sessionId}`, actorUserId, 'session revoked', options.timestamp ?? getNowIso()),
  }
}
