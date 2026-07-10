import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_WORKSPACE_COLLABORATION_OPERATIONS_EVALUATED_EVENT = 'system.workspaceCollaborationOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(sections) {
  if (sections.some((section) => ['blocked', 'rejected', 'expired', 'revoked', 'missing'].includes(section.status))) return 'blocked'
  if (sections.some((section) => ['caution', 'unknown'].includes(section.status))) return 'caution'
  return 'healthy'
}

function section(id, label, status, details = {}) {
  return { id, label, status: status ?? 'unknown', ...details }
}

export function evaluateWorkspaceCollaborationOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const teamAccess = input.teamWorkspaceAccess ?? {}
  const activeCollaborators = input.activeCollaborators ?? []
  const pendingInvitations = input.pendingInvitations ?? []
  const activeCollaboratorsSummary = section('active-collaborators', 'Active collaborators summary', activeCollaborators.length > 0 ? 'healthy' : 'caution', {
    count: activeCollaborators.length,
    roles: [...new Set(activeCollaborators.map((collaborator) => collaborator.role).filter(Boolean))],
  })
  const pendingInvitationsSummary = section('pending-invitations', 'Pending invitations summary', 'healthy', {
    count: pendingInvitations.filter((invitation) => invitation.status === 'pending').length,
    expiredCount: pendingInvitations.filter((invitation) => invitation.status === 'expired').length,
    revokedCount: pendingInvitations.filter((invitation) => invitation.status === 'revoked').length,
  })
  const organizationTeamAccessHealthSummary = section('organization-team-access-health', 'Organization/team access health summary', teamAccess.accessStatus === 'approved' ? 'healthy' : teamAccess.accessStatus ?? 'unknown', {
    organizationRole: teamAccess.organizationTeamMembershipComposition?.organizationRole ?? null,
    teamRole: teamAccess.organizationTeamMembershipComposition?.teamRole ?? null,
  })
  const crossBoundaryDenialSummary = section('cross-boundary-denial', 'Cross-boundary denial summary', teamAccess.crossOrganizationAccessDenied || teamAccess.crossTeamAccessDenied ? 'blocked' : 'healthy', {
    crossOrganizationAccessDenied: teamAccess.crossOrganizationAccessDenied === true,
    crossTeamAccessDenied: teamAccess.crossTeamAccessDenied === true,
  })
  const sections = [
    activeCollaboratorsSummary,
    pendingInvitationsSummary,
    organizationTeamAccessHealthSummary,
    crossBoundaryDenialSummary,
  ]
  const operationalStatus = statusFrom(sections)
  const result = {
    eventType: SYSTEM_WORKSPACE_COLLABORATION_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    activeCollaboratorsSummary,
    pendingInvitationsSummary,
    organizationTeamAccessHealthSummary,
    crossBoundaryDenialSummary,
    operationalStatus,
    summary: `Workspace collaboration operations ${operationalStatus}: collaborators, invitations, organization/team access, and cross-boundary denials reviewed.`,
    sourceEvents: {
      teamWorkspaceAccess: teamAccess.eventType ?? null,
      teamWorkspace: input.teamWorkspaceEventType ?? null,
      teamMembership: input.teamMembershipEventType ?? null,
      invitations: input.invitationEventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_WORKSPACE_COLLABORATION_OPERATIONS_EVALUATED_EVENT, result)
  return result
}
