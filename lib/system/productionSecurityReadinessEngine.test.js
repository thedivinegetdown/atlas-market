import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_SECURITY_READINESS_EVALUATED_EVENT,
  createProductionSecurityReadinessEngine,
  evaluateProductionSecurityReadiness,
} from './productionSecurityReadinessEngine.js'

const baseInput = {
  productionDeploymentReadiness: {
    eventType: 'system.deploymentReadiness.evaluated',
    deploymentReadinessStatus: 'ready',
    deploymentTriggered: false,
    apiSecurityReadinessSummary: {
      status: 'ready',
      secretsConfigured: true,
      productionExposureEnabled: false,
    },
    paperTradingSafetyDeploymentSummary: {
      status: 'ready',
      tradingMode: 'paper',
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    },
    postgresqlReadinessSummary: {
      status: 'ready',
      implemented: true,
      databaseConfigured: true,
      multiUserSupport: false,
    },
  },
  enterpriseSaasReadiness: { eventType: 'system.saasReadiness.evaluated', saasReadinessStatus: 'ready' },
  authReadiness: {
    eventType: 'system.authReadiness.evaluated',
    authReadinessStatus: 'ready',
    permissionBoundarySummary: { deniedScopes: ['broker.order.create'] },
  },
  permissionPlanning: { eventType: 'system.permissionPlanning.evaluated', permissionReadinessStatus: 'ready' },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
    normalizedAuditRecords: [{ id: 'audit-1' }],
  },
  eventObservability: {
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    criticalEventHealthStatus: { status: 'healthy' },
  },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  marketDataAdapterHealth: {
    eventType: 'marketData.adapter.checked',
    health: { provider: 'mock-market', paperTrading: true },
  },
  brokerAdapterHealth: {
    eventType: 'broker.adapter.checked',
    health: { provider: 'mock-paper-broker', paperTrading: true, liveOrders: false },
  },
}

describe('production security readiness engine', () => {
  it('summarizes a ready future production security plan without exposing secrets', () => {
    const result = evaluateProductionSecurityReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T23:45:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_SECURITY_READINESS_EVALUATED_EVENT)
    expect(result.securityReadinessStatus).toBe('ready')
    expect(result.environmentSecretHandlingSummary.secretValuesExposed).toBe(false)
    expect(result.apiBoundarySecuritySummary.productionExposureEnabled).toBe(false)
    expect(result.paperTradingSafetyLockSummary.safetyLockEnabled).toBe(true)
    expect(result.adapterBrokerMockModeSecuritySummary.status).toBe('ready')
    expect(result.persistenceSecurityReadinessSummary.productionCredentialsStored).toBe(false)
    expect(result.auditSecurityTraceabilitySummary.status).toBe('valid')
    expect(result.deploymentSecurityDependencySummary.deploymentTriggered).toBe(false)
    expect(result.realAuthenticationEnabled).toBe(false)
  })

  it('returns caution while secrets and persistence controls are planned', () => {
    const result = evaluateProductionSecurityReadiness({
      ...baseInput,
      productionDeploymentReadiness: {
        ...baseInput.productionDeploymentReadiness,
        deploymentReadinessStatus: 'caution',
        apiSecurityReadinessSummary: { status: 'caution', secretsConfigured: false },
        postgresqlReadinessSummary: { status: 'caution', implemented: false },
      },
    }, { emitEvent: false })

    expect(result.securityReadinessStatus).toBe('caution')
    expect(result.environmentSecretHandlingSummary.secretValuesIncluded).toBe(false)
  })

  it('blocks readiness when paper safety or mock-mode boundaries fail', () => {
    const result = evaluateProductionSecurityReadiness({
      ...baseInput,
      brokerAdapterHealth: {
        ...baseInput.brokerAdapterHealth,
        health: { provider: 'live-broker', paperTrading: false, liveOrders: true },
      },
    }, { emitEvent: false })

    expect(result.securityReadinessStatus).toBe('blocked')
    expect(result.adapterBrokerMockModeSecuritySummary.status).toBe('blocked')
  })

  it('emits security readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_SECURITY_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createProductionSecurityReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
