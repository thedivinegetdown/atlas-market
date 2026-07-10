import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_TENANT_OPERATIONS_EVALUATED_EVENT = 'system.tenantOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'degraded', 'invalid', 'critical', 'failed'].includes(status)) return 'blocked'
  if (['healthy', 'ready', 'valid', 'complete', 'recorded'].includes(status)) return 'healthy'
  return 'caution'
}

function section(id, label, status, details = {}) {
  return { id, label, status: normalizeStatus(status), sourceStatus: status ?? 'unknown', ...details }
}

function operationalStatus(sections) {
  if (sections.some((item) => item.status === 'blocked')) return 'blocked'
  if (sections.some((item) => item.status === 'caution')) return 'caution'
  return 'healthy'
}

export function evaluateTenantOperationsHealth(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantIsolation = input.tenantIsolation ?? {}
  const collaborationGovernance = input.collaborationGovernance ?? {}
  const accessReview = input.accessReview ?? {}
  const sessionSecurity = input.sessionSecurity ?? {}
  const eventObservability = input.eventObservability ?? {}
  const enterpriseAuditTrail = input.enterpriseAuditTrail ?? input.administrativeAudit ?? {}
  const tenantPersistenceHealthSummary = section('tenant-persistence-health', 'Tenant persistence health summary', tenantIsolation.tenantIsolationStatus, {
    tenantContext: tenantIsolation.tenantContext ?? input.tenantContext ?? null,
    scopedRepositoryHelpers: true,
  })
  const organizationMembershipHealth = section('organization-membership-health', 'Organization membership health', accessReview.organizationMembershipReview?.count > 0 ? 'healthy' : 'caution', {
    count: accessReview.organizationMembershipReview?.count ?? 0,
  })
  const teamWorkspaceMembershipHealth = section('team-workspace-membership-health', 'Team workspace membership health', accessReview.teamMembershipReview?.count > 0 ? 'healthy' : 'caution', {
    count: accessReview.teamMembershipReview?.count ?? 0,
  })
  const sessionHealth = section('session-health', 'Session health', sessionSecurity.securityStatus, {
    activeSessions: sessionSecurity.activeSessionListing?.length ?? 0,
    suspiciousSessions: sessionSecurity.suspiciousSessionSummary?.count ?? 0,
  })
  const invitationHealth = section('invitation-health', 'Invitation health', collaborationGovernance.invitationRiskSummary?.status, {
    pendingCount: collaborationGovernance.invitationRiskSummary?.pendingCount ?? accessReview.pendingExpiredInvitationReview?.count ?? 0,
  })
  const tenantScopedEventHealth = section('tenant-scoped-event-health', 'Tenant-scoped event health', eventObservability.observabilityStatus, {
    uniqueEventTypes: eventObservability.eventCatalogSummary?.uniqueEventTypes ?? 0,
  })
  const tenantScopedAuditHealth = section('tenant-scoped-audit-health', 'Tenant-scoped audit health', enterpriseAuditTrail.auditIntegrityStatus?.status ?? enterpriseAuditTrail.status, {
    auditRecordCount: enterpriseAuditTrail.normalizedAuditRecords?.length ?? 0,
  })
  const tenantBoundaryViolationSummary = section(
    'tenant-boundary-violation-summary',
    'Tenant boundary violation summary',
    tenantIsolation.crossOrganizationDenied || tenantIsolation.crossTeamDenied || collaborationGovernance.crossBoundaryDenialSummary?.denialCount > 0 ? 'blocked' : 'healthy',
    {
      crossOrganizationDenied: tenantIsolation.crossOrganizationDenied === true,
      crossTeamDenied: tenantIsolation.crossTeamDenied === true,
      governanceDenialCount: collaborationGovernance.crossBoundaryDenialSummary?.denialCount ?? 0,
    },
  )
  const sections = [
    tenantPersistenceHealthSummary,
    organizationMembershipHealth,
    teamWorkspaceMembershipHealth,
    sessionHealth,
    invitationHealth,
    tenantScopedEventHealth,
    tenantScopedAuditHealth,
    tenantBoundaryViolationSummary,
  ]
  const status = operationalStatus(sections)
  const result = {
    eventType: SYSTEM_TENANT_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    readOnlyEvaluation: true,
    tenantPersistenceHealthSummary,
    organizationMembershipHealth,
    teamWorkspaceMembershipHealth,
    sessionHealth,
    invitationHealth,
    tenantScopedEventHealth,
    tenantScopedAuditHealth,
    tenantBoundaryViolationSummary,
    operationalStatus: status,
    summary: `Tenant operations ${status}: persistence, membership, session, invitation, event, audit, and tenant-boundary health reviewed.`,
    sourceEvents: {
      tenantIsolation: tenantIsolation.eventType ?? null,
      sessionSecurity: sessionSecurity.eventType ?? null,
      collaborationGovernance: collaborationGovernance.eventType ?? null,
      accessReview: accessReview.eventType ?? null,
      eventObservability: eventObservability.eventType ?? null,
      enterpriseAuditTrail: enterpriseAuditTrail.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TENANT_OPERATIONS_EVALUATED_EVENT, result)
  return result
}
