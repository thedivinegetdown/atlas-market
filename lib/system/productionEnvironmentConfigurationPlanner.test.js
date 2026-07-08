import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT,
  createProductionEnvironmentConfigurationPlanner,
  planProductionEnvironmentConfiguration,
} from './productionEnvironmentConfigurationPlanner.js'

const baseInput = {
  productionDeploymentReadiness: {
    eventType: 'system.deploymentReadiness.evaluated',
    deploymentReadinessStatus: 'ready',
    environmentReadinessSummary: { status: 'ready', nodeEnv: 'production', tradingMode: 'paper' },
    netlifyDeploymentReadinessSummary: {
      status: 'ready',
      buildCommand: 'npm run build',
      publishDirectory: 'dist',
      functionsDirectory: 'netlify/functions',
    },
    postgresqlReadinessSummary: {
      status: 'ready',
      interfaceStatus: 'ready',
      implemented: true,
      databaseConfigured: true,
    },
  },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    securityReadinessStatus: 'ready',
    environmentSecretHandlingSummary: { status: 'ready', secretsConfigured: true },
    paperTradingSafetyLockSummary: {
      status: 'ready',
      safetyLockEnabled: true,
      liveOrders: false,
      brokerageIntegration: false,
    },
    adapterBrokerMockModeSecuritySummary: {
      status: 'ready',
      marketProvider: 'mock-market',
      brokerProvider: 'mock-paper-broker',
      liveOrders: false,
    },
  },
  enterpriseSaasReadiness: { eventType: 'system.saasReadiness.evaluated', saasReadinessStatus: 'ready' },
  marketDataAdapterHealth: { eventType: 'marketData.adapter.checked' },
  brokerAdapterHealth: { eventType: 'broker.adapter.checked' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
}

describe('production environment configuration planner', () => {
  it('builds a ready value-free production environment catalog', () => {
    const result = planProductionEnvironmentConfiguration(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T00:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT)
    expect(result.configurationReadinessStatus).toBe('ready')
    expect(result.requiredEnvironmentVariableCatalog.map((item) => item.name)).toContain('TRADING_MODE')
    expect(result.optionalEnvironmentVariableCatalog.map((item) => item.name)).toContain('RESEARCH_NEWS_PROVIDER')
    expect(result.netlifyEnvironmentGrouping.buildCommandDefined).toBe(true)
    expect(result.postgresqlEnvironmentGrouping.implementationReady).toBe(true)
    expect(result.apiProviderEnvironmentGrouping.paidProviderRequired).toBe(false)
    expect(result.paperTradingSafetyEnvironmentGrouping.tradingMode).toBe('paper')
    expect(result.missingConfigurationSummary.missingRequired).toEqual([])
    expect(result.requiredEnvironmentVariableCatalog.every((item) => item.valueIncluded === false)).toBe(true)
    expect(result.secretsIncluded).toBe(false)
  })

  it('returns caution and names missing descriptors without values', () => {
    const result = planProductionEnvironmentConfiguration({
      ...baseInput,
      productionDeploymentReadiness: {
        ...baseInput.productionDeploymentReadiness,
        deploymentReadinessStatus: 'caution',
        postgresqlReadinessSummary: {
          ...baseInput.productionDeploymentReadiness.postgresqlReadinessSummary,
          implemented: false,
          databaseConfigured: false,
        },
      },
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        securityReadinessStatus: 'caution',
        environmentSecretHandlingSummary: { status: 'caution', secretsConfigured: false },
      },
    }, { emitEvent: false })

    expect(result.configurationReadinessStatus).toBe('caution')
    expect(result.missingConfigurationSummary.missingRequired).toContain('DATABASE_URL')
  })

  it('blocks configuration readiness when paper safety is violated', () => {
    const result = planProductionEnvironmentConfiguration({
      ...baseInput,
      productionDeploymentReadiness: {
        ...baseInput.productionDeploymentReadiness,
        environmentReadinessSummary: { status: 'blocked', nodeEnv: 'production', tradingMode: 'live' },
      },
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        paperTradingSafetyLockSummary: {
          status: 'blocked',
          safetyLockEnabled: false,
          liveOrders: true,
          brokerageIntegration: true,
        },
      },
    }, { emitEvent: false })

    expect(result.configurationReadinessStatus).toBe('blocked')
    expect(result.missingConfigurationSummary.hasBlockingSafetyConfiguration).toBe(true)
  })

  it('emits environment configuration planned events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT, (payload) => events.push(payload))

    const result = createProductionEnvironmentConfigurationPlanner({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
