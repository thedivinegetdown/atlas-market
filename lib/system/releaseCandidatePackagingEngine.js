import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_CANDIDATE_EVENTS = Object.freeze({
  created: 'releaseCandidate.created',
  validated: 'releaseCandidate.validated',
  blocked: 'releaseCandidate.blocked',
  approved: 'releaseCandidate.approved',
  superseded: 'releaseCandidate.superseded',
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((next, key) => {
      if (!['stack', 'secret', 'token', 'password', 'credential', 'storagePath'].includes(String(key).toLowerCase())) next[key] = stable(value[key])
      return next
    }, {})
  }
  return value
}

function checksum(value) {
  const text = JSON.stringify(stable(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

function cleanList(items = []) {
  return items.map((item) => ({
    id: item.id ?? item.subsystemId ?? item.category ?? 'release-item',
    message: String(item.message ?? item.label ?? item).slice(0, 240),
    severity: item.severity ?? (item.sourceStatus === 'critical' ? 'critical' : 'warning'),
  }))
}

function stateFrom(readiness = {}, configuration = {}, requestedState = 'draft') {
  const blocked = (readiness.deploymentBlockers?.length ?? 0) > 0 || (configuration.criticalSummary?.length ?? 0) > 0
  if (requestedState === 'approved') return blocked || readiness.releaseReadinessStatus === 'blocked' || configuration.configurationValidationStatus === 'blocked' ? 'blocked' : 'approved'
  if (blocked) return 'blocked'
  if (readiness.releaseReadinessStatus === 'healthy' && configuration.configurationValidationStatus === 'healthy') return 'validated'
  return requestedState === 'draft' ? 'draft' : 'validated'
}

export function createReleaseCandidateManifest(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const releaseReadiness = input.releaseReadinessDiagnostics ?? input.releaseReadiness ?? {}
  const productionConfiguration = input.productionConfigurationValidation ?? input.productionConfiguration ?? {}
  const deploymentBlockers = cleanList([...(releaseReadiness.deploymentBlockers ?? []), ...(productionConfiguration.criticalSummary ?? [])])
  const knownWarnings = cleanList([...(releaseReadiness.warnings ?? []), ...(productionConfiguration.warningSummary ?? [])])
  const manifestCore = {
    releaseCandidateId: String(input.releaseCandidateId ?? `rc-${input.version ?? input.applicationVersion ?? '0.0.0'}-${input.gitCommit ?? 'local'}`).slice(0, 220),
    gitCommit: String(input.gitCommit ?? 'unknown').slice(0, 120),
    branch: String(input.branch ?? 'part-10-trading-workspace').slice(0, 120),
    buildTimestamp: timestamp,
    applicationVersion: String(input.applicationVersion ?? input.version ?? '0.0.0').slice(0, 80),
    databaseMigrationLevel: input.databaseMigrationLevel ?? 'unknown',
    enabledPaperTradingFeatureSet: input.enabledPaperTradingFeatureSet ?? ['paper-execution', 'paper-reporting', 'release-diagnostics'],
    testSummaryReferences: input.testSummaryReferences ?? [],
    lintSummary: input.lintSummary ?? { status: 'not_reported' },
    buildSummary: input.buildSummary ?? { status: 'not_reported' },
    releaseReadinessSnapshotReference: releaseReadiness.id ?? releaseReadiness.timestamp ?? releaseReadiness.eventType ?? null,
    productionConfigurationValidationReference: productionConfiguration.id ?? productionConfiguration.timestamp ?? productionConfiguration.eventType ?? null,
    knownWarnings,
    deploymentBlockers,
    supersedesReleaseCandidateId: input.supersedesReleaseCandidateId ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const manifest = {
    ...manifestCore,
    tenantScope: scope,
    accountId,
    manifestState: stateFrom(releaseReadiness, productionConfiguration, input.manifestState ?? 'draft'),
    checksum: checksum(manifestCore),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const eventType = manifest.manifestState === 'blocked' ? RELEASE_CANDIDATE_EVENTS.blocked : manifest.manifestState === 'validated' ? RELEASE_CANDIDATE_EVENTS.validated : manifest.manifestState === 'approved' ? RELEASE_CANDIDATE_EVENTS.approved : RELEASE_CANDIDATE_EVENTS.created
  const result = {
    eventType,
    timestamp,
    releaseCandidateManifest: manifest,
    manifestState: manifest.manifestState,
    checksum: manifest.checksum,
    approvalBlocked: manifest.manifestState === 'blocked',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Release candidate ${manifest.releaseCandidateId} ${manifest.manifestState} with ${deploymentBlockers.length} blockers and ${knownWarnings.length} warnings.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(eventType, result)
  return result
}

export function supersedeReleaseCandidate(input = {}, options = {}) {
  const created = createReleaseCandidateManifest(input, { ...options, emitEvent: false })
  const result = {
    ...created,
    eventType: RELEASE_CANDIDATE_EVENTS.superseded,
    supersededReleaseCandidateId: input.supersedesReleaseCandidateId ?? input.previousReleaseCandidateId ?? null,
    summary: `Release candidate ${created.releaseCandidateManifest.releaseCandidateId} supersedes ${input.supersedesReleaseCandidateId ?? input.previousReleaseCandidateId ?? 'prior candidate'}.`,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(RELEASE_CANDIDATE_EVENTS.superseded, result)
  return result
}

export function createReleaseCandidateManifestRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const manifest = input.releaseCandidateManifest ?? input
      if (!database?.connected) return { ok: true, disabled: true, manifest }
      const result = await database.query(
        `INSERT INTO atlas_release_candidate_manifests
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, manifest_state, git_commit, application_version, checksum, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [manifest.id ?? manifest.releaseCandidateId, manifest.tenantScope.organizationId, manifest.tenantScope.teamWorkspaceId, manifest.accountId, manifest.releaseCandidateId, manifest.manifestState, manifest.gitCommit, manifest.applicationVersion, manifest.checksum, manifest],
      )
      return { ok: true, manifest: result.rows?.[0]?.payload ?? manifest, immutable: true }
    },
    async list({ tenantContext = {}, accountId, manifestState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (manifestState) { params.push(String(manifestState)); clauses.push(`manifest_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_candidate_manifests
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
