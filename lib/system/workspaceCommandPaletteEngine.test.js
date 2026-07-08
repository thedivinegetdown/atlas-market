import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import { prepareWorkspacePersistence } from './workspacePersistenceEngine.js'
import { recoverWorkspaceSession } from './workspaceSessionRecoveryEngine.js'
import { transferWorkspaceConfiguration } from './workspaceConfigurationTransferEngine.js'
import { applyWorkspaceTemplate } from './workspaceTemplateEngine.js'
import {
  WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT,
  createWorkspaceCommandPaletteEngine,
  executeWorkspaceCommandPalette,
} from './workspaceCommandPaletteEngine.js'

const dashboardNavigation = [
  { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
  { id: 'operator-action-center', label: 'Operator Actions', status: 'low' },
  { id: 'system-health-command-center', label: 'System Health', status: 'operational' },
  { id: 'event-observability', label: 'Observability', status: 'healthy' },
  { id: 'enterprise-audit-trail', label: 'Audit Trail', status: 'valid' },
  { id: 'workspace-template', label: 'Templates', status: 'valid' },
]

const enterpriseReleaseControl = Object.freeze({
  eventType: 'system.releaseControl.evaluated',
  finalReleaseStatus: 'release-ready',
  releaseRationaleSummary: 'Release ready.',
  sourceEvents: Object.freeze({
    releaseReadiness: 'system.releaseReadiness.evaluated',
    enterpriseAuditTrail: 'system.auditTrail.recorded',
  }),
})

const systemHealthCommandCenter = Object.freeze({
  eventType: 'system.healthCommandCenter.evaluated',
  finalPlatformHealthStatus: 'operational',
  summary: 'System operational.',
  sourceEvents: Object.freeze({ eventObservability: 'system.events.observed' }),
})

const operatorActionCenter = Object.freeze({
  eventType: 'system.operatorActions.generated',
  platformActionSummary: Object.freeze({ topSeverity: 'low', openActions: 1 }),
  prioritizedOperatorActions: Object.freeze([
    Object.freeze({
      id: 'approve-operational-posture',
      title: 'Approve operational posture',
      severity: 'low',
      rationale: 'All release controls are ready.',
    }),
  ]),
})

const workspacePersistence = prepareWorkspacePersistence({
  dashboardNavigation,
  enterpriseReleaseControl,
  systemHealthCommandCenter,
  operatorActionCenter,
}, { emitEvent: false })
const workspaceSessionRecovery = recoverWorkspaceSession({
  workspacePersistence,
  enterpriseReleaseControl,
  systemHealthCommandCenter,
}, { emitEvent: false })
const workspaceConfigurationTransfer = transferWorkspaceConfiguration({
  workspacePersistence,
  workspaceSessionRecovery,
  enterpriseReleaseControl,
  systemHealthCommandCenter,
}, { emitEvent: false })
const workspaceTemplate = applyWorkspaceTemplate({
  dashboardNavigation,
  workspacePersistence,
  workspaceSessionRecovery,
  workspaceConfigurationTransfer,
  templateId: 'enterprise-release-review',
}, { emitEvent: false })

const baseInput = Object.freeze({
  dashboardNavigation,
  workspacePersistence,
  workspaceSessionRecovery,
  workspaceConfigurationTransfer,
  workspaceTemplate,
  systemHealthCommandCenter,
  operatorActionCenter,
  enterpriseReleaseControl,
})

describe('workspace command palette engine', () => {
  it('builds and executes a normalized safe workspace command', () => {
    const result = executeWorkspaceCommandPalette({
      ...baseInput,
      commandId: 'open-enterprise-release-control',
    }, { emitEvent: false })

    expect(result.eventType).toBe(WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerageIntegration).toBe(false)
    expect(result.commandCategories).toEqual([
      'navigation',
      'workspace template',
      'panel visibility',
      'operator review',
      'system health',
      'release review',
    ])
    expect(result.normalizedCommandCatalog.some((command) => command.category === 'navigation')).toBe(true)
    expect(result.normalizedCommandCatalog.some((command) => command.category === 'workspace template')).toBe(true)
    expect(result.commandSafetyClassification.workspaceActionsOnly).toBe(true)
    expect(result.commandSafetyClassification.blockedTradingCommands).toBe(0)
    expect(result.commandExecutionResult.status).toBe('executed')
    expect(result.commandExecutionResult.target.panelId).toBe('enterprise-release-control')
  })

  it('searches and filters commands by category', () => {
    const result = executeWorkspaceCommandPalette({
      ...baseInput,
      query: 'template',
      category: 'workspace template',
    }, { emitEvent: false })

    expect(result.commandSearch.query).toBe('template')
    expect(result.filteredCommands.length).toBeGreaterThan(0)
    expect(result.filteredCommands.every((command) => command.category === 'workspace template')).toBe(true)
  })

  it('blocks unavailable workspace commands without triggering side effects', () => {
    const result = executeWorkspaceCommandPalette({
      ...baseInput,
      commandId: 'hide-panel-research-intelligence',
    }, { emitEvent: false })

    expect(result.commandExecutionResult.status).toBe('not-found')
    expect(result.commandExecutionResult.workspaceOnly).toBe(true)
    expect(result.commandExecutionResult.liveOrders).toBe(false)
  })

  it('reports unavailable panel visibility commands as blocked when present', () => {
    const visiblePanelId = Object.entries(workspaceTemplate.templatePanelVisibilityPresets)
      .find(([, preset]) => preset.visible === true)?.[0]
    const result = executeWorkspaceCommandPalette({
      ...baseInput,
      commandId: `show-panel-${visiblePanelId}`,
    }, { emitEvent: false })

    expect(result.commandExecutionResult.status).toBe('blocked')
    expect(result.commandExecutionResult.message).toContain('already visible')
  })

  it('emits workspace command palette executed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT, (payload) => events.push(payload))

    const result = createWorkspaceCommandPaletteEngine({ eventBus }).execute({
      ...baseInput,
      commandId: 'open-system-health-command-center',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT)
  })
})
