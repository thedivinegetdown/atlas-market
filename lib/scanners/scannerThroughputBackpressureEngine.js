import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SCANNER_CYCLE_STARTED_EVENT = 'scanner.cycle.started'
export const SCANNER_CYCLE_COMPLETED_EVENT = 'scanner.cycle.completed'
export const SCANNER_CYCLE_DEGRADED_EVENT = 'scanner.cycle.degraded'
export const SCANNER_BACKPRESSURE_UPDATED_EVENT = 'scanner.backpressure.updated'
export const SCANNER_CYCLE_STATUSES = Object.freeze(['completed', 'partial', 'degraded', 'failed'])

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

function ageMs(value, now) {
  const then = new Date(value ?? now).getTime()
  const current = new Date(now).getTime()
  return Number.isFinite(then) && Number.isFinite(current) ? Math.max(0, current - then) : 0
}

function round(value) {
  return Number((Number(value) || 0).toFixed(4))
}

export function evaluateScannerThroughputBackpressure(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const policy = {
    maxQueueSize: Math.max(1, Number(input.policy?.maxQueueSize ?? 250)),
    concurrency: Math.max(1, Number(input.policy?.concurrency ?? 8)),
    maxPerCycle: Math.max(1, Number(input.policy?.maxPerCycle ?? 100)),
    cycleDeadlineMs: Math.max(10, Number(input.policy?.cycleDeadlineMs ?? 2500)),
    staleAfterMs: Math.max(1000, Number(input.policy?.staleAfterMs ?? 90000)),
    retryLimit: Math.max(0, Number(input.policy?.retryLimit ?? 1)),
  }
  const subscriptions = input.scannerSubscriptions ?? input.realtimeScanner?.scannerSubscriptionRegistry ?? []
  const groupedSymbols = subscriptions.flatMap((subscription, groupIndex) => (subscription.symbols ?? []).map((symbol) => ({ symbol, groupId: subscription.id ?? `group-${groupIndex + 1}` })))
  const explicitQueue = input.scanQueue ?? input.symbols?.map((symbol) => ({ symbol, groupId: 'manual' }))
  const queue = (explicitQueue?.length ? explicitQueue : groupedSymbols).slice(0, policy.maxQueueSize * 2)
  const deduped = []
  const seen = new Set(input.previouslyEvaluatedSymbols ?? [])
  const byGroup = new Map()
  for (const item of queue) {
    const symbol = String(item.symbol ?? item).toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    const group = String(item.groupId ?? 'default')
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push({ symbol, groupId: group, timestamp: item.timestamp ?? timestamp, transientFailure: item.transientFailure === true })
  }
  while (Array.from(byGroup.values()).some((items) => items.length) && deduped.length < policy.maxQueueSize) {
    for (const items of byGroup.values()) {
      const next = items.shift()
      if (next) deduped.push(next)
      if (deduped.length >= policy.maxQueueSize) break
    }
  }
  const deadlineLimited = Math.min(policy.maxPerCycle, policy.concurrency * Math.max(1, Math.floor(policy.cycleDeadlineMs / 100)))
  const processLimit = Math.min(deduped.length, deadlineLimited)
  const processedItems = deduped.slice(0, processLimit)
  const deferredItems = deduped.slice(processLimit)
  const staleItems = processedItems.filter((item) => ageMs(item.timestamp, timestamp) > policy.staleAfterMs)
  const retryableFailures = processedItems.filter((item) => item.transientFailure).slice(0, policy.retryLimit)
  const failed = Math.max(0, processedItems.filter((item) => item.transientFailure).length - retryableFailures.length)
  const processed = Math.max(0, processedItems.length - staleItems.length - failed)
  const queued = deduped.length
  const deferred = deferredItems.length + Math.max(0, queue.length - policy.maxQueueSize)
  const skipped = Math.max(0, queue.length - deduped.length)
  const cycleStatus = !scope.organizationId || !scope.userId
    ? 'failed'
    : failed > 0
      ? 'degraded'
      : deferred > 0 || staleItems.length > 0
        ? 'partial'
        : 'completed'
  const snapshot = {
    id: String(input.id ?? `scanner-cycle-${scope.organizationId ?? 'tenant'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    cycleStatus,
    policy,
    scannerCycleSummary: {
      queued,
      processed,
      skipped,
      stale: staleItems.length,
      failed,
      deferred,
      retried: retryableFailures.length,
      deduplicated: skipped,
      queueDepth: deferred,
      throughputPerSecond: round(processed / Math.max(1, policy.cycleDeadlineMs / 1000)),
      cycleDurationMs: Math.min(policy.cycleDeadlineMs, processedItems.length * 25),
      concurrencyUsed: Math.min(policy.concurrency, processedItems.length),
    },
    fairnessSummary: Array.from(byGroup.keys()).slice(0, 24).map((groupId) => ({
      groupId,
      processed: processedItems.filter((item) => item.groupId === groupId).length,
      deferred: deferredItems.filter((item) => item.groupId === groupId).length,
    })),
    sourceReferences: [
      { id: input.realtimeScanner?.eventType ?? 'scanner.realtime.evaluated', eventType: input.realtimeScanner?.eventType ?? null },
      { id: input.marketDataProviderResilience?.eventType ?? 'marketData.resilience.updated', eventType: input.marketDataProviderResilience?.eventType ?? null },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
  const eventType = cycleStatus === 'completed' ? SCANNER_CYCLE_COMPLETED_EVENT : cycleStatus === 'failed' || cycleStatus === 'degraded' ? SCANNER_CYCLE_DEGRADED_EVENT : SCANNER_BACKPRESSURE_UPDATED_EVENT
  const result = {
    eventType,
    timestamp,
    scannerThroughputSnapshot: snapshot,
    scannerThroughputSummary: snapshot.scannerCycleSummary,
    cycleStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Scanner cycle ${cycleStatus}: ${processed} processed, ${deferred} deferred, ${staleItems.length} stale, ${failed} failed.`,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SCANNER_CYCLE_STARTED_EVENT, { timestamp, tenantScope: scope, queued })
    eventBus.emit(eventType, result)
  }
  return result
}

export function createScannerThroughputRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.scannerThroughputSnapshot ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_scanner_cycle_summaries
          (id, organization_id, team_workspace_id, account_id, cycle_status, snapshot_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET cycle_status = EXCLUDED.cycle_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.cycleStatus, snapshot.createdAt, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, cycleStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (cycleStatus) { params.push(String(cycleStatus)); clauses.push(`cycle_status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_scanner_cycle_summaries
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY snapshot_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
