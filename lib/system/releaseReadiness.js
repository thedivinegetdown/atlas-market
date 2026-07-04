import { validateEnvironment } from '../config/environment.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_RELEASE_READINESS_EVALUATED_EVENT = 'system.releaseReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeMessage(error) {
  return error?.publicMessage ?? error?.message ?? 'release readiness check failed'
}

function buildCheck(name, status, message, metadata = {}) {
  return {
    name,
    status,
    passed: status === 'ready',
    message,
    ...metadata,
  }
}

function normalizeStatus(status) {
  if (status === 'passed' || status === 'healthy' || status === 'ready' || status === true) return 'ready'
  if (status === 'failed' || status === 'blocked' || status === 'error' || status === false) return 'blocked'
  return 'caution'
}

function summarizeStatuses(checks) {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'caution')) return 'caution'
  return 'ready'
}

export function validateReleaseEnvironment(env = {}) {
  try {
    const environment = validateEnvironment(env)
    return buildCheck('environment', 'ready', 'Environment is valid for paper trading release candidate', {
      nodeEnv: environment.nodeEnv,
      tradingMode: environment.tradingMode,
      databaseConfigured: Boolean(environment.databaseUrl),
    })
  } catch (error) {
    return buildCheck('environment', 'blocked', safeMessage(error), {
      errorCode: error?.code ?? 'environment_invalid',
    })
  }
}

export function validateAdapterHealth(adapters = []) {
  const normalizedAdapters = adapters.map((adapter) => ({
    name: adapter.name,
    provider: adapter.provider,
    status: normalizeStatus(adapter.status),
    paperTrading: adapter.paperTrading !== false,
    liveOrders: adapter.liveOrders === true,
  }))
  const blocked = normalizedAdapters.find((adapter) => adapter.liveOrders || !adapter.paperTrading || adapter.status === 'blocked')
  const caution = normalizedAdapters.find((adapter) => adapter.status === 'caution')

  if (blocked) {
    return buildCheck('adapterHealth', 'blocked', `${blocked.name ?? blocked.provider} is not release safe`, {
      adapters: normalizedAdapters,
    })
  }

  if (caution) {
    return buildCheck('adapterHealth', 'caution', `${caution.name ?? caution.provider} requires review`, {
      adapters: normalizedAdapters,
    })
  }

  return buildCheck('adapterHealth', 'ready', 'Market data and broker adapters are healthy and paper-only', {
    adapters: normalizedAdapters,
  })
}

export function validateEventContracts(contracts = []) {
  const missing = contracts.filter((contract) => contract.required !== false && contract.actual !== contract.expected)

  return missing.length > 0
    ? buildCheck('eventContracts', 'blocked', 'Required event contract validation failed', { missing })
    : buildCheck('eventContracts', 'ready', 'Required event contracts are present', {
        contractCount: contracts.length,
      })
}

export function validatePaperTradingSafety({ tradingMode = 'paper', brokerHealth, guardrails = [], executions = [] } = {}) {
  const liveOrdersDisabled = brokerHealth?.liveOrders !== true
  const brokerPaperOnly = brokerHealth?.paperTrading !== false
  const allGuardrailsPaper = guardrails.every((guardrail) => guardrail?.paperTrading === true)
  const allExecutionsPaper = executions.every((execution) => execution?.paperTrading === true)
  const safe = tradingMode === 'paper' && liveOrdersDisabled && brokerPaperOnly && allGuardrailsPaper && allExecutionsPaper

  return safe
    ? buildCheck('paperTradingSafety', 'ready', 'Paper trading safety is enforced across adapters and lifecycle outputs', {
        liveOrdersDisabled,
        guardrailCount: guardrails.length,
        executionCount: executions.length,
      })
    : buildCheck('paperTradingSafety', 'blocked', 'Paper trading safety validation failed', {
        tradingMode,
        liveOrdersDisabled,
        brokerPaperOnly,
        allGuardrailsPaper,
        allExecutionsPaper,
      })
}

export function validateTestBuildStatus({ tests, build } = {}) {
  const testStatus = normalizeStatus(tests?.status)
  const buildStatus = normalizeStatus(build?.status)
  const status = testStatus === 'blocked' || buildStatus === 'blocked'
    ? 'blocked'
    : testStatus === 'caution' || buildStatus === 'caution'
      ? 'caution'
      : 'ready'

  return buildCheck('testBuildStatus', status, status === 'ready'
    ? 'Test suite and production build are passing'
    : 'Test/build validation needs attention', {
    tests: {
      command: tests?.command ?? 'npm test',
      status: tests?.status ?? 'unknown',
      summary: tests?.summary ?? null,
    },
    build: {
      command: build?.command ?? 'npm run build',
      status: build?.status ?? 'unknown',
      summary: build?.summary ?? null,
    },
  })
}

export function evaluateReleaseReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const environmentCheck = validateReleaseEnvironment(input.env ?? { TRADING_MODE: 'paper' })
  const tradingMode = input.env?.TRADING_MODE ?? environmentCheck.tradingMode ?? 'paper'
  const checks = [
    environmentCheck,
    validateAdapterHealth(input.adapters ?? []),
    validateEventContracts(input.eventContracts ?? []),
    validatePaperTradingSafety({
      tradingMode,
      brokerHealth: input.brokerHealth,
      guardrails: input.guardrails ?? [],
      executions: input.executions ?? [],
    }),
    validateTestBuildStatus(input.validation ?? {}),
  ]
  const releaseReadinessStatus = summarizeStatuses(checks)
  const blockers = checks.filter((check) => check.status === 'blocked').map((check) => check.message)
  const cautions = checks.filter((check) => check.status === 'caution').map((check) => check.message)
  const result = {
    eventType: SYSTEM_RELEASE_READINESS_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    releaseReadinessStatus,
    ready: releaseReadinessStatus === 'ready',
    checks,
    blockers,
    cautions,
    summary: releaseReadinessStatus === 'ready'
      ? 'Atlas paper trading workspace is ready for release-candidate review.'
      : 'Atlas release candidate requires attention before release.',
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_RELEASE_READINESS_EVALUATED_EVENT, result)
  }

  return result
}

export function createReleaseReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateReleaseReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
