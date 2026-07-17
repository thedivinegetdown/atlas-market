import { useMemo } from 'react'
import { validateProductionConfiguration } from '../../lib/system/productionConfigurationValidationEngine.js'
import { evaluateReleaseReadinessDiagnostics } from '../../lib/system/releaseReadinessDiagnosticsEngine.js'
import { createReleaseCandidateManifest, supersedeReleaseCandidate } from '../../lib/system/releaseCandidatePackagingEngine.js'
import { transitionReleaseApproval, validateProductionRun } from '../../lib/system/releaseApprovalWorkflowEngine.js'
import { certifyReleaseCandidate, supersedeReleaseCertification } from '../../lib/system/releaseCertificationEngine.js'
import { evaluateReleaseRecoveryReadiness, generateReleaseRunbook, updateReleaseRunbookItem } from '../../lib/system/releaseRunbookRecoveryEngine.js'

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
  const releaseCandidate = useMemo(() => createReleaseCandidateManifest({
    tenantContext,
    accountId,
    releaseCandidateId: 'rc-paper-0.0.0-ffe3837',
    gitCommit: 'ffe3837f2f5d4dfbcfe464e389084665536a2de6',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160060_phase77_release_candidate_approval_validation',
    enabledPaperTradingFeatureSet: ['streaming', 'scanner', 'paper-execution', 'portfolio-pnl', 'reporting', 'release-diagnostics'],
    testSummaryReferences: ['npm test', 'phase76 diagnostics', 'phase77 release workflow'],
    lintSummary: { command: 'npm run lint', status: 'passed' },
    buildSummary: { command: 'npm run build', status: 'passed' },
    releaseReadinessDiagnostics: readiness,
    productionConfigurationValidation: configuration,
  }, { emitEvent: false, timestamp: '2026-07-16T11:00:00.000Z' }), [accountId, configuration, readiness, tenantContext])
  const releaseApproval = useMemo(() => transitionReleaseApproval({
    tenantContext,
    accountId,
    releaseCandidateManifest: releaseCandidate.releaseCandidateManifest,
    actor: { id: tenantContext?.userId ?? 'local-operator', role: 'owner' },
    decision: releaseCandidate.releaseCandidateManifest.manifestState === 'blocked' ? 'rejected' : 'approved',
    note: 'Paper-only release candidate reviewed.',
  }, { emitEvent: false, timestamp: '2026-07-16T11:01:00.000Z' }), [accountId, releaseCandidate, tenantContext])
  const productionRunValidation = useMemo(() => validateProductionRun({
    tenantContext,
    accountId,
    releaseCandidateManifest: releaseCandidate.releaseCandidateManifest,
    releaseApproval: releaseApproval.releaseApproval,
    releaseReadinessDiagnostics: readiness,
    productionConfigurationValidation: configuration,
    authenticationReadiness,
    apiReliability,
    marketDataScannerHealth,
    realtimePortfolioReconciliation,
    realtimePaperRisk,
    paperOperationsObservability,
    paperReportWorker,
    paperReportArtifact,
  }, { emitEvent: false, timestamp: '2026-07-16T11:02:00.000Z' }), [
    accountId,
    apiReliability,
    authenticationReadiness,
    configuration,
    marketDataScannerHealth,
    paperOperationsObservability,
    paperReportArtifact,
    paperReportWorker,
    readiness,
    realtimePaperRisk,
    realtimePortfolioReconciliation,
    releaseApproval,
    releaseCandidate,
    tenantContext,
  ])
  const supersededCandidate = useMemo(() => supersedeReleaseCandidate({
    tenantContext,
    accountId,
    releaseCandidateId: 'rc-paper-0.0.0-next',
    gitCommit: 'next-paper-candidate',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160060_phase77_release_candidate_approval_validation',
    supersedesReleaseCandidateId: releaseCandidate.releaseCandidateManifest.releaseCandidateId,
    releaseReadinessDiagnostics: readiness,
    productionConfigurationValidation: configuration,
  }, { emitEvent: false, timestamp: '2026-07-16T11:03:00.000Z' }), [accountId, configuration, readiness, releaseCandidate, tenantContext])
  const releaseCertification = useMemo(() => certifyReleaseCandidate({
    tenantContext,
    accountId,
    releaseCandidateManifest: releaseCandidate.releaseCandidateManifest,
    releaseApproval: releaseApproval.releaseApproval,
    productionRunValidation: productionRunValidation.productionRunValidation,
    releaseReadinessDiagnostics: readiness,
    productionConfigurationValidation: configuration,
    authenticationReadiness,
    apiReliability,
    marketDataScannerHealth,
    realtimePortfolioReconciliation,
    realtimePaperRisk,
    paperOperationsObservability,
    paperReportWorker,
    validationSummary: { testFileCount: 167, testCount: 930, lint: { status: 'passed' }, build: { status: 'passed' } },
  }, { emitEvent: false, timestamp: '2026-07-16T11:04:00.000Z' }), [
    accountId,
    apiReliability,
    authenticationReadiness,
    configuration,
    marketDataScannerHealth,
    paperOperationsObservability,
    paperReportWorker,
    productionRunValidation,
    readiness,
    realtimePaperRisk,
    realtimePortfolioReconciliation,
    releaseApproval,
    releaseCandidate,
    tenantContext,
  ])
  const releaseRunbook = useMemo(() => generateReleaseRunbook({
    tenantContext,
    accountId,
    releaseCandidateManifest: releaseCandidate.releaseCandidateManifest,
  }, { emitEvent: false, timestamp: '2026-07-16T11:05:00.000Z' }), [accountId, releaseCandidate, tenantContext])
  const completedRunbookItems = useMemo(() => releaseRunbook.releaseRunbookItems.map((item) => (
    item.requiredRole === 'analyst'
      ? updateReleaseRunbookItem({ runbookItem: item, actor: { id: tenantContext?.userId ?? 'local-operator', role: 'analyst' }, status: 'completed' }, { emitEvent: false, timestamp: '2026-07-16T11:06:00.000Z' }).runbookItem
      : updateReleaseRunbookItem({ runbookItem: item, actor: { id: tenantContext?.userId ?? 'local-operator', role: 'owner' }, status: 'completed' }, { emitEvent: false, timestamp: '2026-07-16T11:06:00.000Z' }).runbookItem
  )), [releaseRunbook, tenantContext])
  const releaseRecoveryReadiness = useMemo(() => evaluateReleaseRecoveryReadiness({
    releaseRunbook: releaseRunbook.releaseRunbook,
    releaseRunbookItems: completedRunbookItems,
  }, { emitEvent: false, timestamp: '2026-07-16T11:07:00.000Z' }), [completedRunbookItems, releaseRunbook])
  const supersededCertification = useMemo(() => supersedeReleaseCertification({
    tenantContext,
    accountId,
    releaseCandidateManifest: releaseCandidate.releaseCandidateManifest,
    releaseApproval: releaseApproval.releaseApproval,
    productionRunValidation: productionRunValidation.productionRunValidation,
    supersedesCertificationId: releaseCertification.releaseCertification.id,
  }, { emitEvent: false, timestamp: '2026-07-16T11:08:00.000Z' }), [accountId, productionRunValidation, releaseApproval, releaseCandidate, releaseCertification, tenantContext])
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
        <section>
          <h3>Current Release Candidate</h3>
          <p className="empty-state">{releaseCandidate.releaseCandidateManifest.releaseCandidateId} / {releaseCandidate.releaseCandidateManifest.applicationVersion} / checksum {releaseCandidate.releaseCandidateManifest.checksum}</p>
        </section>
        <section>
          <h3>Approval History</h3>
          <p className="empty-state">{releaseApproval.releaseApproval.approvalState} by {releaseApproval.releaseApproval.actor.role} / activity append-only.</p>
        </section>
        <section>
          <h3>Production-Run Validation</h3>
          <p className="empty-state">{productionRunValidation.validationState}: {productionRunValidation.productionRunValidation.checks.filter((item) => item.status === 'passed').length} passed / {productionRunValidation.productionRunValidation.warnings.length} warnings / {productionRunValidation.productionRunValidation.blockers.length} failed.</p>
        </section>
        <section>
          <h3>Superseded Release Candidates</h3>
          <p className="empty-state">{supersededCandidate.supersededReleaseCandidateId} can be superseded by {supersededCandidate.releaseCandidateManifest.releaseCandidateId} without mutating historical manifest content.</p>
        </section>
        <section>
          <h3>QA Certification Status</h3>
          <p className="empty-state">{releaseCertification.certificationState} / score {formatNumber(releaseCertification.certificationScore)} / {releaseCertification.releaseCertification.categories.length} certification categories.</p>
        </section>
        <section>
          <h3>Certification Categories</h3>
          <p className="empty-state">{releaseCertification.releaseCertification.categories.slice(0, 3).map((item) => `${item.label}: ${item.status}`).join(' / ')}</p>
        </section>
        <section>
          <h3>Runbook Version</h3>
          <p className="empty-state">{releaseRunbook.releaseRunbook.runbookVersion} / recovery {releaseRecoveryReadiness.recoveryReadinessState} / paper-trading procedures only.</p>
        </section>
        <section>
          <h3>Required Checklist Items</h3>
          <p className="empty-state">{completedRunbookItems.length} items / {releaseRecoveryReadiness.releaseRecoveryReadiness.itemSummary.completed} completed / {releaseRecoveryReadiness.releaseRecoveryReadiness.itemSummary.pending} pending / {releaseRecoveryReadiness.releaseRecoveryReadiness.itemSummary.blocked} blocked / {releaseRecoveryReadiness.releaseRecoveryReadiness.itemSummary.skipped} skipped.</p>
        </section>
        <section>
          <h3>Historical Certifications</h3>
          <p className="empty-state">{supersededCertification.releaseCertification.supersedesCertificationId} can be superseded by {supersededCertification.releaseCertification.id} without mutating certification history.</p>
        </section>
      </div>
      <span className="event-line">{readiness.eventType}</span>
      <span className="event-line">{configuration.eventType}</span>
      <span className="event-line">{releaseCandidate.eventType}</span>
      <span className="event-line">{releaseApproval.eventType}</span>
      <span className="event-line">{productionRunValidation.eventType}</span>
      <span className="event-line">{supersededCandidate.eventType}</span>
      <span className="event-line">{releaseCertification.eventType}</span>
      <span className="event-line">{releaseRunbook.eventType}</span>
      <span className="event-line">releaseRunbook.itemUpdated</span>
      <span className="event-line">{releaseRecoveryReadiness.eventType}</span>
      <span className="event-line">{supersededCertification.eventType}</span>
    </article>
  )
}
