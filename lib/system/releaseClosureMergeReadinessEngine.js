import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { validateReleaseAttestationSignature, releaseAttestationChecksum } from './releaseAttestationGateEngine.js'

export const ATLAS_MARKET_VERSION = '1.0.0'

export const RELEASE_CLOSURE_EVENTS = Object.freeze({
  evaluated: 'releaseClosure.evaluated',
  ready: 'releaseClosure.ready',
  warning: 'releaseClosure.warning',
  blocked: 'releaseClosure.blocked',
  closed: 'releaseClosure.closed',
  revoked: 'releaseClosure.revoked',
  superseded: 'releaseClosure.superseded',
})

export const MERGE_READINESS_EVENTS = Object.freeze({
  evaluated: 'mergeReadiness.evaluated',
  ready: 'mergeReadiness.ready',
  warning: 'mergeReadiness.warning',
  blocked: 'mergeReadiness.blocked',
})

export const RELEASE_CLOSURE_STATES = Object.freeze(['pending', 'ready', 'warning', 'blocked', 'closed', 'revoked', 'superseded'])
export const MERGE_RECOMMENDATIONS = Object.freeze(['ready_for_pr', 'ready_with_warnings', 'not_ready'])

const REQUIRED_DOCUMENTATION = Object.freeze(['release_notes', 'operator_guide', 'administrator_guide', 'final_handoff_checklist'])
const REQUIRED_EVIDENCE = Object.freeze([
  'functional-test-results',
  'regression-test-results',
  'lint-results',
  'build-results',
  'security-review',
  'tenant-isolation-verification',
  'paper-only-boundary-verification',
])

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

function sanitize(value, max = 400) {
  return String(value ?? '')
    .replace(/token|secret|password|credential|https?:\/\/\S+|DATABASE_URL=\S+|private key|begin rsa|begin openssh/gi, 'redacted')
    .slice(0, max)
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((next, key) => {
      if (!['stack', 'secret', 'token', 'password', 'credential', 'privateUrl', 'storagePath', 'rawConfiguration', 'signingSecret'].includes(String(key))) next[key] = stable(value[key])
      return next
    }, {})
  }
  return value
}

function checksum(value) {
  return releaseAttestationChecksum(stable(value))
}

function check(id, label, passed, message, severity = 'critical', reference = null) {
  return {
    id,
    label,
    status: passed ? 'passed' : 'blocked',
    severity: passed ? 'info' : severity,
    message,
    reference,
  }
}

function okWithWarnings(state, passState, warningState, acceptedWarnings) {
  return state === passState || (acceptedWarnings && state === warningState)
}

function docsPublished(documents = []) {
  const published = new Set(documents.filter((item) => item.documentationState === 'published').map((item) => item.documentationType))
  return REQUIRED_DOCUMENTATION.every((type) => published.has(type))
}

function evidenceCurrent(evidence = [], manifest = {}) {
  const current = evidence.filter((item) => item.verificationState === 'verified' && item.releaseCandidateId === manifest.releaseCandidateId && !item.expirationTimestamp && item.verificationState !== 'expired')
  const categories = new Set(current.map((item) => item.category))
  return {
    current,
    categories,
    missing: REQUIRED_EVIDENCE.filter((category) => !categories.has(category)),
  }
}

function hasCriticalIncident(incidents = []) {
  return incidents.some((incident) => ['open', 'investigating'].includes(incident.incidentState ?? incident.status) && ['critical', 'high'].includes(incident.severity))
}

function closureChecks(input = {}, options = {}) {
  const manifest = input.releaseCandidateManifest ?? {}
  const approval = input.releaseApproval ?? {}
  const config = input.productionConfigurationValidation ?? {}
  const productionRun = input.productionRunValidation ?? {}
  const certification = input.releaseCertification ?? {}
  const recovery = input.releaseRecoveryReadiness ?? {}
  const attestation = input.releaseAttestation ?? {}
  const gate = input.releaseGateEvaluation ?? {}
  const acceptance = input.releaseAcceptanceRun ?? {}
  const handoff = input.releaseHandoffEvaluation ?? {}
  const evidence = evidenceCurrent(input.releaseEvidence ?? [], manifest)
  const acceptedWarnings = input.acceptedWarnings === true
  const signature = validateReleaseAttestationSignature(attestation, { signingSecret: options.signingSecret ?? input.signingSecret })
  return [
    check('release-candidate-active', 'Release candidate active', Boolean(manifest.releaseCandidateId) && !['blocked', 'superseded'].includes(manifest.manifestState), 'Release candidate is missing, blocked, or superseded.', 'critical', manifest.releaseCandidateId),
    check('manifest-checksum', 'Release manifest checksum valid', String(manifest.checksum ?? '').startsWith('fnv1a-'), 'Release manifest checksum is missing or invalid.', 'critical', manifest.checksum),
    check('approval-active', 'Required approval active', approval.approvalState === 'approved', 'Release approval must be approved and not revoked.', 'critical', approval.id),
    check('configuration', 'Production configuration validation', (config.criticalSummary?.length ?? 0) === 0 && config.configurationValidationStatus !== 'blocked', 'Critical production configuration findings remain.', 'critical', config.id),
    check('production-run', 'Production-run validation', okWithWarnings(productionRun.validationState, 'passed', 'warning', acceptedWarnings), 'Production-run validation must pass or have accepted warnings.', 'critical', productionRun.id),
    check('qa-certification', 'QA certification', okWithWarnings(certification.certificationState, 'passed', 'warning', acceptedWarnings), 'QA certification must pass or have accepted warnings.', 'critical', certification.id),
    check('recovery-readiness', 'Recovery readiness', okWithWarnings(recovery.recoveryReadinessState, 'ready', 'warning', acceptedWarnings), 'Recovery readiness must be ready or have accepted warnings.', 'critical', recovery.id),
    check('evidence-current', 'Required release evidence current', evidence.missing.length === 0, `Missing required evidence: ${evidence.missing.join(', ') || 'none'}.`, 'critical'),
    check('attestation-valid', 'Signed attestation valid', attestation.attestationState === 'signed' && signature.valid, 'Signed attestation must be valid and not revoked or superseded.', 'critical', attestation.id),
    check('release-gate', 'Final release gate passed', gate.gateState === 'passed', 'Final release gate must pass.', 'critical', gate.id),
    check('acceptance', 'Acceptance suite accepted', okWithWarnings(acceptance.runState, 'passed', 'warning', acceptedWarnings), 'Required acceptance suite must pass or have accepted warnings.', 'critical', acceptance.id),
    check('documentation', 'Required documentation published', docsPublished(input.releaseDocumentation ?? input.documents ?? []), 'Release notes, operator guide, administrator guide, and final handoff checklist must be published.', 'critical'),
    check('handoff', 'Final handoff completed', handoff.handoffState === 'completed', 'Final handoff evaluation must be completed.', 'critical', handoff.id),
    check('migration-level', 'Migration level matches manifest', !input.expectedMigrationLevel || input.expectedMigrationLevel === manifest.databaseMigrationLevel, 'Migration level does not match release manifest.', 'critical', manifest.databaseMigrationLevel),
    check('critical-incidents', 'No unresolved critical incident', !hasCriticalIncident(input.paperOperationsIncidents ?? input.releaseIncidents ?? []), 'Unresolved critical operations incident or release blocker remains.', 'critical'),
    check('paper-only', 'Paper trading only', manifest.liveOrders === false && manifest.brokerExecution === false && input.liveTradingEnabled !== true && input.brokerExecutionEnabled !== true, 'Live trading or broker execution configuration is not allowed.', 'critical'),
  ]
}

function closureStateFrom(checks, requestedState) {
  if (['revoked', 'superseded'].includes(requestedState)) return requestedState
  if (checks.some((item) => item.status === 'blocked' && item.severity === 'critical')) return 'blocked'
  if (checks.some((item) => item.severity === 'warning' || item.status === 'warning')) return 'warning'
  return requestedState === 'pending' ? 'ready' : requestedState ?? 'ready'
}

export function evaluateReleaseClosure(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const checks = closureChecks(input, options)
  const blockers = checks.filter((item) => item.status === 'blocked')
  const warnings = checks.filter((item) => item.severity === 'warning')
  const closureState = closureStateFrom(checks, input.closureState ?? 'pending')
  const summaryContent = stable({
    version: input.version ?? ATLAS_MARKET_VERSION,
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    commit: manifest.gitCommit ?? input.gitCommit ?? null,
    branch: manifest.branch ?? input.branch ?? 'part-10-trading-workspace',
    migrationLevel: manifest.databaseMigrationLevel ?? null,
    closureState,
    passedChecks: checks.filter((item) => item.status === 'passed').map((item) => item.id),
    blockers: blockers.map((item) => item.id),
    warnings: warnings.map((item) => item.id),
    acceptedRisks: (input.acceptedRisks ?? []).map((item) => sanitize(item.message ?? item)),
    paperOnlyDeclaration: 'Atlas Market v1.0 is ready only for the paper-trading platform. No live orders, live accounts, broker execution, deployment, tags, or merges are performed.',
  })
  const closure = {
    id: String(input.id ?? `release-closure-${manifest.releaseCandidateId ?? 'rc'}-${checksum(summaryContent)}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    version: input.version ?? ATLAS_MARKET_VERSION,
    closureState,
    closureSummary: summaryContent,
    closureChecksum: checksum(summaryContent),
    checks,
    blockers,
    warnings,
    recommendations: blockers.map((item) => item.message).concat('Human-reviewed PR and merge remain external manual actions.'),
    acceptedRisks: summaryContent.acceptedRisks,
    closureNote: sanitize(input.closureNote ?? input.note),
    createdAt: timestamp,
    evaluatedAt: timestamp,
    closedAt: null,
    revokedAt: null,
    supersededAt: null,
    immutableContent: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
    githubAutomation: false,
  }
  const eventType = closureState === 'ready' ? RELEASE_CLOSURE_EVENTS.ready : closureState === 'warning' ? RELEASE_CLOSURE_EVENTS.warning : closureState === 'blocked' ? RELEASE_CLOSURE_EVENTS.blocked : RELEASE_CLOSURE_EVENTS.evaluated
  const result = {
    eventType,
    evaluatedEventType: RELEASE_CLOSURE_EVENTS.evaluated,
    timestamp,
    releaseClosure: closure,
    closureState,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RELEASE_CLOSURE_EVENTS.evaluated, { ...result, eventType: RELEASE_CLOSURE_EVENTS.evaluated })
    eventBus.emit(eventType, result)
  }
  return result
}

function closureActivity(closure, actor, action, note, timestamp) {
  return {
    id: `${closure.id}-activity-${action}-${Date.parse(timestamp) || Date.now()}`,
    tenantScope: closure.tenantScope,
    accountId: closure.accountId,
    releaseCandidateId: closure.releaseCandidateId,
    closureId: closure.id,
    actor,
    action,
    sanitizedNote: sanitize(note),
    createdAt: timestamp,
    appendOnly: true,
  }
}

export function transitionReleaseClosure(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const actor = input.actor ?? { id: input.tenantContext?.userId ?? 'unknown-actor', role: input.tenantContext?.role ?? 'viewer' }
  const action = input.action ?? 'close'
  const closure = input.releaseClosure ?? evaluateReleaseClosure(input, { ...options, emitEvent: false }).releaseClosure
  const roleAllowed = ['owner', 'admin'].includes(actor.role)
  const terminal = ['closed', 'revoked', 'superseded'].includes(closure.closureState)
  const note = sanitize(input.closureNote ?? input.note)
  const reason = sanitize(input.reason ?? input.revocationReason)
  const canClose = action === 'close' && roleAllowed && !terminal && closure.blockers.length === 0 && note.length > 0
  const canRevoke = action === 'revoke' && roleAllowed && closure.closureState === 'closed' && reason.length > 0
  const canSupersede = action === 'supersede' && roleAllowed && ['closed', 'ready', 'warning'].includes(closure.closureState)
  const valid = canClose || canRevoke || canSupersede
  const nextState = canClose ? 'closed' : canRevoke ? 'revoked' : canSupersede ? 'superseded' : closure.closureState
  const updated = {
    ...closure,
    closureState: nextState,
    closureNote: canClose ? note : closure.closureNote,
    revocationReason: canRevoke ? reason : closure.revocationReason ?? null,
    closedAt: canClose ? timestamp : closure.closedAt ?? null,
    revokedAt: canRevoke ? timestamp : closure.revokedAt ?? null,
    supersededAt: canSupersede ? timestamp : closure.supersededAt ?? null,
    authorizedActor: valid ? actor : closure.authorizedActor ?? null,
    blockedReason: valid ? null : !roleAllowed ? 'role_not_permitted' : terminal && action !== 'revoke' ? 'terminal_closure_immutable' : action === 'close' && closure.blockers.length ? 'critical_blockers_present' : action === 'close' && note.length === 0 ? 'closure_note_required' : action === 'revoke' && reason.length === 0 ? 'revocation_reason_required' : 'invalid_transition',
    updatedAt: timestamp,
  }
  const eventType = canClose ? RELEASE_CLOSURE_EVENTS.closed : canRevoke ? RELEASE_CLOSURE_EVENTS.revoked : canSupersede ? RELEASE_CLOSURE_EVENTS.superseded : RELEASE_CLOSURE_EVENTS.blocked
  return {
    eventType,
    timestamp,
    releaseClosure: updated,
    releaseClosureActivity: closureActivity(updated, actor, valid ? action : `${action}_rejected`, canRevoke ? reason : note, timestamp),
    validTransition: valid,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function evaluateMergeReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const closure = input.releaseClosure ?? {}
  const docs = input.releaseDocumentation ?? []
  const warnings = [
    ...(input.knownWarnings ?? manifest.knownWarnings ?? []),
    ...(closure.warnings ?? []),
  ].map((item) => sanitize(item.message ?? item.label ?? item))
  const validationPassed = input.testResult === 'passed' && input.lintResult === 'passed' && input.buildResult === 'passed' && input.sensitiveMaterialScanResult === 'passed'
  const docsReady = docsPublished(docs)
  const blockers = [
    ...(!validationPassed ? ['validation_not_passed'] : []),
    ...(!['closed', 'ready'].includes(closure.closureState) ? ['release_closure_not_ready'] : []),
    ...(input.releaseGateEvaluation?.gateState !== 'passed' ? ['release_gate_not_passed'] : []),
    ...(!['passed', 'warning'].includes(input.releaseAcceptanceRun?.runState) ? ['acceptance_not_accepted'] : []),
    ...(!docsReady ? ['documentation_not_published'] : []),
    ...(manifest.liveOrders !== false || manifest.brokerExecution !== false ? ['paper_only_boundary_failed'] : []),
  ]
  const mergeRecommendation = blockers.length > 0 ? 'not_ready' : warnings.length > 0 ? 'ready_with_warnings' : 'ready_for_pr'
  const snapshotCore = {
    version: input.version ?? ATLAS_MARKET_VERSION,
    branch: input.branch ?? manifest.branch ?? 'part-10-trading-workspace',
    commit: input.commit ?? manifest.gitCommit ?? 'unknown',
    migrationLevel: input.migrationLevel ?? manifest.databaseMigrationLevel ?? 'unknown',
    totalTestFiles: Number(input.totalTestFiles ?? 0),
    totalTests: Number(input.totalTests ?? 0),
    testResult: input.testResult ?? 'not_reported',
    lintResult: input.lintResult ?? 'not_reported',
    buildResult: input.buildResult ?? 'not_reported',
    sensitiveMaterialScanResult: input.sensitiveMaterialScanResult ?? 'not_reported',
    releaseClosureState: closure.closureState ?? 'pending',
    finalReleaseGateState: input.releaseGateEvaluation?.gateState ?? 'pending',
    acceptanceStatus: input.releaseAcceptanceRun?.runState ?? 'pending',
    documentationStatus: docsReady ? 'published' : 'incomplete',
    knownWarnings: warnings.slice(0, 20),
    deferredOutOfScopeItems: input.deferredOutOfScopeItems ?? ['live trading', 'broker connectivity', 'deployment automation', 'GitHub tags and releases'],
    paperOnlyDeclaration: 'Ready-for-PR means human-reviewed merge readiness only; it does not merge, deploy, tag, publish, or enable live trading.',
    mergeRecommendation,
    blockers,
  }
  const snapshot = {
    id: String(input.id ?? `merge-readiness-${manifest.releaseCandidateId ?? 'rc'}-${checksum(snapshotCore)}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    ...snapshotCore,
    checksum: checksum(snapshotCore),
    evaluatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
    githubAutomation: false,
  }
  const eventType = mergeRecommendation === 'ready_for_pr' ? MERGE_READINESS_EVENTS.ready : mergeRecommendation === 'ready_with_warnings' ? MERGE_READINESS_EVENTS.warning : MERGE_READINESS_EVENTS.blocked
  const result = {
    eventType,
    evaluatedEventType: MERGE_READINESS_EVENTS.evaluated,
    timestamp,
    mergeReadinessSnapshot: snapshot,
    mergeRecommendation,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(MERGE_READINESS_EVENTS.evaluated, { ...result, eventType: MERGE_READINESS_EVENTS.evaluated })
    eventBus.emit(eventType, result)
  }
  return result
}

export function createReleaseClosureRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const closure = input.releaseClosure ?? input
      if (!database?.connected) return { ok: true, disabled: true, closure }
      const result = await database.query(
        `INSERT INTO atlas_release_closures
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, version, closure_state, closure_checksum, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [closure.id, closure.tenantScope.organizationId, closure.tenantScope.teamWorkspaceId, closure.accountId, closure.releaseCandidateId, closure.version, closure.closureState, closure.closureChecksum, closure],
      )
      return { ok: true, closure: result.rows?.[0]?.payload ?? closure, immutable: true }
    },
    async appendActivity(input) {
      const activity = input.releaseClosureActivity ?? input
      if (!database?.connected) return { ok: true, disabled: true, activity }
      await database.query(
        `INSERT INTO atlas_release_closure_activity
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, closure_id, actor_id, action, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [activity.id, activity.tenantScope.organizationId, activity.tenantScope.teamWorkspaceId, activity.accountId, activity.releaseCandidateId, activity.closureId, activity.actor.id, activity.action, activity],
      )
      return { ok: true, activity }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, closureState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (closureState) { params.push(String(closureState)); clauses.push(`closure_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_closures
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}

export function createMergeReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.mergeReadinessSnapshot ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_merge_readiness_snapshots
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, version, commit_sha, merge_recommendation, checksum, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.releaseCandidateId, snapshot.version, snapshot.commit, snapshot.mergeRecommendation, snapshot.checksum, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot, immutable: true }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, mergeRecommendation, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (mergeRecommendation) { params.push(String(mergeRecommendation)); clauses.push(`merge_recommendation = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_merge_readiness_snapshots
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
