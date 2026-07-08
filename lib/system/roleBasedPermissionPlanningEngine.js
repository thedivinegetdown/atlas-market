import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT = 'system.permissionPlanning.evaluated'

const ACCESS_AREAS = {
  workspace: ['navigateWorkspace', 'viewPanels', 'applyTemplates', 'manageWorkspace'],
  strategy: ['reviewStrategies', 'editStrategyBlueprints', 'reviewBacktests'],
  portfolioAnalytics: ['viewPortfolioAnalytics', 'reviewOptimization', 'reviewRisk'],
  releaseControl: ['reviewRelease', 'approveReleaseReview', 'viewAuditTrail'],
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getRoleModel(authReadiness = {}) {
  return authReadiness.roleModelPlaceholder ?? [
    { role: 'owner', permissions: ['manageWorkspace', 'manageTemplates', 'reviewRelease', 'reviewSystemHealth', 'acknowledgeOperatorActions'] },
    { role: 'admin', permissions: ['manageWorkspace', 'manageTemplates', 'reviewRelease', 'reviewSystemHealth'] },
    { role: 'analyst', permissions: ['navigateWorkspace', 'applyTemplates', 'reviewResearch', 'reviewBacktests'] },
    { role: 'viewer', permissions: ['navigateWorkspace', 'viewPanels', 'viewAuditTrail'] },
  ]
}

function buildRoleCapabilityMap(roleModel = []) {
  return roleModel.map((role) => {
    const permissionSet = new Set(role.permissions ?? [])
    const capabilities = {
      workspace: {
        navigate: permissionSet.has('navigateWorkspace') || permissionSet.has('manageWorkspace'),
        configure: permissionSet.has('manageWorkspace'),
        applyTemplates: permissionSet.has('applyTemplates') || permissionSet.has('manageTemplates'),
      },
      strategy: {
        review: permissionSet.has('reviewResearch') || permissionSet.has('reviewBacktests') || permissionSet.has('manageWorkspace'),
        editBlueprints: permissionSet.has('manageWorkspace'),
        backtestReview: permissionSet.has('reviewBacktests') || permissionSet.has('manageWorkspace'),
      },
      portfolioAnalytics: {
        view: permissionSet.has('viewPanels') || permissionSet.has('manageWorkspace') || permissionSet.has('reviewResearch'),
        reviewRisk: permissionSet.has('reviewSystemHealth') || permissionSet.has('manageWorkspace'),
        reviewOptimization: permissionSet.has('manageWorkspace') || permissionSet.has('reviewSystemHealth'),
      },
      releaseControl: {
        review: permissionSet.has('reviewRelease') || permissionSet.has('viewAuditTrail') || permissionSet.has('manageWorkspace'),
        approveReview: role.role === 'owner' || role.role === 'admin',
        auditTrail: permissionSet.has('viewAuditTrail') || permissionSet.has('reviewRelease') || permissionSet.has('manageWorkspace'),
      },
    }

    return {
      role: role.role,
      description: role.description ?? `${role.role} role placeholder`,
      permissions: role.permissions ?? [],
      capabilities,
      enforcementEnabled: false,
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    }
  })
}

function buildPermissionMatrixPlaceholder(roleCapabilityMap = []) {
  return roleCapabilityMap.map((role) => ({
    role: role.role,
    workspace: role.capabilities.workspace,
    strategy: role.capabilities.strategy,
    portfolioAnalytics: role.capabilities.portfolioAnalytics,
    releaseControl: role.capabilities.releaseControl,
  }))
}

function summarizeArea(roleCapabilityMap = [], area) {
  return {
    area,
    plannedRoles: roleCapabilityMap
      .filter((role) => Object.values(role.capabilities[area] ?? {}).some(Boolean))
      .map((role) => role.role),
    enforcementEnabled: false,
    paperTrading: true,
  }
}

function buildRestrictedActionSummary({ authReadiness = {}, workspaceCommandPalette = {} }) {
  const deniedScopes = authReadiness.permissionBoundarySummary?.deniedScopes ?? []
  return {
    restrictedActions: [
      ...deniedScopes,
      'trade.live.submit',
      'brokerage.connection.authorize',
      'permission.enforce',
      'auth.signIn',
    ].filter((item, index, all) => all.indexOf(item) === index),
    blockedTradingCommandCount: workspaceCommandPalette.commandSafetyClassification?.blockedTradingCommands ?? 0,
    enforcementEnabled: false,
    workspacePlanningOnly: true,
  }
}

function resolvePermissionReadinessStatus({ authReadiness = {}, restrictedActionSummary, systemHealthCommandCenter = {}, enterpriseReleaseControl = {} }) {
  if (restrictedActionSummary.blockedTradingCommandCount > 0 || authReadiness.authReadinessStatus === 'blocked') return 'blocked'
  if (
    authReadiness.authReadinessStatus === 'caution'
    || systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded'
    || enterpriseReleaseControl.finalReleaseStatus === 'blocked'
  ) return 'caution'
  return 'ready'
}

export function evaluateRoleBasedPermissionPlanning(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const roleCapabilityMap = buildRoleCapabilityMap(getRoleModel(input.authReadiness))
  const permissionMatrixPlaceholder = buildPermissionMatrixPlaceholder(roleCapabilityMap)
  const workspaceAccessPlanning = summarizeArea(roleCapabilityMap, 'workspace')
  const strategyAccessPlanning = summarizeArea(roleCapabilityMap, 'strategy')
  const portfolioAnalyticsAccessPlanning = summarizeArea(roleCapabilityMap, 'portfolioAnalytics')
  const releaseControlAccessPlanning = summarizeArea(roleCapabilityMap, 'releaseControl')
  const restrictedActionSummary = buildRestrictedActionSummary({
    authReadiness: input.authReadiness,
    workspaceCommandPalette: input.workspaceCommandPalette,
  })
  const permissionReadinessStatus = resolvePermissionReadinessStatus({
    authReadiness: input.authReadiness,
    restrictedActionSummary,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
  })
  const result = {
    eventType: SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    realAuthenticationEnabled: false,
    permissionEnforcementEnabled: false,
    signInUiEnabled: false,
    timestamp,
    permissionMatrixPlaceholder,
    roleCapabilityMap,
    workspaceAccessPlanning,
    strategyAccessPlanning,
    portfolioAnalyticsAccessPlanning,
    releaseControlAccessPlanning,
    restrictedActionSummary,
    permissionReadinessStatus,
    summary: `Permission planning ${permissionReadinessStatus}: ${roleCapabilityMap.length} role placeholders mapped without enforcing permissions.`,
    sourceEvents: {
      authReadiness: input.authReadiness?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      workspaceCommandPalette: input.workspaceCommandPalette?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_PERMISSION_PLANNING_EVALUATED_EVENT, result)
  }

  return result
}

export function createRoleBasedPermissionPlanningEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateRoleBasedPermissionPlanning(input, { ...options, ...evaluationOptions })
    },
  }
}
