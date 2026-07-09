import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT = 'system.customerOnboarding.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved', 'imported', 'executed'].includes(status)) return 'ready'
  return 'caution'
}

function readinessSection(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    ...details,
  }
}

function resolveOnboardingReadinessStatus(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'ready'
}

export function evaluateCustomerOnboardingReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const onboardingFlowPlaceholder = {
    flowId: 'future-customer-onboarding-flow',
    implemented: false,
    authenticationRequired: false,
    userAccountsRequired: false,
    billingRequired: false,
    steps: ['workspace-setup', 'template-selection', 'command-palette-orientation', 'paper-safety-review', 'operator-runbook-review'],
  }
  const workspaceSetupReadiness = readinessSection(
    'workspace-setup',
    'Workspace setup readiness',
    input.workspacePersistence?.persistenceStatus,
    input.workspacePersistence?.eventType,
    {
      localPersistenceReady: input.workspacePersistence?.localPersistenceAdapter?.status ?? 'unknown',
    },
  )
  const templateOnboardingReadiness = readinessSection(
    'template-onboarding',
    'Template onboarding readiness',
    input.workspaceTemplate?.templateValidationStatus,
    input.workspaceTemplate?.eventType,
    {
      defaultTemplateCount: input.workspaceTemplate?.defaultTemplates?.length ?? 0,
    },
  )
  const commandPaletteOnboardingReadiness = readinessSection(
    'command-palette-onboarding',
    'Command palette onboarding readiness',
    input.workspaceCommandPalette?.commandExecutionResult?.status,
    input.workspaceCommandPalette?.eventType,
    {
      workspaceActionsOnly: input.workspaceCommandPalette?.commandSafetyClassification?.workspaceActionsOnly === true,
      availableCommandCount: input.workspaceCommandPalette?.commandAvailabilityChecks?.availableCount ?? 0,
    },
  )
  const paperTradingSafetyOnboardingReadiness = readinessSection(
    'paper-trading-safety-onboarding',
    'Paper-trading safety onboarding readiness',
    input.productionSecurityReadiness?.paperTradingSafetyLockSummary?.status
      ?? input.commercialReadiness?.commercialReadinessStatus,
    input.productionSecurityReadiness?.eventType ?? input.commercialReadiness?.eventType,
    {
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    },
  )
  const supportRunbookReadiness = readinessSection(
    'support-runbook',
    'Support / runbook readiness',
    input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus,
    input.productionOperationsRunbook?.eventType,
    {
      checklistCount: (input.productionOperationsRunbook?.startupChecklistSummary?.length ?? 0)
        + (input.productionOperationsRunbook?.incidentResponseChecklist?.length ?? 0)
        + (input.productionOperationsRunbook?.rollbackReadinessChecklist?.length ?? 0),
    },
  )
  const sections = [
    workspaceSetupReadiness,
    templateOnboardingReadiness,
    commandPaletteOnboardingReadiness,
    paperTradingSafetyOnboardingReadiness,
    supportRunbookReadiness,
  ]
  const onboardingReadinessStatus = resolveOnboardingReadinessStatus(sections)
  const result = {
    eventType: SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    paymentsEnabled: false,
    authenticationEnforced: false,
    userAccountsAdded: false,
    onboardingFlowPlaceholder,
    workspaceSetupReadiness,
    templateOnboardingReadiness,
    commandPaletteOnboardingReadiness,
    paperTradingSafetyOnboardingReadiness,
    supportRunbookReadiness,
    onboardingReadinessStatus,
    summary: `Customer onboarding readiness ${onboardingReadinessStatus}: workspace, templates, commands, paper safety, and runbook support reviewed without accounts or billing.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      workspaceTemplate: input.workspaceTemplate?.eventType ?? null,
      workspaceCommandPalette: input.workspaceCommandPalette?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      commercialReadiness: input.commercialReadiness?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT, result)
  }
  return result
}

export function createCustomerOnboardingReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateCustomerOnboardingReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
