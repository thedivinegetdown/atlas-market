import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { releaseAttestationChecksum, validateReleaseAttestationSignature } from './releaseAttestationGateEngine.js'

export const RELEASE_ACCEPTANCE_EVENTS = Object.freeze({
  started: 'releaseAcceptance.started',
  checkCompleted: 'releaseAcceptance.checkCompleted',
  passed: 'releaseAcceptance.passed',
  warning: 'releaseAcceptance.warning',
  failed: 'releaseAcceptance.failed',
  cancelled: 'releaseAcceptance.cancelled',
})

export const RELEASE_ACCEPTANCE_SUITE_TYPES = Object.freeze(['pre_release', 'post_deployment_smoke', 'regression_acceptance', 'recovery_validation'])
export const RELEASE_ACCEPTANCE_RUN_STATES = Object.freeze(['pending', 'running', 'passed', 'warning', 'failed', 'cancelled', 'expired'])
const TERMINAL_STATES = Object.freeze(['passed', 'warning', 'failed', 'cancelled', 'expired'])

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((next, key) => {
      if (!['stack', 'secret', 'token', 'password', 'credential', 'privateUrl', 'storagePath', 'rawConfiguration'].includes(String(key))) next[key] = stable(value[key])
      return next
    }, {})
  }
  return value
}

function checksum(value) {
  return releaseAttestationChecksum(stable(value))
}

function statusOf(value, warningValues = ['warning', 'degraded', 'caution', 'ready']) {
  const normalized = String(value ?? 'warning').toLowerCase()
  if (['passed', 'healthy', 'approved', 'ready', 'available', 'reconciled', 'signed', 'completed', 'validated', 'active', 'qualified', 'simulated'].includes(normalized)) return 'passed'
  if (['failed', 'blocked', 'critical', 'rejected', 'mismatch', 'revoked', 'invalid'].includes(normalized)) return 'failed'
  if (warningValues.includes(normalized)) return 'warning'
  return 'warning'
}

function check(id, category, label, state, message, { readOnly = true, evidenceReference = null } = {}) {
  return {
    id,
    category,
    label,
    checkState: state,
    message,
    readOnly,
    paperSmokeAction: !readOnly,
    evidenceReference,
  }
}

function suiteChecks(input = {}, options = {}) {
  const manifest = input.releaseCandidateManifest ?? {}
  const certification = input.releaseCertification ?? {}
  const recovery = input.releaseRecoveryReadiness ?? {}
  const evidence = input.evidenceSummary ?? {}
  const attestation = input.releaseAttestation ?? {}
  const gate = input.releaseGateEvaluation ?? {}
  const signature = validateReleaseAttestationSignature(attestation, { signingSecret: options.signingSecret ?? input.signingSecret })
  const smokeAuthorized = input.paperSmokeAuthorized === true || input.authorizedPaperSmoke === true
  const checks = [
    check('application-startup', 'application', 'Application startup and health', statusOf(input.releaseReadinessDiagnostics?.releaseReadinessStatus ?? 'healthy'), 'Application health snapshot reviewed.', { evidenceReference: input.releaseReadinessDiagnostics?.eventType }),
    check('database-migration', 'database', 'Database connectivity and migration level', manifest.databaseMigrationLevel && manifest.databaseMigrationLevel !== 'unknown' ? 'passed' : 'warning', 'Migration level is referenced.', { evidenceReference: manifest.databaseMigrationLevel }),
    check('authentication', 'security', 'Authentication', statusOf(input.authenticationReadiness?.authReadinessStatus ?? 'healthy'), 'Authentication boundary reviewed.'),
    check('tenant-isolation', 'security', 'Tenant isolation', evidence.missingCategories?.includes?.('tenant-isolation-verification') ? 'failed' : 'passed', 'Tenant-isolation evidence reviewed.'),
    check('role-authorization', 'security', 'Role authorization', statusOf(input.identityAuthorization?.authorizationStatus ?? 'healthy'), 'Role authorization snapshot reviewed.'),
    check('api-reliability', 'api', 'API reliability envelopes', statusOf(input.apiReliability?.apiReliabilityStatus ?? 'healthy'), 'API reliability envelope reviewed.'),
    check('market-data', 'market-data', 'Market-data freshness and degraded mode', statusOf(input.marketDataScannerHealth?.healthStatus ?? 'healthy'), 'Market-data freshness snapshot reviewed.'),
    check('scanner', 'scanner', 'Scanner health and stale-data suppression', statusOf(input.realtimeScanner?.scannerStatus ?? 'active'), 'Scanner health reviewed.'),
    check('signals', 'signals', 'Signal generation boundaries', statusOf(input.realtimeSignals?.signalStatus ?? 'qualified'), 'Signal generation boundaries are paper-only.'),
    check('paper-decisions', 'paper-trading', 'Paper decision coordination', statusOf(input.realtimePaperDecisions?.decisionStatus ?? 'approved'), 'Paper decision coordinator reviewed.'),
    check('guardrails', 'paper-trading', 'Guardrail enforcement', statusOf(input.realtimePreparedTrades?.preparationStatus ?? 'ready'), 'Guardrail enforcement reviewed.'),
    check('simulated-execution', 'paper-trading', 'Simulated execution', statusOf(input.realtimeSimulatedExecutions?.executionStatus ?? 'simulated'), 'Simulated execution reviewed.', { readOnly: input.suiteType !== 'post_deployment_smoke' || smokeAuthorized }),
    check('paper-accounting', 'accounting', 'Paper accounting', statusOf(input.primaryAccounting?.accountingStatus ?? 'reconciled'), 'Paper accounting snapshot reviewed.'),
    check('reconciliation', 'accounting', 'Reconciliation', statusOf(input.realtimePortfolioReconciliation?.reconciliationStatus ?? 'reconciled'), 'Reconciliation snapshot reviewed.'),
    check('portfolio-pnl', 'portfolio', 'Portfolio and P&L freshness', statusOf(input.realtimePaperPortfolio?.portfolioStatus ?? 'healthy'), 'Portfolio and P&L freshness reviewed.'),
    check('risk-drawdown', 'risk', 'Risk and drawdown monitoring', statusOf(input.realtimePaperRisk?.riskStatus ?? 'healthy'), 'Risk and drawdown snapshot reviewed.'),
    check('operations', 'operations', 'Operations alerts and incidents', statusOf(input.paperOperationsObservability?.healthStatus ?? 'healthy'), 'Operations observability reviewed.'),
    check('reporting', 'reporting', 'Reporting and audit generation', statusOf(input.paperTradingReport?.paperReport?.status ?? 'completed'), 'Reporting output reviewed.'),
    check('report-worker', 'reporting', 'Report jobs and worker execution', statusOf(input.paperReportWorker?.paperReportWorkerRun?.status ?? 'completed'), 'Report worker snapshot reviewed.'),
    check('artifacts', 'reporting', 'Export artifacts and authorized download', statusOf(input.paperReportArtifact?.paperReportArtifact?.status ?? 'available'), 'Artifact availability reviewed.'),
    check('release-candidate', 'release', 'Release candidate state', statusOf(manifest.manifestState, ['validated']), 'Release candidate state reviewed.', { evidenceReference: manifest.releaseCandidateId }),
    check('qa-certification', 'release', 'QA certification', statusOf(certification.certificationState), 'QA certification reviewed.', { evidenceReference: certification.id }),
    check('recovery-readiness', 'release', 'Recovery readiness', statusOf(recovery.recoveryReadinessState), 'Recovery readiness reviewed.', { evidenceReference: recovery.id }),
    check('evidence-verification', 'release', 'Evidence verification', evidence.satisfiesRequiredEvidence === false ? 'failed' : 'passed', 'Required evidence summary reviewed.'),
    check('attestation-integrity', 'release', 'Attestation integrity', attestation.attestationState === 'signed' && signature.valid ? 'passed' : 'failed', 'Signed attestation integrity reviewed.', { evidenceReference: attestation.id }),
    check('release-gate', 'release', 'Final release-gate state', gate.gateState === 'passed' ? 'passed' : 'failed', 'Final release gate reviewed.', { evidenceReference: gate.id }),
    check('paper-only-boundary', 'paper-trading', 'Paper-only boundary verification', manifest.liveOrders === false && manifest.brokerExecution === false ? 'passed' : 'failed', 'No live orders or broker execution are permitted.'),
  ]
  if (input.suiteType === 'post_deployment_smoke' && !smokeAuthorized) {
    checks.push(check('paper-smoke-authorization', 'paper-trading', 'Paper-only smoke action authorization', 'skipped', 'Paper-only smoke actions require explicit authorization.', { readOnly: false }))
  }
  return checks.slice(0, Math.min(40, Math.max(1, Number(input.maxChecks ?? 32))))
}

function runStateFromChecks(checks, requestedState) {
  if (requestedState === 'cancelled' || requestedState === 'expired') return requestedState
  if (requestedState === 'pending' || requestedState === 'running') return requestedState
  if (checks.some((item) => item.checkState === 'failed')) return 'failed'
  if (checks.some((item) => item.checkState === 'warning' || item.checkState === 'skipped')) return 'warning'
  return 'passed'
}

export function createReleaseAcceptanceRun(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const suiteType = RELEASE_ACCEPTANCE_SUITE_TYPES.includes(input.suiteType) ? input.suiteType : 'pre_release'
  const manifest = input.releaseCandidateManifest ?? {}
  const idempotencyKey = input.idempotencyKey ?? checksum({
    organizationId: scope.organizationId,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    suiteType,
    releaseCandidateId: manifest.releaseCandidateId ?? null,
  })
  const duplicate = (input.existingRuns ?? []).find((run) => run.idempotencyKey === idempotencyKey && ['pending', 'running'].includes(run.runState))
  if (duplicate) {
    return {
      eventType: RELEASE_ACCEPTANCE_EVENTS.started,
      timestamp,
      releaseAcceptanceRun: duplicate,
      releaseAcceptanceChecks: duplicate.checks ?? [],
      duplicateSuppressed: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }
  const checks = suiteChecks({ ...input, suiteType }, options)
  const runState = runStateFromChecks(checks, input.runState)
  const passedCount = checks.filter((item) => item.checkState === 'passed').length
  const warningCount = checks.filter((item) => item.checkState === 'warning').length
  const failedCount = checks.filter((item) => item.checkState === 'failed').length
  const skippedCount = checks.filter((item) => item.checkState === 'skipped').length
  const run = {
    id: String(input.id ?? `release-acceptance-${manifest.releaseCandidateId ?? 'rc'}-${suiteType}-${idempotencyKey}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    certificationId: input.releaseCertification?.id ?? input.certificationId ?? null,
    runbookId: input.releaseRunbook?.id ?? input.runbookId ?? null,
    attestationId: input.releaseAttestation?.id ?? input.attestationId ?? null,
    gateEvaluationId: input.releaseGateEvaluation?.id ?? input.gateEvaluationId ?? null,
    productionRunValidationId: input.productionRunValidation?.id ?? input.productionRunValidationId ?? null,
    suiteType,
    runState,
    idempotencyKey,
    checks,
    summary: `Acceptance suite ${suiteType} ${runState}: ${passedCount} passed, ${warningCount} warnings, ${failedCount} failed, ${skippedCount} skipped.`,
    passedCount,
    warningCount,
    failedCount,
    skippedCount,
    blockers: checks.filter((item) => item.checkState === 'failed'),
    recommendations: checks.filter((item) => item.checkState !== 'passed').map((item) => item.message).concat('Keep acceptance validation bounded and paper-only.'),
    evidenceReferences: checks.map((item) => item.evidenceReference).filter(Boolean).slice(0, 40),
    startedAt: timestamp,
    completedAt: TERMINAL_STATES.includes(runState) ? timestamp : null,
    cancelledAt: runState === 'cancelled' ? timestamp : null,
    expiresAt: input.expiresAt ?? new Date(new Date(timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    immutable: TERMINAL_STATES.includes(runState),
    readOnlyChecks: checks.filter((item) => item.readOnly).length,
    paperSmokeActions: checks.filter((item) => item.paperSmokeAction).length,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const eventType = runState === 'passed' ? RELEASE_ACCEPTANCE_EVENTS.passed : runState === 'warning' ? RELEASE_ACCEPTANCE_EVENTS.warning : runState === 'cancelled' ? RELEASE_ACCEPTANCE_EVENTS.cancelled : runState === 'failed' ? RELEASE_ACCEPTANCE_EVENTS.failed : RELEASE_ACCEPTANCE_EVENTS.started
  const result = {
    eventType,
    checkEventType: RELEASE_ACCEPTANCE_EVENTS.checkCompleted,
    timestamp,
    releaseAcceptanceRun: run,
    releaseAcceptanceChecks: checks,
    duplicateSuppressed: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RELEASE_ACCEPTANCE_EVENTS.started, { ...result, eventType: RELEASE_ACCEPTANCE_EVENTS.started })
    checks.forEach((item) => eventBus.emit(RELEASE_ACCEPTANCE_EVENTS.checkCompleted, { ...result, eventType: RELEASE_ACCEPTANCE_EVENTS.checkCompleted, releaseAcceptanceCheck: item }))
    eventBus.emit(eventType, result)
  }
  return result
}

export function cancelReleaseAcceptanceRun(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const run = input.releaseAcceptanceRun ?? input.run ?? {}
  const valid = !TERMINAL_STATES.includes(run.runState)
  const next = {
    ...run,
    runState: valid ? 'cancelled' : run.runState,
    cancelledAt: valid ? timestamp : run.cancelledAt ?? null,
    completedAt: valid ? timestamp : run.completedAt ?? null,
    immutable: true,
    blockedReason: valid ? null : 'terminal_run_immutable',
    updatedAt: timestamp,
  }
  return {
    eventType: valid ? RELEASE_ACCEPTANCE_EVENTS.cancelled : RELEASE_ACCEPTANCE_EVENTS.failed,
    timestamp,
    releaseAcceptanceRun: next,
    validTransition: valid,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createReleaseAcceptanceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const run = input.releaseAcceptanceRun ?? input
      if (!database?.connected) return { ok: true, disabled: true, run }
      const result = await database.query(
        `INSERT INTO atlas_release_acceptance_runs
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, suite_type, run_state, idempotency_key, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [run.id, run.tenantScope.organizationId, run.tenantScope.teamWorkspaceId, run.accountId, run.releaseCandidateId, run.suiteType, run.runState, run.idempotencyKey, run],
      )
      return { ok: true, run: result.rows?.[0]?.payload ?? run, immutable: TERMINAL_STATES.includes(run.runState) }
    },
    async createCheck(input) {
      const checkRecord = input.releaseAcceptanceCheck ?? input
      if (!database?.connected) return { ok: true, disabled: true, check: checkRecord }
      await database.query(
        `INSERT INTO atlas_release_acceptance_checks
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, run_id, category, check_state, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [checkRecord.id, checkRecord.tenantScope.organizationId, checkRecord.tenantScope.teamWorkspaceId, checkRecord.accountId, checkRecord.releaseCandidateId, checkRecord.runId, checkRecord.category, checkRecord.checkState, checkRecord],
      )
      return { ok: true, check: checkRecord }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, suiteType, runState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (suiteType) { params.push(String(suiteType)); clauses.push(`suite_type = $${params.length}`) }
      if (runState) { params.push(String(runState)); clauses.push(`run_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_acceptance_runs
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
