import { AppError } from '../errors/appError.js'

export const SECURITY_POLICY_EVENTS = Object.freeze({
  requestDenied: 'securityPolicy.requestDenied',
  crossTenantBlocked: 'securityPolicy.crossTenantBlocked',
  invalidTransitionBlocked: 'securityPolicy.invalidTransitionBlocked',
  sensitiveActionEvaluated: 'securityPolicy.sensitiveActionEvaluated',
})

const safeIdPattern = /^[A-Za-z0-9._:-]{1,160}$/
const safeFilenamePattern = /^[A-Za-z0-9._-]{1,160}$/

function denial(code, publicMessage, metadata = {}, statusCode = 400) {
  throw new AppError(code, publicMessage, {
    statusCode,
    publicMessage,
    metadata: {
      eventType: metadata.eventType ?? SECURITY_POLICY_EVENTS.requestDenied,
      ...metadata,
    },
  })
}

export function requireTenantContext(tenantContext = {}) {
  if (!tenantContext.organizationId || !tenantContext.userId || !tenantContext.role) {
    denial('forbidden', 'tenant context is required', { eventType: SECURITY_POLICY_EVENTS.requestDenied }, 403)
  }
  return tenantContext
}

export function requireAccountContext(accountId) {
  const normalized = String(accountId ?? '').trim()
  if (!safeIdPattern.test(normalized)) {
    denial('invalid_request', 'account context is required', { field: 'accountId' }, 400)
  }
  return normalized
}

export function normalizeSafeId(value, fieldName = 'id') {
  const normalized = String(value ?? '').trim()
  if (!safeIdPattern.test(normalized)) {
    denial('invalid_request', `${fieldName} is invalid`, { field: fieldName }, 400)
  }
  return normalized
}

export function normalizeListLimit(value, { defaultLimit = 50, maxLimit = 100 } = {}) {
  const limit = Number(value ?? defaultLimit)
  if (!Number.isFinite(limit)) return defaultLimit
  return Math.min(maxLimit, Math.max(1, Math.trunc(limit)))
}

export function assertAllowedEnum(value, allowedValues = [], fieldName = 'value') {
  const normalized = String(value ?? '').trim()
  if (!allowedValues.includes(normalized)) {
    denial('invalid_request', `${fieldName} is invalid`, { field: fieldName, allowedValues }, 400)
  }
  return normalized
}

export function assertRoleAllowed(role, allowedRoles = [], action = 'action') {
  if (!allowedRoles.includes(role)) {
    denial('forbidden', `${action} is denied`, { action, role }, 403)
  }
  return true
}

export function assertObjectTenantAccess(record = {}, tenantContext = {}, { accountId, fieldName = 'record' } = {}) {
  requireTenantContext(tenantContext)
  const recordTenant = record.tenantScope ?? {}
  const organizationId = recordTenant.organizationId ?? record.organizationId
  const teamWorkspaceId = recordTenant.teamWorkspaceId ?? record.teamWorkspaceId ?? null
  const recordAccountId = record.accountId
  const sameTenant = organizationId === tenantContext.organizationId
    && (teamWorkspaceId ?? null) === (tenantContext.teamWorkspaceId ?? null)
  const sameAccount = accountId ? recordAccountId === accountId : true
  if (!sameTenant || !sameAccount) {
    denial('cross_tenant_denied', `${fieldName} access denied`, {
      eventType: SECURITY_POLICY_EVENTS.crossTenantBlocked,
      field: fieldName,
    }, 403)
  }
  return true
}

export function assertValidTransition({ currentState, nextState, terminalStates = [], allowedTransitions = {}, fieldName = 'state' } = {}) {
  if (terminalStates.includes(currentState) && currentState !== nextState) {
    denial('invalid_transition', `${fieldName} transition is invalid`, {
      eventType: SECURITY_POLICY_EVENTS.invalidTransitionBlocked,
      currentState,
      nextState,
    }, 409)
  }
  const allowed = allowedTransitions[currentState]
  if (allowed && !allowed.includes(nextState)) {
    denial('invalid_transition', `${fieldName} transition is invalid`, {
      eventType: SECURITY_POLICY_EVENTS.invalidTransitionBlocked,
      currentState,
      nextState,
    }, 409)
  }
  return true
}

export function safeContentDisposition(filename) {
  const normalized = String(filename ?? 'paper-report.csv').replace(/[^\w.-]+/g, '-').replace(/\.\.+/g, '.').replace(/^[.-]+|[-]+$/g, '').slice(0, 120) || 'paper-report.csv'
  if (!safeFilenamePattern.test(normalized) || normalized.includes('..')) {
    denial('invalid_request', 'filename is invalid', { field: 'filename' }, 400)
  }
  return `attachment; filename="${normalized}"`
}

export function evaluateSensitiveAction({ tenantContext = {}, membership = {}, action, allowedRoles = ['owner', 'admin'], accountId } = {}) {
  requireTenantContext(tenantContext)
  requireAccountContext(accountId)
  const normalizedAction = normalizeSafeId(action, 'action')
  assertRoleAllowed(membership.role ?? tenantContext.role, allowedRoles, normalizedAction)
  return {
    eventType: SECURITY_POLICY_EVENTS.sensitiveActionEvaluated,
    action: normalizedAction,
    role: membership.role ?? tenantContext.role,
    organizationId: tenantContext.organizationId,
    accountId,
    allowed: true,
  }
}
