import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AUTHORIZATION_EVALUATED_EVENT = 'system.authorization.evaluated'

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze([
    'workspace.admin',
    'workspace.owner',
    'operator.admin',
    'research.read',
    'strategy.read',
    'backtest.read',
    'paperTrading.read',
    'analytics.read',
    'dashboard.read',
  ]),
  admin: Object.freeze([
    'workspace.admin',
    'operator.admin',
    'research.read',
    'strategy.read',
    'backtest.read',
    'paperTrading.read',
    'analytics.read',
    'dashboard.read',
  ]),
  analyst: Object.freeze([
    'research.read',
    'strategy.read',
    'backtest.read',
    'paperTrading.read',
    'analytics.read',
    'dashboard.read',
  ]),
  viewer: Object.freeze([
    'analytics.read',
    'dashboard.read',
  ]),
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission)
}

export function evaluateAuthorization(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const user = input.user ?? input.session?.user ?? null
  const role = user?.role
  const requestedPermission = input.permission ?? 'dashboard.read'
  const workspaceId = input.workspaceId ?? 'atlas-paper-operator-workspace'
  const ownedWorkspaceIds = user?.metadata?.ownedWorkspaceIds ?? (role === 'owner' ? [workspaceId] : [])
  const workspaceOwnershipCheck = {
    workspaceId,
    required: requestedPermission === 'workspace.owner',
    ownsWorkspace: ownedWorkspaceIds.includes(workspaceId),
  }
  const organizationTeamBoundaryPlaceholders = {
    organizationId: input.organizationId ?? null,
    teamWorkspaceId: input.teamWorkspaceId ?? null,
    enforcementEnabled: false,
  }
  const allowedByRole = Boolean(role && hasPermission(role, requestedPermission))
  const allowedByOwnership = !workspaceOwnershipCheck.required || workspaceOwnershipCheck.ownsWorkspace
  const allowed = allowedByRole && allowedByOwnership
  const restrictedActionHandling = {
    defaultDeny: !role,
    reason: allowed ? 'permission granted' : role ? 'permission denied' : 'missing role context',
    safePublicError: allowed ? null : 'forbidden',
  }
  const authorizationDecisionAuditRecord = {
    id: `audit-authorization-${input.requestId ?? 'request'}`,
    category: 'authorization_decision',
    severity: allowed ? 'low' : 'medium',
    actor: user?.id ?? 'anonymous',
    source: input.routeId ?? 'authorization-service',
    eventType: SYSTEM_AUTHORIZATION_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    summary: `${requestedPermission} ${allowed ? 'allowed' : 'denied'} for role ${role ?? 'missing'}.`,
    eventChainReferences: [SYSTEM_AUTHORIZATION_EVALUATED_EVENT],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
  const result = {
    eventType: SYSTEM_AUTHORIZATION_EVALUATED_EVENT,
    timestamp: authorizationDecisionAuditRecord.timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    requestedPermission,
    role: role ?? null,
    allowed,
    authorizationStatus: allowed ? 'approved' : 'rejected',
    permissionEvaluation: {
      role,
      allowedPermissions: ROLE_PERMISSIONS[role] ?? [],
      requestedPermission,
      allowedByRole,
      sourceModel: 'phase22-owner-admin-analyst-viewer',
    },
    workspaceOwnershipCheck,
    organizationTeamBoundaryPlaceholders,
    restrictedActionHandling,
    authorizationDecisionAuditRecord,
    sourceEvents: {
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      authentication: input.authentication?.eventType ?? null,
      auditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      apiReliability: input.apiReliability?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AUTHORIZATION_EVALUATED_EVENT, result)
  return result
}

export function createAuthorizationService(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateAuthorization(input, { ...options, ...evaluationOptions })
    },
    assert(input, evaluationOptions = {}) {
      const decision = evaluateAuthorization(input, { ...options, ...evaluationOptions })
      if (!decision.allowed) {
        const error = new Error(decision.restrictedActionHandling.reason)
        error.code = 'forbidden'
        error.statusCode = 403
        error.publicMessage = 'forbidden'
        error.decision = decision
        throw error
      }
      return decision
    },
  }
}
