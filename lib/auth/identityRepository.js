import { hashSessionToken, normalizeAuthenticatedSession, normalizeUserIdentity } from './authenticationProvider.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createDatabaseAdapter } from '../db/postgresRepository.js'

export const SYSTEM_USER_IDENTITY_PERSISTED_EVENT = 'system.userIdentity.persisted'
export const SYSTEM_USER_SESSION_UPDATED_EVENT = 'system.userSession.updated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function createAuditRecord(id, eventType, userId, action, timestamp) {
  return {
    id,
    category: 'identity_session',
    severity: 'low',
    actor: userId ?? 'unknown-user',
    source: 'identity-repository',
    eventType,
    timestamp,
    summary: `Identity session lifecycle action: ${action}.`,
    eventChainReferences: [eventType],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export function createUserIdentityRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  return {
    connected: adapter.connected,
    async upsertUser(identity) {
      const user = normalizeUserIdentity(identity)
      if (!adapter.connected) return { ok: true, disabled: true, user }
      const result = await adapter.query(
        `INSERT INTO atlas_users (id, provider, provider_subject, display_name, email, role, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (provider, provider_subject)
         DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, role = EXCLUDED.role, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id, provider, provider_subject, display_name, email, role, metadata`,
        [user.id, user.provider, user.providerSubject, user.displayName, user.email, user.role, user.metadata],
      )
      return { ok: true, user: rowToUser(result.rows?.[0] ?? user) }
    },
    async findByProviderSubject(provider, providerSubject) {
      if (!adapter.connected) return null
      const result = await adapter.query('SELECT id, provider, provider_subject, display_name, email, role, metadata FROM atlas_users WHERE provider = $1 AND provider_subject = $2', [provider, providerSubject])
      return result.rows?.[0] ? rowToUser(result.rows[0]) : null
    },
  }
}

function rowToUser(row = {}) {
  return normalizeUserIdentity({
    id: row.id,
    provider: row.provider,
    providerSubject: row.provider_subject ?? row.providerSubject,
    displayName: row.display_name ?? row.displayName,
    email: row.email,
    role: row.role,
    metadata: row.metadata,
  })
}

function rowToSession(row = {}, user = null) {
  return normalizeAuthenticatedSession({
    id: row.id,
    userId: row.user_id ?? row.userId,
    provider: row.provider,
    tokenHash: row.token_hash ?? row.tokenHash,
    status: row.status,
    issuedAt: row.created_at ?? row.issuedAt,
    refreshedAt: row.refreshed_at ?? row.refreshedAt,
    expiresAt: row.expires_at ?? row.expiresAt,
    revokedAt: row.revoked_at ?? row.revokedAt,
    user,
    metadata: row.metadata,
    deviceFingerprint: row.device_fingerprint ?? row.deviceFingerprint,
    lastSeenAt: row.last_seen_at ?? row.lastSeenAt,
    ipAddress: row.ip_address ?? row.ipAddress,
    userAgent: row.user_agent ?? row.userAgent,
  })
}

export function createUserSessionRepository({ database, userRepository } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  return {
    connected: adapter.connected,
    async createSession({ user, session }) {
      const normalizedUser = normalizeUserIdentity(user)
      const normalizedSession = normalizeAuthenticatedSession({ ...session, userId: normalizedUser.id, user: normalizedUser })
      if (userRepository) await userRepository.upsertUser(normalizedUser)
      if (!adapter.connected) return { ok: true, disabled: true, session: normalizedSession }
      const result = await adapter.query(
        `INSERT INTO atlas_user_sessions (id, user_id, provider, token_hash, status, metadata, refreshed_at, expires_at, device_fingerprint, last_seen_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, NOW(), $9, $10)
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata, refreshed_at = NOW(), expires_at = EXCLUDED.expires_at, device_fingerprint = EXCLUDED.device_fingerprint, last_seen_at = NOW(), ip_address = EXCLUDED.ip_address, user_agent = EXCLUDED.user_agent
         RETURNING id, user_id, provider, token_hash, status, metadata, created_at, refreshed_at, expires_at, revoked_at, device_fingerprint, last_seen_at, ip_address, user_agent`,
        [
          normalizedSession.id,
          normalizedUser.id,
          normalizedSession.provider,
          normalizedSession.tokenHash,
          normalizedSession.status,
          normalizedSession.metadata,
          normalizedSession.expiresAt,
          normalizedSession.deviceFingerprint ?? normalizedSession.metadata?.deviceFingerprint ?? null,
          normalizedSession.ipAddress ?? normalizedSession.metadata?.ipAddress ?? null,
          normalizedSession.userAgent ?? normalizedSession.metadata?.userAgent ?? null,
        ],
      )
      return { ok: true, session: rowToSession(result.rows?.[0], normalizedUser) }
    },
    async findByToken(token) {
      if (!adapter.connected) return null
      const tokenHash = hashSessionToken(token)
      const result = await adapter.query(
        `SELECT s.id, s.user_id, s.provider, s.token_hash, s.status, s.metadata, s.created_at, s.refreshed_at, s.expires_at, s.revoked_at,
                s.device_fingerprint, s.last_seen_at, s.ip_address, s.user_agent,
                u.id AS user_id_value, u.provider AS user_provider, u.provider_subject, u.display_name, u.email, u.role, u.metadata AS user_metadata
         FROM atlas_user_sessions s
         JOIN atlas_users u ON u.id = s.user_id
         WHERE s.token_hash = $1`,
        [tokenHash],
      )
      const row = result.rows?.[0]
      if (!row) return null
      const user = rowToUser({
        id: row.user_id_value,
        provider: row.user_provider,
        provider_subject: row.provider_subject,
        display_name: row.display_name,
        email: row.email,
        role: row.role,
        metadata: row.user_metadata,
      })
      return rowToSession(row, user)
    },
    async refreshSession(sessionId, expiresAt) {
      if (!adapter.connected) return { ok: true, disabled: true, sessionId, expiresAt }
      const result = await adapter.query(
        'UPDATE atlas_user_sessions SET refreshed_at = NOW(), last_seen_at = NOW(), expires_at = $2 WHERE id = $1 AND status = $3 RETURNING id, refreshed_at, expires_at, last_seen_at',
        [sessionId, expiresAt, 'active'],
      )
      return { ok: true, session: result.rows?.[0] ?? null }
    },
    async revokeSession(sessionId) {
      if (!adapter.connected) return { ok: true, disabled: true, sessionId, status: 'revoked' }
      const result = await adapter.query(
        'UPDATE atlas_user_sessions SET status = $2, revoked_at = NOW() WHERE id = $1 RETURNING id, status, revoked_at',
        [sessionId, 'revoked'],
      )
      return { ok: true, session: result.rows?.[0] ?? null }
    },
    async listActiveSessions(userId) {
      if (!adapter.connected) return []
      const result = await adapter.query(
        `SELECT id, user_id, provider, status, metadata, created_at, refreshed_at, expires_at, revoked_at, device_fingerprint, last_seen_at, ip_address, user_agent
         FROM atlas_user_sessions
         WHERE user_id = $1 AND status = $2
         ORDER BY last_seen_at DESC NULLS LAST, refreshed_at DESC`,
        [userId, 'active'],
      )
      return (result.rows ?? []).map((row) => {
        const session = rowToSession(row)
        const { tokenHash, ...safeSession } = session
        void tokenHash
        return safeSession
      })
    },
    async revokeOtherSessions(userId, currentSessionId) {
      if (!adapter.connected) return { ok: true, disabled: true, userId, currentSessionId, revokedCount: 0, sessions: [] }
      const result = await adapter.query(
        `UPDATE atlas_user_sessions
         SET status = $3, revoked_at = NOW()
         WHERE user_id = $1 AND id <> $2 AND status = $4
         RETURNING id, user_id, status, revoked_at`,
        [userId, currentSessionId, 'revoked', 'active'],
      )
      return { ok: true, revokedCount: result.rows?.length ?? 0, sessions: result.rows ?? [] }
    },
  }
}

export async function persistUserIdentity(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createUserIdentityRepository(options)
  const persisted = await repository.upsertUser(input.identity ?? input.user)
  const result = {
    eventType: SYSTEM_USER_IDENTITY_PERSISTED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    plaintextPasswordsStored: false,
    rawAccessTokensStored: false,
    userIdentity: persisted.user,
    auditRecord: createAuditRecord(`audit-user-${persisted.user.id}`, SYSTEM_USER_IDENTITY_PERSISTED_EVENT, persisted.user.id, 'user persisted', timestamp),
    status: persisted.ok ? 'ready' : 'blocked',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_USER_IDENTITY_PERSISTED_EVENT, result)
  return result
}

export async function updateUserSession(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createUserSessionRepository(options)
  const action = input.action ?? 'create'
  const response = action === 'revoke'
    ? await repository.revokeSession(input.sessionId)
    : action === 'refresh'
      ? await repository.refreshSession(input.sessionId, input.expiresAt)
      : await repository.createSession({ user: input.user, session: input.session })
  const { token, ...sessionWithoutRawToken } = response.session ?? { id: input.sessionId, status: action === 'revoke' ? 'revoked' : 'active' }
  void token
  const result = {
    eventType: SYSTEM_USER_SESSION_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    rawAccessTokensStored: false,
    sessionAction: action,
    operatorSession: sessionWithoutRawToken,
    auditRecord: createAuditRecord(`audit-session-${sessionWithoutRawToken.id}`, SYSTEM_USER_SESSION_UPDATED_EVENT, sessionWithoutRawToken.userId, action, timestamp),
    status: response.ok ? 'ready' : 'blocked',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_USER_SESSION_UPDATED_EVENT, result)
  return result
}
