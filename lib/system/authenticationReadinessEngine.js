import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AUTH_READINESS_EVALUATED_EVENT = 'system.authReadiness.evaluated'

const ROLE_MODEL = [
  {
    role: 'owner',
    description: 'Future platform owner role with full workspace administration once authentication exists.',
    permissions: ['manageWorkspace', 'manageTemplates', 'reviewRelease', 'reviewSystemHealth', 'acknowledgeOperatorActions'],
  },
  {
    role: 'admin',
    description: 'Future administrative operator role for workspace configuration and release review.',
    permissions: ['manageWorkspace', 'manageTemplates', 'reviewRelease', 'reviewSystemHealth'],
  },
  {
    role: 'analyst',
    description: 'Future analyst role for research, strategy, backtesting, and review workflows.',
    permissions: ['navigateWorkspace', 'applyTemplates', 'reviewResearch', 'reviewBacktests'],
  },
  {
    role: 'viewer',
    description: 'Future read-only role for dashboard visibility and audit review.',
    permissions: ['navigateWorkspace', 'viewPanels', 'viewAuditTrail'],
  },
]

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildFutureUserIdentityModelPlaceholder(input = {}) {
  return {
    modelStatus: 'placeholder',
    userId: input.userId ?? 'future-user-id',
    displayName: input.displayName ?? 'Future Atlas Operator',
    email: input.email ?? null,
    authenticationProvider: 'future-auth-provider',
    persisted: false,
    multiUserSupport: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildOperatorSessionIdentityPlaceholder({ workspacePersistence = {}, workspaceSessionRecovery = {}, workspaceCommandPalette = {} }) {
  return {
    sessionStatus: 'placeholder',
    sessionId: 'future-operator-session',
    workspaceId: workspacePersistence.workspacePersistenceModel?.workspaceId ?? workspacePersistence.savedWorkspaceStateHydration?.workspaceId ?? 'atlas-paper-operator-workspace',
    hydrationSource: workspaceSessionRecovery.savedWorkspaceStateHydration?.source ?? 'none',
    commandContext: workspaceCommandPalette.commandExecutionResult?.commandId ?? null,
    authenticated: false,
    signInRequired: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildPermissionBoundarySummary({ workspaceCommandPalette = {}, enterpriseReleaseControl = {}, systemHealthCommandCenter = {} }) {
  const safeCommandCount = workspaceCommandPalette.commandSafetyClassification?.safeWorkspaceCommands ?? 0
  const tradingCommandCount = workspaceCommandPalette.commandSafetyClassification?.blockedTradingCommands ?? 0
  return {
    status: tradingCommandCount > 0 ? 'caution' : 'ready',
    workspaceActionsOnly: true,
    safeWorkspaceCommandCount: safeCommandCount,
    blockedTradingCommandCount: tradingCommandCount,
    releaseReviewStatus: enterpriseReleaseControl.finalReleaseStatus ?? 'unknown',
    systemHealthStatus: systemHealthCommandCenter.finalPlatformHealthStatus ?? 'unknown',
    allowedScopes: [
      'workspace.navigation',
      'workspace.template',
      'workspace.panelVisibility',
      'operator.review',
      'system.healthReview',
      'release.review',
    ],
    deniedScopes: [
      'broker.order.create',
      'broker.order.cancel',
      'liveExecution.enable',
      'multiUser.persistence',
      'auth.signIn',
    ],
  }
}

function buildPaperModeAccessBoundary({ workspacePersistence = {}, workspaceSessionRecovery = {}, workspaceCommandPalette = {} }) {
  return {
    tradingMode: 'paper',
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    signInUiEnabled: false,
    realAuthenticationEnabled: false,
    multiUserPersistenceEnabled: false,
    workspacePersistenceStatus: workspacePersistence.persistenceStatus ?? 'unknown',
    sessionRecoveryStatus: workspaceSessionRecovery.recoveryValidationStatus ?? 'unknown',
    commandPaletteWorkspaceOnly: workspaceCommandPalette.commandSafetyClassification?.workspaceActionsOnly === true,
  }
}

function resolveAuthReadinessStatus({ permissionBoundarySummary, paperModeAccessBoundary, systemHealthCommandCenter = {}, enterpriseReleaseControl = {} }) {
  if (
    paperModeAccessBoundary.liveOrders
    || paperModeAccessBoundary.brokerageIntegration
    || paperModeAccessBoundary.realAuthenticationEnabled
    || permissionBoundarySummary.blockedTradingCommandCount > 0
  ) {
    return 'blocked'
  }

  if (
    permissionBoundarySummary.status === 'caution'
    || systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded'
    || enterpriseReleaseControl.finalReleaseStatus === 'blocked'
    || paperModeAccessBoundary.sessionRecoveryStatus === 'failed'
  ) {
    return 'caution'
  }

  return 'ready'
}

export function evaluateAuthenticationReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const futureUserIdentityModelPlaceholder = buildFutureUserIdentityModelPlaceholder(input.futureUserIdentity)
  const operatorSessionIdentityPlaceholder = buildOperatorSessionIdentityPlaceholder({
    workspacePersistence: input.workspacePersistence,
    workspaceSessionRecovery: input.workspaceSessionRecovery,
    workspaceCommandPalette: input.workspaceCommandPalette,
  })
  const roleModelPlaceholder = ROLE_MODEL
  const permissionBoundarySummary = buildPermissionBoundarySummary({
    workspaceCommandPalette: input.workspaceCommandPalette,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
  })
  const paperModeAccessBoundary = buildPaperModeAccessBoundary({
    workspacePersistence: input.workspacePersistence,
    workspaceSessionRecovery: input.workspaceSessionRecovery,
    workspaceCommandPalette: input.workspaceCommandPalette,
  })
  const authReadinessStatus = resolveAuthReadinessStatus({
    permissionBoundarySummary,
    paperModeAccessBoundary,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
  })
  const result = {
    eventType: SYSTEM_AUTH_READINESS_EVALUATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    realAuthenticationEnabled: false,
    signInUiEnabled: false,
    multiUserPersistenceEnabled: false,
    timestamp,
    futureUserIdentityModelPlaceholder,
    operatorSessionIdentityPlaceholder,
    roleModelPlaceholder,
    permissionBoundarySummary,
    paperModeAccessBoundary,
    authReadinessStatus,
    summary: `Authentication readiness ${authReadinessStatus}: placeholder identity, session, role, and permission boundaries prepared for future auth.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      workspaceSessionRecovery: input.workspaceSessionRecovery?.eventType ?? null,
      workspaceCommandPalette: input.workspaceCommandPalette?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_AUTH_READINESS_EVALUATED_EVENT, result)
  }

  return result
}

export function createAuthenticationReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateAuthenticationReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
