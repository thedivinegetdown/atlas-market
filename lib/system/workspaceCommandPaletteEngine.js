import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT = 'workspace.commandPalette.executed'

const COMMAND_CATEGORIES = [
  'navigation',
  'workspace template',
  'panel visibility',
  'operator review',
  'system health',
  'release review',
]

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizePanel(panel, index) {
  return {
    id: panel.id,
    label: panel.label ?? panel.id,
    status: panel.status ?? 'unknown',
    sortOrder: Number.isFinite(Number(panel.sortOrder)) ? Number(panel.sortOrder) : index,
  }
}

function getPanels(input = {}) {
  return input.dashboardNavigation
    ?? input.workspaceTemplate?.templateLayoutPresets?.panels
    ?? input.workspacePersistence?.savedDashboardLayoutState?.panels
    ?? input.workspacePersistence?.workspacePersistenceModel?.savedDashboardLayoutState?.panels
    ?? []
}

function makeCommand({ id, label, category, description, target, source = null, available = true, unavailableReason = null, safety = 'safe-workspace', priority = 'normal' }) {
  return {
    id,
    label,
    category,
    description,
    target,
    source,
    availability: {
      available,
      reason: unavailableReason,
    },
    safetyClassification: {
      classification: safety,
      workspaceOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
      tradingAction: false,
    },
    priority,
  }
}

function buildNavigationCommands(panels = []) {
  return panels.map((panel) => makeCommand({
    id: `navigate-${panel.id}`,
    label: `Open ${panel.label}`,
    category: 'navigation',
    description: `Navigate to ${panel.label}.`,
    target: { type: 'panel', panelId: panel.id },
    source: panel.id,
    priority: panel.id === 'enterprise-release-control' ? 'high' : 'normal',
  }))
}

function buildTemplateCommands(workspaceTemplate = {}) {
  return (workspaceTemplate.defaultTemplates ?? []).map((template) => makeCommand({
    id: `apply-template-${template.templateId}`,
    label: `Apply ${template.templateName}`,
    category: 'workspace template',
    description: template.description,
    target: { type: 'template', templateId: template.templateId },
    source: workspaceTemplate.eventType,
    available: workspaceTemplate.templateValidationStatus !== 'invalid',
    unavailableReason: workspaceTemplate.templateValidationStatus === 'invalid' ? 'Current workspace template validation is invalid.' : null,
    priority: template.templateId === workspaceTemplate.appliedTemplateId ? 'high' : 'normal',
  }))
}

function buildPanelVisibilityCommands(workspaceTemplate = {}) {
  return Object.entries(workspaceTemplate.templatePanelVisibilityPresets ?? {}).flatMap(([panelId, preset]) => [
    makeCommand({
      id: `show-panel-${panelId}`,
      label: `Show ${panelId}`,
      category: 'panel visibility',
      description: `Set ${panelId} visible in the workspace shell.`,
      target: { type: 'panelVisibility', panelId, visible: true },
      source: workspaceTemplate.eventType,
      available: preset.visible !== true,
      unavailableReason: preset.visible === true ? 'Panel is already visible in the active template.' : null,
    }),
    makeCommand({
      id: `hide-panel-${panelId}`,
      label: `Hide ${panelId}`,
      category: 'panel visibility',
      description: `Set ${panelId} hidden in the workspace shell.`,
      target: { type: 'panelVisibility', panelId, visible: false },
      source: workspaceTemplate.eventType,
      available: preset.visible === true,
      unavailableReason: preset.visible !== true ? 'Panel is already hidden in the active template.' : null,
    }),
  ])
}

function buildOperatorReviewCommands(operatorActionCenter = {}) {
  const actions = operatorActionCenter.prioritizedOperatorActions ?? []
  const reviewActions = actions.slice(0, 5).map((action) => makeCommand({
    id: `review-operator-action-${action.id}`,
    label: `Review ${action.title ?? action.id}`,
    category: 'operator review',
    description: action.rationale ?? 'Review operator action.',
    target: { type: 'operatorAction', actionId: action.id },
    source: operatorActionCenter.eventType,
    priority: action.severity === 'critical' || action.severity === 'high' ? 'high' : 'normal',
  }))

  return [
    makeCommand({
      id: 'open-operator-action-center',
      label: 'Open Operator Action Center',
      category: 'operator review',
      description: 'Review human-only operator actions.',
      target: { type: 'panel', panelId: 'operator-action-center' },
      source: operatorActionCenter.eventType,
      priority: operatorActionCenter.platformActionSummary?.topSeverity === 'high' || operatorActionCenter.platformActionSummary?.topSeverity === 'critical' ? 'high' : 'normal',
    }),
    ...reviewActions,
  ]
}

function buildSystemHealthCommands(systemHealthCommandCenter = {}) {
  return [
    makeCommand({
      id: 'open-system-health-command-center',
      label: 'Open System Health Command Center',
      category: 'system health',
      description: systemHealthCommandCenter.summary ?? 'Review platform health.',
      target: { type: 'panel', panelId: 'system-health-command-center' },
      source: systemHealthCommandCenter.eventType,
      priority: systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded' ? 'high' : 'normal',
    }),
    makeCommand({
      id: 'open-event-observability',
      label: 'Open Event Observability',
      category: 'system health',
      description: 'Review system event observability.',
      target: { type: 'panel', panelId: 'event-observability' },
      source: systemHealthCommandCenter.sourceEvents?.eventObservability ?? null,
    }),
  ]
}

function buildReleaseReviewCommands(enterpriseReleaseControl = {}) {
  return [
    makeCommand({
      id: 'open-enterprise-release-control',
      label: 'Open Enterprise Release Control',
      category: 'release review',
      description: enterpriseReleaseControl.releaseRationaleSummary ?? 'Review release control status.',
      target: { type: 'panel', panelId: 'enterprise-release-control' },
      source: enterpriseReleaseControl.eventType,
      priority: enterpriseReleaseControl.finalReleaseStatus === 'blocked' ? 'high' : 'normal',
    }),
    makeCommand({
      id: 'open-release-readiness',
      label: 'Open Release Readiness',
      category: 'release review',
      description: 'Review release readiness gate.',
      target: { type: 'panel', panelId: 'release-readiness' },
      source: enterpriseReleaseControl.sourceEvents?.releaseReadiness ?? null,
    }),
    makeCommand({
      id: 'open-enterprise-audit-trail',
      label: 'Open Enterprise Audit Trail',
      category: 'release review',
      description: 'Review enterprise audit trail before release.',
      target: { type: 'panel', panelId: 'enterprise-audit-trail' },
      source: enterpriseReleaseControl.sourceEvents?.enterpriseAuditTrail ?? null,
    }),
  ]
}

function buildCommandCatalog(input = {}) {
  const panels = getPanels(input).map(normalizePanel)
  return [
    ...buildNavigationCommands(panels),
    ...buildTemplateCommands(input.workspaceTemplate),
    ...buildPanelVisibilityCommands(input.workspaceTemplate),
    ...buildOperatorReviewCommands(input.operatorActionCenter),
    ...buildSystemHealthCommands(input.systemHealthCommandCenter),
    ...buildReleaseReviewCommands(input.enterpriseReleaseControl),
  ].filter((command, index, commands) => commands.findIndex((candidate) => candidate.id === command.id) === index)
}

function filterCommands(commands = [], { query = '', category = 'all' } = {}) {
  const normalizedQuery = query.trim().toLowerCase()
  return commands.filter((command) => {
    const categoryMatches = category === 'all' || command.category === category
    const queryMatches = !normalizedQuery
      || command.label.toLowerCase().includes(normalizedQuery)
      || command.description.toLowerCase().includes(normalizedQuery)
      || command.id.toLowerCase().includes(normalizedQuery)
    return categoryMatches && queryMatches
  })
}

function summarizeAvailability(commands = []) {
  return {
    availableCount: commands.filter((command) => command.availability.available).length,
    unavailableCount: commands.filter((command) => !command.availability.available).length,
    highPriorityCount: commands.filter((command) => command.priority === 'high').length,
  }
}

function executeCommand({ command, commands = [] }) {
  if (!command) {
    return {
      commandId: null,
      status: 'not-found',
      message: 'Command was not found in the workspace command catalog.',
      target: null,
      workspaceOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    }
  }

  if (!command.availability.available) {
    return {
      commandId: command.id,
      status: 'blocked',
      message: command.availability.reason ?? 'Command is unavailable.',
      target: command.target,
      workspaceOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    }
  }

  const relatedCommands = commands
    .filter((candidate) => candidate.category === command.category && candidate.id !== command.id)
    .slice(0, 3)
    .map((candidate) => candidate.id)

  return {
    commandId: command.id,
    status: 'executed',
    message: `${command.label} prepared as a safe workspace-level action.`,
    target: command.target,
    relatedCommands,
    workspaceOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export function executeWorkspaceCommandPalette(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const normalizedCommandCatalog = buildCommandCatalog(input)
  const commandSearch = {
    query: input.query ?? options.query ?? '',
    category: input.category ?? options.category ?? 'all',
    totalCommands: normalizedCommandCatalog.length,
  }
  const filteredCommands = filterCommands(normalizedCommandCatalog, commandSearch)
  const requestedCommandId = input.commandId ?? options.commandId
  const selectedCommand = requestedCommandId
    ? normalizedCommandCatalog.find((command) => command.id === requestedCommandId)
    : filteredCommands.find((command) => command.availability.available) ?? filteredCommands[0]
  const commandAvailabilityChecks = summarizeAvailability(normalizedCommandCatalog)
  const commandSafetyClassification = {
    safeWorkspaceCommands: normalizedCommandCatalog.filter((command) => command.safetyClassification.classification === 'safe-workspace').length,
    blockedTradingCommands: 0,
    liveOrders: false,
    brokerageIntegration: false,
    workspaceActionsOnly: true,
  }
  const commandExecutionResult = executeCommand({ command: selectedCommand, commands: normalizedCommandCatalog })
  const result = {
    eventType: WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    timestamp,
    normalizedCommandCatalog,
    commandCategories: COMMAND_CATEGORIES,
    commandSearch,
    filteredCommands,
    commandAvailabilityChecks,
    commandSafetyClassification,
    commandExecutionResult,
    summary: `Workspace command palette ${commandExecutionResult.status}: ${filteredCommands.length} commands matched from ${normalizedCommandCatalog.length} workspace-safe commands.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      workspaceSessionRecovery: input.workspaceSessionRecovery?.eventType ?? null,
      workspaceConfigurationTransfer: input.workspaceConfigurationTransfer?.eventType ?? null,
      workspaceTemplate: input.workspaceTemplate?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(WORKSPACE_COMMAND_PALETTE_EXECUTED_EVENT, result)
  }

  return result
}

export function createWorkspaceCommandPaletteEngine(options = {}) {
  return {
    execute(input, executionOptions = {}) {
      return executeWorkspaceCommandPalette(input, { ...options, ...executionOptions })
    },
  }
}
