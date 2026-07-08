import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT,
  createRoleBasedPermissionPlanningEngine,
  evaluateRoleBasedPermissionPlanning,
} from './roleBasedPermissionPlanningEngine.js'

const authReadiness = Object.freeze({
  eventType: 'system.authReadiness.evaluated',
  authReadinessStatus: 'ready',
  roleModelPlaceholder: Object.freeze([
    Object.freeze({ role: 'owner', permissions: Object.freeze(['manageWorkspace', 'reviewRelease', 'reviewSystemHealth', 'acknowledgeOperatorActions']) }),
    Object.freeze({ role: 'admin', permissions: Object.freeze(['manageWorkspace', 'reviewRelease', 'reviewSystemHealth']) }),
    Object.freeze({ role: 'analyst', permissions: Object.freeze(['navigateWorkspace', 'applyTemplates', 'reviewResearch', 'reviewBacktests']) }),
    Object.freeze({ role: 'viewer', permissions: Object.freeze(['navigateWorkspace', 'viewPanels', 'viewAuditTrail']) }),
  ]),
  permissionBoundarySummary: Object.freeze({
    deniedScopes: Object.freeze(['broker.order.create', 'broker.order.cancel', 'liveExecution.enable']),
  }),
})

const baseInput = Object.freeze({
  authReadiness,
  workspacePersistence: Object.freeze({ eventType: 'workspace.persistence.prepared', persistenceStatus: 'prepared' }),
  workspaceCommandPalette: Object.freeze({
    eventType: 'workspace.commandPalette.executed',
    commandSafetyClassification: Object.freeze({ blockedTradingCommands: 0 }),
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

describe('role-based permission planning engine', () => {
  it('builds ready role and permission planning placeholders', () => {
    const result = evaluateRoleBasedPermissionPlanning(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T20:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerageIntegration).toBe(false)
    expect(result.permissionEnforcementEnabled).toBe(false)
    expect(result.signInUiEnabled).toBe(false)
    expect(result.permissionReadinessStatus).toBe('ready')
    expect(result.permissionMatrixPlaceholder).toHaveLength(4)
    expect(result.roleCapabilityMap.map((role) => role.role)).toEqual(['owner', 'admin', 'analyst', 'viewer'])
    expect(result.workspaceAccessPlanning.plannedRoles).toContain('owner')
    expect(result.strategyAccessPlanning.plannedRoles).toContain('analyst')
    expect(result.portfolioAnalyticsAccessPlanning.plannedRoles).toContain('viewer')
    expect(result.releaseControlAccessPlanning.plannedRoles).toContain('admin')
    expect(result.restrictedActionSummary.restrictedActions).toContain('broker.order.create')
    expect(result.sourceEvents.authReadiness).toBe('system.authReadiness.evaluated')
  })

  it('returns caution when auth or platform readiness requires review', () => {
    const result = evaluateRoleBasedPermissionPlanning({
      ...baseInput,
      authReadiness: {
        ...authReadiness,
        authReadinessStatus: 'caution',
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        finalReleaseStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.permissionReadinessStatus).toBe('caution')
    expect(result.releaseControlAccessPlanning.enforcementEnabled).toBe(false)
  })

  it('blocks planning when command palette exposes trading command violations', () => {
    const result = evaluateRoleBasedPermissionPlanning({
      ...baseInput,
      workspaceCommandPalette: {
        ...baseInput.workspaceCommandPalette,
        commandSafetyClassification: { blockedTradingCommands: 1 },
      },
    }, { emitEvent: false })

    expect(result.permissionReadinessStatus).toBe('blocked')
    expect(result.restrictedActionSummary.blockedTradingCommandCount).toBe(1)
  })

  it('emits system permission planning evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createRoleBasedPermissionPlanningEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT)
  })
})
