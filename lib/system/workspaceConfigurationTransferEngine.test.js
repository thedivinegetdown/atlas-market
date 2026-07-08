import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import { prepareWorkspacePersistence } from './workspacePersistenceEngine.js'
import { recoverWorkspaceSession } from './workspaceSessionRecoveryEngine.js'
import {
  WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT,
  createWorkspaceConfigurationTransferEngine,
  transferWorkspaceConfiguration,
} from './workspaceConfigurationTransferEngine.js'

const releaseControl = Object.freeze({
  eventType: 'system.releaseControl.evaluated',
  finalReleaseStatus: 'release-ready',
})

const systemHealthCommandCenter = Object.freeze({
  eventType: 'system.healthCommandCenter.evaluated',
  finalPlatformHealthStatus: 'operational',
})

const workspacePersistence = prepareWorkspacePersistence({
  workspaceId: 'atlas-transfer-workspace',
  dashboardNavigation: [
    { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
    { id: 'workspace-persistence', label: 'Persistence', status: 'prepared' },
    { id: 'workspace-session-recovery', label: 'Recovery', status: 'restored' },
  ],
  hiddenPanelIds: ['workspace-session-recovery'],
  operatorPreferences: {
    theme: 'dark',
    density: 'compact',
    defaultLandingPanel: 'enterprise-release-control',
  },
  enterpriseReleaseControl: releaseControl,
  systemHealthCommandCenter,
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
}, { emitEvent: false })

const workspaceSessionRecovery = recoverWorkspaceSession({
  workspacePersistence,
  enterpriseReleaseControl: releaseControl,
  systemHealthCommandCenter,
}, { emitEvent: false })

describe('workspace configuration transfer engine', () => {
  it('exports and validates a normalized workspace configuration package', () => {
    const result = transferWorkspaceConfiguration({
      workspacePersistence,
      workspaceSessionRecovery,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T17:00:00.000Z',
    })

    expect(result.eventType).toBe(WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.authenticationEnabled).toBe(false)
    expect(result.multiUserSupport).toBe(false)
    expect(result.importStatus).toBe('imported')
    expect(result.importValidation.valid).toBe(true)
    expect(result.normalizedExportPackage.workspaceId).toBe('atlas-transfer-workspace')
    expect(result.layoutExport.panelOrder).toContain('enterprise-release-control')
    expect(result.panelVisibilityExport['workspace-session-recovery'].visible).toBe(false)
    expect(result.operatorPreferencesExport.theme).toBe('dark')
    expect(result.paperModeProfileExport.tradingMode).toBe('paper')
    expect(result.sourceEvents.workspacePersistence).toBe('workspace.persistence.prepared')
    expect(result.sourceEvents.workspaceSessionRecovery).toBe('workspace.session.recovered')
  })

  it('returns partial when import conflicts are detected', () => {
    const exportResult = transferWorkspaceConfiguration({
      workspacePersistence,
      workspaceSessionRecovery,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false })
    const currentWorkspacePersistence = prepareWorkspacePersistence({
      workspaceId: 'atlas-current-workspace',
      dashboardNavigation: [
        { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
        { id: 'operator-action-center', label: 'Operator Actions', status: 'low' },
      ],
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false })

    const result = transferWorkspaceConfiguration({
      importPackage: exportResult.normalizedExportPackage,
      currentWorkspacePersistence,
      workspaceSessionRecovery,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false })

    expect(result.importStatus).toBe('partial')
    expect(result.importConflictSummary.conflictCount).toBeGreaterThan(0)
    expect(result.importConflictSummary.highestSeverity).toBe('low')
  })

  it('rejects import packages that violate paper-mode boundaries', () => {
    const result = transferWorkspaceConfiguration({
      importPackage: {
        packageVersion: '1.0.0',
        layoutExport: { layoutId: 'unsafe-layout', panelOrder: [], panels: [] },
        panelVisibilityExport: {},
        operatorPreferencesExport: { theme: 'dark' },
        paperModeProfileExport: {
          tradingMode: 'live',
          paperTrading: false,
          liveOrders: true,
          brokerageIntegration: true,
        },
      },
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    }, { emitEvent: false })

    expect(result.importStatus).toBe('rejected')
    expect(result.importValidation.valid).toBe(false)
    expect(result.importValidation.issues).toContain('Paper-mode profile export violates portability safety boundaries.')
  })

  it('emits workspace configuration transferred events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT, (payload) => events.push(payload))

    const result = createWorkspaceConfigurationTransferEngine({ eventBus }).transfer({
      workspacePersistence,
      workspaceSessionRecovery,
      enterpriseReleaseControl: releaseControl,
      systemHealthCommandCenter,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT)
  })
})
