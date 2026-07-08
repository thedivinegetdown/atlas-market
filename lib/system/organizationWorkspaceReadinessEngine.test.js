import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT,
  createOrganizationWorkspaceReadinessEngine,
  evaluateOrganizationWorkspaceReadiness,
} from './organizationWorkspaceReadinessEngine.js'

const baseInput = {
  authReadiness: { eventType: 'system.authReadiness.evaluated', authReadinessStatus: 'ready' },
  permissionPlanning: { eventType: 'system.permissionPlanning.evaluated', permissionReadinessStatus: 'ready' },
  multiUserWorkspacePlanning: {
    eventType: 'system.multiUserWorkspacePlanning.evaluated',
    multiUserReadinessStatus: 'ready',
    futureOrganizationModelPlaceholder: { organizationId: 'atlas-org', organizationName: 'Atlas Organization' },
    futureTeamWorkspaceModelPlaceholder: { teamWorkspaceId: 'atlas-team', modelStatus: 'placeholder' },
    workspaceOwnershipPlanning: { plannedOwnerRole: 'owner', ownerMemberships: ['owner-1'] },
    sharedWorkspaceAccessPlanning: { plannedSharedRoles: ['owner', 'admin', 'analyst', 'viewer'] },
  },
  workspacePersistence: {
    eventType: 'workspace.persistence.prepared',
    persistenceStatus: 'prepared',
    localPersistenceAdapter: { adapterType: 'local-storage' },
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
    normalizedAuditRecords: [{ id: 'audit-1' }],
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  },
}

describe('organization workspace readiness engine', () => {
  it('prepares a ready organization workspace planning contract', () => {
    const result = evaluateOrganizationWorkspaceReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T22:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT)
    expect(result.organizationReadinessStatus).toBe('ready')
    expect(result.organizationProfilePlaceholder.organizationId).toBe('atlas-org')
    expect(result.workspaceOwnershipReadiness.plannedOwnerRole).toBe('owner')
    expect(result.teamWorkspaceReadiness.plannedSharedRoles).toContain('analyst')
    expect(result.roleAndPermissionDependencySummary.permissionsEnforced).toBe(false)
    expect(result.persistenceDependencySummary.multiUserPersistenceEnabled).toBe(false)
    expect(result.realOrganizationsEnabled).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('returns caution when an enterprise dependency needs review', () => {
    const result = evaluateOrganizationWorkspaceReadiness({
      ...baseInput,
      enterpriseReleaseControl: { ...baseInput.enterpriseReleaseControl, finalReleaseStatus: 'caution' },
    }, { emitEvent: false })

    expect(result.organizationReadinessStatus).toBe('caution')
    expect(result.releaseControlDependencySummary.releaseControlStatus).toBe('caution')
  })

  it('blocks readiness when permission planning or audit integrity is blocked', () => {
    const result = evaluateOrganizationWorkspaceReadiness({
      ...baseInput,
      permissionPlanning: { ...baseInput.permissionPlanning, permissionReadinessStatus: 'blocked' },
      enterpriseAuditTrail: {
        ...baseInput.enterpriseAuditTrail,
        auditIntegrityStatus: { status: 'invalid' },
      },
    }, { emitEvent: false })

    expect(result.organizationReadinessStatus).toBe('blocked')
    expect(result.permissionEnforcementEnabled).toBe(false)
  })

  it('emits organization workspace readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createOrganizationWorkspaceReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
