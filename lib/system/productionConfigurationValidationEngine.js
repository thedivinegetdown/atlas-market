import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PRODUCTION_CONFIGURATION_VALIDATED_EVENT = 'productionConfiguration.validated'

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function tenantScope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function configured(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function finding(id, category, severity, message, metadata = {}) {
  return {
    id,
    category,
    severity,
    message,
    configured: metadata.configured ?? false,
    valueIncluded: false,
    ...metadata,
  }
}

function statusFromFindings(findings) {
  if (findings.some((item) => item.severity === 'critical')) return 'blocked'
  if (findings.some((item) => item.severity === 'warning')) return 'warning'
  return 'healthy'
}

export function validateProductionConfiguration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const env = input.env ?? {}
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const findings = []
  const tradingMode = env.TRADING_MODE ?? input.tradingMode
  const paperOnly = env.PAPER_TRADING_ONLY ?? input.paperTradingOnly
  const liveTradingEnabled = env.LIVE_TRADING_ENABLED ?? input.liveTradingEnabled

  if (!configured(env.NODE_ENV ?? input.nodeEnv)) findings.push(finding('node-env-missing', 'environment', 'warning', 'NODE_ENV should be configured for production diagnostics.'))
  if (tradingMode !== 'paper') findings.push(finding('trading-mode-paper-required', 'paper-safety', 'critical', 'TRADING_MODE must remain paper for this release boundary.', { configured: configured(tradingMode) }))
  if (!(paperOnly === true || String(paperOnly).toLowerCase() === 'true')) findings.push(finding('paper-trading-only-required', 'paper-safety', 'critical', 'PAPER_TRADING_ONLY must be enabled.'))
  if (String(liveTradingEnabled).toLowerCase() === 'true') findings.push(finding('live-trading-disabled-required', 'paper-safety', 'critical', 'LIVE_TRADING_ENABLED must not be enabled.'))
  if (!configured(env.DATABASE_URL) && input.databaseConfigured !== true) findings.push(finding('database-url-missing', 'database', 'critical', 'Database configuration is required for production persistence readiness.'))
  if (String(env.NODE_ENV ?? input.nodeEnv).toLowerCase() === 'production') {
    if (env.ATLAS_AUTH_MODE !== 'netlify-identity') findings.push(finding('netlify-identity-auth-mode-required', 'authentication', 'critical', 'ATLAS_AUTH_MODE must select Netlify Identity for production.', { configured: configured(env.ATLAS_AUTH_MODE) }))
    if (!configured(env.NETLIFY_IDENTITY_URL ?? env.URL ?? env.DEPLOY_PRIME_URL)) findings.push(finding('netlify-identity-url-missing', 'authentication', 'critical', 'A Netlify site or Identity URL is required for production session verification.'))
  }
  if (!configured(env.REPORT_WORKER_ENABLED) && input.workerConfig?.enabled !== true) findings.push(finding('report-worker-config-missing', 'scheduled-worker', 'warning', 'Scheduled report worker configuration should be enabled for asynchronous reporting.'))
  if (!configured(env.REPORT_ARTIFACT_RETENTION_DAYS) && !configured(input.artifactConfig?.retentionDays)) findings.push(finding('artifact-retention-missing', 'reporting', 'warning', 'Report artifact retention should be configured.'))
  if (!configured(env.API_BASE_URL) && input.apiConfigured !== true) findings.push(finding('api-base-url-missing', 'api', 'warning', 'API base configuration should be declared for production diagnostics.'))
  if (input.tenantConfiguration?.configured !== true && !configured(env.DEFAULT_ORGANIZATION_ID)) findings.push(finding('tenant-config-missing', 'tenant', 'warning', 'Default tenant or organization configuration should be available for diagnostics.'))
  if (input.securityConfiguration?.originValidation !== true && !configured(env.ALLOWED_ORIGINS)) findings.push(finding('origin-validation-config-missing', 'security', 'warning', 'Allowed origin configuration should be declared for write-boundary validation.'))
  if (!configured(env.MARKET_DATA_PROVIDER) && input.marketDataProviderConfigured !== true) findings.push(finding('market-data-provider-missing', 'market-data', 'info', 'Primary market-data provider configuration is not declared; mock/reference provider fallback remains paper-safe.'))
  const aiEnabled = env.ATLAS_AI_ENABLED ?? input.aiConfig?.enabled
  if (String(aiEnabled).toLowerCase() === 'true' && !configured(env.ATLAS_AI_PROVIDER ?? input.aiConfig?.defaultProvider)) findings.push(finding('atlas-ai-provider-missing', 'atlas-ai', 'warning', 'Atlas AI provider descriptor should be configured when AI is enabled.'))
  if (String(aiEnabled).toLowerCase() === 'true' && !configured(env.ATLAS_AI_MODEL ?? input.aiConfig?.defaultModel)) findings.push(finding('atlas-ai-model-missing', 'atlas-ai', 'warning', 'Atlas AI model descriptor should be configured when AI is enabled.'))
  const aiProviderDescriptors = input.aiConfig?.providerDescriptors ?? input.aiConfig?.providers ?? []
  if (String(aiEnabled).toLowerCase() === 'true') {
    if (!Array.isArray(aiProviderDescriptors) || aiProviderDescriptors.length === 0) findings.push(finding('atlas-ai-provider-descriptors-missing', 'atlas-ai', 'warning', 'Administrator-approved Atlas AI provider descriptors should be configured for real-provider routing.', { configured: false }))
    if (Array.isArray(aiProviderDescriptors) && aiProviderDescriptors.some((descriptor) => !Array.isArray(descriptor.allowedModels ?? descriptor.modelAllowlist ?? descriptor.models) && !configured(descriptor.defaultModel ?? descriptor.model))) findings.push(finding('atlas-ai-model-allowlist-missing', 'atlas-ai', 'warning', 'Each real Atlas AI provider descriptor should include an administrator-approved model allowlist.', { configured: false }))
    if (Array.isArray(aiProviderDescriptors) && aiProviderDescriptors.some((descriptor) => descriptor.provider === 'local' || descriptor.provider === 'self_hosted') && !configured(env.ATLAS_AI_LOCAL_PROVIDER_URL ?? input.aiConfig?.localProviderConfigured)) findings.push(finding('atlas-ai-local-provider-url-missing', 'atlas-ai', 'warning', 'Local/self-hosted Atlas AI providers need a server-side private URL; never accept it from browser input.', { configured: false }))
    if (String(env.ATLAS_AI_MOCK_FALLBACK_ENABLED ?? input.aiConfig?.mockFallbackEnabled).toLowerCase() === 'true' && !['test', 'development', 'local'].includes(String(env.NODE_ENV ?? input.nodeEnv ?? '').toLowerCase())) findings.push(finding('atlas-ai-mock-fallback-production', 'atlas-ai', 'warning', 'Mock Atlas AI fallback should be restricted to local or test environments unless explicitly approved for diagnostics.', { configured: true }))
  }
  const opportunityAnalysisEnabled = env.ATLAS_OPPORTUNITY_ANALYSIS_ENABLED ?? input.aiConfig?.opportunityAnalysisEnabled ?? input.opportunityAnalysisEnabled
  const opportunityAnalysisExplicitlyConfigured = configured(env.ATLAS_OPPORTUNITY_ANALYSIS_ENABLED ?? input.aiConfig?.opportunityAnalysisEnabled ?? input.opportunityAnalysisEnabled)
  const opportunityAnalysisRequested = String(opportunityAnalysisEnabled).toLowerCase() === 'true' || opportunityAnalysisEnabled === true
  if (opportunityAnalysisExplicitlyConfigured && (opportunityAnalysisEnabled === false || String(opportunityAnalysisEnabled).toLowerCase() === 'false')) findings.push(finding('atlas-opportunity-analysis-disabled', 'atlas-ai', 'info', 'Opportunity analysis is disabled; deterministic scanners and strategies remain active.', { configured: true }))
  if (opportunityAnalysisRequested) {
    if (!configured(env.ATLAS_OPPORTUNITY_MAX_CANDIDATES ?? input.aiConfig?.maxCandidatesPerRequest ?? input.opportunityConfig?.maxCandidatesPerRequest)) findings.push(finding('atlas-opportunity-max-candidates-missing', 'atlas-ai', 'warning', 'Opportunity analysis candidate limit should be configured for bounded ranking requests.', { configured: false }))
    if (!configured(env.ATLAS_OPPORTUNITY_MAX_COMPARISON_CANDIDATES ?? input.aiConfig?.maxComparisonCandidates ?? input.opportunityConfig?.maxComparisonCandidates)) findings.push(finding('atlas-opportunity-max-comparison-candidates-missing', 'atlas-ai', 'warning', 'Opportunity comparison candidate limit should be configured for bounded requests.', { configured: false }))
    if (!configured(env.ATLAS_OPPORTUNITY_RETENTION_DAYS ?? input.opportunityConfig?.retentionDays)) findings.push(finding('atlas-opportunity-retention-missing', 'atlas-ai', 'warning', 'Opportunity analysis history retention should be configured for bounded persistence.', { configured: false }))
    if (!configured(env.ATLAS_OPPORTUNITY_MIN_DATA_QUALITY ?? input.opportunityConfig?.minimumDataQuality)) findings.push(finding('atlas-opportunity-min-data-quality-missing', 'atlas-ai', 'warning', 'Minimum opportunity data quality should be configured before ranking.', { configured: false }))
  }

  const configurationValidationStatus = statusFromFindings(findings)
  const result = {
    eventType: PRODUCTION_CONFIGURATION_VALIDATED_EVENT,
    timestamp,
    tenantScope: scope,
    accountId,
    configurationValidationStatus,
    findings,
    missingConfiguration: findings.filter((item) => item.id.endsWith('missing') || item.id.includes('-missing')),
    invalidConfiguration: findings.filter((item) => item.severity === 'critical' && !item.id.includes('missing')),
    warningSummary: findings.filter((item) => item.severity === 'warning'),
    criticalSummary: findings.filter((item) => item.severity === 'critical'),
    infoSummary: findings.filter((item) => item.severity === 'info'),
    valuesIncluded: false,
    secretsIncluded: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
    summary: `Production configuration ${configurationValidationStatus}: ${findings.filter((item) => item.severity === 'critical').length} critical, ${findings.filter((item) => item.severity === 'warning').length} warnings.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PRODUCTION_CONFIGURATION_VALIDATED_EVENT, result)
  return result
}

export function createProductionConfigurationValidationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.productionConfigurationValidation ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_production_configuration_validations
          (id, organization_id, team_workspace_id, account_id, validation_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET validation_status = EXCLUDED.validation_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id ?? `production-config-${snapshot.accountId}-${Date.parse(snapshot.timestamp) || Date.now()}`, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.configurationValidationStatus, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, validationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (validationStatus) { params.push(String(validationStatus)); clauses.push(`validation_status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_production_configuration_validations
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
