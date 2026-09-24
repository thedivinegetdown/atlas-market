export const GOVERNED_OBSERVATION_COVERAGE_VERSION = 'governed-observation-coverage-v1'

export const GOVERNED_OBSERVATION_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])

export const GOVERNED_OBSERVATION_STRATEGIES = Object.freeze([
  Object.freeze({ strategyId: 'breakout-momentum-v1', experimentId: 'BREAKOUT.1' }),
  Object.freeze({ strategyId: 'range-mean-reversion-v1', experimentId: 'RANGE.1' }),
  Object.freeze({ strategyId: 'volatility-expansion-v1', experimentId: 'VOL.1' }),
])

export const GOVERNED_OBSERVATION_CHECK_STATUSES = Object.freeze({
  candidate: 'COMPLETED_CANDIDATE',
  noCandidate: 'COMPLETED_NO_CANDIDATE',
  degraded: 'BLOCKED_DEGRADED',
  missed: 'MISSED_NOT_EVALUATED',
})

const TERMINAL_STATUSES = new Set(Object.values(GOVERNED_OBSERVATION_CHECK_STATUSES))

function checkId(sessionDate, experimentId, symbol) {
  return `${sessionDate}:${experimentId}:${symbol}`
}

function summarize(checks) {
  const counts = {
    completedCandidate: 0,
    completedNoCandidate: 0,
    blockedDegraded: 0,
    missedNotEvaluated: 0,
  }
  for (const check of checks) {
    if (check.status === GOVERNED_OBSERVATION_CHECK_STATUSES.candidate) counts.completedCandidate += 1
    else if (check.status === GOVERNED_OBSERVATION_CHECK_STATUSES.noCandidate) counts.completedNoCandidate += 1
    else if (check.status === GOVERNED_OBSERVATION_CHECK_STATUSES.degraded) counts.blockedDegraded += 1
    else counts.missedNotEvaluated += 1
  }
  return {
    expected: checks.length,
    evaluated: checks.length - counts.missedNotEvaluated,
    ...counts,
    status: counts.missedNotEvaluated > 0 ? 'INCOMPLETE' : counts.blockedDegraded > 0 ? 'DEGRADED' : 'COMPLETE',
    requiresOperatorAttention: counts.missedNotEvaluated > 0 || counts.blockedDegraded > 0,
  }
}

export function createGovernedObservationCoverage({ preparationId, createdAt, universe = GOVERNED_OBSERVATION_UNIVERSE, strategies = GOVERNED_OBSERVATION_STRATEGIES } = {}) {
  const timestamp = new Date(createdAt)
  if (!preparationId || Number.isNaN(timestamp.getTime())) throw new Error('governed observation coverage identity is invalid')
  const sessionDate = timestamp.toISOString().slice(0, 10)
  const checks = universe.flatMap((symbol) => strategies.map((strategy) => ({
    checkId: checkId(sessionDate, strategy.experimentId, symbol),
    symbol,
    strategyId: strategy.strategyId,
    experimentId: strategy.experimentId,
    status: GOVERNED_OBSERVATION_CHECK_STATUSES.missed,
    reason: 'not_evaluated',
    evaluatedAt: null,
    strategyFingerprint: null,
    evidenceFingerprint: null,
  })))
  return {
    version: GOVERNED_OBSERVATION_COVERAGE_VERSION,
    preparationId,
    sessionDate,
    createdAt: timestamp.toISOString(),
    checks,
    summary: summarize(checks),
    boundaries: {
      paperOnly: true,
      discoveryOnly: true,
      automaticExecution: false,
      edge2Included: false,
      edge2CountersIncremented: false,
    },
  }
}

export function recordGovernedObservationCheck(coverage, { symbol, strategyId, experimentId, status, reason, evaluatedAt, strategyFingerprint = null, evidenceFingerprint = null } = {}) {
  if (coverage?.version !== GOVERNED_OBSERVATION_COVERAGE_VERSION) throw new Error('governed observation coverage is invalid')
  if (!TERMINAL_STATUSES.has(status) || status === GOVERNED_OBSERVATION_CHECK_STATUSES.missed) throw new Error('governed observation check terminal status is invalid')
  const timestamp = new Date(evaluatedAt)
  if (Number.isNaN(timestamp.getTime())) throw new Error('governed observation check timestamp is invalid')
  const id = checkId(coverage.sessionDate, experimentId, symbol)
  let found = false
  const checks = coverage.checks.map((check) => {
    if (check.checkId !== id || check.strategyId !== strategyId) return check
    found = true
    return {
      ...check,
      status,
      reason: String(reason ?? '').trim() || null,
      evaluatedAt: timestamp.toISOString(),
      strategyFingerprint: strategyFingerprint ?? null,
      evidenceFingerprint: evidenceFingerprint ?? null,
    }
  })
  if (!found) throw new Error('governed observation check is outside the frozen coverage matrix')
  return { ...coverage, checks, summary: summarize(checks) }
}

export function governedObservationAttention(coverage) {
  if (coverage?.version !== GOVERNED_OBSERVATION_COVERAGE_VERSION) return null
  const checks = coverage.checks.filter((check) => (
    check.status === GOVERNED_OBSERVATION_CHECK_STATUSES.degraded
      || check.status === GOVERNED_OBSERVATION_CHECK_STATUSES.missed
  ))
  return {
    required: checks.length > 0,
    status: coverage.summary.status,
    count: checks.length,
    checks,
  }
}
