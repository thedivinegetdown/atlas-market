import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_PRICING_PACKAGING_PLANNED_EVENT = 'system.pricingPackaging.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved'].includes(status)) return 'ready'
  return 'caution'
}

function packageTier(tierId, label, featureGroups) {
  return {
    tierId,
    label,
    featureGroups,
    priceConfigured: false,
    billingEnabled: false,
    paymentsEnabled: false,
    userAccountsRequired: false,
  }
}

function buildPackageTiersPlaceholder() {
  return [
    packageTier('personal', 'Personal', ['workspace', 'paper-trading', 'research']),
    packageTier('pro', 'Pro', ['workspace', 'paper-trading', 'research', 'strategy']),
    packageTier('team', 'Team', ['workspace', 'paper-trading', 'research', 'strategy', 'governance']),
    packageTier('enterprise', 'Enterprise', ['workspace', 'paper-trading', 'research', 'strategy', 'governance', 'release-control']),
  ]
}

function buildFeatureGroupingSummary(packageTiersPlaceholder) {
  const featureGroups = [...new Set(packageTiersPlaceholder.flatMap((tier) => tier.featureGroups))]
  return {
    featureGroups,
    featureGroupCount: featureGroups.length,
    packageTierCount: packageTiersPlaceholder.length,
    billingFeatureIncluded: false,
    paymentFeatureIncluded: false,
  }
}

function resolvePricingReadinessStatus(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'ready'
}

export function planPricingPackaging(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const packageTiersPlaceholder = buildPackageTiersPlaceholder()
  const futurePackageModelPlaceholder = {
    modelId: 'future-commercial-package-model',
    version: '0.1-planning',
    implemented: false,
    billingEnabled: false,
    paymentsEnabled: false,
    userAccountsRequired: false,
  }
  const featureGroupingSummary = buildFeatureGroupingSummary(packageTiersPlaceholder)
  const workspacePackageCompatibilitySummary = {
    status: normalizeStatus(input.workspaceTemplate?.templateValidationStatus),
    templateCount: input.workspaceTemplate?.defaultTemplates?.length ?? 0,
    commandCount: input.workspaceCommandPalette?.normalizedCommandCatalog?.length ?? 0,
    workspaceOnlyCommands: input.workspaceCommandPalette?.commandSafetyClassification?.workspaceActionsOnly === true,
    sourceEvents: [
      input.workspaceTemplate?.eventType,
      input.workspaceCommandPalette?.eventType,
    ].filter(Boolean),
  }
  const governancePackageCompatibilitySummary = {
    status: normalizeStatus(input.governanceReviewBoard?.governanceDecision),
    complianceStatus: input.complianceReadiness?.complianceReadinessStatus ?? 'unknown',
    policyStatus: input.policyControlPlanning?.policyReadinessStatus ?? 'unknown',
    sourceEvents: [
      input.governanceReviewBoard?.eventType,
      input.complianceReadiness?.eventType,
      input.policyControlPlanning?.eventType,
    ].filter(Boolean),
  }
  const commercialCompatibilitySummary = {
    status: normalizeStatus(input.commercialReadiness?.commercialReadinessStatus),
    billingEnabled: false,
    paymentsEnabled: false,
    sourceEvent: input.commercialReadiness?.eventType ?? null,
  }
  const pricingReadinessStatus = resolvePricingReadinessStatus([
    workspacePackageCompatibilitySummary,
    governancePackageCompatibilitySummary,
    commercialCompatibilitySummary,
  ])
  const result = {
    eventType: SYSTEM_PRICING_PACKAGING_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    paymentsEnabled: false,
    authenticationEnforced: false,
    userAccountsAdded: false,
    futurePackageModelPlaceholder,
    packageTiersPlaceholder,
    featureGroupingSummary,
    workspacePackageCompatibilitySummary,
    governancePackageCompatibilitySummary,
    pricingReadinessStatus,
    summary: `Pricing and packaging planning ${pricingReadinessStatus}: ${packageTiersPlaceholder.length} placeholder tiers mapped with billing and payments disabled.`,
    sourceEvents: {
      commercialReadiness: input.commercialReadiness?.eventType ?? null,
      workspaceTemplate: input.workspaceTemplate?.eventType ?? null,
      workspaceCommandPalette: input.workspaceCommandPalette?.eventType ?? null,
      governanceReviewBoard: input.governanceReviewBoard?.eventType ?? null,
      complianceReadiness: input.complianceReadiness?.eventType ?? null,
      policyControlPlanning: input.policyControlPlanning?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_PRICING_PACKAGING_PLANNED_EVENT, result)
  }
  return result
}

export function createPricingPackagingPlanningEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return planPricingPackaging(input, { ...options, ...evaluationOptions })
    },
  }
}
