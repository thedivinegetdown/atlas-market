import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_CERTIFICATION_EVENTS = Object.freeze({
  started: 'releaseCertification.started',
  passed: 'releaseCertification.passed',
  warning: 'releaseCertification.warning',
  failed: 'releaseCertification.failed',
  superseded: 'releaseCertification.superseded',
})

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

function statusOf(value) {
  const normalized = String(value ?? 'warning').toLowerCase()
  if (['passed', 'healthy', 'ready', 'valid', 'available', 'approved', 'completed', 'reconciled'].includes(normalized)) return 'passed'
  if (['failed', 'blocked', 'critical', 'invalid', 'rejected', 'mismatch', 'superseded'].includes(normalized)) return 'failed'
  return 'warning'
}

function category(id, label, sourceStatus, evidenceReference, required = true) {
  const status = statusOf(sourceStatus)
  return {
    id,
    label,
    status,
    required,
    evidenceReference: evidenceReference ?? null,
    message: status === 'passed' ? `${label} evidence is sufficient.` : status === 'warning' ? `${label} evidence should be reviewed.` : `${label} evidence blocks certification.`,
  }
}

function score(categories) {
  if (categories.length === 0) return 0
  const total = categories.reduce((sum, item) => sum + (item.status === 'passed' ? 100 : item.status === 'warning' ? 60 : 0), 0)
  return Math.round(total / categories.length)
}

function certificationState({ manifest = {}, approval = {}, categories = [], productionRunValidation = {}, requestedState }) {
  if (requestedState === 'superseded' || manifest.manifestState === 'superseded') return 'superseded'
  const eligible = approval.approvalState === 'approved' && !['blocked', 'superseded'].includes(manifest.manifestState)
  const blockers = categories.filter((item) => item.status === 'failed' && item.required)
  if (!eligible || blockers.length > 0 || productionRunValidation.validationState === 'failed') return 'failed'
  if (categories.some((item) => item.status === 'warning') || productionRunValidation.validationState === 'warning') return 'warning'
  return 'passed'
}

export function certifyReleaseCandidate(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const approval = input.releaseApproval ?? {}
  const productionRunValidation = input.productionRunValidation ?? {}
  const readiness = input.releaseReadinessDiagnostics ?? {}
  const config = input.productionConfigurationValidation ?? {}
  const validation = input.validationSummary ?? {}
  const categories = [
    category('functional-tests', 'Functional test coverage', validation.tests?.status ?? validation.testStatus ?? 'passed', validation.tests?.reference),
    category('regression-validation', 'Regression validation', validation.regression?.status ?? validation.regressionStatus ?? 'passed', validation.regression?.reference),
    category('authorization-tenant-isolation', 'Authorization and tenant isolation', input.authenticationReadiness?.authReadinessStatus ?? 'passed', input.authenticationReadiness?.eventType),
    category('paper-boundary', 'Paper-only boundary verification', manifest.liveOrders === false && manifest.brokerExecution === false ? 'passed' : 'failed', manifest.releaseCandidateId),
    category('database-migration', 'Database migration readiness', manifest.databaseMigrationLevel && manifest.databaseMigrationLevel !== 'unknown' ? 'passed' : 'warning', manifest.databaseMigrationLevel),
    category('api-reliability', 'API reliability', input.apiReliability?.apiReliabilityStatus ?? 'passed', input.apiReliability?.eventType),
    category('market-scanner', 'Market-data and scanner health', input.marketDataScannerHealth?.healthStatus ?? 'passed', input.marketDataScannerHealth?.eventType),
    category('execution-reconciliation', 'Simulated execution and reconciliation', input.realtimePortfolioReconciliation?.reconciliationStatus ?? 'passed', input.realtimePortfolioReconciliation?.eventType),
    category('portfolio-risk-performance', 'Portfolio, risk, and performance freshness', input.realtimePaperRisk?.riskStatus ?? 'passed', input.realtimePaperRisk?.eventType),
    category('operations-observability', 'Operations alerting and observability', input.paperOperationsObservability?.healthStatus ?? 'passed', input.paperOperationsObservability?.eventType),
    category('reporting-artifacts', 'Reporting jobs, worker, deliveries, and artifacts', input.paperReportWorker?.paperReportWorkerRun?.status ?? 'passed', input.paperReportWorker?.eventType),
    category('production-configuration', 'Production configuration', config.configurationValidationStatus ?? 'passed', config.eventType),
    category('build-bundle', 'Build and bundle health', manifest.buildSummary?.status ?? validation.build?.status ?? 'passed', manifest.buildSummary?.command),
    category('release-approval', 'Release approval status', approval.approvalState ?? 'pending', approval.id),
    category('production-run-validation', 'Production-run validation status', productionRunValidation.validationState ?? 'pending', productionRunValidation.id),
  ]
  const blockers = categories.filter((item) => item.status === 'failed' && item.required)
  const warnings = categories.filter((item) => item.status === 'warning')
  const certification = {
    id: String(input.id ?? `release-certification-${manifest.releaseCandidateId ?? 'rc'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    manifestChecksum: manifest.checksum ?? null,
    certificationState: certificationState({ manifest, approval, categories, productionRunValidation, requestedState: input.certificationState }),
    certificationScore: score(categories),
    categories,
    warnings,
    blockers,
    recommendations: [
      ...blockers.map((item) => `Resolve ${item.label} before v1.0 certification.`),
      ...warnings.map((item) => `Review ${item.label} warning before v1.0 signoff.`),
      'Preserve paper-only release behavior during certification.',
    ],
    evidenceSummary: {
      testFileCount: validation.testFileCount ?? manifest.testSummaryReferences?.length ?? 0,
      testCount: validation.testCount ?? 0,
      lintStatus: manifest.lintSummary?.status ?? validation.lint?.status ?? 'not_reported',
      buildStatus: manifest.buildSummary?.status ?? validation.build?.status ?? 'not_reported',
      warningCount: warnings.length,
      migrationLevel: manifest.databaseMigrationLevel ?? 'unknown',
      releaseReadinessReference: readiness.timestamp ?? readiness.eventType ?? null,
      configurationReference: config.timestamp ?? config.eventType ?? null,
      productionRunValidationReference: productionRunValidation.id ?? productionRunValidation.validationState ?? null,
    },
    supersedesCertificationId: input.supersedesCertificationId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const eventType = certification.certificationState === 'passed' ? RELEASE_CERTIFICATION_EVENTS.passed : certification.certificationState === 'warning' ? RELEASE_CERTIFICATION_EVENTS.warning : certification.certificationState === 'superseded' ? RELEASE_CERTIFICATION_EVENTS.superseded : RELEASE_CERTIFICATION_EVENTS.failed
  const result = {
    eventType,
    timestamp,
    releaseCertification: certification,
    certificationState: certification.certificationState,
    certificationScore: certification.certificationScore,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Release certification ${certification.certificationState}: score ${certification.certificationScore}, ${blockers.length} blockers, ${warnings.length} warnings.`,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RELEASE_CERTIFICATION_EVENTS.started, { ...result, eventType: RELEASE_CERTIFICATION_EVENTS.started })
    eventBus.emit(eventType, result)
  }
  return result
}

export function supersedeReleaseCertification(input = {}, options = {}) {
  return certifyReleaseCandidate({ ...input, certificationState: 'superseded' }, options)
}

export function createReleaseCertificationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const certification = input.releaseCertification ?? input
      if (!database?.connected) return { ok: true, disabled: true, certification }
      const result = await database.query(
        `INSERT INTO atlas_release_qa_certifications
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, certification_state, certification_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [certification.id, certification.tenantScope.organizationId, certification.tenantScope.teamWorkspaceId, certification.accountId, certification.releaseCandidateId, certification.certificationState, certification.certificationScore, certification],
      )
      return { ok: true, certification: result.rows?.[0]?.payload ?? certification, immutable: true }
    },
    async list({ tenantContext = {}, accountId, certificationState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (certificationState) { params.push(String(certificationState)); clauses.push(`certification_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_qa_certifications
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
