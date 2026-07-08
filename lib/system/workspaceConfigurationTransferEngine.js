import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT = 'workspace.configuration.transferred'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getPersistenceModel(workspacePersistence = {}) {
  return workspacePersistence.workspacePersistenceModel ?? {}
}

function cloneValue(value, fallback) {
  return value === undefined || value === null ? fallback : JSON.parse(JSON.stringify(value))
}

function buildExportPackage({ workspacePersistence = {}, workspaceSessionRecovery = {}, enterpriseReleaseControl = {}, systemHealthCommandCenter = {}, timestamp }) {
  const model = getPersistenceModel(workspacePersistence)
  const layoutExport = cloneValue(model.savedDashboardLayoutState ?? workspacePersistence.savedDashboardLayoutState, {
    layoutId: 'unknown',
    panelOrder: [],
    panels: [],
  })
  const panelVisibilityExport = cloneValue(model.savedPanelVisibilityState ?? workspacePersistence.savedPanelVisibilityState, {})
  const operatorPreferencesExport = cloneValue(model.savedOperatorPreferences ?? workspacePersistence.savedOperatorPreferences, {
    theme: 'system',
    density: 'operator',
    defaultLandingPanel: 'enterprise-release-control',
  })
  const paperModeProfileExport = cloneValue(model.savedPaperModeEnvironmentProfile ?? workspacePersistence.savedPaperModeEnvironmentProfile, {
    tradingMode: 'paper',
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  })

  return {
    packageVersion: '1.0.0',
    packageId: `atlas-workspace-export-${model.workspaceId ?? 'operator-workspace'}`,
    exportedAt: timestamp,
    workspaceId: model.workspaceId ?? 'atlas-paper-operator-workspace',
    layoutExport,
    panelVisibilityExport,
    operatorPreferencesExport,
    paperModeProfileExport,
    recoverySnapshot: {
      recoveryValidationStatus: workspaceSessionRecovery.recoveryValidationStatus ?? 'unknown',
      source: workspaceSessionRecovery.savedWorkspaceStateHydration?.source ?? 'unknown',
    },
    sourceEvents: {
      workspacePersistence: workspacePersistence.eventType ?? null,
      workspaceSessionRecovery: workspaceSessionRecovery.eventType ?? null,
      enterpriseReleaseControl: enterpriseReleaseControl.eventType ?? null,
      systemHealthCommandCenter: systemHealthCommandCenter.eventType ?? null,
    },
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
  }
}

function validateImportPackage(exportPackage = {}) {
  const issues = []
  if (!exportPackage.packageVersion) issues.push('Export package version is missing.')
  if (!exportPackage.layoutExport?.layoutId || !Array.isArray(exportPackage.layoutExport?.panelOrder)) {
    issues.push('Layout export is incomplete.')
  }
  if (!exportPackage.panelVisibilityExport || typeof exportPackage.panelVisibilityExport !== 'object') {
    issues.push('Panel visibility export is incomplete.')
  }
  if (!exportPackage.operatorPreferencesExport || typeof exportPackage.operatorPreferencesExport !== 'object') {
    issues.push('Operator preferences export is incomplete.')
  }

  const profile = exportPackage.paperModeProfileExport ?? {}
  if (profile.tradingMode !== 'paper' || profile.paperTrading === false || profile.liveOrders === true || profile.brokerageIntegration === true) {
    issues.push('Paper-mode profile export violates portability safety boundaries.')
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

function summarizeImportConflicts({ exportPackage = {}, currentWorkspacePersistence = {}, currentWorkspaceSessionRecovery = {} }) {
  const currentModel = getPersistenceModel(currentWorkspacePersistence)
  const conflicts = []
  const currentLayoutId = currentModel.savedDashboardLayoutState?.layoutId ?? currentWorkspacePersistence.savedDashboardLayoutState?.layoutId
  if (currentLayoutId && exportPackage.layoutExport?.layoutId && currentLayoutId !== exportPackage.layoutExport.layoutId) {
    conflicts.push({
      field: 'layoutId',
      current: currentLayoutId,
      incoming: exportPackage.layoutExport.layoutId,
      severity: 'medium',
    })
  }

  const currentPanelOrder = currentModel.savedDashboardLayoutState?.panelOrder ?? currentWorkspacePersistence.savedDashboardLayoutState?.panelOrder ?? []
  const incomingPanelOrder = exportPackage.layoutExport?.panelOrder ?? []
  const missingPanels = currentPanelOrder.filter((panelId) => !incomingPanelOrder.includes(panelId))
  if (missingPanels.length > 0) {
    conflicts.push({
      field: 'panelOrder',
      current: `${currentPanelOrder.length} current panels`,
      incoming: `${incomingPanelOrder.length} incoming panels`,
      severity: 'low',
      missingPanels,
    })
  }

  const recoveryStatus = currentWorkspaceSessionRecovery.recoveryValidationStatus
  if (recoveryStatus && recoveryStatus !== 'restored') {
    conflicts.push({
      field: 'recoveryValidationStatus',
      current: recoveryStatus,
      incoming: exportPackage.recoverySnapshot?.recoveryValidationStatus ?? 'unknown',
      severity: recoveryStatus === 'failed' ? 'high' : 'medium',
    })
  }

  return {
    conflictCount: conflicts.length,
    conflicts,
    highestSeverity: conflicts.some((conflict) => conflict.severity === 'high')
      ? 'high'
      : conflicts.some((conflict) => conflict.severity === 'medium')
        ? 'medium'
        : conflicts.length > 0 ? 'low' : 'none',
  }
}

function resolveImportStatus({ importValidation, importConflictSummary, enterpriseReleaseControl = {}, systemHealthCommandCenter = {} }) {
  if (!importValidation.valid) return 'rejected'
  if (enterpriseReleaseControl.finalReleaseStatus === 'blocked' || systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded') return 'partial'
  if (importConflictSummary.highestSeverity === 'high') return 'partial'
  return importConflictSummary.conflictCount > 0 ? 'partial' : 'imported'
}

export function transferWorkspaceConfiguration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const normalizedExportPackage = input.importPackage ?? buildExportPackage({
    workspacePersistence: input.workspacePersistence,
    workspaceSessionRecovery: input.workspaceSessionRecovery,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    timestamp,
  })
  const importValidation = validateImportPackage(normalizedExportPackage)
  const importConflictSummary = summarizeImportConflicts({
    exportPackage: normalizedExportPackage,
    currentWorkspacePersistence: input.currentWorkspacePersistence ?? input.workspacePersistence,
    currentWorkspaceSessionRecovery: input.currentWorkspaceSessionRecovery ?? input.workspaceSessionRecovery,
  })
  const importStatus = resolveImportStatus({
    importValidation,
    importConflictSummary,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
  })
  const result = {
    eventType: WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    timestamp,
    normalizedExportPackage,
    layoutExport: normalizedExportPackage.layoutExport,
    panelVisibilityExport: normalizedExportPackage.panelVisibilityExport,
    operatorPreferencesExport: normalizedExportPackage.operatorPreferencesExport,
    paperModeProfileExport: normalizedExportPackage.paperModeProfileExport,
    importValidation,
    importConflictSummary,
    importStatus,
    summary: `Workspace configuration transfer ${importStatus}: ${normalizedExportPackage.layoutExport?.panelOrder?.length ?? 0} panels packaged with ${importConflictSummary.conflictCount} import conflicts.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? normalizedExportPackage.sourceEvents?.workspacePersistence ?? null,
      workspaceSessionRecovery: input.workspaceSessionRecovery?.eventType ?? normalizedExportPackage.sourceEvents?.workspaceSessionRecovery ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? normalizedExportPackage.sourceEvents?.enterpriseReleaseControl ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? normalizedExportPackage.sourceEvents?.systemHealthCommandCenter ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(WORKSPACE_CONFIGURATION_TRANSFERRED_EVENT, result)
  }

  return result
}

export function createWorkspaceConfigurationTransferEngine(options = {}) {
  return {
    transfer(input, transferOptions = {}) {
      return transferWorkspaceConfiguration(input, { ...options, ...transferOptions })
    },
  }
}
