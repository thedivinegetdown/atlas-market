import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT,
  createProductionDeploymentReadinessEngine,
  evaluateProductionDeploymentReadiness,
} from './productionDeploymentReadinessEngine.js'

const baseInput = {
  releaseReadiness: {
    eventType: 'system.releaseReadiness.evaluated',
    checks: [
      { name: 'environment', status: 'ready', tradingMode: 'paper', nodeEnv: 'production', databaseConfigured: true },
      { name: 'paperTradingSafety', status: 'ready' },
    ],
  },
  netlifyConfiguration: {
    configured: true,
    buildCommand: 'npm run build',
    publishDirectory: 'dist',
    functionsDirectory: 'netlify/functions',
  },
  apiSecurityConfiguration: {
    status: 'ready',
    authenticationEnabled: false,
    authorizationEnforced: false,
    secretsConfigured: true,
  },
  workspacePersistence: {
    eventType: 'workspace.persistence.prepared',
    futurePostgresPersistenceInterface: { status: 'ready', implemented: true, multiUserSupport: false },
  },
  enterpriseSaasReadiness: {
    eventType: 'system.saasReadiness.evaluated',
    saasReadinessStatus: 'ready',
    authReadinessSummary: { status: 'ready' },
    billingEnabled: false,
  },
  organizationWorkspaceReadiness: {
    eventType: 'system.organizationWorkspaceReadiness.evaluated',
    organizationReadinessStatus: 'ready',
  },
  eventObservability: {
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    criticalEventHealthStatus: 'healthy',
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  },
}

describe('production deployment readiness engine', () => {
  it('summarizes a ready future production deployment plan', () => {
    const result = evaluateProductionDeploymentReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T23:30:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT)
    expect(result.deploymentReadinessStatus).toBe('ready')
    expect(result.environmentReadinessSummary.tradingMode).toBe('paper')
    expect(result.netlifyDeploymentReadinessSummary.status).toBe('ready')
    expect(result.postgresqlReadinessSummary.status).toBe('ready')
    expect(result.apiSecurityReadinessSummary.productionExposureEnabled).toBe(false)
    expect(result.observabilityReadinessSummary.status).toBe('healthy')
    expect(result.saasReadinessDependencySummary.status).toBe('ready')
    expect(result.paperTradingSafetyDeploymentSummary.deploymentCanExecuteOrders).toBe(false)
    expect(result.deploymentTriggered).toBe(false)
  })

  it('returns caution while production persistence and security remain placeholders', () => {
    const result = evaluateProductionDeploymentReadiness({
      ...baseInput,
      workspacePersistence: {
        ...baseInput.workspacePersistence,
        futurePostgresPersistenceInterface: { status: 'placeholder', implemented: false },
      },
      apiSecurityConfiguration: { status: 'caution' },
    }, { emitEvent: false })

    expect(result.deploymentReadinessStatus).toBe('caution')
    expect(result.postgresqlReadinessSummary.implemented).toBe(false)
  })

  it('blocks deployment readiness when paper-trading safety is violated', () => {
    const result = evaluateProductionDeploymentReadiness({
      ...baseInput,
      releaseReadiness: {
        ...baseInput.releaseReadiness,
        checks: [
          { name: 'environment', status: 'blocked', tradingMode: 'live', databaseConfigured: true },
          { name: 'paperTradingSafety', status: 'blocked' },
        ],
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        liveOrders: true,
      },
    }, { emitEvent: false })

    expect(result.deploymentReadinessStatus).toBe('blocked')
    expect(result.paperTradingSafetyDeploymentSummary.liveOrders).toBe(true)
  })

  it('emits deployment readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createProductionDeploymentReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
