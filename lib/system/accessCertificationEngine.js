import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ACCESS_CERTIFICATION_EVALUATED_EVENT = 'system.accessCertification.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function certificationStatus(decision) {
  if (decision === 'revoke-recommended') return 'blocked'
  if (decision === 'review') return 'caution'
  return 'complete'
}

function decisionFromFindings(findings = []) {
  if (findings.some((finding) => finding.severity === 'critical')) return 'revoke-recommended'
  if (findings.some((finding) => finding.severity === 'caution')) return 'review'
  return 'approve'
}

export function evaluateAccessCertification(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const accessReview = input.accessReview ?? {}
  const organizationMemberships = input.organizationMemberships ?? []
  const teamMemberships = input.teamMemberships ?? []
  const sessions = input.sessions ?? input.sessionSecurity?.activeSessionListing ?? []
  const invitations = input.invitations ?? []
  const periodStart = options.periodStart ?? input.periodStart ?? '2026-07-01'
  const periodEnd = options.periodEnd ?? input.periodEnd ?? '2026-07-31'
  const elevatedRoles = ['owner', 'admin']
  const findings = accessReview.reviewFindings ?? []
  const certificationDecision = decisionFromFindings(findings)
  const status = certificationStatus(certificationDecision)
  const result = {
    eventType: SYSTEM_ACCESS_CERTIFICATION_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    reviewOnly: true,
    automaticAccessRevocation: false,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    certificationPeriodModel: {
      periodStart,
      periodEnd,
      reviewerRoles: ['owner', 'admin'],
      ownerAdminReviewBoundary: true,
    },
    certifiableOrganizationMemberships: organizationMemberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
    })),
    certifiableTeamMemberships: teamMemberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      teamWorkspaceId: membership.teamWorkspaceId,
      role: membership.role,
      status: membership.status,
    })),
    elevatedRoleCertifications: [...organizationMemberships, ...teamMemberships].filter((membership) => elevatedRoles.includes(membership.role)).map((membership) => membership.id),
    inactiveAccessCertifications: [...organizationMemberships, ...teamMemberships].filter((membership) => ['inactive', 'suspended', 'revoked'].includes(membership.status)).map((membership) => membership.id),
    staleSessionCertificationSummary: {
      staleSessionIds: sessions.filter((session) => session.status !== 'active').map((session) => session.id),
      count: sessions.filter((session) => session.status !== 'active').length,
    },
    pendingInvitationCertificationSummary: {
      invitationIds: invitations.filter((invitation) => ['pending', 'expired'].includes(invitation.status)).map((invitation) => invitation.id),
      count: invitations.filter((invitation) => ['pending', 'expired'].includes(invitation.status)).length,
    },
    certificationDecision,
    certificationStatus: status,
    summary: `Access certification ${status}: decision ${certificationDecision} for ${organizationMemberships.length + teamMemberships.length} memberships and ${findings.length} review findings.`,
    sourceEvents: {
      accessReview: accessReview.eventType ?? null,
      administrativeAudit: input.administrativeAudit?.eventType ?? null,
      collaborationGovernance: input.collaborationGovernance?.eventType ?? null,
      sessionSecurity: input.sessionSecurity?.eventType ?? null,
      operatorActions: input.operatorActions?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ACCESS_CERTIFICATION_EVALUATED_EVENT, result)
  return result
}
