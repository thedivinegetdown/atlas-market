import { createHash, randomUUID } from 'node:crypto'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AUTHENTICATION_INITIALIZED_EVENT = 'system.authentication.initialized'

const SAFE_ROLES = Object.freeze(['owner', 'admin', 'analyst', 'viewer'])

function getHeader(headers = {}, name) {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}

function decodeVerifiedTokenTiming(token, now = new Date()) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const expiresAtMs = Number(claims.exp) * 1000
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= new Date(now).getTime()) return null
    return {
      issuedAt: Number.isFinite(Number(claims.iat)) ? new Date(Number(claims.iat) * 1000) : now,
      expiresAt: new Date(expiresAtMs),
    }
  } catch {
    return null
  }
}

function resolveIdentityUrl(env = process.env, configuredUrl) {
  const source = configuredUrl ?? env.NETLIFY_IDENTITY_URL ?? env.URL ?? env.DEPLOY_PRIME_URL
  if (!source) return null
  const url = new URL(source)
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocal) throw new Error('Netlify Identity URL must use HTTPS')
  if (!url.pathname.includes('/.netlify/identity')) url.pathname = '/.netlify/identity'
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/$/, '')
}

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
    role: Object.hasOwn(input, 'role') ? (SAFE_ROLES.includes(input.role) ? input.role : null) : 'viewer',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createNetlifyIdentityAuthAdapter(options = {}) {
  const now = options.now ?? (() => new Date())
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const identityUrl = resolveIdentityUrl(options.env, options.identityUrl)

  return {
    providerId: 'netlify-identity',
    productionSafe: true,
    async authenticate(request = {}) {
      const token = request.token ?? getHeader(request.headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim()
      const timing = decodeVerifiedTokenTiming(token, now())
      if (!timing || !identityUrl || typeof fetchImpl !== 'function') {
        return normalizeAuthenticationError(new Error('Identity session could not be verified'), 'invalid_identity_session')
      }

      try {
        const response = await fetchImpl(`${identityUrl}/user`, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        })
        if (!response.ok) return normalizeAuthenticationError(new Error('Identity provider rejected the session'), 'invalid_identity_session')
        const providerUser = await response.json()
        if (!providerUser?.id) return normalizeAuthenticationError(new Error('Identity provider returned no subject'), 'invalid_identity_session')
        const explicitRoles = Array.isArray(providerUser.app_metadata?.roles) ? providerUser.app_metadata.roles : []
        const role = [providerUser.role, ...explicitRoles].find((candidate) => SAFE_ROLES.includes(candidate)) ?? null
        const user = normalizeUserIdentity({
          provider: 'netlify-identity',
          providerSubject: providerUser.id,
          displayName: providerUser.user_metadata?.full_name ?? providerUser.user_metadata?.name ?? providerUser.email ?? 'Atlas user',
          email: providerUser.email ?? null,
          role,
          metadata: {
            identityProvider: providerUser.app_metadata?.provider ?? 'email',
            rolesExplicitlyAssigned: role !== null,
          },
        })
        const session = normalizeAuthenticatedSession({
          id: `netlify-identity:${providerUser.id}`,
          provider: user.provider,
          userId: user.id,
          token,
          user,
          issuedAt: timing.issuedAt,
          refreshedAt: now(),
          expiresAt: timing.expiresAt,
          metadata: { providerVerified: true },
        }, now())
        return { ok: true, user, session }
      } catch (error) {
        return normalizeAuthenticationError(error, 'identity_provider_unavailable')
      }
    },
    async healthCheck() {
      return {
        status: identityUrl ? 'ready' : 'blocked',
        providerId: 'netlify-identity',
        configured: Boolean(identityUrl),
        productionSafe: true,
        swappable: true,
      }
    },
  }
}

export function createAuthenticationProvider(options = {}) {
  const env = options.env ?? process.env
  const nodeEnv = String(env.NODE_ENV ?? 'development').toLowerCase()
  const mode = String(env.ATLAS_AUTH_MODE ?? (nodeEnv === 'production' ? 'netlify-identity' : 'development')).toLowerCase()
  if (nodeEnv === 'production' && mode !== 'netlify-identity') {
    throw new Error('Production authentication must use Netlify Identity')
  }
  if (mode === 'netlify-identity') {
    return createNetlifyIdentityAuthAdapter({ ...options.netlifyIdentity, env })
  }
  if (!['development', 'test'].includes(nodeEnv) || !['development', 'local'].includes(mode)) {
    throw new Error('Local authentication is restricted to explicit development and test environments')
  }
  return createLocalDevelopmentAuthAdapter(options.localDevelopment)
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
