import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import { createLocalWorkspacePersistenceAdapter, prepareWorkspacePersistence } from './workspacePersistenceEngine.js'
import {
  WORKSPACE_SESSION_RECOVERED_EVENT,
  createWorkspaceSessionRecoveryEngine,
  recoverWorkspaceSession,
} from './workspaceSessionRecoveryEngine.js'

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

const basePersistence = prepareWorkspacePersistence({
  workspaceId: 'atlas-recovery-workspace',
  dashboardNavigation: [
    { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
    { id: 'workspace-persistence', label: 'Persistence', status: 'prepared' },
    { id: 'workspace-session-recovery', label: 'Recovery', status: 'restored' },
  ],
  hiddenPanelIds: ['workspace-persistence'],
  operatorPreferences: {
    theme: 'dark',
    density: 'operator',
    defaultLandingPanel: 'enterprise-release-control',
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
}, { emitEvent: false, storage: createMemoryStorage() })

const releaseControl = Object.freeze({
  eventType: 'system.releaseControl.evaluated',
  finalReleaseStatus: 'release-ready',
})

const systemHealthCommandCenter = Object.freeze({
  eventType: 'system.healthCommandCenter.evaluated',
  finalPlatformHealthStatus: 'operational',
})

describe('workspace session recovery engine', () => {
  it('restores workspace state from Phase 21A persistence output', () => {
    const result = recoverWorkspaceSession({
      workspacePersistence: basePersistence,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false, storage: createMemoryStorage() })

    expect(result.eventType).toBe(WORKSPACE_SESSION_RECOVERED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.authenticationEnabled).toBe(false)
    expect(result.multiUserSupport).toBe(false)
    expect(result.recoveryValidationStatus).toBe('restored')
    expect(result.savedWorkspaceStateHydration.source).toBe('prepared-persistence')
    expect(result.layoutRestoration.panelOrder).toContain('enterprise-release-control')
    expect(result.panelVisibilityRestoration.hiddenPanelIds).toContain('workspace-persistence')
    expect(result.operatorPreferenceRestoration.preferences.theme).toBe('dark')
    expect(result.paperModeProfileRestoration.profile.tradingMode).toBe('paper')
    expect(result.sourceEvents.workspacePersistence).toBe('workspace.persistence.prepared')
  })

  it('hydrates saved workspace state through the local adapter', () => {
    const adapter = createLocalWorkspacePersistenceAdapter({
      storage: createMemoryStorage(),
      storageKey: 'atlas-recovery-test',
    })
    adapter.save(basePersistence.workspacePersistenceModel)

    const result = recoverWorkspaceSession({
      workspacePersistence: { eventType: basePersistence.eventType },
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, {
      emitEvent: false,
      localAdapter: adapter,
    })

    expect(result.savedWorkspaceStateHydration.source).toBe('local')
    expect(result.savedWorkspaceStateHydration.workspaceId).toBe('atlas-recovery-workspace')
    expect(result.recoveryValidationStatus).toBe('restored')
  })

  it('returns partial recovery when upstream release or health context needs attention', () => {
    const result = recoverWorkspaceSession({
      workspacePersistence: basePersistence,
      enterpriseReleaseControl: {
        ...releaseControl,
        finalReleaseStatus: 'blocked',
      },
      systemHealthCommandCenter: {
        ...systemHealthCommandCenter,
        finalPlatformHealthStatus: 'degraded',
      },
    }, { emitEvent: false, storage: createMemoryStorage() })

    expect(result.recoveryValidationStatus).toBe('partial')
    expect(result.recoveryIssueSummary).toContain('Enterprise release control is blocked during recovery.')
    expect(result.recoveryIssueSummary).toContain('System health is degraded during recovery.')
  })

  it('fails recovery when no saved workspace state can be hydrated', () => {
    const result = recoverWorkspaceSession({
      workspacePersistence: { eventType: 'workspace.persistence.prepared' },
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false, storage: createMemoryStorage() })

    expect(result.recoveryValidationStatus).toBe('failed')
    expect(result.recoveryIssueSummary).toContain('No saved workspace state was available to hydrate.')
  })

  it('emits workspace session recovered events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(WORKSPACE_SESSION_RECOVERED_EVENT, (payload) => events.push(payload))

    const result = createWorkspaceSessionRecoveryEngine({
      eventBus,
      storage: createMemoryStorage(),
    }).recover({
      workspacePersistence: basePersistence,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(WORKSPACE_SESSION_RECOVERED_EVENT)
  })
})
