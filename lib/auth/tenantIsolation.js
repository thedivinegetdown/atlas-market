import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT = 'system.tenantIsolation.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normalizeTenantContext(input = {}) {
  return {
    organizationId: input.organizationId ?? input.organizationMembership?.organizationId ?? input.membership?.organizationId ?? null,
    teamWorkspaceId: input.teamWorkspaceId ?? input.teamWorkspace?.id ?? input.teamMembership?.teamWorkspaceId ?? null,
    userId: input.userId ?? input.user?.id ?? input.organizationMembership?.userId ?? input.membership?.userId ?? null,
    role: input.role ?? input.organizationMembership?.role ?? input.membership?.role ?? input.user?.role ?? 'viewer',
  }
}

export function resolveTenantContext(input = {}, options = {}) {
  const context = normalizeTenantContext(input)
  const required = options.requireTeam === true
    ? ['organizationId', 'teamWorkspaceId', 'userId', 'role']
    : ['organizationId', 'userId', 'role']
  const missing = required.filter((key) => !context[key])
  const crossOrganizationDenied = Boolean(input.requestedOrganizationId && context.organizationId && input.requestedOrganizationId !== context.organizationId)
  const crossTeamDenied = Boolean(input.requestedTeamWorkspaceId && context.teamWorkspaceId && input.requestedTeamWorkspaceId !== context.teamWorkspaceId)
  const allowed = missing.length === 0 && !crossOrganizationDenied && !crossTeamDenied
  return {
    tenantContext: context,
    allowed,
    missing,
    crossOrganizationDenied,
    crossTeamDenied,
    reason: allowed ? 'tenant context resolved' : missing.length > 0 ? 'tenant context is required' : 'cross-tenant access denied',
  }
}

export function assertTenantScope(input = {}, options = {}) {
  const resolved = resolveTenantContext(input, options)
  if (!resolved.allowed) {
    const error = new Error(resolved.reason)
    error.code = resolved.missing.length > 0 ? 'tenant_context_required' : 'cross_tenant_access_denied'
    error.statusCode = 403
    error.publicMessage = resolved.reason
    error.tenantIsolation = resolved
    throw error
  }
  return resolved.tenantContext
}

export function buildTenantCriteria(tenantContext = {}) {
  return {
    organizationId: tenantContext.organizationId,
    teamWorkspaceId: tenantContext.teamWorkspaceId ?? null,
    userId: tenantContext.userId,
    role: tenantContext.role,
    parameterized: true,
  }
}

export async function upsertTenantWorkspaceConfiguration(repository, id, payload, tenantContext) {
  assertTenantScope(tenantContext, { requireTeam: Boolean(tenantContext.teamWorkspaceId) })
  return repository.getStore('workspaceConfigurations')?.upsertScoped?.(id, payload, tenantContext)
}

export async function listTenantSystemEvents(repository, tenantContext, query = {}) {
  assertTenantScope(tenantContext, { requireTeam: Boolean(tenantContext.teamWorkspaceId) })
  return repository.getStore('systemEvents')?.listScoped?.({ limit: query.limit, ...tenantContext }) ?? []
}

export async function listTenantOperatorActions(repository, tenantContext, query = {}) {
  assertTenantScope(tenantContext, { requireTeam: Boolean(tenantContext.teamWorkspaceId) })
  return repository.getStore('operatorActions')?.listScoped?.({ limit: query.limit, ...tenantContext }) ?? []
}

function createAuditRecord(tenantContext, status, timestamp) {
  return {
    id: `audit-tenant-boundary-${tenantContext.organizationId ?? 'missing'}-${tenantContext.teamWorkspaceId ?? 'org'}`,
    category: 'tenant_boundary',
    severity: status === 'blocked' ? 'critical' : 'low',
    actor: tenantContext.userId ?? 'unknown-user',
    source: 'tenant-isolation',
    eventType: SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT,
    timestamp,
    summary: `Tenant isolation ${status} for organization ${tenantContext.organizationId ?? 'missing'}.`,
    eventChainReferences: [SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export function evaluateTenantIsolation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const resolved = resolveTenantContext(input, { requireTeam: input.requireTeam === true })
  const tenantIsolationStatus = resolved.allowed ? 'healthy' : 'blocked'
  const tenantContext = resolved.tenantContext
  const result = {
    eventType: SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    tenantContext,
    repositoryScopeEnforcement: {
      defaultDenyWithoutTenant: true,
      parameterizedQueriesRequired: true,
      clientProvidedIdsOnly: false,
    },
    tenantAwareQueryCriteria: buildTenantCriteria(tenantContext),
    tenantAwareWorkspaceConfigurationPersistence: 'workspaceConfigurations.upsertScoped',
    tenantAwareSystemEventReads: 'systemEvents.listScoped',
    tenantAwareOperatorActionReads: 'operatorActions.listScoped',
    tenantBoundaryAuditRecords: [createAuditRecord(tenantContext, tenantIsolationStatus, timestamp)],
    crossOrganizationDenied: resolved.crossOrganizationDenied,
    crossTeamDenied: resolved.crossTeamDenied,
    missingTenantContext: resolved.missing,
    tenantIsolationStatus,
    summary: `Tenant isolation ${tenantIsolationStatus}: organization, team workspace, user, and role context reviewed before scoped persistence access.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT, result)
  return result
}
