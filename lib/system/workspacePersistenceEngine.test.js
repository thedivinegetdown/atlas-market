import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  WORKSPACE_PERSISTENCE_PREPARED_EVENT,
  createLocalWorkspacePersistenceAdapter,
  createWorkspacePersistenceEngine,
  prepareWorkspacePersistence,
} from './workspacePersistenceEngine.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

const baseInput = Object.freeze({
  workspaceId: 'atlas-paper-workspace-test',
  dashboardNavigation: Object.freeze([
    Object.freeze({ id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' }),
    Object.freeze({ id: 'operator-action-center', label: 'Operator Actions', status: 'low' }),
    Object.freeze({ id: 'system-health-command-center', label: 'System Health', status: 'operational' }),
  ]),
  hiddenPanelIds: Object.freeze(['operator-action-center']),
  operatorPreferences: Object.freeze({
    theme: 'dark',
    density: 'compact',
    defaultLandingPanel: 'enterprise-release-control',
    eventRefreshMode: 'manual',
  }),
  enterpriseReleaseControl: Object.freeze({
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  }),
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  }),
  operatorActionCenter: Object.freeze({
    eventType: 'system.operatorActions.generated',
    platformActionSummary: Object.freeze({ topSeverity: 'low' }),
  }),
})

describe('workspace persistence engine', () => {
  it('prepares a normalized paper-only workspace persistence model', () => {
    const result = prepareWorkspacePersistence(baseInput, {
      emitEvent: false,
      storage: createMemoryStorage(),
      timestamp: '2026-07-08T16:00:00.000Z',
    })

    expect(result.eventType).toBe(WORKSPACE_PERSISTENCE_PREPARED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.authenticationEnabled).toBe(false)
    expect(result.multiUserSupport).toBe(false)
    expect(result.persistenceStatus).toBe('prepared')
    expect(result.workspacePersistenceModel.workspaceId).toBe('atlas-paper-workspace-test')
    expect(result.savedDashboardLayoutState.panelOrder).toEqual([
      'enterprise-release-control',
      'operator-action-center',
      'system-health-command-center',
    ])
    expect(result.savedPanelVisibilityState['operator-action-center'].visible).toBe(false)
    expect(result.savedOperatorPreferences.theme).toBe('dark')
    expect(result.savedPaperModeEnvironmentProfile.releaseStatus).toBe('release-ready')
    expect(result.localPersistenceAdapter.status).toBe('available')
    expect(result.futurePostgresPersistenceInterface.status).toBe('placeholder')
    expect(result.sourceEvents.enterpriseReleaseControl).toBe('system.releaseControl.evaluated')
  })

  it('saves and loads models through the local persistence adapter', () => {
    const adapter = createLocalWorkspacePersistenceAdapter({
      storage: createMemoryStorage(),
      storageKey: 'atlas-test-workspace',
    })
    const result = prepareWorkspacePersistence(baseInput, {
      emitEvent: false,
      localAdapter: adapter,
    })

    expect(adapter.save(result.workspacePersistenceModel)).toEqual({
      status: 'saved',
      storageKey: 'atlas-test-workspace',
    })
    expect(adapter.load().model.workspaceId).toBe('atlas-paper-workspace-test')
    expect(adapter.clear()).toEqual({
      status: 'cleared',
      storageKey: 'atlas-test-workspace',
    })
    expect(adapter.load().model).toBeNull()
  })

  it('marks persistence caution when release control or system health is blocked', () => {
    const result = prepareWorkspacePersistence({
      ...baseInput,
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        finalReleaseStatus: 'blocked',
      },
      systemHealthCommandCenter: {
        ...baseInput.systemHealthCommandCenter,
        finalPlatformHealthStatus: 'degraded',
      },
    }, {
      emitEvent: false,
      storage: createMemoryStorage(),
    })

    expect(result.persistenceStatus).toBe('caution')
    expect(result.savedPaperModeEnvironmentProfile.releaseStatus).toBe('blocked')
    expect(result.savedPaperModeEnvironmentProfile.platformHealthStatus).toBe('degraded')
  })

  it('emits workspace persistence prepared events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(WORKSPACE_PERSISTENCE_PREPARED_EVENT, (payload) => events.push(payload))

    const result = createWorkspacePersistenceEngine({
      eventBus,
      storage: createMemoryStorage(),
    }).prepare(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(WORKSPACE_PERSISTENCE_PREPARED_EVENT)
  })
})
