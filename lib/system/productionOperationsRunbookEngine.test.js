import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT,
  createProductionOperationsRunbookEngine,
  generateProductionOperationsRunbook,
} from './productionOperationsRunbookEngine.js'

const baseInput = {
  productionDeploymentReadiness: {
    eventType: 'system.deploymentReadiness.evaluated',
    deploymentReadinessStatus: 'ready',
    netlifyDeploymentReadinessSummary: { status: 'ready' },
    postgresqlReadinessSummary: { status: 'ready' },
  },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    securityReadinessStatus: 'ready',
    environmentSecretHandlingSummary: { status: 'ready' },
    apiBoundarySecuritySummary: { status: 'ready' },
    paperTradingSafetyLockSummary: { status: 'ready' },
    adapterBrokerMockModeSecuritySummary: { status: 'ready' },
  },
  productionEnvironmentConfiguration: {
    eventType: 'system.environmentConfiguration.planned',
    configurationReadinessStatus: 'ready',
    missingConfigurationSummary: { missingRequired: [] },
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
    liveOrders: false,
    releaseDecisionSummary: { paperTradingOnly: true },
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
}

describe('production operations runbook engine', () => {
  it('generates a ready, non-executable operator runbook', () => {
    const result = generateProductionOperationsRunbook(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T00:15:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT)
    expect(result.operatorHandoffSummary.handoffStatus).toBe('ready')
    expect(result.startupChecklistSummary).toHaveLength(3)
    expect(result.deploymentValidationChecklist).toHaveLength(3)
    expect(result.securityValidationChecklist).toHaveLength(3)
    expect(result.environmentConfigurationChecklist).toHaveLength(2)
    expect(result.paperTradingSafetyChecklist).toHaveLength(3)
    expect(result.incidentResponseChecklist).toHaveLength(3)
    expect(result.rollbackReadinessChecklist).toHaveLength(3)
    expect(result.operatorHandoffSummary.deploymentAuthorized).toBe(false)
    expect(Object.values(result).flat().filter((item) => item?.executable === true)).toEqual([])
    expect(result.liveOrders).toBe(false)
  })

  it('returns a caution handoff when planning items need review', () => {
    const result = generateProductionOperationsRunbook({
      ...baseInput,
      productionEnvironmentConfiguration: {
        ...baseInput.productionEnvironmentConfiguration,
        configurationReadinessStatus: 'caution',
        missingConfigurationSummary: { missingRequired: ['DATABASE_URL'] },
      },
    }, { emitEvent: false })

    expect(result.operatorHandoffSummary.handoffStatus).toBe('caution')
    expect(result.operatorHandoffSummary.reviewCount).toBeGreaterThan(0)
  })

  it('blocks handoff when paper-trading safety fails', () => {
    const result = generateProductionOperationsRunbook({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        paperTradingSafetyLockSummary: { status: 'blocked' },
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        liveOrders: true,
        releaseDecisionSummary: { paperTradingOnly: false },
      },
    }, { emitEvent: false })

    expect(result.operatorHandoffSummary.handoffStatus).toBe('blocked')
    expect(result.operatorHandoffSummary.blockedCount).toBeGreaterThan(0)
    expect(result.operatorHandoffSummary.deploymentAuthorized).toBe(false)
  })

  it('emits operations runbook generated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_OPERATIONS_RUNBOOK_GENERATED_EVENT, (payload) => events.push(payload))

    const result = createProductionOperationsRunbookEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
