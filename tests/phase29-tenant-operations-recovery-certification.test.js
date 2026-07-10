import { describe, expect, it, vi } from 'vitest'
import { evaluateTenantIsolation } from '../lib/auth/tenantIsolation.js'
import { evaluateSessionSecurity } from '../lib/auth/sessionSecurityService.js'
import { evaluateCollaborationGovernance } from '../lib/system/collaborationGovernanceEngine.js'
import { evaluateAccessReview } from '../lib/system/accessReviewEngine.js'
import {
  SYSTEM_TENANT_OPERATIONS_EVALUATED_EVENT,
  evaluateTenantOperationsHealth,
} from '../lib/system/tenantOperationsHealthEngine.js'
import {
  SYSTEM_TENANT_BACKUP_RECOVERY_PLANNED_EVENT,
  planTenantBackupRecovery,
} from '../lib/system/tenantBackupRecoveryPlanningEngine.js'
import {
  SYSTEM_ACCESS_CERTIFICATION_EVALUATED_EVENT,
  evaluateAccessCertification,
} from '../lib/system/accessCertificationEngine.js'
import { createTenantOperationsHealthHandler } from '../netlify/functions/tenant-operations-health.js'
import { createTenantBackupRecoveryPlanHandler } from '../netlify/functions/tenant-backup-recovery-plan.js'
import { createAccessCertificationHandler } from '../netlify/functions/access-certification.js'

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, query = {}, role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase29-def',
      'x-atlas-dev-role': role,
    },
    queryStringParameters: query,
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function createMockPersistenceRepository() {
  return {
    getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []), upsertScoped: vi.fn(async () => ({ ok: true })) })),
    end: vi.fn(async () => {}),
  }
}

const tenantContext = {
  organizationId: 'org-1',
  teamWorkspaceId: 'team-1',
  userId: 'local-development:local-operator',
  role: 'owner',
}

const organizationMembership = {
  id: 'membership-owner',
  organizationId: 'org-1',
  userId: 'local-development:local-operator',
  role: 'owner',
  status: 'active',
}

const teamMembership = {
  id: 'team-membership-owner',
  organizationId: 'org-1',
  teamWorkspaceId: 'team-1',
  userId: 'local-development:local-operator',
  role: 'owner',
  status: 'active',
}

function createBaseInputs() {
  const tenantIsolation = evaluateTenantIsolation(tenantContext, { emitEvent: false })
  const sessionSecurity = evaluateSessionSecurity({
    user: { id: tenantContext.userId },
    sessions: [{ id: 'session-1', status: 'active', lastSeenAt: '2026-07-10T12:00:00.000Z', expiresAt: '2026-07-10T13:00:00.000Z' }],
  }, { emitEvent: false, now: () => new Date('2026-07-10T12:05:00.000Z') })
  const collaborationGovernance = evaluateCollaborationGovernance({
    organizationMemberships: [organizationMembership],
    teamMemberships: [teamMembership],
    invitations: [{ id: 'invite-1', status: 'pending' }],
    teamWorkspaces: [{ id: 'team-1' }],
    crossBoundaryDenials: [],
  }, { emitEvent: false })
  const accessReview = evaluateAccessReview({
    organizationMemberships: [organizationMembership],
    teamMemberships: [teamMembership],
    invitations: [{ id: 'invite-1', status: 'pending' }],
    teamWorkspaces: [{ id: 'team-1' }],
    sessionSecurity,
    collaborationGovernance,
    tenantIsolation,
  }, { emitEvent: false })
  return { tenantIsolation, sessionSecurity, collaborationGovernance, accessReview }
}

function routeOptions(role = 'owner', overrides = {}) {
  const base = createBaseInputs()
  return {
    repositoryFactory: () => createMockPersistenceRepository(),
    organizationMembershipRepository: {
      getMembership: vi.fn(async () => ({ ...organizationMembership, role })),
    },
    ...base,
    eventObservability: { eventType: 'system.events.observed', observabilityStatus: 'healthy', eventCatalogSummary: { uniqueEventTypes: 10 } },
    enterpriseAuditTrail: { eventType: 'system.auditTrail.recorded', auditIntegrityStatus: { status: 'valid' }, normalizedAuditRecords: [] },
    dataRetention: { eventType: 'system.dataRetention.planned', retentionReadinessStatus: 'ready' },
    dataLineage: { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' },
    persistenceApiIntegration: { eventType: 'system.persistenceApiIntegration.evaluated', persistenceReadinessStatus: 'ready' },
    productionOperationsRunbook: { eventType: 'system.operationsRunbook.generated', operatorHandoffSummary: { handoffStatus: 'ready' } },
    organizationMemberships: [organizationMembership],
    teamMemberships: [teamMembership],
    sessions: [{ id: 'session-1', status: 'active' }],
    invitations: [{ id: 'invite-1', status: 'pending' }],
    env: { TRADING_MODE: 'paper' },
    ...overrides,
  }
}

describe('Phase 29D tenant operations health engine', () => {
  it('summarizes tenant operations health without duplicating source calculations', () => {
    const base = createBaseInputs()
    const result = evaluateTenantOperationsHealth({
      ...base,
      eventObservability: { eventType: 'system.events.observed', observabilityStatus: 'healthy', eventCatalogSummary: { uniqueEventTypes: 6 } },
      enterpriseAuditTrail: { eventType: 'system.auditTrail.recorded', auditIntegrityStatus: { status: 'valid' }, normalizedAuditRecords: [] },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_TENANT_OPERATIONS_EVALUATED_EVENT)
    expect(result.operationalStatus).toBe('healthy')
    expect(result.readOnlyEvaluation).toBe(true)
    expect(result.tenantBoundaryViolationSummary.status).toBe('healthy')
  })

  it('serves tenant operations health only to owner/admin roles', async () => {
    const owner = parseResponse(await createTenantOperationsHealthHandler(routeOptions('owner'))(authEvent('GET', {}, { organizationId: 'org-1' })))
    const analyst = parseResponse(await createTenantOperationsHealthHandler(routeOptions('analyst'))(authEvent('GET', {}, { organizationId: 'org-1' }, 'analyst')))

    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.tokenHashesExposed).toBe(false)
    expect(owner.json.data.invitationHashesExposed).toBe(false)
    expect(analyst.statusCode).toBe(403)
  })
})

describe('Phase 29E tenant backup and recovery planning engine', () => {
  it('plans backup scopes and recovery ordering without backup, restore, dump, or mutation', () => {
    const base = createBaseInputs()
    const result = planTenantBackupRecovery({
      tenantIsolation: base.tenantIsolation,
      dataRetention: { eventType: 'system.dataRetention.planned', retentionReadinessStatus: 'ready' },
      dataLineage: { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' },
      persistenceApiIntegration: { eventType: 'system.persistenceApiIntegration.evaluated', persistenceReadinessStatus: 'ready' },
      productionOperationsRunbook: { eventType: 'system.operationsRunbook.generated', operatorHandoffSummary: { handoffStatus: 'ready' } },
      eventObservability: { eventType: 'system.events.observed', observabilityStatus: 'healthy' },
      operatorActions: { eventType: 'system.operatorActions.generated' },
      enterpriseAuditTrail: { eventType: 'system.auditTrail.recorded', auditIntegrityStatus: { status: 'valid' } },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_TENANT_BACKUP_RECOVERY_PLANNED_EVENT)
    expect(result.backupReadinessStatus).toBe('ready')
    expect(result.recoveryReadinessStatus).toBe('ready')
    expect(result.realBackupPerformed).toBe(false)
    expect(result.restorePerformed).toBe(false)
    expect(result.dataMutated).toBe(false)
    expect(result.credentialsIncluded).toBe(false)
  })

  it('serves backup recovery planning only to owner/admin roles', async () => {
    const admin = parseResponse(await createTenantBackupRecoveryPlanHandler(routeOptions('admin'))(authEvent('GET', {}, { organizationId: 'org-1' }, 'admin')))
    const viewer = parseResponse(await createTenantBackupRecoveryPlanHandler(routeOptions('viewer'))(authEvent('GET', {}, { organizationId: 'org-1' }, 'viewer')))

    expect(admin.statusCode).toBe(200)
    expect(admin.json.data.realBackupPerformed).toBe(false)
    expect(admin.json.data.restorePerformed).toBe(false)
    expect(admin.json.data.credentialsIncluded).toBe(false)
    expect(viewer.statusCode).toBe(403)
  })
})

describe('Phase 29F access certification engine', () => {
  it('certifies access from access review findings without automatic mutations', () => {
    const base = createBaseInputs()
    const result = evaluateAccessCertification({
      ...base,
      organizationMemberships: [organizationMembership],
      teamMemberships: [teamMembership],
      sessions: [{ id: 'session-1', status: 'active' }],
      invitations: [{ id: 'invite-1', status: 'pending' }],
      operatorActions: { eventType: 'system.operatorActions.generated' },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_ACCESS_CERTIFICATION_EVALUATED_EVENT)
    expect(['approve', 'review', 'revoke-recommended']).toContain(result.certificationDecision)
    expect(['complete', 'caution', 'blocked']).toContain(result.certificationStatus)
    expect(result.automaticAccessRevocation).toBe(false)
    expect(result.automaticRoleChanges).toBe(false)
    expect(result.automaticSessionRevocation).toBe(false)
  })

  it('serves access certification only to owner/admin roles and keeps responses safe', async () => {
    const owner = parseResponse(await createAccessCertificationHandler(routeOptions('owner'))(authEvent('GET', {}, { organizationId: 'org-1' })))
    const analyst = parseResponse(await createAccessCertificationHandler(routeOptions('analyst'))(authEvent('GET', {}, { organizationId: 'org-1' }, 'analyst')))

    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.automaticAccessRevocation).toBe(false)
    expect(owner.json.data.automaticRoleChanges).toBe(false)
    expect(owner.json.data.tokenHashesExposed).toBe(false)
    expect(owner.json.data.invitationHashesExposed).toBe(false)
    expect(JSON.stringify(owner.json)).not.toContain('sensitive-session-value')
    expect(JSON.stringify(owner.json)).not.toContain('sensitive-invite-value')
    expect(analyst.statusCode).toBe(403)
  })
})
