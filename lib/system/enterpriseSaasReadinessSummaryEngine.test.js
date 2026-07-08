import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_SAAS_READINESS_EVALUATED_EVENT,
  createEnterpriseSaasReadinessSummaryEngine,
  evaluateEnterpriseSaasReadiness,
} from './enterpriseSaasReadinessSummaryEngine.js'

const baseInput = {
  authReadiness: {
    eventType: 'system.authReadiness.evaluated',
    authReadinessStatus: 'ready',
    roleModelPlaceholder: [{ role: 'owner' }, { role: 'viewer' }],
  },
  permissionPlanning: {
    eventType: 'system.permissionPlanning.evaluated',
    permissionReadinessStatus: 'ready',
    roleCapabilityMap: [{ role: 'owner' }, { role: 'viewer' }],
  },
  multiUserWorkspacePlanning: {
    eventType: 'system.multiUserWorkspacePlanning.evaluated',
    multiUserReadinessStatus: 'ready',
    userMembershipModelPlaceholder: [{ role: 'owner' }, { role: 'viewer' }],
  },
  organizationWorkspaceReadiness: {
    eventType: 'system.organizationWorkspaceReadiness.evaluated',
    organizationReadinessStatus: 'ready',
    organizationProfilePlaceholder: { organizationId: 'atlas-org' },
  },
  workspacePersistence: {
    eventType: 'workspace.persistence.prepared',
    persistenceStatus: 'prepared',
    localPersistenceAdapter: { status: 'available' },
    futurePostgresPersistenceInterface: { implemented: false },
    multiUserSupport: false,
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

describe('enterprise SaaS readiness summary engine', () => {
  it('summarizes a ready future SaaS planning foundation', () => {
    const result = evaluateEnterpriseSaasReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T23:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_SAAS_READINESS_EVALUATED_EVENT)
    expect(result.saasReadinessStatus).toBe('ready')
    expect(result.authReadinessSummary.status).toBe('ready')
    expect(result.permissionPlanningSummary.roleCapabilityCount).toBe(2)
    expect(result.multiUserWorkspaceSummary.realMultiUserAccountsEnabled).toBe(false)
    expect(result.organizationWorkspaceSummary.organizationId).toBe('atlas-org')
    expect(result.persistenceReadinessSummary.postgresImplemented).toBe(false)
    expect(result.auditReadinessSummary.status).toBe('valid')
    expect(result.releaseControlReadinessSummary.platformHealthStatus).toBe('operational')
    expect(result.billingEnabled).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('returns caution when a dependency is not fully ready', () => {
    const result = evaluateEnterpriseSaasReadiness({
      ...baseInput,
      workspacePersistence: { ...baseInput.workspacePersistence, persistenceStatus: 'caution' },
    }, { emitEvent: false })

    expect(result.saasReadinessStatus).toBe('caution')
  })

  it('blocks readiness when a critical dependency is blocked', () => {
    const result = evaluateEnterpriseSaasReadiness({
      ...baseInput,
      organizationWorkspaceReadiness: {
        ...baseInput.organizationWorkspaceReadiness,
        organizationReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.saasReadinessStatus).toBe('blocked')
    expect(result.realOrganizationsEnabled).toBe(false)
    expect(result.permissionEnforcementEnabled).toBe(false)
  })

  it('emits SaaS readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_SAAS_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createEnterpriseSaasReadinessSummaryEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
