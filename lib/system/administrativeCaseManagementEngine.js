import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT = 'system.administrativeCase.created'
export const SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT = 'system.administrativeCase.updated'

export const ADMINISTRATIVE_CASE_STATUSES = Object.freeze(['open', 'investigating', 'monitoring', 'resolved', 'dismissed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return ADMINISTRATIVE_CASE_STATUSES.includes(status) ? status : 'open'
}

function safePriority(priority) {
  return ['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium'
}

function redactEvidence(reference = {}) {
  const payload = reference.payload ?? reference
  return {
    id: payload.id ?? reference.id ?? null,
    type: payload.type ?? reference.type ?? 'operator-intelligence',
    eventType: payload.eventType ?? reference.eventType ?? null,
    summary: String(payload.summary ?? reference.summary ?? '').slice(0, 400),
  }
}

export function normalizeAdministrativeCase(input = {}) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const priority = safePriority(input.priority)
  return {
    id: String(input.id ?? `admin-case-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(timestamp) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    ownerUserId: input.ownerUserId ?? tenantScope.userId ?? null,
    title: String(input.title ?? 'Administrative case').slice(0, 160),
    status: safeStatus(input.status),
    priority,
    dueDate: input.dueDate ?? null,
    evidenceReferences: (input.evidenceReferences ?? input.evidence ?? []).map(redactEvidence),
    timelineReferences: (input.timelineReferences ?? []).map(redactEvidence),
    resolutionSummary: input.resolutionSummary ? String(input.resolutionSummary).slice(0, 500) : null,
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    humanReviewOnly: true,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    automaticMembershipRemoval: false,
    automaticInvitationCancellation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createAdministrativeCaseRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(caseInput) {
      const administrativeCase = normalizeAdministrativeCase(caseInput)
      if (!database?.connected) return { ok: true, disabled: true, case: administrativeCase }
      const result = await database.query(
        `INSERT INTO atlas_administrative_cases
          (id, organization_id, team_workspace_id, owner_user_id, status, priority, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status, priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          administrativeCase.id,
          administrativeCase.tenantScope.organizationId,
          administrativeCase.tenantScope.teamWorkspaceId,
          administrativeCase.ownerUserId,
          administrativeCase.status,
          administrativeCase.priority,
          administrativeCase.dueDate,
          administrativeCase,
        ],
      )
      return { ok: true, case: normalizeAdministrativeCase(result.rows?.[0]?.payload ?? administrativeCase) }
    },
    async list({ tenantContext = {}, status, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const statusClause = status ? 'AND status = $4' : ''
      if (status) params.push(safeStatus(status))
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_cases
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${statusClause}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAdministrativeCase(row.payload))
    },
    async get({ id, tenantContext = {} }) {
      if (!database?.connected) return null
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_cases
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? ''],
      )
      return result.rows?.[0]?.payload ? normalizeAdministrativeCase(result.rows[0].payload) : null
    },
    async updateStatus({ id, tenantContext = {}, status, resolutionSummary }) {
      const safe = safeStatus(status)
      if (!database?.connected) return { ok: true, disabled: true, case: normalizeAdministrativeCase({ id, tenantContext, status: safe, resolutionSummary }) }
      const result = await database.query(
        `UPDATE atlas_administrative_cases
         SET status = $4,
             payload = jsonb_set(jsonb_set(payload, '{status}', to_jsonb($4::text), true), '{resolutionSummary}', to_jsonb($5::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', safe, resolutionSummary ?? ''],
      )
      return { ok: result.rows?.length > 0, case: result.rows?.[0]?.payload ? normalizeAdministrativeCase(result.rows[0].payload) : null }
    },
  }
}

export function buildAdministrativeCases(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const attentionItems = input.operatorAttention?.rankedOperatorAttentionQueue ?? []
  const existingCases = (input.existingCases ?? []).map(normalizeAdministrativeCase)
  const generatedCases = attentionItems.slice(0, input.maxCases ?? 5).map((item) => normalizeAdministrativeCase({
    id: `admin-case-${item.id}`,
    tenantContext,
    ownerUserId: tenantContext.userId,
    title: `Review ${item.sourceType}`,
    status: item.severity === 'critical' ? 'investigating' : 'open',
    priority: item.severity === 'critical' ? 'critical' : item.severity === 'high' ? 'high' : 'medium',
    dueDate: item.dueState === 'breached' ? options.timestamp ?? getNowIso() : null,
    evidenceReferences: [{
      id: item.id,
      type: item.sourceType,
      eventType: item.sourceEventReference,
      summary: item.rationale,
    }],
    timelineReferences: item.workflowReference ? [{ id: item.workflowReference, type: 'workflow' }] : [],
    timestamp: options.timestamp,
  }))
  const cases = [...generatedCases, ...existingCases]
  const result = {
    eventType: generatedCases.length > 0 ? SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT : SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    administrativeCases: cases,
    caseSummary: {
      total: cases.length,
      open: cases.filter((item) => ['open', 'investigating', 'monitoring'].includes(item.status)).length,
      critical: cases.filter((item) => item.priority === 'critical').length,
      dueSoon: cases.filter((item) => item.dueDate).length,
    },
    allowedStatuses: ADMINISTRATIVE_CASE_STATUSES,
    humanReviewOnly: true,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    automaticMembershipRemoval: false,
    automaticInvitationCancellation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    status: cases.some((item) => item.priority === 'critical') ? 'caution' : 'healthy',
    summary: `Administrative case management prepared ${cases.length} human-review cases from operator intelligence signals.`,
    sourceEvents: {
      operatorAttention: input.operatorAttention?.eventType ?? null,
      userActivityRiskReview: input.userActivityRiskReview?.eventType ?? null,
      administrationWorkflowSla: input.administrationWorkflowSla?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(result.eventType, result)
  return result
}

export async function createAdministrativeCase(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const repository = options.repository ?? createAdministrativeCaseRepository(options)
  const response = await repository.create(input.case ?? input)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    administrativeCase: response.case,
    status: response.ok ? 'created' : 'blocked',
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT, result)
  return result
}

export async function updateAdministrativeCaseStatus(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const repository = options.repository ?? createAdministrativeCaseRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    administrativeCase: response.case,
    requestedStatus: safeStatus(input.status),
    status: response.ok ? 'updated' : 'blocked',
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT, result)
  return result
}
