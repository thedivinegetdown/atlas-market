import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import { prepareWorkspacePersistence } from './workspacePersistenceEngine.js'
import { recoverWorkspaceSession } from './workspaceSessionRecoveryEngine.js'
import { transferWorkspaceConfiguration } from './workspaceConfigurationTransferEngine.js'
import {
  WORKSPACE_TEMPLATE_APPLIED_EVENT,
  applyWorkspaceTemplate,
  createWorkspaceTemplateEngine,
} from './workspaceTemplateEngine.js'

const dashboardNavigation = [
  { id: 'ai-decision', label: 'AI Decision', status: 'approved' },
  { id: 'risk', label: 'Risk', status: 'controlled' },
  { id: 'guardrails', label: 'Guardrails', status: 'approved' },
  { id: 'execution', label: 'Execution', status: 'filled' },
  { id: 'accounting', label: 'Accounting', status: 'ready' },
  { id: 'journal', label: 'Journal', status: 'ready' },
  { id: 'operator-action-center', label: 'Operator Actions', status: 'low' },
  { id: 'research-intelligence', label: 'Research Intel', status: 'supportive' },
  { id: 'research-signal-score', label: 'Research Score', status: 'bullish' },
  { id: 'strategy-builder', label: 'Strategy Builder', status: 'valid' },
  { id: 'strategy-rule-evaluation', label: 'Rule Eval', status: 'eligible' },
  { id: 'strategy-backtest-input', label: 'Backtest Input', status: 'ready' },
  { id: 'historical-replay', label: 'Replay', status: 'prepared' },
  { id: 'portfolio-correlation', label: 'Correlation', status: 'clear' },
  { id: 'portfolio-factor-exposure', label: 'Factors', status: 'clear' },
  { id: 'release-readiness', label: 'Release RC', status: 'ready' },
  { id: 'rc-stabilization', label: 'RC Stability', status: 'stable' },
  { id: 'event-observability', label: 'Observability', status: 'healthy' },
  { id: 'system-health-command-center', label: 'System Health', status: 'operational' },
  { id: 'enterprise-audit-trail', label: 'Audit Trail', status: 'valid' },
  { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
  { id: 'workspace-persistence', label: 'Persistence', status: 'prepared' },
  { id: 'workspace-session-recovery', label: 'Recovery', status: 'restored' },
  { id: 'workspace-configuration-transfer', label: 'Config Transfer', status: 'imported' },
]

const workspacePersistence = prepareWorkspacePersistence({
  dashboardNavigation,
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated', finalPlatformHealthStatus: 'operational' },
  operatorActionCenter: { eventType: 'system.operatorActions.generated', platformActionSummary: { topSeverity: 'low' } },
}, { emitEvent: false })
const workspaceSessionRecovery = recoverWorkspaceSession({ workspacePersistence }, { emitEvent: false })
const workspaceConfigurationTransfer = transferWorkspaceConfiguration({
  workspacePersistence,
  workspaceSessionRecovery,
}, { emitEvent: false })

describe('workspace template engine', () => {
  it('applies a valid enterprise release review template', () => {
    const result = applyWorkspaceTemplate({
      workspacePersistence,
      workspaceSessionRecovery,
      workspaceConfigurationTransfer,
      templateId: 'enterprise-release-review',
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T18:00:00.000Z',
    })

    expect(result.eventType).toBe(WORKSPACE_TEMPLATE_APPLIED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.authenticationEnabled).toBe(false)
    expect(result.multiUserSupport).toBe(false)
    expect(result.defaultTemplates).toHaveLength(6)
    expect(result.defaultTemplates.map((template) => template.templateName)).toEqual([
      'Trading Operations',
      'Research Intelligence',
      'Strategy Development',
      'Backtesting Lab',
      'Risk Command Center',
      'Enterprise Release Review',
    ])
    expect(result.templateValidationStatus).toBe('valid')
    expect(result.appliedTemplateId).toBe('enterprise-release-review')
    expect(result.templateLayoutPresets.activePanelId).toBe('release-readiness')
    expect(result.templatePanelVisibilityPresets['enterprise-release-control'].visible).toBe(true)
    expect(result.templatePreferencePresets.density).toBe('review')
    expect(result.sourceEvents.workspacePersistence).toBe('workspace.persistence.prepared')
    expect(result.sourceEvents.workspaceSessionRecovery).toBe('workspace.session.recovered')
    expect(result.sourceEvents.workspaceConfigurationTransfer).toBe('workspace.configuration.transferred')
  })

  it('applies trading operations visibility and layout presets', () => {
    const result = applyWorkspaceTemplate({
      dashboardNavigation,
      templateId: 'trading-operations',
    }, { emitEvent: false })

    expect(result.templateValidationStatus).toBe('valid')
    expect(result.templateLayoutPresets.activePanelId).toBe('ai-decision')
    expect(result.templatePanelVisibilityPresets.risk.visible).toBe(true)
    expect(result.templatePanelVisibilityPresets['research-intelligence'].visible).toBe(false)
    expect(result.templatePreferencePresets.eventRefreshMode).toBe('active-review')
  })

  it('marks templates caution when focus panels are unavailable', () => {
    const result = applyWorkspaceTemplate({
      dashboardNavigation: [
        { id: 'enterprise-release-control', label: 'Release Control', status: 'release-ready' },
      ],
      templateId: 'backtesting-lab',
    }, { emitEvent: false })

    expect(result.templateValidationStatus).toBe('caution')
    expect(result.missingFocusPanels).toContain('strategy-backtest-input')
  })

  it('emits workspace template applied events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(WORKSPACE_TEMPLATE_APPLIED_EVENT, (payload) => events.push(payload))

    const result = createWorkspaceTemplateEngine({ eventBus }).apply({
      dashboardNavigation,
      templateId: 'risk-command-center',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(WORKSPACE_TEMPLATE_APPLIED_EVENT)
  })
})
