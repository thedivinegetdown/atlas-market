import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_IDENTITY_ORGANIZATION_OPERATIONS_EVALUATED_EVENT = 'system.identityOrganizationOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFromSections(sections) {
  if (sections.some((section) => ['blocked', 'rejected', 'revoked', 'expired', 'missing'].includes(section.status))) return 'blocked'
  if (sections.some((section) => ['caution', 'partial', 'unknown'].includes(section.status))) return 'caution'
  return 'healthy'
}

function section(id, label, status, details = {}) {
  return { id, label, status: status ?? 'unknown', ...details }
}

export function evaluateIdentityOrganizationOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const user = input.userIdentity ?? input.authenticatedUser ?? {}
  const organization = input.organization ?? {}
  const membership = input.membership ?? {}
  const workspaceAccess = input.organizationWorkspaceAccess ?? {}
  const authenticatedUserSummary = section('authenticated-user', 'Authenticated user summary', user.id ? 'healthy' : 'missing', {
    userId: user.id ?? null,
    role: user.role ?? null,
    provider: user.provider ?? null,
  })
  const activeOrganizationSummary = section('active-organization', 'Active organization summary', organization.id ? organization.status ?? 'healthy' : 'missing', {
    organizationId: organization.id ?? null,
    name: organization.name ?? null,
    billingEnabled: false,
  })
  const membershipSummary = section('membership', 'Membership summary', membership.status === 'active' ? 'healthy' : membership.status ?? 'missing', {
    membershipId: membership.id ?? null,
    role: membership.role ?? null,
    finalOwnerProtected: input.membershipUpdate?.ownershipProtection?.finalOwnerProtected === true,
  })
  const authorizationHealthSummary = section('authorization-health', 'Authorization health summary', input.authorization?.authorizationStatus === 'approved' ? 'healthy' : input.authorization?.authorizationStatus ?? 'unknown', {
    defaultDeny: true,
    sourceEvent: input.authorization?.eventType ?? null,
  })
  const sessionHealthSummary = section('session-health', 'Session health summary', input.session?.status === 'active' ? 'healthy' : input.session?.status ?? 'unknown', {
    sessionId: input.session?.id ?? null,
    expiresAt: input.session?.expiresAt ?? null,
    revocationAware: true,
  })
  const protectedWorkspaceAccessSummary = section('protected-workspace-access', 'Protected workspace access summary', workspaceAccess.accessStatus === 'approved' ? 'healthy' : workspaceAccess.accessStatus ?? 'unknown', {
    workspaceId: workspaceAccess.workspace?.id ?? null,
    organizationId: workspaceAccess.workspace?.organizationId ?? null,
    crossOrganizationAccessDenied: workspaceAccess.crossOrganizationAccessDenied === true,
  })
  const sections = [
    authenticatedUserSummary,
    activeOrganizationSummary,
    membershipSummary,
    authorizationHealthSummary,
    sessionHealthSummary,
    protectedWorkspaceAccessSummary,
  ]
  const operationalStatus = statusFromSections(sections)
  const result = {
    eventType: SYSTEM_IDENTITY_ORGANIZATION_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    authenticatedUserSummary,
    activeOrganizationSummary,
    membershipSummary,
    authorizationHealthSummary,
    sessionHealthSummary,
    protectedWorkspaceAccessSummary,
    operationalStatus,
    summary: `Identity and organization operations ${operationalStatus}: user, organization, membership, session, authorization, and protected workspace access reviewed.`,
    sourceEvents: {
      organization: input.organizationEventType ?? null,
      membership: input.membershipEventType ?? null,
      authorization: input.authorization?.eventType ?? null,
      workspaceAccess: workspaceAccess.eventType ?? null,
      session: input.sessionEventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_IDENTITY_ORGANIZATION_OPERATIONS_EVALUATED_EVENT, result)
  return result
}
