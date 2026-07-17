import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_RUNBOOK_EVENTS = Object.freeze({
  generated: 'releaseRunbook.generated',
  itemUpdated: 'releaseRunbook.itemUpdated',
})

export const RELEASE_RECOVERY_EVENTS = Object.freeze({
  ready: 'releaseRecovery.ready',
  warning: 'releaseRecovery.warning',
  blocked: 'releaseRecovery.blocked',
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

function sanitize(note) {
  return String(note ?? '').replace(/token|secret|password|credential|https?:\/\/\S+/gi, 'redacted').slice(0, 300)
}

const RUNBOOK_SECTIONS = Object.freeze([
  ['pre-deployment', 'Pre-deployment checks', 'owner'],
  ['migration-verification', 'Migration verification', 'admin'],
  ['deployment-verification', 'Deployment verification', 'admin'],
  ['smoke-validation', 'Post-deployment smoke validation', 'analyst'],
  ['auth-tenant', 'Authentication and tenant-isolation verification', 'admin'],
  ['market-data-degraded', 'Market-data degraded-mode response', 'analyst'],
  ['scanner-stale-data', 'Scanner backlog or stale-data response', 'analyst'],
  ['paper-execution-failure', 'Paper execution failure response', 'analyst'],
  ['reconciliation-mismatch', 'Reconciliation mismatch response', 'analyst'],
  ['risk-drawdown', 'Risk or drawdown escalation', 'analyst'],
  ['alerts-incidents', 'Operations alert and incident handling', 'analyst'],
  ['report-worker-failure', 'Reporting worker failure response', 'admin'],
  ['artifact-integrity', 'Artifact expiration or integrity failure', 'admin'],
  ['configuration-rollback', 'Configuration rollback', 'owner'],
  ['application-rollback', 'Application rollback', 'owner'],
  ['database-recovery', 'Database recovery guidance', 'owner'],
  ['release-revocation', 'Release revocation', 'owner'],
  ['audit-handoff', 'Evidence collection and audit handoff', 'admin'],
])

export function generateReleaseRunbook(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const version = String(input.runbookVersion ?? `runbook-${manifest.releaseCandidateId ?? 'rc'}-v1`).slice(0, 160)
  const items = RUNBOOK_SECTIONS.map(([category, label, requiredRole], index) => ({
    id: `${version}-${category}`,
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    runbookVersion: version,
    category,
    label,
    sequence: index + 1,
    requiredRole,
    status: input.completedByDefault ? 'completed' : 'pending',
    evidenceReference: `${manifest.releaseCandidateId ?? 'release'}:${category}`,
    sanitizedNote: '',
    completedAt: input.completedByDefault ? timestamp : null,
    required: true,
    destructiveAutomation: false,
  }))
  const runbook = {
    id: String(input.id ?? `${version}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    runbookVersion: version,
    recoveryReadinessState: 'warning',
    items,
    itemSummary: summarizeItems(items),
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const result = {
    eventType: RELEASE_RUNBOOK_EVENTS.generated,
    timestamp,
    releaseRunbook: runbook,
    releaseRunbookItems: items,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Release runbook ${version} generated with ${items.length} checklist items.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(RELEASE_RUNBOOK_EVENTS.generated, result)
  return result
}

function summarizeItems(items = []) {
  return {
    completed: items.filter((item) => item.status === 'completed').length,
    pending: items.filter((item) => item.status === 'pending').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    total: items.length,
  }
}

function roleAllowed(actorRole, requiredRole, status) {
  if (['owner', 'admin'].includes(actorRole)) return true
  if (actorRole === 'analyst' && status === 'completed' && requiredRole === 'analyst') return true
  return false
}

export function updateReleaseRunbookItem(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const item = input.runbookItem ?? input.item ?? {}
  const actor = input.actor ?? { id: input.tenantContext?.userId ?? 'unknown-actor', role: input.tenantContext?.role ?? 'viewer' }
  const nextStatus = input.status ?? input.action ?? 'completed'
  const note = sanitize(input.note)
  const requiresNote = ['blocked', 'skipped'].includes(nextStatus) && item.required !== false
  const permitted = roleAllowed(actor.role, item.requiredRole, nextStatus)
  const valid = ['pending', 'completed', 'blocked', 'skipped'].includes(nextStatus) && permitted && (!requiresNote || note.length > 0)
  const updated = {
    ...item,
    status: valid ? nextStatus : 'blocked',
    sanitizedNote: note,
    completedAt: valid && nextStatus === 'completed' ? timestamp : item.completedAt ?? null,
    updatedAt: timestamp,
    blockedReason: valid ? null : !permitted ? 'role_not_permitted' : requiresNote ? 'required_note_missing' : 'invalid_status',
  }
  const activity = {
    id: `${updated.id}-activity-${Date.parse(timestamp) || Date.now()}`,
    tenantScope: updated.tenantScope ?? tenantScope(input),
    accountId: updated.accountId ?? input.accountId ?? 'paper-portfolio',
    releaseCandidateId: updated.releaseCandidateId ?? input.releaseCandidateId ?? null,
    runbookItemId: updated.id,
    actor,
    status: updated.status,
    sanitizedNote: note,
    createdAt: timestamp,
    appendOnly: true,
  }
  return {
    eventType: RELEASE_RUNBOOK_EVENTS.itemUpdated,
    timestamp,
    runbookItem: updated,
    runbookActivity: activity,
    validTransition: valid,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function evaluateReleaseRecoveryReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const runbook = input.releaseRunbook ?? {}
  const items = input.releaseRunbookItems ?? runbook.items ?? []
  const required = items.filter((item) => item.required !== false)
  const missing = RUNBOOK_SECTIONS.filter(([category]) => !items.some((item) => item.category === category))
  const blockedItems = required.filter((item) => item.status === 'blocked')
  const pendingItems = required.filter((item) => item.status === 'pending')
  const skippedWithoutNote = required.filter((item) => item.status === 'skipped' && !item.sanitizedNote)
  const hasRequiredRecovery = ['configuration-rollback', 'application-rollback', 'database-recovery', 'release-revocation'].every((category) => items.some((item) => item.category === category))
  const state = missing.length > 0 || blockedItems.length > 0 || skippedWithoutNote.length > 0 || !hasRequiredRecovery ? 'blocked' : pendingItems.length > 0 ? 'warning' : 'ready'
  const result = {
    eventType: state === 'ready' ? RELEASE_RECOVERY_EVENTS.ready : state === 'warning' ? RELEASE_RECOVERY_EVENTS.warning : RELEASE_RECOVERY_EVENTS.blocked,
    timestamp,
    releaseRecoveryReadiness: {
      id: String(input.id ?? `release-recovery-${runbook.releaseCandidateId ?? 'rc'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
      tenantScope: runbook.tenantScope ?? tenantScope(input),
      accountId: runbook.accountId ?? input.accountId ?? 'paper-portfolio',
      releaseCandidateId: runbook.releaseCandidateId ?? input.releaseCandidateId ?? null,
      runbookVersion: runbook.runbookVersion ?? 'runbook-v1',
      recoveryReadinessState: state,
      itemSummary: summarizeItems(items),
      missingProcedures: missing.map(([category, label]) => ({ category, label })),
      blockers: [...blockedItems, ...skippedWithoutNote],
      warnings: pendingItems,
      recommendations: [
        ...missing.map(([, label]) => `Add ${label} procedure before release readiness.`),
        ...blockedItems.map((item) => `Resolve blocked runbook item: ${item.label}.`),
        'Validate rollback or forward-recovery guidance without destructive commands.',
      ],
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      deploymentAutomation: false,
    },
    recoveryReadinessState: state,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(result.eventType, result)
  return result
}

export function createReleaseRunbookRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const runbook = input.releaseRunbook ?? input
      if (!database?.connected) return { ok: true, disabled: true, runbook }
      const result = await database.query(
        `INSERT INTO atlas_release_runbooks
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, runbook_version, recovery_readiness_state, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [runbook.id, runbook.tenantScope.organizationId, runbook.tenantScope.teamWorkspaceId, runbook.accountId, runbook.releaseCandidateId, runbook.runbookVersion, runbook.recoveryReadinessState, runbook],
      )
      return { ok: true, runbook: result.rows?.[0]?.payload ?? runbook, immutable: true }
    },
    async createItem(input) {
      const item = input.runbookItem ?? input
      if (!database?.connected) return { ok: true, disabled: true, item }
      await database.query(
        `INSERT INTO atlas_release_runbook_items
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, runbook_version, category, status, required_role, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = NOW()`,
        [item.id, item.tenantScope.organizationId, item.tenantScope.teamWorkspaceId, item.accountId, item.releaseCandidateId, item.runbookVersion, item.category, item.status, item.requiredRole, item],
      )
      return { ok: true, item }
    },
    async appendActivity(input) {
      const activity = input.runbookActivity ?? input
      if (!database?.connected) return { ok: true, disabled: true, activity }
      await database.query(
        `INSERT INTO atlas_release_runbook_activity
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, runbook_item_id, actor_id, status, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [activity.id, activity.tenantScope.organizationId, activity.tenantScope.teamWorkspaceId, activity.accountId, activity.releaseCandidateId, activity.runbookItemId, activity.actor.id, activity.status, activity],
      )
      return { ok: true, activity }
    },
    async list({ tenantContext = {}, accountId, recoveryReadinessState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (recoveryReadinessState) { params.push(String(recoveryReadinessState)); clauses.push(`recovery_readiness_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_runbooks
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
