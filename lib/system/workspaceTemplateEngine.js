import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const WORKSPACE_TEMPLATE_APPLIED_EVENT = 'workspace.template.applied'

const TEMPLATE_DEFINITIONS = [
  {
    id: 'trading-operations',
    name: 'Trading Operations',
    description: 'Paper trading operations workspace focused on decisions, risk, guardrails, execution simulation, and portfolio state.',
    focusPanelIds: ['ai-decision', 'risk', 'guardrails', 'execution', 'accounting', 'journal', 'operator-action-center'],
    density: 'operator',
  },
  {
    id: 'research-intelligence',
    name: 'Research Intelligence',
    description: 'Research workspace focused on intelligence, signal scoring, decision context, multi-timeframe context, and market regime.',
    focusPanelIds: ['research-intelligence', 'research-signal-score', 'research-decision-context', 'multi-timeframe-research', 'market-regime', 'research-enhanced-decision'],
    density: 'research',
  },
  {
    id: 'strategy-development',
    name: 'Strategy Development',
    description: 'Strategy workspace focused on blueprint design, rule evaluation, signal composition, lifecycle, and registry.',
    focusPanelIds: ['strategy-builder', 'strategy-rule-evaluation', 'strategy-signal-composer', 'strategy-lifecycle', 'strategy-registry', 'multi-strategy'],
    density: 'builder',
  },
  {
    id: 'backtesting-lab',
    name: 'Backtesting Lab',
    description: 'Backtesting workspace focused on replay, execution, performance, walk-forward, Monte Carlo, and report review.',
    focusPanelIds: ['strategy-backtest-input', 'historical-replay', 'strategy-backtest-execution', 'strategy-backtest-performance', 'strategy-walk-forward', 'strategy-monte-carlo', 'strategy-backtest-report'],
    density: 'lab',
  },
  {
    id: 'risk-command-center',
    name: 'Risk Command Center',
    description: 'Risk workspace focused on portfolio risk, drawdown, sizing, allocation, correlation, factor exposure, and optimization governance.',
    focusPanelIds: ['risk', 'drawdown-protection', 'position-sizing', 'portfolio-analytics', 'portfolio-correlation', 'portfolio-factor-exposure', 'portfolio-optimization-governance'],
    density: 'command',
  },
  {
    id: 'enterprise-release-review',
    name: 'Enterprise Release Review',
    description: 'Release workspace focused on readiness, stabilization, observability, health, audit, release control, and workspace portability.',
    focusPanelIds: ['release-readiness', 'rc-stabilization', 'event-observability', 'system-health-command-center', 'enterprise-audit-trail', 'enterprise-release-control', 'workspace-persistence', 'workspace-session-recovery', 'workspace-configuration-transfer'],
    density: 'review',
  },
]

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getPanels(input = {}) {
  return input.dashboardNavigation
    ?? input.workspacePersistence?.savedDashboardLayoutState?.panels
    ?? input.workspacePersistence?.workspacePersistenceModel?.savedDashboardLayoutState?.panels
    ?? []
}

function normalizePanel(panel, index) {
  return {
    id: panel.id,
    label: panel.label ?? panel.id,
    status: panel.status ?? 'unknown',
    sortOrder: Number.isFinite(Number(panel.sortOrder)) ? Number(panel.sortOrder) : index,
    visible: panel.visible !== false,
  }
}

function buildTemplatePanelVisibilityPreset(template, panels = []) {
  const focus = new Set(template.focusPanelIds)
  return Object.fromEntries(panels.map((panel) => [
    panel.id,
    {
      visible: focus.has(panel.id),
      collapsed: !focus.has(panel.id),
      templateRole: focus.has(panel.id) ? 'primary' : 'available',
    },
  ]))
}

function buildTemplateLayoutPreset(template, panels = []) {
  const focus = new Set(template.focusPanelIds)
  const focusedPanels = template.focusPanelIds.filter((panelId) => panels.some((panel) => panel.id === panelId))
  const secondaryPanels = panels.map((panel) => panel.id).filter((panelId) => !focus.has(panelId))
  return {
    layoutId: `template-${template.id}`,
    activePanelId: focusedPanels[0] ?? panels[0]?.id ?? null,
    panelOrder: [...focusedPanels, ...secondaryPanels],
    pinnedPanelIds: focusedPanels.slice(0, 4),
    panels: [...focusedPanels, ...secondaryPanels]
      .map((panelId, index) => {
        const panel = panels.find((candidate) => candidate.id === panelId)
        return {
          ...panel,
          sortOrder: index,
          visible: focus.has(panelId),
        }
      })
      .filter((panel) => panel.id),
  }
}

function buildTemplatePreferencePreset(template) {
  return {
    theme: 'system',
    density: template.density,
    defaultLandingPanel: template.focusPanelIds[0],
    acknowledgeLowSeverityActions: false,
    eventRefreshMode: template.id === 'trading-operations' || template.id === 'risk-command-center' ? 'active-review' : 'manual',
    reduceMotion: false,
  }
}

function buildNormalizedTemplate(template, panels = []) {
  return {
    templateId: template.id,
    templateName: template.name,
    description: template.description,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    templatePanelVisibilityPreset: buildTemplatePanelVisibilityPreset(template, panels),
    templateLayoutPreset: buildTemplateLayoutPreset(template, panels),
    templatePreferencePreset: buildTemplatePreferencePreset(template),
  }
}

function validateTemplate(template, panels = []) {
  const issues = []
  const panelIds = new Set(panels.map((panel) => panel.id))
  const missingFocusPanels = TEMPLATE_DEFINITIONS
    .find((definition) => definition.id === template.templateId)
    ?.focusPanelIds
    .filter((panelId) => !panelIds.has(panelId)) ?? []

  if (!template.templateId || !template.templateName) issues.push('Template identity is incomplete.')
  if (template.paperTrading !== true || template.liveOrders === true || template.brokerageIntegration === true) {
    issues.push('Template violates paper-mode safety boundaries.')
  }
  if (!template.templateLayoutPreset.activePanelId || template.templateLayoutPreset.panelOrder.length === 0) {
    issues.push('Template layout preset is incomplete.')
  }
  if (Object.keys(template.templatePanelVisibilityPreset).length === 0) {
    issues.push('Template panel visibility preset is incomplete.')
  }
  if (!template.templatePreferencePreset.defaultLandingPanel) {
    issues.push('Template preference preset is incomplete.')
  }

  const status = issues.some((issue) => /violates paper-mode|identity/.test(issue))
    ? 'invalid'
    : issues.length > 0 || missingFocusPanels.length > 0
      ? 'caution'
      : 'valid'

  return {
    status,
    issues,
    missingFocusPanels,
  }
}

function resolveTemplate(templateId) {
  return TEMPLATE_DEFINITIONS.find((template) => template.id === templateId) ?? TEMPLATE_DEFINITIONS[0]
}

export function applyWorkspaceTemplate(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const panels = getPanels(input).map(normalizePanel)
  const selectedTemplateDefinition = resolveTemplate(input.templateId ?? options.templateId ?? 'enterprise-release-review')
  const defaultTemplates = TEMPLATE_DEFINITIONS.map((template) => buildNormalizedTemplate(template, panels))
  const normalizedWorkspaceTemplateModel = buildNormalizedTemplate(selectedTemplateDefinition, panels)
  const validation = validateTemplate(normalizedWorkspaceTemplateModel, panels)
  const result = {
    eventType: WORKSPACE_TEMPLATE_APPLIED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    timestamp,
    defaultTemplates,
    normalizedWorkspaceTemplateModel,
    appliedTemplateId: normalizedWorkspaceTemplateModel.templateId,
    appliedTemplateName: normalizedWorkspaceTemplateModel.templateName,
    templatePanelVisibilityPresets: normalizedWorkspaceTemplateModel.templatePanelVisibilityPreset,
    templateLayoutPresets: normalizedWorkspaceTemplateModel.templateLayoutPreset,
    templatePreferencePresets: normalizedWorkspaceTemplateModel.templatePreferencePreset,
    templateValidationStatus: validation.status,
    templateValidationIssues: validation.issues,
    missingFocusPanels: validation.missingFocusPanels,
    summary: `Workspace template ${normalizedWorkspaceTemplateModel.templateName} applied with ${validation.status} validation across ${normalizedWorkspaceTemplateModel.templateLayoutPreset.panelOrder.length} panels.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      workspaceSessionRecovery: input.workspaceSessionRecovery?.eventType ?? null,
      workspaceConfigurationTransfer: input.workspaceConfigurationTransfer?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(WORKSPACE_TEMPLATE_APPLIED_EVENT, result)
  }

  return result
}

export function createWorkspaceTemplateEngine(options = {}) {
  return {
    apply(input, applyOptions = {}) {
      return applyWorkspaceTemplate(input, { ...options, ...applyOptions })
    },
  }
}
