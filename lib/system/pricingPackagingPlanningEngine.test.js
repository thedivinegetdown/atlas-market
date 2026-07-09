import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_PRICING_PACKAGING_PLANNED_EVENT,
  createPricingPackagingPlanningEngine,
  planPricingPackaging,
} from './pricingPackagingPlanningEngine.js'

const baseInput = {
  commercialReadiness: { eventType: 'system.commercialReadiness.evaluated', commercialReadinessStatus: 'ready' },
  workspaceTemplate: {
    eventType: 'workspace.template.applied',
    templateValidationStatus: 'valid',
    defaultTemplates: [{ templateId: 'trading-operations' }, { templateId: 'research-intelligence' }],
  },
  workspaceCommandPalette: {
    eventType: 'workspace.commandPalette.executed',
    normalizedCommandCatalog: [{ id: 'open-release' }],
    commandSafetyClassification: { workspaceActionsOnly: true },
  },
  governanceReviewBoard: { eventType: 'system.governanceReview.evaluated', governanceDecision: 'approved' },
  complianceReadiness: { eventType: 'system.complianceReadiness.evaluated', complianceReadinessStatus: 'ready' },
  policyControlPlanning: { eventType: 'system.policyControl.planned', policyReadinessStatus: 'ready' },
}

describe('pricing and packaging planning engine', () => {
  it('plans package tiers without prices, billing, or payments', () => {
    const result = planPricingPackaging(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T03:05:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_PRICING_PACKAGING_PLANNED_EVENT)
    expect(result.pricingReadinessStatus).toBe('ready')
    expect(result.futurePackageModelPlaceholder.implemented).toBe(false)
    expect(result.packageTiersPlaceholder.map((tier) => tier.tierId)).toEqual(['personal', 'pro', 'team', 'enterprise'])
    expect(result.packageTiersPlaceholder.every((tier) => tier.priceConfigured === false)).toBe(true)
    expect(result.featureGroupingSummary.billingFeatureIncluded).toBe(false)
    expect(result.workspacePackageCompatibilitySummary.status).toBe('ready')
    expect(result.governancePackageCompatibilitySummary.status).toBe('ready')
    expect(result.billingEnabled).toBe(false)
    expect(result.paymentsEnabled).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
  })

  it('returns caution when commercial readiness is not fully ready', () => {
    const result = planPricingPackaging({
      ...baseInput,
      commercialReadiness: {
        ...baseInput.commercialReadiness,
        commercialReadinessStatus: 'caution',
      },
    }, { emitEvent: false })

    expect(result.pricingReadinessStatus).toBe('caution')
  })

  it('emits pricing and packaging planned events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_PRICING_PACKAGING_PLANNED_EVENT, (payload) => events.push(payload))

    const result = createPricingPackagingPlanningEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
