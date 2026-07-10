import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_TENANT_ADMINISTRATION_OPERATIONS_EVALUATED_EVENT = 'system.tenantAdministrationOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(sections) {
  if (sections.some((section) => ['blocked', 'degraded', 'critical'].includes(section.status))) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'healthy'
}

function section(id, label, status, details = {}) {
  return { id, label, status: status ?? 'healthy', ...details }
}

export function evaluateTenantAdministrationOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const organizationSummary = section('organization-summary', 'Organization summary', input.organization?.status ?? 'healthy', {
    organizationId: input.tenantContext?.organizationId ?? input.organization?.id ?? null,
    name: input.organization?.name ?? 'Atlas Local Organization',
  })
  const teamWorkspaceSummary = section('team-workspace-summary', 'Team workspace summary', input.teamWorkspace?.status ?? 'healthy', {
    teamWorkspaceId: input.tenantContext?.teamWorkspaceId ?? input.teamWorkspace?.id ?? null,
    name: input.teamWorkspace?.name ?? 'Atlas Research Desk',
  })
  const membershipSummary = section('membership-summary', 'Membership summary', input.accessReview?.organizationMembershipReview?.count > 0 ? 'healthy' : 'caution', {
    organizationMemberships: input.accessReview?.organizationMembershipReview?.count ?? 0,
    teamMemberships: input.accessReview?.teamMembershipReview?.count ?? 0,
  })
  const invitationSummary = section('invitation-summary', 'Invitation summary', input.collaborationGovernance?.invitationRiskSummary?.status ?? 'healthy', {
    pendingCount: input.collaborationGovernance?.invitationRiskSummary?.pendingCount ?? 0,
  })
  const sessionSecuritySummary = section('session-security-summary', 'Session security summary', input.sessionSecurity?.securityStatus ?? 'healthy', {
    activeSessions: input.sessionSecurity?.activeSessionListing?.length ?? 0,
  })
  const tenantHealthSummary = section('tenant-health-summary', 'Tenant health summary', input.tenantOperationsHealth?.operationalStatus ?? 'healthy')
  const accessReviewCertificationSummary = section('access-review-certification-summary', 'Access review/certification summary', input.accessCertification?.certificationStatus === 'blocked' ? 'blocked' : input.accessReview?.reviewStatus ?? 'healthy', {
    accessReviewStatus: input.accessReview?.reviewStatus ?? null,
    certificationStatus: input.accessCertification?.certificationStatus ?? null,
  })
  const administrativeAuditSummary = section('administrative-audit-summary', 'Administrative audit summary', input.administrativeAudit?.status ?? 'recorded', {
    eventType: input.administrativeAudit?.eventType ?? null,
  })
  const sections = [
    organizationSummary,
    teamWorkspaceSummary,
    membershipSummary,
    invitationSummary,
    sessionSecuritySummary,
    tenantHealthSummary,
    accessReviewCertificationSummary,
    administrativeAuditSummary,
  ]
  const operationalStatus = statusFrom(sections)
  const result = {
    eventType: SYSTEM_TENANT_ADMINISTRATION_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    destructiveDashboardActions: false,
    organizationSummary,
    teamWorkspaceSummary,
    membershipSummary,
    invitationSummary,
    sessionSecuritySummary,
    tenantHealthSummary,
    accessReviewCertificationSummary,
    administrativeAuditSummary,
    accountProfileSummary: input.accountProfileSummary ?? null,
    notificationPreferenceSummary: input.notificationPreferenceSummary ?? null,
    rolePermissionSummary: input.rolePermissionSummary ?? null,
    activeSessionSummary: input.activeSessionSummary ?? null,
    pendingInvitationSummary: input.pendingInvitationSummary ?? null,
    accessCertificationSummary: input.accessCertification ?? null,
    operationalStatus,
    summary: `Tenant administration operations ${operationalStatus}: account, notification, organization, team, access, session, invitation, audit, and tenant health summaries reviewed.`,
    sourceEvents: {
      userAccount: input.userAccount?.eventType ?? null,
      notificationPreferences: input.notificationPreferences?.eventType ?? null,
      tenantOperationsHealth: input.tenantOperationsHealth?.eventType ?? null,
      accessCertification: input.accessCertification?.eventType ?? null,
      accessReview: input.accessReview?.eventType ?? null,
      collaborationGovernance: input.collaborationGovernance?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TENANT_ADMINISTRATION_OPERATIONS_EVALUATED_EVENT, result)
  return result
}
