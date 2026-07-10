import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ACCESS_REVIEW_EVALUATED_EVENT = 'system.accessReview.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function finding(id, severity, summary, references = []) {
  return { id, severity, summary, references }
}

function reviewStatus(findings) {
  if (findings.some((item) => item.severity === 'critical')) return 'blocked'
  if (findings.some((item) => item.severity === 'caution')) return 'caution'
  return 'healthy'
}

export function evaluateAccessReview(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const organizationMemberships = input.organizationMemberships ?? []
  const teamMemberships = input.teamMemberships ?? []
  const invitations = input.invitations ?? []
  const teamWorkspaces = input.teamWorkspaces ?? []
  const sessions = input.sessions ?? input.sessionSecurity?.activeSessionListing ?? []
  const elevated = ['owner', 'admin']
  const findings = []

  if (organizationMemberships.length === 0) findings.push(finding('organization-membership-missing', 'critical', 'No organization memberships available for review.'))
  for (const membership of [...organizationMemberships, ...teamMemberships]) {
    if (['revoked', 'suspended', 'inactive'].includes(membership.status)) findings.push(finding(`inactive-access-${membership.id}`, 'caution', 'Inactive or suspended membership requires operator review.', [membership.id]))
    if (elevated.includes(membership.role)) findings.push(finding(`elevated-role-${membership.id}`, 'informational', 'Elevated owner/admin role reviewed.', [membership.id]))
  }
  for (const session of sessions) {
    if (session.status !== 'active') findings.push(finding(`stale-session-${session.id}`, 'caution', 'Non-active or stale session requires review.', [session.id]))
  }
  for (const invitation of invitations) {
    if (['pending', 'expired'].includes(invitation.status)) findings.push(finding(`invitation-${invitation.id}`, invitation.status === 'expired' ? 'caution' : 'informational', 'Pending or expired invitation reviewed.', [invitation.id]))
  }
  for (const workspace of teamWorkspaces) {
    const hasActive = teamMemberships.some((membership) => membership.teamWorkspaceId === workspace.id && membership.status === 'active')
    if (!hasActive) findings.push(finding(`orphaned-workspace-${workspace.id}`, 'critical', 'Team workspace has no active membership.', [workspace.id]))
  }

  const status = reviewStatus(findings)
  const result = {
    eventType: SYSTEM_ACCESS_REVIEW_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    reviewOnly: true,
    automaticRoleChanges: false,
    automaticMembershipRevocation: false,
    automaticSessionRevocation: false,
    organizationMembershipReview: { count: organizationMemberships.length },
    teamMembershipReview: { count: teamMemberships.length },
    elevatedRoleReview: { count: findings.filter((item) => item.id.startsWith('elevated-role')).length },
    staleSessionReview: { count: findings.filter((item) => item.id.startsWith('stale-session')).length },
    pendingExpiredInvitationReview: { count: findings.filter((item) => item.id.startsWith('invitation')).length },
    orphanedWorkspaceReview: { count: findings.filter((item) => item.id.startsWith('orphaned-workspace')).length },
    inactiveUserAccessReview: { count: findings.filter((item) => item.id.startsWith('inactive-access')).length },
    reviewFindings: findings,
    reviewStatus: status,
    summary: `Access review ${status}: ${findings.length} findings across memberships, sessions, invitations, and team workspaces.`,
    sourceEvents: {
      collaborationGovernance: input.collaborationGovernance?.eventType ?? null,
      sessionSecurity: input.sessionSecurity?.eventType ?? null,
      tenantIsolation: input.tenantIsolation?.eventType ?? null,
      auditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      operatorActions: input.operatorActions?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ACCESS_REVIEW_EVALUATED_EVENT, result)
  return result
}
