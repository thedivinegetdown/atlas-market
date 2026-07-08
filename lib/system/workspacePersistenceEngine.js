import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const WORKSPACE_PERSISTENCE_PREPARED_EVENT = 'workspace.persistence.prepared'

const DEFAULT_STORAGE_KEY = 'atlas-market.workspace.v1'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function resolveStorage(storage) {
  if (storage) return storage
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  return null
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null
  } catch (error) {
    return {
      error: 'workspace_persistence_parse_failed',
      message: error?.message ?? 'Unable to parse saved workspace state.',
    }
  }
}

export function createLocalWorkspacePersistenceAdapter({ storage, storageKey = DEFAULT_STORAGE_KEY } = {}) {
  const resolvedStorage = resolveStorage(storage)
  const available = Boolean(resolvedStorage?.getItem && resolvedStorage?.setItem && resolvedStorage?.removeItem)

  return {
    kind: 'local',
    name: 'Local workspace persistence adapter',
    status: available ? 'available' : 'unavailable',
    storageKey,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    load() {
      if (!available) return { status: 'unavailable', model: null }
      return {
        status: 'loaded',
        model: safeJsonParse(resolvedStorage.getItem(storageKey)),
      }
    },
    save(model) {
      if (!available) return { status: 'unavailable', storageKey }
      resolvedStorage.setItem(storageKey, JSON.stringify(model))
      return { status: 'saved', storageKey }
    },
    clear() {
      if (!available) return { status: 'unavailable', storageKey }
      resolvedStorage.removeItem(storageKey)
      return { status: 'cleared', storageKey }
    },
  }
}

export function createPostgresWorkspacePersistenceInterface() {
  return {
    kind: 'postgres',
    name: 'Future PostgreSQL workspace persistence interface',
    status: 'placeholder',
    implemented: false,
    operations: [
      'saveWorkspaceState',
      'loadWorkspaceState',
      'listWorkspaceSnapshots',
      'archiveWorkspaceSnapshot',
    ],
    authRequired: false,
    multiUserSupport: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function normalizeNavigationItem(item, index) {
  return {
    id: item.id,
    label: item.label,
    status: item.status ?? 'unknown',
    sortOrder: index,
    visible: item.visible !== false,
    pinned: item.pinned === true,
  }
}

function buildDashboardLayoutState({ navigation = [], activePanelId }) {
  const normalizedPanels = navigation.map(normalizeNavigationItem)
  return {
    layoutId: 'atlas-default-operator-layout',
    activePanelId: activePanelId ?? normalizedPanels[0]?.id ?? 'release-control',
    panelOrder: normalizedPanels.map((panel) => panel.id),
    panels: normalizedPanels,
    savedAt: null,
  }
}

function buildPanelVisibilityState({ navigation = [], hiddenPanelIds = [] }) {
  const hidden = new Set(hiddenPanelIds)
  return Object.fromEntries(navigation.map((item) => [
    item.id,
    {
      visible: !hidden.has(item.id),
      collapsed: false,
      lastStatus: item.status ?? 'unknown',
    },
  ]))
}

function buildOperatorPreferences(preferences = {}) {
  return {
    theme: preferences.theme ?? 'system',
    density: preferences.density ?? 'operator',
    defaultLandingPanel: preferences.defaultLandingPanel ?? 'enterprise-release-control',
    acknowledgeLowSeverityActions: preferences.acknowledgeLowSeverityActions ?? false,
    eventRefreshMode: preferences.eventRefreshMode ?? 'manual',
    reduceMotion: preferences.reduceMotion ?? false,
  }
}

function buildPaperModeEnvironmentProfile({ enterpriseReleaseControl = {}, systemHealthCommandCenter = {}, operatorActionCenter = {} }) {
  return {
    profileId: 'paper-mode-default',
    tradingMode: 'paper',
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    releaseStatus: enterpriseReleaseControl.finalReleaseStatus ?? 'unknown',
    platformHealthStatus: systemHealthCommandCenter.finalPlatformHealthStatus ?? 'unknown',
    operatorActionSeverity: operatorActionCenter.platformActionSummary?.topSeverity ?? 'low',
  }
}

function buildAdapterSummary(adapter) {
  return {
    kind: adapter.kind,
    name: adapter.name,
    status: adapter.status,
    storageKey: adapter.storageKey ?? null,
    paperTrading: adapter.paperTrading,
    liveOrders: adapter.liveOrders,
    brokerageIntegration: adapter.brokerageIntegration,
  }
}

function buildPersistenceStatus({ localAdapter, enterpriseReleaseControl = {}, systemHealthCommandCenter = {} }) {
  if (enterpriseReleaseControl.finalReleaseStatus === 'blocked' || systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded') {
    return 'caution'
  }

  return localAdapter.status === 'available' ? 'prepared' : 'prepared'
}

export function prepareWorkspacePersistence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const localAdapter = options.localAdapter ?? createLocalWorkspacePersistenceAdapter({
    storage: options.storage,
    storageKey: options.storageKey,
  })
  const postgresInterface = options.postgresInterface ?? createPostgresWorkspacePersistenceInterface()
  const navigation = input.dashboardNavigation ?? input.navigation ?? []
  const savedDashboardLayoutState = buildDashboardLayoutState({
    navigation,
    activePanelId: input.activePanelId,
  })
  const savedPanelVisibilityState = buildPanelVisibilityState({
    navigation,
    hiddenPanelIds: input.hiddenPanelIds ?? [],
  })
  const savedOperatorPreferences = buildOperatorPreferences(input.operatorPreferences)
  const savedPaperModeEnvironmentProfile = buildPaperModeEnvironmentProfile({
    enterpriseReleaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    operatorActionCenter: input.operatorActionCenter,
  })
  const workspacePersistenceModel = {
    modelVersion: '1.0.0',
    workspaceId: input.workspaceId ?? 'atlas-paper-operator-workspace',
    savedDashboardLayoutState,
    savedPanelVisibilityState,
    savedOperatorPreferences,
    savedPaperModeEnvironmentProfile,
  }
  const localPersistenceAdapter = buildAdapterSummary(localAdapter)
  const futurePostgresPersistenceInterface = {
    kind: postgresInterface.kind,
    name: postgresInterface.name,
    status: postgresInterface.status,
    implemented: postgresInterface.implemented,
    operations: postgresInterface.operations,
    authRequired: postgresInterface.authRequired,
    multiUserSupport: postgresInterface.multiUserSupport,
    paperTrading: postgresInterface.paperTrading,
    liveOrders: postgresInterface.liveOrders,
    brokerageIntegration: postgresInterface.brokerageIntegration,
  }
  const persistenceStatus = buildPersistenceStatus({
    localAdapter,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
  })
  const result = {
    eventType: WORKSPACE_PERSISTENCE_PREPARED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    authenticationEnabled: false,
    multiUserSupport: false,
    timestamp,
    persistenceStatus,
    workspacePersistenceModel,
    savedDashboardLayoutState,
    savedPanelVisibilityState,
    savedOperatorPreferences,
    savedPaperModeEnvironmentProfile,
    localPersistenceAdapter,
    futurePostgresPersistenceInterface,
    summary: `Workspace persistence ${persistenceStatus}: ${savedDashboardLayoutState.panels.length} dashboard panels prepared for paper-mode operator state.`,
    sourceEvents: {
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(WORKSPACE_PERSISTENCE_PREPARED_EVENT, result)
  }

  return result
}

export function createWorkspacePersistenceEngine(options = {}) {
  return {
    prepare(input, preparationOptions = {}) {
      return prepareWorkspacePersistence(input, { ...options, ...preparationOptions })
    },
    createLocalAdapter(adapterOptions = {}) {
      return createLocalWorkspacePersistenceAdapter({ ...options, ...adapterOptions })
    },
    createPostgresInterface() {
      return createPostgresWorkspacePersistenceInterface()
    },
  }
}
