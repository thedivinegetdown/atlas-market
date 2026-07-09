import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT,
  createCustomerOnboardingReadinessEngine,
  evaluateCustomerOnboardingReadiness,
} from './customerOnboardingReadinessEngine.js'

const baseInput = {
  workspacePersistence: {
    eventType: 'workspace.persistence.prepared',
    persistenceStatus: 'ready',
    localPersistenceAdapter: { status: 'ready' },
  },
  workspaceTemplate: {
    eventType: 'workspace.template.applied',
    templateValidationStatus: 'valid',
    defaultTemplates: [{ templateId: 'enterprise-release-review' }],
  },
  workspaceCommandPalette: {
    eventType: 'workspace.commandPalette.executed',
    commandExecutionResult: { status: 'executed' },
    commandSafetyClassification: { workspaceActionsOnly: true },
    commandAvailabilityChecks: { availableCount: 8 },
  },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    paperTradingSafetyLockSummary: { status: 'ready' },
  },
  productionOperationsRunbook: {
    eventType: 'system.operationsRunbook.generated',
    operatorHandoffSummary: { handoffStatus: 'ready' },
    startupChecklistSummary: [{ id: 'startup' }],
    incidentResponseChecklist: [{ id: 'incident' }],
    rollbackReadinessChecklist: [{ id: 'rollback' }],
  },
  commercialReadiness: { eventType: 'system.commercialReadiness.evaluated', commercialReadinessStatus: 'ready' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated' },
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated' },
}

describe('customer onboarding readiness engine', () => {
  it('evaluates onboarding readiness without accounts, auth enforcement, or billing', () => {
    const result = evaluateCustomerOnboardingReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T03:10:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT)
    expect(result.onboardingReadinessStatus).toBe('ready')
    expect(result.onboardingFlowPlaceholder.implemented).toBe(false)
    expect(result.workspaceSetupReadiness.status).toBe('ready')
    expect(result.templateOnboardingReadiness.status).toBe('ready')
    expect(result.commandPaletteOnboardingReadiness.status).toBe('ready')
    expect(result.paperTradingSafetyOnboardingReadiness.status).toBe('ready')
    expect(result.supportRunbookReadiness.status).toBe('ready')
    expect(result.billingEnabled).toBe(false)
    expect(result.paymentsEnabled).toBe(false)
    expect(result.authenticationEnforced).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
  })

  it('blocks onboarding when paper-trading safety is blocked', () => {
    const result = evaluateCustomerOnboardingReadiness({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        paperTradingSafetyLockSummary: { status: 'blocked' },
      },
    }, { emitEvent: false })

    expect(result.onboardingReadinessStatus).toBe('blocked')
    expect(result.paperTradingSafetyOnboardingReadiness.status).toBe('blocked')
  })

  it('emits customer onboarding evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_CUSTOMER_ONBOARDING_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createCustomerOnboardingReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
