import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT,
  createMultiUserWorkspacePlanningEngine,
  evaluateMultiUserWorkspacePlanning,
} from './multiUserWorkspacePlanningEngine.js'

const baseInput = Object.freeze({
  authReadiness: Object.freeze({
    eventType: 'system.authReadiness.evaluated',
    authReadinessStatus: 'ready',
    roleModelPlaceholder: Object.freeze([
      Object.freeze({ role: 'owner' }),
      Object.freeze({ role: 'admin' }),
      Object.freeze({ role: 'analyst' }),
      Object.freeze({ role: 'viewer' }),
    ]),
  }),
  permissionPlanning: Object.freeze({
    eventType: 'system.permissionPlanning.evaluated',
    permissionReadinessStatus: 'ready',
    roleCapabilityMap: Object.freeze([
      Object.freeze({ role: 'owner' }),
      Object.freeze({ role: 'admin' }),
      Object.freeze({ role: 'analyst' }),
      Object.freeze({ role: 'viewer' }),
    ]),
    workspaceAccessPlanning: Object.freeze({ plannedRoles: Object.freeze(['owner', 'admin', 'analyst', 'viewer']) }),
    releaseControlAccessPlanning: Object.freeze({ plannedRoles: Object.freeze(['owner', 'admin', 'viewer']) }),
  }),
  workspacePersistence: Object.freeze({
    eventType: 'workspace.persistence.prepared',
    workspacePersistenceModel: Object.freeze({ workspaceId: 'atlas-paper-workspace' }),
  }),
  enterpriseAuditTrail: Object.freeze({
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: Object.freeze({ status: 'valid' }),
    normalizedAuditRecords: Object.freeze([Object.freeze({ id: 'audit-system-health' })]),
  }),
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  }),
  enterpriseReleaseControl: Object.freeze({
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  }),
})

describe('multi-user workspace planning engine', () => {
  it('builds ready future multi-user workspace placeholders', () => {
    const result = evaluateMultiUserWorkspacePlanning(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T21:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerageIntegration).toBe(false)
    expect(result.realAuthenticationEnabled).toBe(false)
    expect(result.realMultiUserAccountsEnabled).toBe(false)
    expect(result.permissionEnforcementEnabled).toBe(false)
    expect(result.multiUserReadinessStatus).toBe('ready')
    expect(result.futureOrganizationModelPlaceholder.modelStatus).toBe('placeholder')
    expect(result.futureTeamWorkspaceModelPlaceholder.teamWorkspaceId).toBe('atlas-paper-workspace')
    expect(result.userMembershipModelPlaceholder.map((membership) => membership.role)).toEqual(['owner', 'admin', 'analyst', 'viewer'])
    expect(result.workspaceOwnershipPlanning.plannedOwnerRole).toBe('owner')
    expect(result.sharedWorkspaceAccessPlanning.workspaceAccessRoles).toContain('analyst')
    expect(result.collaborationBoundarySummary.deniedCollaborationActions).toContain('user.invite')
    expect(result.auditAndPermissionDependencySummary.dependenciesReady).toBe(true)
    expect(result.sourceEvents.permissionPlanning).toBe('system.permissionPlanning.evaluated')
  })

  it('returns caution when audit or release dependencies are not ready', () => {
    const result = evaluateMultiUserWorkspacePlanning({
      ...baseInput,
      enterpriseAuditTrail: {
        ...baseInput.enterpriseAuditTrail,
        auditIntegrityStatus: { status: 'caution' },
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        finalReleaseStatus: 'caution',
      },
    }, { emitEvent: false })

    expect(result.multiUserReadinessStatus).toBe('caution')
    expect(result.auditAndPermissionDependencySummary.dependenciesReady).toBe(false)
  })

  it('blocks planning when auth or permission planning is blocked', () => {
    const result = evaluateMultiUserWorkspacePlanning({
      ...baseInput,
      authReadiness: {
        ...baseInput.authReadiness,
        authReadinessStatus: 'blocked',
      },
      permissionPlanning: {
        ...baseInput.permissionPlanning,
        permissionReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.multiUserReadinessStatus).toBe('blocked')
    expect(result.collaborationBoundarySummary.authenticationEnabled).toBe(false)
    expect(result.sharedWorkspaceAccessPlanning.permissionEnforcementEnabled).toBe(false)
  })

  it('emits system multi-user workspace planning evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createMultiUserWorkspacePlanningEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT)
  })
})
