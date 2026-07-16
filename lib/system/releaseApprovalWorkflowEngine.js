import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_APPROVAL_EVENTS = Object.freeze({
  requested: 'releaseApproval.requested',
  approved: 'releaseApproval.approved',
  rejected: 'releaseApproval.rejected',
  revoked: 'releaseApproval.revoked',
})

export const PRODUCTION_RUN_VALIDATION_EVENTS = Object.freeze({
  started: 'productionRunValidation.started',
  passed: 'productionRunValidation.passed',
  warning: 'productionRunValidation.warning',
  failed: 'productionRunValidation.failed',
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

function sanitizeNote(note) {
  return String(note ?? '').replace(/token|secret|password|credential/gi, 'redacted').slice(0, 300)
}

function activeDuplicate(approvals = [], actorId, releaseCandidateId) {
  return approvals.some((approval) => approval.actor?.id === actorId && approval.releaseCandidateId === releaseCandidateId && ['pending', 'approved'].includes(approval.approvalState))
}

function criticalBlockers(manifest = {}) {
  return (manifest.manifestState === 'blocked' || manifest.manifestState === 'superseded' || (manifest.deploymentBlockers?.length ?? 0) > 0)
}

export function requestReleaseApproval(input = {}, options = {}) {
  return transitionReleaseApproval({ ...input, decision: 'pending' }, options)
}

export function transitionReleaseApproval(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const actor = {
    id: input.actor?.id ?? scope.userId ?? 'unknown-actor',
    role: input.actor?.role ?? scope.role ?? 'viewer',
  }
  const manifest = input.releaseCandidateManifest ?? {}
  const releaseCandidateId = input.releaseCandidateId ?? manifest.releaseCandidateId ?? 'unknown-release-candidate'
  const decision = input.decision ?? input.action ?? 'pending'
  const current = input.releaseApproval ?? {}
  const allowedRoles = ['owner', 'admin']
  const invalidTransition = current.approvalState === 'revoked' && decision === 'approved'
    || current.approvalState === 'rejected' && decision === 'approved'
    || current.approvalState === 'approved' && decision === 'pending'
  const duplicate = decision === 'pending' && activeDuplicate(input.existingApprovals ?? [], actor.id, releaseCandidateId)
  const approvalBlocked = (decision === 'approved' || decision === 'pending') && criticalBlockers(manifest)
  const roleDenied = decision !== 'pending' && !allowedRoles.includes(actor.role)
  const state = duplicate || invalidTransition || approvalBlocked || roleDenied ? 'rejected' : decision
  const approval = {
    id: String(input.id ?? current.id ?? `release-approval-${releaseCandidateId}-${actor.id}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId,
    manifestChecksum: manifest.checksum ?? input.manifestChecksum ?? null,
    approvalState: state,
    priority: input.priority ?? 'normal',
    actor,
    sanitizedNote: sanitizeNote(input.note),
    requestedAt: current.requestedAt ?? timestamp,
    approvedAt: state === 'approved' ? timestamp : current.approvedAt ?? null,
    rejectedAt: state === 'rejected' ? timestamp : current.rejectedAt ?? null,
    revokedAt: state === 'revoked' ? timestamp : current.revokedAt ?? null,
    updatedAt: timestamp,
    blockedReason: duplicate ? 'duplicate_active_approval' : invalidTransition ? 'invalid_transition' : approvalBlocked ? 'release_candidate_blocked' : roleDenied ? 'role_not_permitted' : null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const activity = {
    id: `${approval.id}-activity-${Date.parse(timestamp) || Date.now()}`,
    tenantScope: scope,
    accountId: approval.accountId,
    approvalId: approval.id,
    releaseCandidateId,
    actor,
    decision: state,
    sanitizedNote: approval.sanitizedNote,
    createdAt: timestamp,
    appendOnly: true,
  }
  const eventType = state === 'approved' ? RELEASE_APPROVAL_EVENTS.approved : state === 'revoked' ? RELEASE_APPROVAL_EVENTS.revoked : state === 'rejected' ? RELEASE_APPROVAL_EVENTS.rejected : RELEASE_APPROVAL_EVENTS.requested
  const result = {
    eventType,
    timestamp,
    releaseApproval: approval,
    approvalActivity: activity,
    approvalState: state,
    approvalBlocked: approval.blockedReason !== null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Release approval ${state} for ${releaseCandidateId}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(eventType, result)
  return result
}

function check(id, label, status, message) {
  return { id, label, status, message }
}

export function validateProductionRun(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const configuration = input.productionConfigurationValidation ?? {}
  const readiness = input.releaseReadinessDiagnostics ?? {}
  const checks = [
    check('application-health', 'Application health', readiness.releaseReadinessStatus === 'blocked' ? 'failed' : 'passed', 'Application release readiness snapshot reviewed.'),
    check('database-migration', 'Database migration level', manifest.databaseMigrationLevel && manifest.databaseMigrationLevel !== 'unknown' ? 'passed' : 'warning', 'Database migration level is referenced.'),
    check('api-reliability', 'API reliability', input.apiReliability?.apiReliabilityStatus === 'blocked' ? 'failed' : 'passed', 'API reliability snapshot reviewed.'),
    check('auth-tenant', 'Authentication and tenant isolation', input.authenticationReadiness?.authReadinessStatus === 'blocked' ? 'failed' : 'passed', 'Authentication and tenant isolation remain enabled.'),
    check('market-data-freshness', 'Market-data freshness', input.marketDataScannerHealth?.healthStatus === 'critical' ? 'failed' : input.marketDataScannerHealth?.healthStatus === 'degraded' ? 'warning' : 'passed', 'Market-data and scanner health referenced.'),
    check('paper-execution-boundary', 'Paper execution boundary', configuration.configurationValidationStatus === 'blocked' ? 'failed' : 'passed', 'No live-trading configuration is permitted.'),
    check('reconciliation-health', 'Reconciliation health', input.realtimePortfolioReconciliation?.reconciliationStatus === 'mismatch' ? 'failed' : 'passed', 'Reconciliation snapshot reviewed.'),
    check('portfolio-risk-freshness', 'Portfolio and risk freshness', input.realtimePaperRisk?.riskStatus === 'stale' ? 'warning' : 'passed', 'Portfolio and risk snapshots are bounded.'),
    check('operations-observability', 'Operations observability', input.paperOperationsObservability?.healthStatus === 'critical' ? 'failed' : input.paperOperationsObservability?.healthStatus === 'degraded' ? 'warning' : 'passed', 'Operations observability snapshot reviewed.'),
    check('reporting-worker', 'Reporting worker health', input.paperReportWorker?.paperReportWorkerRun?.status === 'failed' ? 'failed' : 'passed', 'Reporting worker status referenced.'),
    check('artifact-availability', 'Artifact availability behavior', input.paperReportArtifact?.paperReportArtifact?.status === 'failed' ? 'failed' : 'passed', 'Artifact availability behavior referenced.'),
  ]
  const blockers = checks.filter((item) => item.status === 'failed')
  const warnings = checks.filter((item) => item.status === 'warning')
  const validationState = blockers.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed'
  const validation = {
    id: String(input.id ?? `production-run-validation-${manifest.releaseCandidateId ?? 'rc'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? input.releaseCandidateId ?? null,
    approvalId: input.releaseApproval?.id ?? input.approvalId ?? null,
    validationState,
    checks,
    warnings,
    blockers,
    recommendations: [
      ...blockers.map((item) => `Resolve ${item.label} before production run signoff.`),
      ...warnings.map((item) => `Review ${item.label} warning after deployment.`),
      'Keep production run validation read-only and paper-only.',
    ],
    validatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const eventType = validationState === 'failed' ? PRODUCTION_RUN_VALIDATION_EVENTS.failed : validationState === 'warning' ? PRODUCTION_RUN_VALIDATION_EVENTS.warning : PRODUCTION_RUN_VALIDATION_EVENTS.passed
  const result = {
    eventType,
    timestamp,
    productionRunValidation: validation,
    validationState,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Production run validation ${validationState}: ${blockers.length} blockers and ${warnings.length} warnings.`,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PRODUCTION_RUN_VALIDATION_EVENTS.started, { ...result, eventType: PRODUCTION_RUN_VALIDATION_EVENTS.started })
    eventBus.emit(eventType, result)
  }
  return result
}

export function createReleaseApprovalRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const approval = input.releaseApproval ?? input
      if (!database?.connected) return { ok: true, disabled: true, approval }
      const result = await database.query(
        `INSERT INTO atlas_release_approvals
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, approval_state, actor_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET approval_state = EXCLUDED.approval_state, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [approval.id, approval.tenantScope.organizationId, approval.tenantScope.teamWorkspaceId, approval.accountId, approval.releaseCandidateId, approval.approvalState, approval.actor.id, approval],
      )
      return { ok: true, approval: result.rows?.[0]?.payload ?? approval }
    },
    async appendActivity(input) {
      const activity = input.approvalActivity ?? input
      if (!database?.connected) return { ok: true, disabled: true, activity }
      await database.query(
        `INSERT INTO atlas_release_approval_activity
          (id, organization_id, team_workspace_id, account_id, approval_id, release_candidate_id, actor_id, decision, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [activity.id, activity.tenantScope.organizationId, activity.tenantScope.teamWorkspaceId, activity.accountId, activity.approvalId, activity.releaseCandidateId, activity.actor.id, activity.decision, activity],
      )
      return { ok: true, activity }
    },
    async list({ tenantContext = {}, accountId, approvalState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (approvalState) { params.push(String(approvalState)); clauses.push(`approval_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_approvals
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}

export function createProductionRunValidationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const validation = input.productionRunValidation ?? input
      if (!database?.connected) return { ok: true, disabled: true, validation }
      const result = await database.query(
        `INSERT INTO atlas_production_run_validations
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, approval_id, validation_state, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET validation_state = EXCLUDED.validation_state, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [validation.id, validation.tenantScope.organizationId, validation.tenantScope.teamWorkspaceId, validation.accountId, validation.releaseCandidateId, validation.approvalId, validation.validationState, validation],
      )
      return { ok: true, validation: result.rows?.[0]?.payload ?? validation }
    },
    async list({ tenantContext = {}, accountId, validationState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (validationState) { params.push(String(validationState)); clauses.push(`validation_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_production_run_validations
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
