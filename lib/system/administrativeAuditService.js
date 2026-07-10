import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT = 'system.administrativeAudit.recorded'

const SAFE_CATEGORIES = Object.freeze(['organization', 'membership', 'team workspace', 'invitation', 'session', 'workspace configuration'])
const SNAPSHOT_BLOCKLIST = Object.freeze(['token', 'tokenHash', 'token_hash', 'password', 'secret', 'invitationTokenHash'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function sanitizeSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return {}
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => !SNAPSHOT_BLOCKLIST.includes(key)))
}

export function normalizeAdministrativeAuditRecord(input = {}) {
  const timestamp = input.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const category = SAFE_CATEGORIES.includes(input.category) ? input.category : 'organization'
  return {
    id: String(input.id ?? `admin-audit-${category.replace(/\s+/g, '-')}-${timestamp}`),
    category,
    actor: input.actor ?? tenantContext.userId ?? 'unknown-user',
    tenantScope: {
      organizationId: tenantContext.organizationId ?? null,
      teamWorkspaceId: tenantContext.teamWorkspaceId ?? null,
      userId: tenantContext.userId ?? null,
      role: tenantContext.role ?? null,
    },
    before: sanitizeSnapshot(input.before),
    after: sanitizeSnapshot(input.after),
    changeReason: input.changeReason ?? 'operator review placeholder',
    eventType: SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export async function recordAdministrativeChange(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const record = normalizeAdministrativeAuditRecord(input)
  await options.repository?.getStore?.('enterpriseAuditRecords')?.upsertScoped?.(record.id, record, record.tenantScope)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT,
    timestamp: record.timestamp,
    normalizedAdministrativeAuditRecord: record,
    operationCategory: record.category,
    beforeAfterSnapshots: { before: record.before, after: record.after },
    actorIdentityAndTenantScope: { actor: record.actor, tenantScope: record.tenantScope },
    changeReasonPlaceholder: record.changeReason,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    status: 'recorded',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT, result)
  return result
}

export async function lookupAdministrativeAudit(input = {}, options = {}) {
  const tenantContext = input.tenantContext ?? {}
  const query = input.query ?? {}
  const records = await options.repository?.getStore?.('enterpriseAuditRecords')?.listScoped?.({
    organizationId: tenantContext.organizationId,
    teamWorkspaceId: tenantContext.teamWorkspaceId ?? null,
    limit: query.limit ?? 50,
  }) ?? []
  return {
    tenantContext,
    filters: {
      actor: query.actor ?? null,
      category: query.category ?? null,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      sort: ['created_at', 'updated_at'].includes(query.sort) ? query.sort : 'created_at',
    },
    pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50))) },
    records: records.filter((record) => {
      const payload = record.payload ?? record
      if (query.actor && payload.actor !== query.actor) return false
      if (query.category && payload.category !== query.category) return false
      return true
    }),
    sensitiveMaterialExcluded: true,
  }
}
