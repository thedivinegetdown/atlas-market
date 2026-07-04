import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT = 'system.releaseCandidate.stabilized'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (status === 'stable' || status === 'ready' || status === 'passed' || status === 'healthy' || status === true) return 'stable'
  if (status === 'blocked' || status === 'failed' || status === 'error' || status === false) return 'blocked'
  return 'caution'
}

function buildCheck(name, status, message, metadata = {}) {
  return {
    name,
    status,
    passed: status === 'stable',
    message,
    ...metadata,
  }
}

function summarizeFinalStatus(checks) {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'caution')) return 'caution'
  return 'stable'
}

export function buildRegressionChecklist(items = []) {
  const normalizedItems = items.map((item) => ({
    name: item.name,
    status: normalizeStatus(item.status),
    required: item.required !== false,
    evidence: item.evidence ?? null,
  }))
  const blocked = normalizedItems.filter((item) => item.required && item.status === 'blocked')
  const caution = normalizedItems.filter((item) => item.required && item.status === 'caution')
  const status = blocked.length > 0 ? 'blocked' : caution.length > 0 ? 'caution' : 'stable'

  return buildCheck('regressionChecklist', status, status === 'stable'
    ? 'Regression checklist is stable for the release candidate'
    : 'Regression checklist has release candidate findings', {
    items: normalizedItems,
    blockers: blocked.map((item) => item.name),
    cautions: caution.map((item) => item.name),
  })
}

export function summarizeCriticalModuleHealth(modules = []) {
  const normalizedModules = modules.map((module) => ({
    name: module.name,
    status: normalizeStatus(module.status),
    eventType: module.eventType ?? null,
    required: module.required !== false,
  }))
  const blocked = normalizedModules.filter((module) => module.required && module.status === 'blocked')
  const caution = normalizedModules.filter((module) => module.required && module.status === 'caution')
  const status = blocked.length > 0 ? 'blocked' : caution.length > 0 ? 'caution' : 'stable'

  return buildCheck('criticalModuleHealth', status, status === 'stable'
    ? 'Critical paper-trading modules are stable'
    : 'Critical module health requires review', {
    modules: normalizedModules,
    blockers: blocked.map((module) => module.name),
    cautions: caution.map((module) => module.name),
  })
}

export function summarizeDashboardSmokeTests(smokeTests = []) {
  const normalizedSmokeTests = smokeTests.map((test) => ({
    name: test.name,
    status: normalizeStatus(test.status),
    panel: test.panel ?? test.name,
  }))
  const blocked = normalizedSmokeTests.filter((test) => test.status === 'blocked')
  const caution = normalizedSmokeTests.filter((test) => test.status === 'caution')
  const status = blocked.length > 0 ? 'blocked' : caution.length > 0 ? 'caution' : 'stable'

  return buildCheck('dashboardSmokeTests', status, status === 'stable'
    ? 'Dashboard smoke-test summary is stable'
    : 'Dashboard smoke tests need review', {
    smokeTests: normalizedSmokeTests,
    blockers: blocked.map((test) => test.panel),
    cautions: caution.map((test) => test.panel),
  })
}

export function checkEventPipelineIntegrity(events = []) {
  const normalizedEvents = events.map((event, index) => ({
    index,
    eventType: event.eventType,
    status: event.status ?? 'observed',
    timestamp: event.timestamp ?? null,
  }))
  const missing = normalizedEvents.filter((event) => !event.eventType)
  const duplicated = normalizedEvents
    .filter((event, index, all) => event.eventType && all.findIndex((candidate) => candidate.eventType === event.eventType) !== index)
    .map((event) => event.eventType)

  if (missing.length > 0) {
    return buildCheck('eventPipelineIntegrity', 'blocked', 'Event pipeline has missing event types', {
      events: normalizedEvents,
      missing,
      duplicated,
    })
  }

  return buildCheck('eventPipelineIntegrity', duplicated.length > 0 ? 'caution' : 'stable', duplicated.length > 0
    ? 'Event pipeline has duplicate event observations'
    : 'Event pipeline integrity is stable', {
    events: normalizedEvents,
    duplicated,
  })
}

export function verifyPaperTradingSafetyLock({ releaseReadiness, brokerHealth, guardrails = [], executions = [] } = {}) {
  const readinessSafe = releaseReadiness?.releaseReadinessStatus === 'ready' || releaseReadiness?.ready === true
  const brokerSafe = brokerHealth?.paperTrading !== false && brokerHealth?.liveOrders !== true
  const guardrailsSafe = guardrails.every((guardrail) => guardrail?.paperTrading === true)
  const executionsSafe = executions.every((execution) => execution?.paperTrading === true)
  const status = readinessSafe && brokerSafe && guardrailsSafe && executionsSafe ? 'stable' : 'blocked'

  return buildCheck('paperTradingSafetyLock', status, status === 'stable'
    ? 'Paper-trading safety lock is verified'
    : 'Paper-trading safety lock failed verification', {
    readinessSafe,
    brokerSafe,
    guardrailsSafe,
    executionsSafe,
  })
}

export function verifyAdapterMockMode(adapters = []) {
  const normalizedAdapters = adapters.map((adapter) => ({
    name: adapter.name,
    provider: adapter.provider,
    default: adapter.default === true,
    paperTrading: adapter.paperTrading !== false,
    mockMode: adapter.mockMode !== false && /mock|paper/i.test(`${adapter.provider ?? ''} ${adapter.name ?? ''}`),
    liveOrders: adapter.liveOrders === true,
  }))
  const unsafe = normalizedAdapters.filter((adapter) => !adapter.paperTrading || adapter.liveOrders || !adapter.mockMode)

  return buildCheck('adapterMockMode', unsafe.length > 0 ? 'blocked' : 'stable', unsafe.length > 0
    ? 'Adapter mock-mode verification failed'
    : 'Adapters are verified in mock paper mode', {
    adapters: normalizedAdapters,
    blockers: unsafe.map((adapter) => adapter.name ?? adapter.provider),
  })
}

export function evaluateReleaseCandidateStabilization(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const checks = [
    buildRegressionChecklist(input.regressionChecklist ?? []),
    summarizeCriticalModuleHealth(input.criticalModules ?? []),
    summarizeDashboardSmokeTests(input.dashboardSmokeTests ?? []),
    checkEventPipelineIntegrity(input.eventPipeline ?? []),
    verifyPaperTradingSafetyLock({
      releaseReadiness: input.releaseReadiness,
      brokerHealth: input.brokerHealth,
      guardrails: input.guardrails ?? [],
      executions: input.executions ?? [],
    }),
    verifyAdapterMockMode(input.adapters ?? []),
  ]
  const finalStatus = summarizeFinalStatus(checks)
  const releaseBlockers = checks.flatMap((check) => check.blockers ?? [])
  const cautions = checks.flatMap((check) => check.cautions ?? [])
  const result = {
    eventType: SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT,
    paperTrading: true,
    timestamp,
    finalStatus,
    stable: finalStatus === 'stable',
    checks,
    releaseBlockers,
    cautions,
    criticalModuleHealthSummary: checks.find((check) => check.name === 'criticalModuleHealth'),
    dashboardSmokeTestSummary: checks.find((check) => check.name === 'dashboardSmokeTests'),
    eventPipelineIntegrity: checks.find((check) => check.name === 'eventPipelineIntegrity'),
    summary: finalStatus === 'stable'
      ? 'Atlas paper-trading operating system is stable for release-candidate review.'
      : 'Atlas release candidate has stabilization findings before review.',
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT, result)
  }

  return result
}

export function createReleaseCandidateStabilizationEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateReleaseCandidateStabilization(input, { ...options, ...evaluationOptions })
    },
  }
}
