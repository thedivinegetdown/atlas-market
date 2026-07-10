import { createHash, randomUUID } from 'node:crypto'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AUTHENTICATION_INITIALIZED_EVENT = 'system.authentication.initialized'

const SAFE_ROLES = Object.freeze(['owner', 'admin', 'analyst', 'viewer'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

export function normalizeAuthenticationError(error, fallbackCode = 'authentication_failed') {
  return {
    ok: false,
    error: {
      code: error?.code && typeof error.code === 'string' ? error.code : fallbackCode,
      message: 'authentication failed',
      internalMessage: error?.message ?? 'authentication failed',
    },
  }
}

export function normalizeUserIdentity(input = {}) {
  const provider = String(input.provider ?? 'local-development')
  const providerSubject = String(input.providerSubject ?? input.id ?? 'local-operator')
  return {
    id: String(input.id ?? `${provider}:${providerSubject}`),
    provider,
    providerSubject,
    displayName: String(input.displayName ?? 'Local Development Operator'),
    email: input.email ?? null,
    role: SAFE_ROLES.includes(input.role) ? input.role : 'viewer',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function normalizeAuthenticatedSession(input = {}, now = new Date()) {
  const issuedAt = getNowIso(input.issuedAt ?? now)
  const expiresAt = getNowIso(input.expiresAt ?? new Date(new Date(now).getTime() + 60 * 60 * 1000))
  return {
    id: String(input.id ?? `sess_${randomUUID()}`),
    userId: String(input.userId ?? input.user?.id ?? 'local-development:local-operator'),
    provider: String(input.provider ?? input.user?.provider ?? 'local-development'),
    tokenHash: input.tokenHash ?? hashSessionToken(input.token ?? input.id ?? issuedAt),
    status: input.status ?? 'active',
    issuedAt,
    refreshedAt: getNowIso(input.refreshedAt ?? now),
    expiresAt,
    revokedAt: input.revokedAt ?? null,
    user: input.user ? normalizeUserIdentity(input.user) : null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    deviceFingerprint: input.deviceFingerprint ?? input.metadata?.deviceFingerprint ?? null,
    lastSeenAt: input.lastSeenAt ?? input.refreshedAt ?? issuedAt,
    ipAddress: input.ipAddress ?? input.metadata?.ipAddress ?? null,
    userAgent: input.userAgent ?? input.metadata?.userAgent ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function validateAuthenticatedSession(session, now = new Date()) {
  if (!session) return { valid: false, status: 'missing', reason: 'session is missing' }
  if (session.status === 'revoked' || session.revokedAt) return { valid: false, status: 'revoked', reason: 'session has been revoked' }
  if (new Date(session.expiresAt).getTime() <= new Date(now).getTime()) return { valid: false, status: 'expired', reason: 'session has expired' }
  return { valid: true, status: 'active', reason: 'session is active' }
}

export function createLocalDevelopmentAuthAdapter(options = {}) {
  const now = options.now ?? (() => new Date())
  return {
    providerId: 'local-development',
    productionSafe: false,
    async authenticate(request = {}) {
      const headers = request.headers ?? {}
      const role = headers['x-atlas-dev-role'] ?? headers['X-Atlas-Dev-Role'] ?? options.defaultRole ?? 'owner'
      const subject = headers['x-atlas-dev-subject'] ?? headers['X-Atlas-Dev-Subject'] ?? 'local-operator'
      const user = normalizeUserIdentity({
        provider: 'local-development',
        providerSubject: subject,
        displayName: headers['x-atlas-dev-name'] ?? headers['X-Atlas-Dev-Name'] ?? 'Local Development Operator',
        role,
        metadata: { adapter: 'local-development', nonProduction: true },
      })
      const token = headers.authorization?.replace(/^Bearer\s+/i, '') ?? headers.Authorization?.replace(/^Bearer\s+/i, '') ?? `local-dev-${subject}`
      const session = normalizeAuthenticatedSession({
        id: `local-session-${subject}`,
        provider: user.provider,
        userId: user.id,
        token,
        user,
        issuedAt: now(),
        refreshedAt: now(),
        expiresAt: new Date(now().getTime() + (options.sessionTtlMs ?? 60 * 60 * 1000)),
        metadata: { localDevelopmentOnly: true },
      }, now())
      return { ok: true, user, session }
    },
    async healthCheck() {
      return { status: 'ready', providerId: 'local-development', productionSafe: false, swappable: true }
    },
  }
}

export function createExternalProviderAdapterContract(providerId = 'future-external-provider') {
  return {
    providerId,
    productionSafe: true,
    authenticate: async () => {
      throw new Error('External authentication provider contract is not configured.')
    },
    healthCheck: async () => ({ status: 'caution', providerId, configured: false, swappable: true }),
  }
}

export async function initializeAuthentication(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const provider = options.provider ?? createLocalDevelopmentAuthAdapter(options.localDevelopment)
  const health = await provider.healthCheck()
  const result = {
    eventType: SYSTEM_AUTHENTICATION_INITIALIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    credentialsCommitted: false,
    hardCodedCredentials: false,
    providerInterface: {
      methods: ['authenticate', 'healthCheck'],
      swappable: true,
      domainCoupled: false,
    },
    localDevelopmentAuthenticationAdapter: {
      providerId: 'local-development',
      nonProductionOnly: true,
      storesCredentials: false,
    },
    futureExternalProviderAdapterContract: createExternalProviderAdapterContract(input.futureProviderId).providerId,
    authenticatedSessionModel: normalizeAuthenticatedSession({ user: normalizeUserIdentity(), token: 'model-only' }),
    sessionValidation: validateAuthenticatedSession(normalizeAuthenticatedSession({ token: 'model-only' })),
    sessionExpirationHandling: {
      ttlMs: options.localDevelopment?.sessionTtlMs ?? 60 * 60 * 1000,
      expiredSessionsRejected: true,
      revokedSessionsRejected: true,
    },
    authenticationErrorNormalization: normalizeAuthenticationError(new Error('model-only')).error.message,
    authenticationHealthSummary: health,
    authenticationStatus: health.status === 'ready' ? 'ready' : 'caution',
    summary: `Authentication initialized with ${health.providerId} provider abstraction; local development adapter is non-production and swappable.`,
    sourceEvents: {
      authReadiness: input.authReadiness?.eventType ?? null,
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      apiReliability: input.apiReliability?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AUTHENTICATION_INITIALIZED_EVENT, result)
  return result
}
