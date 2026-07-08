import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT = 'system.environmentConfiguration.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function variable(name, group, { required = true, sensitive = false, configured = false, purpose, source }) {
  return { name, group, required, sensitive, configured, purpose, source, valueIncluded: false }
}

function buildCatalogs(input = {}) {
  const deployment = input.productionDeploymentReadiness ?? {}
  const security = input.productionSecurityReadiness ?? {}
  const environment = deployment.environmentReadinessSummary ?? {}
  const netlify = deployment.netlifyDeploymentReadinessSummary ?? {}
  const postgres = deployment.postgresqlReadinessSummary ?? {}
  const secretHandling = security.environmentSecretHandlingSummary ?? {}
  const adapterSecurity = security.adapterBrokerMockModeSecuritySummary ?? {}
  const requiredEnvironmentVariableCatalog = [
    variable('NODE_ENV', 'netlify', {
      configured: environment.nodeEnv === 'production',
      purpose: 'Select production runtime behavior.',
      source: 'deployment.environment',
    }),
    variable('TRADING_MODE', 'paper-safety', {
      configured: environment.tradingMode === 'paper',
      purpose: 'Lock every trading workflow to paper mode.',
      source: 'deployment.paper-safety',
    }),
    variable('PAPER_TRADING_ONLY', 'paper-safety', {
      configured: security.paperTradingSafetyLockSummary?.safetyLockEnabled === true,
      purpose: 'Declare the production workspace as paper-trading only.',
      source: 'security.paper-lock',
    }),
    variable('BROKER_ADAPTER_MODE', 'paper-safety', {
      configured: adapterSecurity.status === 'ready' && adapterSecurity.liveOrders !== true,
      purpose: 'Require the mock paper broker adapter.',
      source: 'security.adapter-boundary',
    }),
    variable('DATABASE_URL', 'postgresql', {
      sensitive: true,
      configured: postgres.databaseConfigured === true && secretHandling.secretsConfigured === true,
      purpose: 'Provide the future PostgreSQL connection through managed secrets.',
      source: 'deployment.postgresql',
    }),
  ]
  const optionalEnvironmentVariableCatalog = [
    variable('MARKET_DATA_PROVIDER', 'api-provider', {
      required: false,
      configured: Boolean(adapterSecurity.marketProvider && adapterSecurity.marketProvider !== 'unknown'),
      purpose: 'Select a market-data adapter without embedding credentials.',
      source: 'adapter.market-data',
    }),
    variable('RESEARCH_NEWS_PROVIDER', 'api-provider', {
      required: false,
      configured: false,
      purpose: 'Select a future catalyst/news provider.',
      source: 'research.placeholder',
    }),
    variable('OBSERVABILITY_DSN', 'netlify', {
      required: false,
      sensitive: true,
      configured: false,
      purpose: 'Connect future hosted error telemetry through managed secrets.',
      source: 'observability.placeholder',
    }),
    variable('LOG_LEVEL', 'netlify', {
      required: false,
      configured: false,
      purpose: 'Control future production log verbosity.',
      source: 'observability.placeholder',
    }),
  ]
  const allVariables = [...requiredEnvironmentVariableCatalog, ...optionalEnvironmentVariableCatalog]
  const group = (name) => ({
    name,
    variables: allVariables.filter((item) => item.group === name),
    configuredCount: allVariables.filter((item) => item.group === name && item.configured).length,
    valuesIncluded: false,
  })
  return {
    requiredEnvironmentVariableCatalog,
    optionalEnvironmentVariableCatalog,
    netlifyEnvironmentGrouping: {
      ...group('netlify'),
      configurationStatus: netlify.status ?? 'unknown',
      buildCommandDefined: Boolean(netlify.buildCommand),
      publishDirectoryDefined: Boolean(netlify.publishDirectory),
      functionsDirectoryDefined: Boolean(netlify.functionsDirectory),
    },
    postgresqlEnvironmentGrouping: {
      ...group('postgresql'),
      interfaceStatus: postgres.interfaceStatus ?? 'unknown',
      implementationReady: postgres.implemented === true,
    },
    apiProviderEnvironmentGrouping: {
      ...group('api-provider'),
      marketProvider: adapterSecurity.marketProvider ?? 'unknown',
      paidProviderRequired: false,
    },
    paperTradingSafetyEnvironmentGrouping: {
      ...group('paper-safety'),
      tradingMode: environment.tradingMode ?? 'unknown',
      liveOrders: security.paperTradingSafetyLockSummary?.liveOrders === true,
      brokerageIntegration: security.paperTradingSafetyLockSummary?.brokerageIntegration === true,
    },
  }
}

function buildMissingConfigurationSummary(catalogs) {
  const missingRequired = catalogs.requiredEnvironmentVariableCatalog
    .filter((item) => !item.configured)
    .map((item) => item.name)
  const missingOptional = catalogs.optionalEnvironmentVariableCatalog
    .filter((item) => !item.configured)
    .map((item) => item.name)
  return {
    missingRequired,
    missingOptional,
    requiredConfiguredCount: catalogs.requiredEnvironmentVariableCatalog.length - missingRequired.length,
    requiredTotalCount: catalogs.requiredEnvironmentVariableCatalog.length,
    hasBlockingSafetyConfiguration: catalogs.paperTradingSafetyEnvironmentGrouping.tradingMode !== 'paper'
      || catalogs.paperTradingSafetyEnvironmentGrouping.liveOrders
      || catalogs.paperTradingSafetyEnvironmentGrouping.brokerageIntegration,
    valuesIncluded: false,
  }
}

function resolveConfigurationReadinessStatus(input, missingConfigurationSummary) {
  const deploymentStatus = input.productionDeploymentReadiness?.deploymentReadinessStatus ?? 'unknown'
  const securityStatus = input.productionSecurityReadiness?.securityReadinessStatus ?? 'unknown'
  const releaseStatus = input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown'
  if (
    missingConfigurationSummary.hasBlockingSafetyConfiguration
    || deploymentStatus === 'blocked'
    || securityStatus === 'blocked'
    || releaseStatus === 'blocked'
  ) return 'blocked'
  if (
    missingConfigurationSummary.missingRequired.length > 0
    || deploymentStatus !== 'ready'
    || securityStatus !== 'ready'
    || input.enterpriseSaasReadiness?.saasReadinessStatus !== 'ready'
  ) return 'caution'
  return 'ready'
}

export function planProductionEnvironmentConfiguration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const catalogs = buildCatalogs(input)
  const missingConfigurationSummary = buildMissingConfigurationSummary(catalogs)
  const configurationReadinessStatus = resolveConfigurationReadinessStatus(input, missingConfigurationSummary)
  const result = {
    eventType: SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    secretsIncluded: false,
    deploymentChanged: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    ...catalogs,
    missingConfigurationSummary,
    configurationReadinessStatus,
    summary: `Production environment configuration ${configurationReadinessStatus}: ${missingConfigurationSummary.requiredConfiguredCount} of ${missingConfigurationSummary.requiredTotalCount} required variable descriptors are ready without storing values.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      enterpriseSaasReadiness: input.enterpriseSaasReadiness?.eventType ?? null,
      marketDataAdapterHealth: input.marketDataAdapterHealth?.eventType ?? null,
      brokerAdapterHealth: input.brokerAdapterHealth?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_ENVIRONMENT_CONFIGURATION_PLANNED_EVENT, result)
  }
  return result
}

export function createProductionEnvironmentConfigurationPlanner(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return planProductionEnvironmentConfiguration(input, { ...options, ...evaluationOptions })
    },
  }
}
