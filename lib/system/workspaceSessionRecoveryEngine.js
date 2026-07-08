import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createLocalWorkspacePersistenceAdapter } from './workspacePersistenceEngine.js'

export const WORKSPACE_SESSION_RECOVERED_EVENT = 'workspace.session.recovered'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getPreparedModel(workspacePersistence = {}) {
  return workspacePersistence.workspacePersistenceModel ?? null
}

function loadSavedWorkspaceState({ savedWorkspaceState, localAdapter, workspacePersistence }) {
  if (savedWorkspaceState) {
    return {
      source: 'provided',
      loadStatus: 'loaded',
      model: savedWorkspaceState,
    }
  }

  const loaded = localAdapter?.load?.()
  if (loaded?.model && !loaded.model.error) {
    return {
      source: 'local',
      loadStatus: loaded.status,
      model: loaded.model,
    }
  }

  const preparedModel = getPreparedModel(workspacePersistence)
  return {
    source: preparedModel ? 'prepared-persistence' : (loaded?.status ?? 'none'),
    loadStatus: preparedModel ? 'prepared' : (loaded?.status ?? 'missing'),
    model: preparedModel,
    issue: loaded?.model?.error ? loaded.model.message : null,
  }
}

function restoreDashboardLayout(model = {}) {
  const layout = (model ?? {}).savedDashboardLayoutState ?? null
  return {
    restored: Boolean(layout?.layoutId && Array.isArray(layout.panelOrder) && Array.isArray(layout.panels)),
    layoutId: layout?.layoutId ?? null,
    activePanelId: layout?.activePanelId ?? null,
    panelOrder: layout?.panelOrder ?? [],
    panels: layout?.panels ?? [],
  }
}

function restorePanelVisibility(model = {}) {
  const visibility = (model ?? {}).savedPanelVisibilityState ?? null
  return {
    restored: Boolean(visibility && typeof visibility === 'object' && Object.keys(visibility).length > 0),
    visiblePanelIds: Object.entries(visibility ?? {})
      .filter(([, state]) => state?.visible !== false)
      .map(([panelId]) => panelId),
    hiddenPanelIds: Object.entries(visibility ?? {})
      .filter(([, state]) => state?.visible === false)
      .map(([panelId]) => panelId),
    visibilityState: visibility ?? {},
  }
}

function restoreOperatorPreferences(model = {}) {
  const preferences = (model ?? {}).savedOperatorPreferences ?? null
  return {
    restored: Boolean(preferences),
    preferences: {
      theme: preferences?.theme ?? 'system',
      density: preferences?.density ?? 'operator',
      defaultLandingPanel: preferences?.defaultLandingPanel ?? 'enterprise-release-control',
      acknowledgeLowSeverityActions: preferences?.acknowledgeLowSeverityActions ?? false,
      eventRefreshMode: preferences?.eventRefreshMode ?? 'manual',
      reduceMotion: preferences?.reduceMotion ?? false,
    },
  }
}

function restorePaperModeProfile(model = {}) {
  const profile = (model ?? {}).savedPaperModeEnvironmentProfile ?? null
  return {
    restored: Boolean(profile),
    profile: {
      profileId: profile?.profileId ?? 'paper-mode-default',
      tradingMode: profile?.tradingMode ?? 'paper',
      paperTrading: profile?.paperTrading !== false,
      liveOrders: profile?.liveOrders === true,
      brokerageIntegration: profile?.brokerageIntegration === true,
      authenticationEnabled: profile?.authenticationEnabled === true,
      multiUserSupport: profile?.multiUserSupport === true,
      releaseStatus: profile?.releaseStatus ?? 'unknown',
      platformHealthStatus: profile?.platformHealthStatus ?? 'unknown',
      operatorActionSeverity: profile?.operatorActionSeverity ?? 'low',
    },
  }
}

function validateRecovery({ model, layoutRestoration, panelVisibilityRestoration, operatorPreferenceRestoration, paperModeProfileRestoration, releaseControl = {}, systemHealthCommandCenter = {}, loadIssue }) {
  const issues = []

  if (!model) issues.push('No saved workspace state was available to hydrate.')
  if (loadIssue) issues.push(loadIssue)
  if (!layoutRestoration.restored) issues.push('Dashboard layout state could not be restored.')
  if (!panelVisibilityRestoration.restored) issues.push('Panel visibility state could not be restored.')
  if (!operatorPreferenceRestoration.restored) issues.push('Operator preferences could not be restored.')
  if (!paperModeProfileRestoration.restored) issues.push('Paper-mode profile could not be restored.')

  const profile = paperModeProfileRestoration.profile
  if (profile.tradingMode !== 'paper' || profile.liveOrders || profile.brokerageIntegration) {
    issues.push('Recovered workspace profile violates paper-mode safety boundaries.')
  }

  if (releaseControl.finalReleaseStatus === 'blocked') {
    issues.push('Enterprise release control is blocked during recovery.')
  }

  if (systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded') {
    issues.push('System health is degraded during recovery.')
  }

  const failed = !model || issues.some((issue) => /violates paper-mode|No saved workspace/.test(issue))
  const partial = issues.length > 0
  return {
    recoveryValidationStatus: failed ? 'failed' : partial ? 'partial' : 'restored',
    recoveryIssueSummary: issues.length > 0 ? issues : ['Workspace session recovered without validation issues.'],
  }
}

export function recoverWorkspaceSession(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const workspacePersistence = input.workspacePersistence ?? {}
  const localAdapter = options.localAdapter ?? createLocalWorkspacePersistenceAdapter({
    storage: options.storage,
    storageKey: options.storageKey ?? workspacePersistence.localPersistenceAdapter?.storageKey,
  })
  const hydration = loadSavedWorkspaceState({
    savedWorkspaceState: input.savedWorkspaceState,
    localAdapter,
    workspacePersistence,
  })
  const model = hydration.model
  const savedWorkspaceStateHydration = {
    source: hydration.source,
    loadStatus: hydration.loadStatus,
    workspaceId: model?.workspaceId ?? null,
    modelVersion: model?.modelVersion ?? null,
  }
  const layoutRestoration = restoreDashboardLayout(model)
  const panelVisibilityRestoration = restorePanelVisibility(model)
  const operatorPreferenceRestoration = restoreOperatorPreferences(model)
  const paperModeProfileRestoration = restorePaperModeProfile(model)
  const validation = validateRecovery({
    model,
    layoutRestoration,
    panelVisibilityRestoration,
    operatorPreferenceRestoration,
    paperModeProfileRestoration,
    releaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    loadIssue: hydration.issue,
  })
  const result = {
    eventType: WORKSPACE_SESSION_RECOVERED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    timestamp,
    savedWorkspaceStateHydration,
    panelVisibilityRestoration,
    layoutRestoration,
    operatorPreferenceRestoration,
    paperModeProfileRestoration,
    recoveryValidationStatus: validation.recoveryValidationStatus,
    recoveryIssueSummary: validation.recoveryIssueSummary,
    summary: `Workspace session recovery ${validation.recoveryValidationStatus}: ${layoutRestoration.panels.length} panels hydrated from ${hydration.source}.`,
    sourceEvents: {
      workspacePersistence: workspacePersistence.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(WORKSPACE_SESSION_RECOVERED_EVENT, result)
  }

  return result
}

export function createWorkspaceSessionRecoveryEngine(options = {}) {
  return {
    recover(input, recoveryOptions = {}) {
      return recoverWorkspaceSession(input, { ...options, ...recoveryOptions })
    },
  }
}
