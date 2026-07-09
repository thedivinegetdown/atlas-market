import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_POLICY_CONTROL_PLANNED_EVENT = 'system.policyControl.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'ready'
  return 'caution'
}

function policyPlan(id, label, category, sourceStatus, sourceEvent, controls = []) {
  return {
    id,
    label,
    category,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    controls,
    enforcementEnabled: false,
  }
}

function buildFuturePolicyModelPlaceholder() {
  return {
    modelId: 'future-enterprise-policy-model',
    version: '0.1-planning',
    implemented: false,
    enforcementEnabled: false,
    authenticationRequired: false,
    userAccountsRequired: false,
    categories: ['workspace', 'trading-safety', 'data', 'release'],
  }
}

function summarizePolicies(plans) {
  const blockedCount = plans.filter((plan) => plan.status === 'blocked').length
  const cautionCount = plans.filter((plan) => plan.status === 'caution').length
  return {
    totalCategories: plans.length,
    readyCount: plans.filter((plan) => plan.status === 'ready').length,
    cautionCount,
    blockedCount,
    enforcementEnabled: false,
    status: blockedCount > 0 ? 'blocked' : cautionCount > 0 ? 'caution' : 'ready',
  }
}

export function planPolicyControl(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const futurePolicyModelPlaceholder = buildFuturePolicyModelPlaceholder()
  const workspacePolicyPlanning = policyPlan(
    'workspace-policy',
    'Workspace policy planning',
    'workspace',
    input.workspacePersistence?.persistenceStatus ?? input.systemHealthCommandCenter?.finalPlatformHealthStatus,
    input.workspacePersistence?.eventType ?? input.systemHealthCommandCenter?.eventType,
    ['workspace-state-review', 'operator-preference-review', 'paper-mode-profile-review'],
  )
  const tradingSafetyPolicyPlanning = policyPlan(
    'trading-safety-policy',
    'Trading safety policy planning',
    'trading-safety',
    input.complianceReadiness?.paperTradingComplianceBoundarySummary?.status,
    input.complianceReadiness?.eventType,
    ['paper-trading-only', 'no-live-orders', 'no-broker-execution'],
  )
  const dataPolicyPlanning = policyPlan(
    'data-policy',
    'Data policy planning',
    'data',
    input.dataQualityReadiness?.dataQualityStatus === 'blocked'
      || input.dataLineage?.lineageStatus === 'invalid'
      || input.dataRetentionPlanning?.retentionReadinessStatus === 'blocked'
      ? 'blocked'
      : input.dataQualityReadiness?.dataQualityStatus === 'ready'
        && input.dataLineage?.lineageStatus === 'valid'
        && input.dataRetentionPlanning?.retentionReadinessStatus === 'ready'
          ? 'ready'
          : 'caution',
    input.dataQualityReadiness?.eventType ?? input.dataLineage?.eventType,
    ['quality-review', 'lineage-review', 'retention-review'],
  )
  const releasePolicyPlanning = policyPlan(
    'release-policy',
    'Release policy planning',
    'release',
    input.enterpriseReleaseControl?.finalReleaseStatus ?? input.productionDeploymentReadiness?.deploymentReadinessStatus,
    input.enterpriseReleaseControl?.eventType ?? input.productionDeploymentReadiness?.eventType,
    ['release-gate-review', 'deployment-readiness-review', 'operator-action-review'],
  )
  const plans = [
    workspacePolicyPlanning,
    tradingSafetyPolicyPlanning,
    dataPolicyPlanning,
    releasePolicyPlanning,
  ]
  const policyCategorySummary = summarizePolicies(plans)
  const policyReadinessStatus = policyCategorySummary.status
  const result = {
    eventType: SYSTEM_POLICY_CONTROL_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    legalClaimMade: false,
    policyEnforced: false,
    authenticationAdded: false,
    userAccountsAdded: false,
    futurePolicyModelPlaceholder,
    policyCategorySummary,
    workspacePolicyPlanning,
    tradingSafetyPolicyPlanning,
    dataPolicyPlanning,
    releasePolicyPlanning,
    policyReadinessStatus,
    summary: `Policy control planning ${policyReadinessStatus}: ${policyCategorySummary.totalCategories} future policy categories mapped with enforcement disabled.`,
    sourceEvents: {
      complianceReadiness: input.complianceReadiness?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      dataQualityReadiness: input.dataQualityReadiness?.eventType ?? null,
      dataLineage: input.dataLineage?.eventType ?? null,
      dataRetentionPlanning: input.dataRetentionPlanning?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_POLICY_CONTROL_PLANNED_EVENT, result)
  }
  return result
}

export function createPolicyControlPlanningEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return planPolicyControl(input, { ...options, ...evaluationOptions })
    },
  }
}
