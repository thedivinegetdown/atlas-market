import { useMemo } from 'react'
import { validateProductionConfiguration } from '../../lib/system/productionConfigurationValidationEngine.js'
import { evaluateReleaseReadinessDiagnostics } from '../../lib/system/releaseReadinessDiagnosticsEngine.js'

export function ReleaseDiagnosticsPanel({
  tenantContext,
  accountId,
  systems,
  releaseReadinessDiagnostics,
  productionConfigurationValidation,
  MetricCard,
  formatNumber,
}) {
  const [
    authenticationReadiness,
    identityAuthorization,
    apiReliability,
    marketDataScannerHealth,
    realtimeScanner,
    realtimeSignals,
    realtimeSimulatedExecutions,
    primaryAccounting,
    realtimePortfolioReconciliation,
    realtimePaperPortfolio,
    realtimePaperRisk,
    realtimePaperPerformance,
    portfolioRisk,
    paperTradingReport,
    paperReportJob,
    paperReportWorker,
    paperReportArtifact,
    realtimePaperOperations,
    paperOperationsAlerts,
    paperOperationsIncidents,
    paperOperationsObservability,
  ] = systems ?? []
  const evaluatedReadiness = useMemo(() => evaluateReleaseReadinessDiagnostics({
    tenantContext,
    accountId,
    authenticationReadiness,
    identityAuthorization,
    apiReliability,
    marketDataScannerHealth,
    realtimeScanner,
    realtimeSignals,
    realtimeSimulatedExecutions,
    primaryAccounting,
    realtimePortfolioReconciliation,
    realtimePaperPortfolio,
    realtimePaperRisk,
    realtimePaperPerformance,
    portfolioRisk,
    paperTradingReport,
    paperReportJob,
    paperReportWorker,
    paperReportArtifact,
    realtimePaperOperations,
    paperOperationsAlerts,
    paperOperationsIncidents,
    paperOperationsObservability,
  }, { emitEvent: false, timestamp: '2026-07-16T10:45:00.000Z' }), [
    accountId,
    apiReliability,
    authenticationReadiness,
    identityAuthorization,
    marketDataScannerHealth,
    paperOperationsAlerts,
    paperOperationsIncidents,
    paperOperationsObservability,
    paperReportArtifact,
    paperReportJob,
    paperReportWorker,
    paperTradingReport,
    portfolioRisk,
    primaryAccounting,
    realtimePaperOperations,
    realtimePaperPerformance,
    realtimePaperPortfolio,
    realtimePaperRisk,
    realtimePortfolioReconciliation,
    realtimeScanner,
    realtimeSignals,
    realtimeSimulatedExecutions,
    tenantContext,
  ])
  const evaluatedConfiguration = useMemo(() => validateProductionConfiguration({
    tenantContext,
    accountId,
    env: {
      NODE_ENV: 'production',
      TRADING_MODE: 'paper',
      PAPER_TRADING_ONLY: 'true',
      DATABASE_URL: 'configured',
      REPORT_WORKER_ENABLED: 'true',
      REPORT_ARTIFACT_RETENTION_DAYS: '7',
      API_BASE_URL: 'configured',
      ALLOWED_ORIGINS: 'configured',
      MARKET_DATA_PROVIDER: 'mock',
    },
    tenantConfiguration: { configured: true },
    securityConfiguration: { originValidation: true },
    databaseConfigured: true,
    workerConfig: { enabled: true },
    artifactConfig: { retentionDays: 7 },
    apiConfigured: true,
    marketDataProviderConfigured: true,
  }, { emitEvent: false, timestamp: '2026-07-16T10:46:00.000Z' }), [accountId, tenantContext])
  const readiness = releaseReadinessDiagnostics ?? evaluatedReadiness
  const configuration = productionConfigurationValidation ?? evaluatedConfiguration
  return (
    <article id="release-diagnostics" className={`panel release-readiness-panel ${readiness.releaseReadinessStatus}`}>
      <div className="panel-heading">
        <h2>Release Readiness &amp; Production Configuration</h2>
        <span>Unified system diagnostics and configuration validation for paper-only production review.</span>
      </div>
      <div className="guardrail-card-header">
        <div>
          <span>Readiness score</span>
          <strong>{formatNumber(readiness.readinessScore)}</strong>
        </div>
        <span className={`decision-pill ${readiness.releaseReadinessStatus === 'healthy' ? 'positive' : readiness.releaseReadinessStatus === 'warning' ? 'warning' : 'danger'}`}>
          {readiness.releaseReadinessStatus}
        </span>
      </div>
      <p className="empty-state">{readiness.summary}</p>
      <div className="release-validation-summary">
        <MetricCard label="Deployment Blockers" value={formatNumber(readiness.deploymentBlockers.length)} tone={readiness.deploymentBlockers.length ? 'danger' : 'positive'} />
        <MetricCard label="Warning Summary" value={formatNumber(readiness.warnings.length)} tone={readiness.warnings.length ? 'warning' : 'positive'} />
        <MetricCard label="Configuration Status" value={configuration.configurationValidationStatus} tone={configuration.configurationValidationStatus === 'healthy' ? 'positive' : configuration.configurationValidationStatus === 'warning' ? 'warning' : 'danger'} />
        <MetricCard label="Critical Config Findings" value={formatNumber(configuration.criticalSummary.length)} tone={configuration.criticalSummary.length ? 'danger' : 'positive'} />
      </div>
      <div className="release-readiness-list">
        <section>
          <h3>Deployment Blockers</h3>
          <p className="empty-state">{readiness.deploymentBlockers[0]?.message ?? 'No deployment blockers detected.'}</p>
        </section>
        <section>
          <h3>Warning Summary</h3>
          <p className="empty-state">{readiness.warnings[0]?.message ?? 'No release warnings detected.'}</p>
        </section>
        <section>
          <h3>Configuration Validation Results</h3>
          <p className="empty-state">{configuration.findings[0]?.message ?? 'Production configuration validation passed without exposing secret values.'}</p>
        </section>
      </div>
      <span className="event-line">{readiness.eventType}</span>
      <span className="event-line">{configuration.eventType}</span>
    </article>
  )
}
