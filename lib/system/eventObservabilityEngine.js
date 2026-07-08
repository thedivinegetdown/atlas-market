import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_EVENTS_OBSERVED_EVENT = 'system.events.observed'

const defaultCriticalEventTypes = Object.freeze([
  'portfolio.risk.evaluated',
  'trade.guardrail.evaluated',
  'trade.execution.simulated',
  'ai.decision.orchestrated',
  'system.releaseReadiness.evaluated',
  'system.releaseCandidate.stabilized',
])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeStatus(status) {
  if (status === true || ['ready', 'stable', 'healthy', 'approved', 'filled', 'recorded', 'evaluated', 'updated', 'recommended', 'completed', 'clear', 'controlled'].includes(status)) return 'healthy'
  if (status === false || ['blocked', 'failed', 'critical', 'rejected', 'error', 'degraded'].includes(status)) return 'degraded'
  return 'caution'
}

function inferFamily(eventType = '') {
  if (eventType.startsWith('research.')) return 'research'
  if (eventType.startsWith('strategy.')) return 'strategy'
  if (eventType.startsWith('portfolio.optimization')) return 'optimization'
  if (eventType.startsWith('portfolio.')) return 'portfolio'
  if (eventType.startsWith('trade.')) return 'trading'
  if (eventType.startsWith('market.')) return 'market'
  if (eventType.startsWith('ai.')) return 'ai'
  if (eventType.startsWith('system.')) return 'system'
  if (eventType.includes('adapter') || eventType.startsWith('broker.')) return 'adapter'
  return 'other'
}

function normalizeEventRecord(event = {}, index) {
  const eventType = event.eventType ?? event.type ?? null
  return {
    index,
    label: event.label ?? event.name ?? eventType ?? `event-${index + 1}`,
    eventType,
    family: event.family ?? inferFamily(eventType),
    status: event.status ?? event.finalStatus ?? event.releaseReadinessStatus ?? event.finalDecision ?? event.governanceStatus ?? 'observed',
    normalizedStatus: normalizeStatus(event.status ?? event.finalStatus ?? event.releaseReadinessStatus ?? event.finalDecision ?? event.governanceStatus ?? 'healthy'),
    timestamp: event.timestamp ?? event.checkedAt ?? null,
    source: event.source ?? 'event-catalog',
    paperTrading: event.paperTrading !== false,
  }
}

function collectEvents(input = {}) {
  const timelineEvents = input.events ?? input.eventTimeline ?? []
  const outputEvents = Object.entries(input.eventOutputs ?? {})
    .map(([label, output]) => output?.eventType ? {
      label,
      eventType: output.eventType,
      status: output.status ?? output.finalStatus ?? output.releaseReadinessStatus ?? output.finalDecision ?? output.governanceStatus ?? output.finalWalkForwardStatus ?? output.factorRiskStatus ?? output.correlationRiskStatus ?? output.recommendationPriority ?? 'observed',
      timestamp: output.timestamp ?? output.health?.checkedAt,
      paperTrading: output.paperTrading,
      source: 'event-output',
    } : null)
    .filter(Boolean)

  return [...timelineEvents, ...outputEvents]
    .map((event, index) => normalizeEventRecord(event, index))
}

function buildEventCatalogSummary(events = []) {
  const eventTypes = events.map((event) => event.eventType).filter(Boolean)
  return {
    totalEvents: events.length,
    uniqueEventTypes: new Set(eventTypes).size,
    paperTradingEvents: events.filter((event) => event.paperTrading).length,
    degradedEvents: events.filter((event) => event.normalizedStatus === 'degraded').length,
    cautionEvents: events.filter((event) => event.normalizedStatus === 'caution').length,
  }
}

function groupEventFamilies(events = []) {
  const families = new Map()
  for (const event of events) {
    const current = families.get(event.family) ?? {
      family: event.family,
      totalEvents: 0,
      uniqueEventTypes: new Set(),
      latestTimestamp: null,
      degradedEvents: 0,
      cautionEvents: 0,
    }
    current.totalEvents += 1
    if (event.eventType) current.uniqueEventTypes.add(event.eventType)
    if (event.normalizedStatus === 'degraded') current.degradedEvents += 1
    if (event.normalizedStatus === 'caution') current.cautionEvents += 1
    if (event.timestamp && (!current.latestTimestamp || new Date(event.timestamp) > new Date(current.latestTimestamp))) {
      current.latestTimestamp = event.timestamp
    }
    families.set(event.family, current)
  }

  return Array.from(families.values())
    .map((family) => ({
      ...family,
      uniqueEventTypes: family.uniqueEventTypes.size,
      status: family.degradedEvents > 0 ? 'degraded' : family.cautionEvents > 0 ? 'caution' : 'healthy',
    }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

function checkEventFreshness(events = [], { now, maxEventAgeMs }) {
  const nowMs = new Date(now).getTime()
  const checkedEvents = events.map((event) => {
    const timestampMs = event.timestamp ? new Date(event.timestamp).getTime() : Number.NaN
    const ageMs = Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : null
    const fresh = ageMs !== null && ageMs <= maxEventAgeMs
    return {
      eventType: event.eventType,
      family: event.family,
      timestamp: event.timestamp,
      ageMs,
      fresh,
    }
  })
  const staleEvents = checkedEvents.filter((event) => !event.fresh)

  return {
    maxEventAgeMs,
    checkedCount: checkedEvents.length,
    freshCount: checkedEvents.length - staleEvents.length,
    staleCount: staleEvents.length,
    staleEvents,
    status: staleEvents.length === 0 ? 'healthy' : 'caution',
  }
}

function detectMissingEvents(events = [], requiredEventTypes = []) {
  const observed = new Set(events.map((event) => event.eventType).filter(Boolean))
  const missing = requiredEventTypes.filter((eventType) => !observed.has(eventType))
  return {
    requiredCount: requiredEventTypes.length,
    missingCount: missing.length,
    missingEventTypes: missing,
    status: missing.length === 0 ? 'healthy' : 'degraded',
  }
}

function detectDuplicateEvents(events = []) {
  const counts = new Map()
  for (const event of events) {
    if (!event.eventType) continue
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1)
  }
  const duplicates = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([eventType, count]) => ({ eventType, count }))

  return {
    duplicateCount: duplicates.length,
    duplicates,
    status: duplicates.length === 0 ? 'healthy' : 'caution',
  }
}

function evaluateCriticalEventHealth({ events, criticalEventTypes, freshnessCheck }) {
  const observed = new Set(events.map((event) => event.eventType).filter(Boolean))
  const staleCritical = new Set((freshnessCheck.staleEvents ?? [])
    .filter((event) => criticalEventTypes.includes(event.eventType))
    .map((event) => event.eventType))
  const missingCritical = criticalEventTypes.filter((eventType) => !observed.has(eventType))
  const degradedCritical = events
    .filter((event) => criticalEventTypes.includes(event.eventType) && event.normalizedStatus === 'degraded')
    .map((event) => event.eventType)
  const status = missingCritical.length > 0 || degradedCritical.length > 0
    ? 'degraded'
    : staleCritical.size > 0
      ? 'caution'
      : 'healthy'

  return {
    status,
    criticalEventTypes,
    observedCriticalCount: criticalEventTypes.length - missingCritical.length,
    missingCritical,
    degradedCritical,
    staleCritical: Array.from(staleCritical),
  }
}

function deriveObservabilityStatus({ missingEventDetection, duplicateEventDetection, eventFreshnessCheck, criticalEventHealthStatus, releaseReadiness, releaseCandidateStabilization }) {
  if (
    missingEventDetection.status === 'degraded'
    || criticalEventHealthStatus.status === 'degraded'
    || releaseReadiness?.releaseReadinessStatus === 'blocked'
    || releaseCandidateStabilization?.finalStatus === 'blocked'
  ) {
    return 'degraded'
  }
  if (
    duplicateEventDetection.status === 'caution'
    || eventFreshnessCheck.status === 'caution'
    || criticalEventHealthStatus.status === 'caution'
    || releaseReadiness?.releaseReadinessStatus === 'caution'
    || releaseCandidateStabilization?.finalStatus === 'caution'
  ) {
    return 'caution'
  }
  return 'healthy'
}

export function observeSystemEvents(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const now = options.now ?? input.now ?? timestamp
  const maxEventAgeMs = numberValue(input.maxEventAgeMs ?? options.maxEventAgeMs, 1000 * 60 * 60 * 24 * 30)
  const events = collectEvents(input)
  const requiredEventTypes = input.requiredEventTypes ?? defaultCriticalEventTypes
  const criticalEventTypes = input.criticalEventTypes ?? defaultCriticalEventTypes
  const eventCatalogSummary = buildEventCatalogSummary(events)
  const eventFamilyGrouping = groupEventFamilies(events)
  const eventFreshnessCheck = checkEventFreshness(events, { now, maxEventAgeMs })
  const missingEventDetection = detectMissingEvents(events, requiredEventTypes)
  const duplicateEventDetection = detectDuplicateEvents(events)
  const criticalEventHealthStatus = evaluateCriticalEventHealth({
    events,
    criticalEventTypes,
    freshnessCheck: eventFreshnessCheck,
  })
  const observabilityStatus = deriveObservabilityStatus({
    missingEventDetection,
    duplicateEventDetection,
    eventFreshnessCheck,
    criticalEventHealthStatus,
    releaseReadiness: input.releaseReadiness,
    releaseCandidateStabilization: input.releaseCandidateStabilization,
  })
  const result = {
    eventType: SYSTEM_EVENTS_OBSERVED_EVENT,
    paperTrading: true,
    timestamp,
    observabilityStatus,
    eventCatalogSummary,
    eventFamilyGrouping,
    eventFreshnessCheck,
    missingEventDetection,
    duplicateEventDetection,
    criticalEventHealthStatus,
    summary: `System event observability ${observabilityStatus}: ${eventCatalogSummary.uniqueEventTypes} unique event contracts across ${eventFamilyGrouping.length} families.`,
    sourceEvents: {
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
      releaseCandidateStabilization: input.releaseCandidateStabilization?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_EVENTS_OBSERVED_EVENT, result)
  }

  return result
}

export function createEventObservabilityEngine(options = {}) {
  return {
    observe(input, observationOptions = {}) {
      return observeSystemEvents(input, { ...options, ...observationOptions })
    },
  }
}
