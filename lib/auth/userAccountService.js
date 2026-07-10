import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_USER_ACCOUNT_UPDATED_EVENT = 'system.userAccount.updated'

const SAFE_PROFILE_FIELDS = Object.freeze(['displayName', 'timezone', 'locale', 'preferredWorkspace', 'accessibilityPreferences'])
const SAFE_LOCALES = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const SAFE_TIMEZONE = /^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normalizeUserProfile(input = {}) {
  return {
    userId: String(input.userId ?? input.user?.id ?? 'local-development:local-operator'),
    displayName: String(input.displayName ?? input.user?.displayName ?? 'Local Development Operator').slice(0, 120),
    timezone: String(input.timezone ?? 'America/New_York'),
    locale: String(input.locale ?? 'en-US'),
    preferredWorkspace: String(input.preferredWorkspace ?? input.preferred_workspace ?? 'atlas-paper-operator-workspace'),
    accessibilityPreferences: input.accessibilityPreferences && typeof input.accessibilityPreferences === 'object'
      ? input.accessibilityPreferences
      : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function validateUserProfile(profile = {}) {
  const issues = []
  if (!profile.userId) issues.push('user id is required')
  if (!profile.displayName || profile.displayName.length > 120) issues.push('display name must be 1-120 characters')
  if (!SAFE_TIMEZONE.test(profile.timezone)) issues.push('timezone is invalid')
  if (!SAFE_LOCALES.test(profile.locale)) issues.push('locale is invalid')
  if (!profile.preferredWorkspace) issues.push('preferred workspace is required')
  return {
    valid: issues.length === 0,
    issues,
    safeProfileFields: SAFE_PROFILE_FIELDS,
  }
}

export function assertOwnProfileUpdate({ actorUserId, targetUserId }) {
  if (!actorUserId || actorUserId !== targetUserId) {
    const error = new Error('profile update denied')
    error.code = 'profile_update_denied'
    error.statusCode = 403
    throw error
  }
  return true
}

export function createUserProfileRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async getProfile(userId) {
      if (!database?.connected) return normalizeUserProfile({ userId })
      const result = await database.query(
        'SELECT user_id, display_name, timezone, locale, preferred_workspace, accessibility_preferences, metadata FROM atlas_user_profiles WHERE user_id = $1',
        [userId],
      )
      const row = result.rows?.[0]
      return row ? normalizeUserProfile({
        userId: row.user_id,
        displayName: row.display_name,
        timezone: row.timezone,
        locale: row.locale,
        preferredWorkspace: row.preferred_workspace,
        accessibilityPreferences: row.accessibility_preferences,
        metadata: row.metadata,
      }) : normalizeUserProfile({ userId })
    },
    async upsertProfile(profile) {
      const normalized = normalizeUserProfile(profile)
      if (!database?.connected) return { ok: true, disabled: true, profile: normalized }
      const result = await database.query(
        `INSERT INTO atlas_user_profiles (user_id, display_name, timezone, locale, preferred_workspace, accessibility_preferences, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET display_name = EXCLUDED.display_name, timezone = EXCLUDED.timezone, locale = EXCLUDED.locale, preferred_workspace = EXCLUDED.preferred_workspace, accessibility_preferences = EXCLUDED.accessibility_preferences, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING user_id, display_name, timezone, locale, preferred_workspace, accessibility_preferences, metadata`,
        [normalized.userId, normalized.displayName, normalized.timezone, normalized.locale, normalized.preferredWorkspace, normalized.accessibilityPreferences, normalized.metadata],
      )
      const row = result.rows?.[0] ?? {
        user_id: normalized.userId,
        display_name: normalized.displayName,
        timezone: normalized.timezone,
        locale: normalized.locale,
        preferred_workspace: normalized.preferredWorkspace,
        accessibility_preferences: normalized.accessibilityPreferences,
        metadata: normalized.metadata,
      }
      return { ok: true, profile: normalizeUserProfile({
        userId: row.user_id,
        displayName: row.display_name,
        timezone: row.timezone,
        locale: row.locale,
        preferredWorkspace: row.preferred_workspace,
        accessibilityPreferences: row.accessibility_preferences,
        metadata: row.metadata,
      }) }
    },
  }
}

function createAuditRecord(profile, actorUserId, timestamp) {
  return {
    id: `audit-user-account-${profile.userId}`,
    category: 'user_account',
    severity: 'low',
    actor: actorUserId,
    source: 'user-account-service',
    eventType: SYSTEM_USER_ACCOUNT_UPDATED_EVENT,
    timestamp,
    summary: `User account profile updated for ${profile.userId}.`,
    eventChainReferences: [SYSTEM_USER_ACCOUNT_UPDATED_EVENT],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export async function updateUserAccount(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const actorUserId = input.actorUserId ?? input.user?.id
  const profile = normalizeUserProfile({ ...input.profile, userId: input.targetUserId ?? input.profile?.userId ?? actorUserId })
  assertOwnProfileUpdate({ actorUserId, targetUserId: profile.userId })
  const validation = validateUserProfile(profile)
  const repository = options.repository ?? createUserProfileRepository(options)
  const response = validation.valid ? await repository.upsertProfile(profile) : { ok: false, profile }
  const result = {
    eventType: SYSTEM_USER_ACCOUNT_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    safeProfileFields: SAFE_PROFILE_FIELDS,
    profileValidation: validation,
    accountStatusSummary: {
      status: validation.valid && response.ok ? 'healthy' : 'blocked',
      providerSubjectPreserved: true,
      passwordsStored: false,
      rawTokensStored: false,
    },
    profile: response.profile,
    accountUpdateAuditRecord: createAuditRecord(response.profile, actorUserId, timestamp),
    status: validation.valid && response.ok ? 'updated' : 'blocked',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_USER_ACCOUNT_UPDATED_EVENT, result)
  return result
}
