import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COLLABORATION_GOVERNANCE_EVALUATED_EVENT = 'system.collaborationGovernance.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'healthy'
}

function section(id, label, status, details = {}) {
  return { id, label, status, ...details }
}

export function evaluateCollaborationGovernance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const organizationMemberships = input.organizationMemberships ?? []
  const teamMemberships = input.teamMemberships ?? []
  const invitations = input.invitations ?? []
  const teamWorkspaces = input.teamWorkspaces ?? []
  const elevatedRoles = ['owner', 'admin']
  const organizationMembershipReviewSummary = section('organization-membership-review', 'Organization membership review summary', organizationMemberships.length > 0 ? 'healthy' : 'caution', {
    total: organizationMemberships.length,
    elevatedCount: organizationMemberships.filter((membership) => elevatedRoles.includes(membership.role)).length,
  })
  const teamMembershipReviewSummary = section('team-membership-review', 'Team membership review summary', teamMemberships.length > 0 ? 'healthy' : 'caution', {
    total: teamMemberships.length,
    elevatedCount: teamMemberships.filter((membership) => elevatedRoles.includes(membership.role)).length,
  })
  const invitationRiskSummary = section('invitation-risk', 'Invitation risk summary', invitations.some((invitation) => invitation.status === 'expired' || invitation.status === 'revoked') ? 'caution' : 'healthy', {
    pendingCount: invitations.filter((invitation) => invitation.status === 'pending').length,
    expiredCount: invitations.filter((invitation) => invitation.status === 'expired').length,
    revokedCount: invitations.filter((invitation) => invitation.status === 'revoked').length,
  })
  const inactiveSuspendedMembershipSummary = section('inactive-suspended-membership', 'Inactive/suspended membership summary', [...organizationMemberships, ...teamMemberships].some((membership) => ['suspended', 'revoked', 'inactive'].includes(membership.status)) ? 'caution' : 'healthy', {
    count: [...organizationMemberships, ...teamMemberships].filter((membership) => ['suspended', 'revoked', 'inactive'].includes(membership.status)).length,
  })
  const orphanedWorkspaceDetection = section('orphaned-workspace-detection', 'Orphaned workspace detection', teamWorkspaces.some((workspace) => !teamMemberships.some((membership) => membership.teamWorkspaceId === workspace.id && membership.status === 'active')) ? 'blocked' : 'healthy', {
    orphanedWorkspaceIds: teamWorkspaces.filter((workspace) => !teamMemberships.some((membership) => membership.teamWorkspaceId === workspace.id && membership.status === 'active')).map((workspace) => workspace.id),
  })
  const elevatedRoleReviewSummary = section('elevated-role-review', 'Elevated-role review summary', organizationMembershipReviewSummary.elevatedCount + teamMembershipReviewSummary.elevatedCount > 0 ? 'caution' : 'healthy', {
    elevatedRoleCount: organizationMembershipReviewSummary.elevatedCount + teamMembershipReviewSummary.elevatedCount,
  })
  const crossBoundaryDenialSummary = section('cross-boundary-denial', 'Cross-boundary denial summary', input.crossBoundaryDenials?.length > 0 ? 'caution' : 'healthy', {
    denialCount: input.crossBoundaryDenials?.length ?? 0,
  })
  const sections = [
    organizationMembershipReviewSummary,
    teamMembershipReviewSummary,
    invitationRiskSummary,
    inactiveSuspendedMembershipSummary,
    orphanedWorkspaceDetection,
    elevatedRoleReviewSummary,
    crossBoundaryDenialSummary,
  ]
  const governanceStatus = statusFrom(sections)
  const result = {
    eventType: SYSTEM_COLLABORATION_GOVERNANCE_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticRoleChanges: false,
    automaticMembershipRevocation: false,
    organizationMembershipReviewSummary,
    teamMembershipReviewSummary,
    invitationRiskSummary,
    inactiveSuspendedMembershipSummary,
    orphanedWorkspaceDetection,
    elevatedRoleReviewSummary,
    crossBoundaryDenialSummary,
    governanceStatus,
    summary: `Collaboration governance ${governanceStatus}: membership reviews, invitation risk, inactive access, orphaned workspaces, elevated roles, and boundary denials reviewed.`,
    sourceEvents: {
      sessionSecurity: input.sessionSecurity?.eventType ?? null,
      auditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      operatorActions: input.operatorActions?.eventType ?? null,
      systemHealth: input.systemHealth?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COLLABORATION_GOVERNANCE_EVALUATED_EVENT, result)
  return result
}
