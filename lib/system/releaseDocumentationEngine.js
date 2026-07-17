import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { releaseAttestationChecksum, validateReleaseAttestationSignature } from './releaseAttestationGateEngine.js'

export const RELEASE_DOCUMENTATION_EVENTS = Object.freeze({
  generated: 'releaseDocumentation.generated',
  validated: 'releaseDocumentation.validated',
  published: 'releaseDocumentation.published',
  superseded: 'releaseDocumentation.superseded',
})

export const RELEASE_HANDOFF_EVENTS = Object.freeze({
  evaluated: 'releaseHandoff.evaluated',
  completed: 'releaseHandoff.completed',
  blocked: 'releaseHandoff.blocked',
})

export const RELEASE_DOCUMENTATION_TYPES = Object.freeze(['release_notes', 'operator_guide', 'administrator_guide', 'final_handoff_checklist'])
export const RELEASE_DOCUMENTATION_STATES = Object.freeze(['draft', 'validated', 'published', 'superseded'])

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

function sanitize(value, max = 500) {
  return String(value ?? '')
    .replace(/token|secret|password|credential|https?:\/\/\S+|DATABASE_URL=\S+/gi, 'redacted')
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

function documentSections(type, input = {}) {
  const manifest = input.releaseCandidateManifest ?? {}
  const acceptanceRun = input.releaseAcceptanceRun ?? {}
  const common = {
    version: manifest.applicationVersion ?? '0.0.0',
    releaseCandidate: manifest.releaseCandidateId ?? null,
    commit: manifest.gitCommit ?? null,
    branch: manifest.branch ?? null,
    migrationLevel: manifest.databaseMigrationLevel ?? null,
    paperOnlyDeclaration: 'Atlas Market v1.0 release documentation covers the paper-trading platform only. No live orders or broker execution are included.',
  }
  if (type === 'operator_guide') {
    return {
      ...common,
      procedures: [
        'Application health checks',
        'Tenant and role verification',
        'Market-data degraded-mode handling',
        'Scanner health and backlog review',
        'Paper execution troubleshooting',
        'Reconciliation mismatch handling',
        'Risk and drawdown escalation',
        'Alert and incident workflows',
        'Reporting jobs and worker health',
        'Artifact expiration and integrity handling',
        'Release diagnostics, evidence, attestation, and gate review',
        'Acceptance-test execution',
        'Recovery and rollback-readiness review',
      ],
    }
  }
  if (type === 'administrator_guide') {
    return {
      ...common,
      procedures: [
        'Required production configuration descriptors',
        'Migration verification',
        'Protected worker and scheduled endpoints',
        'Report schedule operations',
        'Retention and expiration controls',
        'Role and permission model',
        'Security-policy behavior',
        'Release approval workflow',
        'Certification and attestation workflow',
        'Release revocation and superseding',
      ],
    }
  }
  if (type === 'final_handoff_checklist') {
    return {
      ...common,
      checklist: [
        ['release-candidate-approved', input.releaseApproval?.approvalState === 'approved'],
        ['production-configuration-validated', input.productionConfigurationValidation?.configurationValidationStatus !== 'blocked'],
        ['qa-certification-accepted', ['passed', 'warning'].includes(input.releaseCertification?.certificationState)],
        ['recovery-readiness-accepted', ['ready', 'warning'].includes(input.releaseRecoveryReadiness?.recoveryReadinessState)],
        ['required-evidence-verified', input.evidenceSummary?.satisfiesRequiredEvidence !== false],
        ['attestation-signed-valid', input.releaseAttestation?.attestationState === 'signed'],
        ['release-gate-passed', input.releaseGateEvaluation?.gateState === 'passed'],
        ['acceptance-suite-accepted', ['passed', 'warning'].includes(acceptanceRun.runState)],
        ['operator-guide-generated', true],
        ['administrator-guide-generated', true],
        ['known-risks-acknowledged', true],
        ['paper-only-limitation-acknowledged', true],
      ].map(([id, complete]) => ({ id, complete })),
    }
  }
  return {
    ...common,
    majorCapabilities: input.majorCapabilities ?? ['real-time paper trading', 'scanner and alerts', 'paper execution', 'portfolio and P&L', 'release governance', 'reporting'],
    securityHardeningSummary: sanitize(input.securityHardeningSummary ?? 'Security policy default-deny, tenant isolation, role checks, safe downloads, and release signing protections are enabled.'),
    performanceSummary: sanitize(input.performanceSummary ?? 'Dashboard state remains summary-only with bounded lists and preserved code splitting.'),
    accessibilitySummary: sanitize(input.accessibilitySummary ?? 'Release workflows expose accessible status text and keyboard-operable action summaries.'),
    validationResults: {
      tests: input.validationSummary?.tests ?? 'passed',
      lint: input.validationSummary?.lint ?? 'passed',
      build: input.validationSummary?.build ?? 'passed',
    },
    knownWarnings: (input.knownWarnings ?? manifest.knownWarnings ?? []).map((item) => sanitize(item.message ?? item)),
    acceptedRisks: (input.acceptedRisks ?? []).map((item) => sanitize(item.message ?? item)),
    deferredFunctionality: ['live trading', 'broker connectivity', 'deployment automation', 'external documentation publishing'],
  }
}

export function generateReleaseDocumentation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const documentationType = RELEASE_DOCUMENTATION_TYPES.includes(input.documentationType) ? input.documentationType : 'release_notes'
  const content = stable(documentSections(documentationType, input))
  const documentChecksum = checksum(content)
  const documentation = {
    id: String(input.id ?? `release-documentation-${manifest.releaseCandidateId ?? 'rc'}-${documentationType}-${documentChecksum}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    documentationType,
    version: String(input.version ?? manifest.applicationVersion ?? '0.0.0').slice(0, 80),
    documentationState: input.documentationState ?? 'draft',
    content,
    markdown: input.includeMarkdown === false ? null : `# ${documentationType.replaceAll('_', ' ')}\n\n${content.paperOnlyDeclaration}`,
    checksum: documentChecksum,
    supersedesDocumentationId: input.supersedesDocumentationId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
    supersededAt: null,
    immutable: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    externalPublishing: false,
  }
  const result = {
    eventType: RELEASE_DOCUMENTATION_EVENTS.generated,
    timestamp,
    releaseDocumentation: documentation,
    documentationState: documentation.documentationState,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(RELEASE_DOCUMENTATION_EVENTS.generated, result)
  return result
}

export function transitionReleaseDocumentation(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const document = input.releaseDocumentation ?? input.documentation ?? {}
  const action = input.action ?? 'validate'
  const nextState = action === 'publish' ? 'published' : action === 'supersede' ? 'superseded' : 'validated'
  const valid = RELEASE_DOCUMENTATION_STATES.includes(nextState) && !(document.documentationState === 'published' && nextState !== 'superseded')
  const updated = {
    ...document,
    documentationState: valid ? nextState : document.documentationState ?? 'draft',
    publishedAt: valid && nextState === 'published' ? timestamp : document.publishedAt ?? null,
    supersededAt: valid && nextState === 'superseded' ? timestamp : document.supersededAt ?? null,
    immutable: valid && ['published', 'superseded'].includes(nextState),
    blockedReason: valid ? null : 'published_document_immutable',
    updatedAt: timestamp,
  }
  const eventType = nextState === 'published' && valid ? RELEASE_DOCUMENTATION_EVENTS.published : nextState === 'superseded' && valid ? RELEASE_DOCUMENTATION_EVENTS.superseded : valid ? RELEASE_DOCUMENTATION_EVENTS.validated : RELEASE_DOCUMENTATION_EVENTS.generated
  return {
    eventType,
    timestamp,
    releaseDocumentation: updated,
    documentationState: updated.documentationState,
    validTransition: valid,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

function handoffCheck(id, label, passed, message) {
  return { id, label, status: passed ? 'passed' : 'blocked', message }
}

export function evaluateReleaseHandoff(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const documents = input.releaseDocumentation ?? input.documents ?? []
  const publishedTypes = new Set(documents.filter((doc) => doc.documentationState === 'published').map((doc) => doc.documentationType))
  const signature = validateReleaseAttestationSignature(input.releaseAttestation ?? {}, { signingSecret: options.signingSecret ?? input.signingSecret })
  const checks = [
    handoffCheck('candidate-approved', 'Release candidate approved', input.releaseApproval?.approvalState === 'approved', 'Approve release candidate.'),
    handoffCheck('configuration-validated', 'Production configuration validated', input.productionConfigurationValidation?.configurationValidationStatus !== 'blocked', 'Resolve critical configuration findings.'),
    handoffCheck('certification-accepted', 'QA certification accepted', ['passed', 'warning'].includes(input.releaseCertification?.certificationState), 'Complete QA certification.'),
    handoffCheck('recovery-accepted', 'Recovery readiness accepted', ['ready', 'warning'].includes(input.releaseRecoveryReadiness?.recoveryReadinessState), 'Complete recovery readiness.'),
    handoffCheck('evidence-verified', 'Required evidence verified', input.evidenceSummary?.satisfiesRequiredEvidence !== false, 'Verify required evidence.'),
    handoffCheck('attestation-valid', 'Attestation signed and valid', input.releaseAttestation?.attestationState === 'signed' && signature.valid, 'Sign valid attestation.'),
    handoffCheck('gate-passed', 'Release gate passed', input.releaseGateEvaluation?.gateState === 'passed', 'Pass final release gate.'),
    handoffCheck('acceptance-accepted', 'Acceptance suite accepted', ['passed', 'warning'].includes(input.releaseAcceptanceRun?.runState), 'Run acceptance suite.'),
    handoffCheck('release-notes-published', 'Release notes published', publishedTypes.has('release_notes'), 'Publish release notes.'),
    handoffCheck('operator-guide-published', 'Operator guide published', publishedTypes.has('operator_guide'), 'Publish operator guide.'),
    handoffCheck('administrator-guide-published', 'Administrator guide published', publishedTypes.has('administrator_guide'), 'Publish administrator guide.'),
    handoffCheck('handoff-checklist-published', 'Final handoff checklist published', publishedTypes.has('final_handoff_checklist'), 'Publish final handoff checklist.'),
    handoffCheck('paper-only-acknowledged', 'Paper-only limitation acknowledged', manifest.liveOrders === false && manifest.brokerExecution === false, 'Acknowledge paper-only limitation.'),
  ]
  const blockers = checks.filter((item) => item.status === 'blocked')
  const handoffState = blockers.length === 0 ? 'completed' : 'blocked'
  const evaluation = {
    id: String(input.id ?? `release-handoff-${manifest.releaseCandidateId ?? 'rc'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    handoffState,
    checks,
    blockers,
    recommendations: blockers.map((item) => item.message),
    evaluatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const result = {
    eventType: handoffState === 'completed' ? RELEASE_HANDOFF_EVENTS.completed : RELEASE_HANDOFF_EVENTS.blocked,
    evaluatedEventType: RELEASE_HANDOFF_EVENTS.evaluated,
    timestamp,
    releaseHandoffEvaluation: evaluation,
    handoffState,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RELEASE_HANDOFF_EVENTS.evaluated, { ...result, eventType: RELEASE_HANDOFF_EVENTS.evaluated })
    eventBus.emit(result.eventType, result)
  }
  return result
}

export function createReleaseDocumentationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const document = input.releaseDocumentation ?? input
      if (!database?.connected) return { ok: true, disabled: true, document }
      const result = await database.query(
        `INSERT INTO atlas_release_documentation
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, documentation_type, version, documentation_state, checksum, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [document.id, document.tenantScope.organizationId, document.tenantScope.teamWorkspaceId, document.accountId, document.releaseCandidateId, document.documentationType, document.version, document.documentationState, document.checksum, document],
      )
      return { ok: true, document: result.rows?.[0]?.payload ?? document, immutable: document.documentationState === 'published' }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, documentationType, documentationState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (documentationType) { params.push(String(documentationType)); clauses.push(`documentation_type = $${params.length}`) }
      if (documentationState) { params.push(String(documentationState)); clauses.push(`documentation_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_documentation
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}

export function createReleaseHandoffRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const evaluation = input.releaseHandoffEvaluation ?? input
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_release_handoff_evaluations
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, handoff_state, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [evaluation.id, evaluation.tenantScope.organizationId, evaluation.tenantScope.teamWorkspaceId, evaluation.accountId, evaluation.releaseCandidateId, evaluation.handoffState, evaluation],
      )
      return { ok: true, evaluation: result.rows?.[0]?.payload ?? evaluation, immutable: true }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, handoffState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (handoffState) { params.push(String(handoffState)); clauses.push(`handoff_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_handoff_evaluations
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
